/**
 * File 3/10: Store.gs — Google Sheets as the database.
 *
 *  - One tab per table, header row = system columns + schema fields.
 *  - Reads load a table once per request into memory.
 *  - Writes are applied to the in-memory copy first and flushed with `commit()`;
 *    `rollback()` simply drops the copy, so a failed validation never half-writes.
 *  - String columns are formatted as plain text ('@') so values that start with
 *    = + - @ can never be evaluated as spreadsheet formulas.
 *  - Values larger than a cell can hold are moved to a Drive blob (see Files.gs).
 */
var SYS_COLS = ['id', 'createdAt', 'updatedAt', 'rev'];

var Store = (function () {
  var ssCache = null;
  var mem = {};        // table -> { rows:[], byId:{}, rowOf:{}, nextRow:int }
  var dirty = {};      // table -> { rewrite:bool, ins:[ids], upd:{id:true} }
  var appendQ = {};    // table -> [rows]   (append-only tables, never loaded)
  var verCache = null;
  var verDirty = {};
  var newBlobs = [];   // blob file ids created in this request (cleaned on rollback)
  var oldBlobs = [];   // blob file ids superseded in this request (trashed on commit)

  function spreadsheet() {
    if (ssCache) return ssCache;
    var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!id) throw new AppError('NOT_SETUP', 'Server is not set up: run setup() in the Apps Script editor', 503);
    ssCache = SpreadsheetApp.openById(id);
    return ssCache;
  }
  function def(table) {
    var d = SCHEMA[table];
    if (!d) throw E.bad('Unknown table: ' + table);
    return d;
  }
  function columns(table) { return SYS_COLS.concat(def(table).fields.map(function (f) { return f.name; })); }
  function fieldMap(table) {
    var d = def(table);
    if (!d._map) { d._map = {}; d.fields.forEach(function (f) { d._map[f.name] = f; }); }
    return d._map;
  }
  function sheet(table) {
    var sh = spreadsheet().getSheetByName(def(table).sheet);
    if (!sh) throw new AppError('NOT_SETUP', 'Sheet "' + def(table).sheet + '" is missing: run setup()', 503);
    return sh;
  }

  // ------------------------------------------------------------ coercion
  function fromCell(f, v) {
    if (f.type === 'b') return v === true || v === 'TRUE' || v === 'true' || v === 1;
    if (f.type === 'n' || f.type === 'i') {
      if (v === '' || v === null || v === undefined) return f.def !== undefined ? f.def : 0;
      var n = Number(v);
      return isFinite(n) ? n : (f.def !== undefined ? f.def : 0);
    }
    return v === null || v === undefined ? '' : String(v);
  }
  function rowToObj(table, cols, vals) {
    var fm = fieldMap(table), o = {};
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      if (c === 'rev') o.rev = Number(vals[i]) || 1;
      else if (fm[c]) o[c] = fromCell(fm[c], vals[i]);
      else o[c] = vals[i] === null || vals[i] === undefined ? '' : String(vals[i]);
    }
    return o;
  }
  function objToArr(table, cols, o) {
    var fm = fieldMap(table);
    return cols.map(function (c) {
      var v = o[c];
      if (c === 'rev') return o.rev || 1;
      var f = fm[c];
      if (!f) return v === undefined ? '' : v;
      if (f.type === 'b') return v === true;
      if (f.type === 'n' || f.type === 'i') return typeof v === 'number' && isFinite(v) ? v : (f.def !== undefined ? f.def : 0);
      return v === undefined || v === null ? '' : String(v);
    });
  }

  // ------------------------------------------------------------ loading
  function load(table) {
    if (mem[table]) return mem[table];
    var sh = sheet(table), cols = columns(table);
    var last = sh.getLastRow();
    var data = last >= 1 ? sh.getRange(1, 1, last, cols.length).getValues() : [[]];
    if (!data[0] || data[0].join('|') !== cols.join('|')) {
      throw new AppError('SCHEMA_MISMATCH', 'Header of sheet "' + def(table).sheet + '" does not match the schema. Run setup() again; do not rename or reorder columns.', 500);
    }
    var t = { rows: [], byId: {}, rowOf: {}, nextRow: Math.max(last, 1) + 1 };
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === '' || data[i][0] === null) continue;
      var o = rowToObj(table, cols, data[i]);
      t.rows.push(o); t.byId[o.id] = o; t.rowOf[o.id] = i + 1;
    }
    mem[table] = t;
    return t;
  }
  function mark(table) { return dirty[table] || (dirty[table] = { rewrite: false, ins: [], upd: {} }); }

  // ------------------------------------------------------------ blobs (values too big for a cell)
  function packBlobs(table, id, o, prev) {
    var fm = fieldMap(table);
    def(table).fields.forEach(function (f) {
      if (f.type !== 's' && f.type !== 'j') return;
      var v = o[f.name];
      if (typeof v !== 'string') return;
      var prevPtr = prev && typeof prev[f.name] === 'string' && prev[f.name].indexOf('@blob:') === 0 ? prev[f.name] : '';
      if (v.indexOf('@blob:') === 0) return; // already a pointer (restore path keeps pointers it created)
      if (v.length > APP.BLOB_THRESHOLD) {
        var ptr = Blobs.put(table, id, f.name, v, prevPtr ? prevPtr.slice(6) : '');
        if (!prevPtr || prevPtr.slice(6) !== ptr) newBlobs.push(ptr);
        o[f.name] = '@blob:' + ptr;
      } else if (prevPtr) {
        oldBlobs.push(prevPtr.slice(6));
      }
    });
  }

  // ------------------------------------------------------------ public API
  var api = {
    columns: columns,
    def: def,
    fieldMap: fieldMap,

    all: function (table) { return load(table).rows; },
    get: function (table, id) { return load(table).byId[id] || null; },
    find: function (table, pred) {
      var rows = load(table).rows;
      for (var i = 0; i < rows.length; i++) if (pred(rows[i])) return rows[i];
      return null;
    },
    filter: function (table, pred) { return load(table).rows.filter(pred); },

    /** Returns a copy of `row` where blob pointers are replaced with their content. */
    expand: function (table, row) {
      var o = {};
      for (var k in row) o[k] = row[k];
      def(table).fields.forEach(function (f) {
        var v = o[f.name];
        if (typeof v === 'string' && v.indexOf('@blob:') === 0) o[f.name] = Blobs.get(v.slice(6));
      });
      return o;
    },

    insert: function (table, o) {
      var t = load(table);
      if (!o.id) throw new Error('insert without id');
      if (t.byId[o.id]) throw E.conflict('Duplicate id ' + o.id);
      var ts = nowIso_();
      o.createdAt = o.createdAt || ts; o.updatedAt = ts; o.rev = 1;
      packBlobs(table, o.id, o, null);
      t.rows.push(o); t.byId[o.id] = o; t.rowOf[o.id] = t.nextRow++;
      mark(table).ins.push(o.id);
      verDirty[table] = true;
      return o;
    },
    /** Keeps createdAt/updatedAt/rev exactly as given (restore & migration). */
    insertRaw: function (table, o) {
      var t = load(table);
      if (t.byId[o.id]) throw E.conflict('Duplicate id ' + o.id);
      o.rev = o.rev || 1; o.createdAt = o.createdAt || nowIso_(); o.updatedAt = o.updatedAt || o.createdAt;
      packBlobs(table, o.id, o, null);
      t.rows.push(o); t.byId[o.id] = o; t.rowOf[o.id] = t.nextRow++;
      mark(table).ins.push(o.id);
      verDirty[table] = true;
      return o;
    },
    update: function (table, id, patch) {
      var t = load(table), cur = t.byId[id];
      if (!cur) throw E.notFound('Record not found');
      var prev = {};
      for (var k in cur) prev[k] = cur[k];
      for (var p in patch) cur[p] = patch[p];
      cur.updatedAt = nowIso_(); cur.rev = (cur.rev || 1) + 1;
      packBlobs(table, id, cur, prev);
      var d = mark(table);
      if (t.rowOf[id] && d.ins.indexOf(id) < 0) d.upd[id] = true;
      verDirty[table] = true;
      return cur;
    },
    remove: function (table, id) {
      var t = load(table), cur = t.byId[id];
      if (!cur) return false;
      def(table).fields.forEach(function (f) {
        if (typeof cur[f.name] === 'string' && cur[f.name].indexOf('@blob:') === 0) oldBlobs.push(cur[f.name].slice(6));
      });
      t.rows = t.rows.filter(function (r) { return r.id !== id; });
      delete t.byId[id];
      mark(table).rewrite = true;
      verDirty[table] = true;
      return true;
    },
    /** Replace the complete content of a table (restore). */
    replaceAll: function (table, rows) {
      load(table).rows.forEach(function (r) {   // pointers of the rows being replaced become garbage
        def(table).fields.forEach(function (f) {
          if (typeof r[f.name] === 'string' && r[f.name].indexOf('@blob:') === 0) oldBlobs.push(r[f.name].slice(6));
        });
      });
      var t = { rows: [], byId: {}, rowOf: {}, nextRow: 2 };
      mem[table] = t;
      rows.forEach(function (r) {
        packBlobs(table, r.id, r, null);
        t.rows.push(r); t.byId[r.id] = r;
      });
      mark(table).rewrite = true;
      verDirty[table] = true;
    },
    append: function (table, o) {
      (appendQ[table] = appendQ[table] || []).push(o);
      verDirty[table] = true;
    },
    /** Last `n` rows of a table without loading all of it (audit log). */
    tail: function (table, n, skipNewest) {
      var sh = sheet(table), cols = columns(table), last = sh.getLastRow();
      if (last < 2) return [];
      var end = last - (skipNewest || 0);
      if (end < 2) return [];
      var start = Math.max(2, end - n + 1);
      var vals = sh.getRange(start, 1, end - start + 1, cols.length).getValues();
      var out = [];
      for (var i = vals.length - 1; i >= 0; i--) if (vals[i][0] !== '') out.push(rowToObj(table, cols, vals[i]));
      return out;
    },
    count: function (table) { return Math.max(0, sheet(table).getLastRow() - 1); },

    // ------------------------------------------------------------ versions (cache invalidation for clients)
    versions: function () {
      if (verCache) return verCache;
      var raw = PropertiesService.getScriptProperties().getProperty('VERSIONS');
      try { verCache = raw ? JSON.parse(raw) : {}; } catch (e) { verCache = {}; }
      return verCache;
    },
    version: function (table) { return api.versions()[table] || 1; },

    // ------------------------------------------------------------ transaction end
    commit: function () {
      var touched = {};
      Object.keys(dirty).forEach(function (table) {
        var ch = dirty[table], t = mem[table], sh = sheet(table), cols = columns(table);
        var nUpd = Object.keys(ch.upd).length;
        if (ch.rewrite || nUpd > 25) {
          var oldLast = sh.getLastRow();
          if (oldLast >= 2) sh.getRange(2, 1, oldLast - 1, cols.length).clearContent();
          if (t.rows.length) {
            ensureCapacity(sh, t.rows.length + 1);
            sh.getRange(2, 1, t.rows.length, cols.length).setValues(t.rows.map(function (r) { return objToArr(table, cols, r); }));
          }
          t.rows.forEach(function (r, i) { t.rowOf[r.id] = i + 2; });
          t.nextRow = t.rows.length + 2;
        } else {
          Object.keys(ch.upd).forEach(function (id) {
            sh.getRange(t.rowOf[id], 1, 1, cols.length).setValues([objToArr(table, cols, t.byId[id])]);
          });
          if (ch.ins.length) {
            var first = t.rowOf[ch.ins[0]];
            ensureCapacity(sh, first + ch.ins.length - 1);
            sh.getRange(first, 1, ch.ins.length, cols.length).setValues(ch.ins.map(function (id) { return objToArr(table, cols, t.byId[id]); }));
          }
        }
        touched[table] = true;
      });
      Object.keys(appendQ).forEach(function (table) {
        var rows = appendQ[table], sh = sheet(table), cols = columns(table);
        var start = Math.max(sh.getLastRow(), 1) + 1;
        ensureCapacity(sh, start + rows.length - 1);
        sh.getRange(start, 1, rows.length, cols.length).setValues(rows.map(function (r) { return objToArr(table, cols, r); }));
        touched[table] = true;
      });
      // versions
      var vs = api.versions(), before = {}, after = {}, changed = false;
      Object.keys(verDirty).forEach(function (table) {
        before[table] = vs[table] || 1;
        vs[table] = before[table] + 1;
        after[table] = vs[table];
        changed = true;
      });
      if (changed) PropertiesService.getScriptProperties().setProperty('VERSIONS', JSON.stringify(vs));
      oldBlobs.forEach(function (id) { Blobs.trash(id); });
      var result = { before: before, after: after };
      resetTx();
      return result;
    },
    rollback: function () {
      newBlobs.forEach(function (id) { try { Blobs.trash(id); } catch (e) { /* ignore */ } });
      resetTx();
      mem = {};
    },
    /** Drop in-memory copies (used after external edits such as restore). */
    flush: function () { mem = {}; resetTx(); },

    // ------------------------------------------------------------ setup
    ensureSheets: function () {
      var ss = spreadsheet(), created = [], upgraded = [];
      Object.keys(SCHEMA).forEach(function (table) {
        var d = SCHEMA[table], cols = columns(table), sh = ss.getSheetByName(d.sheet);
        if (!sh) {
          sh = ss.insertSheet(d.sheet);
          sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#fef3c7');
          sh.setFrozenRows(1);
          formatTextColumns(sh, table, cols);
          created.push(d.sheet);
        } else {
          var width = Math.max(sh.getLastColumn(), 1);
          var header = sh.getRange(1, 1, 1, width).getValues()[0].filter(function (x) { return x !== ''; });
          if (header.join('|') !== cols.join('|')) {
            if (header.length < cols.length && header.join('|') === cols.slice(0, header.length).join('|')) {
              // new columns appended at the end in a newer schema version
              sh.getRange(1, header.length + 1, 1, cols.length - header.length).setValues([cols.slice(header.length)]).setFontWeight('bold').setBackground('#fef3c7');
              formatTextColumns(sh, table, cols);
              upgraded.push(d.sheet);
            } else {
              throw new AppError('SCHEMA_MISMATCH', 'Sheet "' + d.sheet + '" has unexpected columns. Expected: ' + cols.join(', '), 500);
            }
          }
        }
      });
      var def1 = ss.getSheetByName('Sheet1');
      if (def1 && ss.getSheets().length > 1) ss.deleteSheet(def1);
      return { created: created, upgraded: upgraded };
    }
  };

  function ensureCapacity(sh, rowsNeeded) {
    var max = sh.getMaxRows();
    if (rowsNeeded > max) sh.insertRowsAfter(max, rowsNeeded - max + 200);
  }
  function formatTextColumns(sh, table, cols) {
    var fm = fieldMap(table), maxRows = Math.max(sh.getMaxRows() - 1, 1);
    cols.forEach(function (c, i) {
      var f = fm[c];
      var isText = c === 'id' || c === 'createdAt' || c === 'updatedAt' || (f && (f.type === 's' || f.type === 'j'));
      if (isText) sh.getRange(2, i + 1, maxRows, 1).setNumberFormat('@');
    });
  }
  function resetTx() { dirty = {}; appendQ = {}; verDirty = {}; newBlobs = []; oldBlobs = []; verCache = null; }

  api.reset = function () { mem = {}; resetTx(); ssCache = null; };
  return api;
})();
