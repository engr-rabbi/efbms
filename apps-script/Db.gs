/**
 * File 4/10: Db.gs — authorization policy, validation, generic CRUD.
 *
 * Every request that touches data goes through here, so the browser can never
 * read or write something the signed-in user's role / project membership does
 * not allow, no matter what the UI shows.
 */

// ------------------------------------------------------------------ policy
var Policy = {
  _acc: null,
  reset: function () { Policy._acc = null; },

  isAdmin: function (u) { return u.role === 'SUPER_ADMIN'; },

  roleAllows: function (user, table, op) {
    var p = POLICY[table];
    if (!p) return false;
    var list = op === 'read' ? p.read : p.write[op];
    return !!list && list.indexOf(user.role) >= 0;
  },
  assertRole: function (user, table, op) {
    if (!Policy.roleAllows(user, table, op)) throw E.forbidden('Your role (' + user.role + ') may not ' + op + ' ' + table);
  },

  /** Set of project ids the user may access (null = all). */
  accessible: function (user) {
    if (Policy.isAdmin(user)) return null;
    if (Policy._acc && Policy._acc.uid === user.id) return Policy._acc.set;
    var set = {};
    Store.all('projects').forEach(function (p) {
      if (p.ownerId === user.id || (p.members && (',' + p.members + ',').indexOf(',' + user.id + ',') >= 0)) set[p.id] = true;
    });
    Policy._acc = { uid: user.id, set: set };
    return set;
  },
  canProject: function (user, projectId) {
    var set = Policy.accessible(user);
    return set === null || !!set[projectId];
  },
  assertProject: function (user, projectId) {
    if (!projectId || !Store.get('projects', projectId)) throw E.notFound('Project not found');
    if (!Policy.canProject(user, projectId)) throw E.forbidden('You are not a member of this project');
  },
  isOwnerOrAdmin: function (user, project) { return Policy.isAdmin(user) || project.ownerId === user.id; },

  rowVisible: function (user, table, row) {
    var d = SCHEMA[table];
    if (table === 'projects') return Policy.canProject(user, row.id);
    if (table === 'settings') return Policy.isAdmin(user) || SETTINGS_WRITABLE_PREFIXES.some(function (p) { return row.id.indexOf(p) === 0; }) || row.id.indexOf('ui.') === 0;
    if (d.projectCol) {
      if (!row.projectId) return !!d.optionalProject;
      return Policy.canProject(user, row.projectId);
    }
    return true;
  },

  /** Public copy of a row: hidden fields removed, blobs expanded, viewer redactions applied. */
  present: function (user, table, row) {
    var o = Store.expand(table, row);
    (SCHEMA[table].hidden || []).forEach(function (k) { delete o[k]; });
    if (user.role === 'VIEWER' && table === 'quotations') {
      o.totalCost = 0;
      try {
        var items = JSON.parse(o.items || '[]');
        if (Array.isArray(items)) {
          items.forEach(function (i) { if (i && typeof i === 'object') { delete i.totalCost; delete i.unitPurchasePrice; } });
          o.items = JSON.stringify(items);
        }
      } catch (e) { /* leave as is */ }
    }
    return o;
  }
};

// ------------------------------------------------------------------ validation
function coerce_(table, f, v) {
  var label = table + '.' + f.name;
  if (f.type === 's') {
    if (v === null || v === undefined) v = '';
    if (typeof v === 'object') throw E.validation(label + ' must be text');
    v = String(v);
    if (f.lower) v = v.toLowerCase();
    if (f.lower || f.name === 'code' || f.name === 'key') v = v.trim();
    if (f.max && v.length > f.max) throw E.validation(label + ' is too long (max ' + f.max + ')');
    if (f.enum) {
      if (v === '' && f.def !== undefined) v = f.def;
      if (ENUMS[f.enum].indexOf(v) < 0) throw E.validation(label + ' must be one of ' + ENUMS[f.enum].join(', '));
    }
    if (f.pattern && v !== '' && !f.pattern.test(v)) throw E.validation(label + ' has an invalid format');
    return v;
  }
  if (f.type === 'n' || f.type === 'i') {
    if (typeof v === 'string' && v.trim() !== '') v = Number(v);
    if (typeof v !== 'number' || !isFinite(v)) throw E.validation(label + ' must be a number');
    if (f.type === 'i') v = Math.round(v);
    if (f.min !== undefined && v < f.min) throw E.validation(label + ' must be at least ' + f.min);
    if (f.maxv !== undefined && v > f.maxv) throw E.validation(label + ' must be at most ' + f.maxv);
    return v;
  }
  if (f.type === 'b') {
    if (v === true || v === 'true' || v === 1) return true;
    if (v === false || v === 'false' || v === 0 || v === null) return false;
    throw E.validation(label + ' must be true/false');
  }
  if (f.type === 'j') {
    if (typeof v !== 'string') v = JSON.stringify(v === undefined ? null : v);
    if (v.length > 3000000) throw E.validation(label + ' is too large');
    try { JSON.parse(v); } catch (e) { throw E.validation(label + ' must be valid JSON'); }
    return v;
  }
  return v;
}

function defaultFor_(f) {
  if (f.def !== undefined) return f.def;
  if (f.type === 'n' || f.type === 'i') return 0;
  if (f.type === 'b') return false;
  if (f.type === 'j') return '[]';
  return '';
}

/** Build a clean record from client data. Unknown / hidden fields are dropped. */
function sanitize_(table, data, mode) {
  if (!isObj_(data)) throw E.validation('Missing data for ' + table);
  var d = SCHEMA[table], out = {};
  d.fields.forEach(function (f) {
    var has = Object.prototype.hasOwnProperty.call(data, f.name);
    if ((d.hidden || []).indexOf(f.name) >= 0) return;
    if (!has) {
      if (mode === 'create') {
        if (f.req && f.def === undefined) throw E.validation(table + '.' + f.name + ' is required');
        out[f.name] = defaultFor_(f);
      }
      return;
    }
    var val = coerce_(table, f, data[f.name]);
    if (f.req && (val === '' || val === null) ) throw E.validation(table + '.' + f.name + ' is required');
    out[f.name] = val;
  });
  return out;
}

function checkUnique_(table, rec, selfId) {
  var d = SCHEMA[table];
  (d.unique || []).forEach(function (u) {
    var keys = u.split('+');
    var clash = Store.find(table, function (r) {
      if (r.id === selfId) return false;
      return keys.every(function (k) { return String(r[k]).toLowerCase() === String(rec[k]).toLowerCase(); });
    });
    if (clash) throw E.conflict(keys.join(' + ') + ' already exists (' + rec[keys[0]] + ')');
  });
}

// ------------------------------------------------------------------ audit
var AUDITED_ALWAYS = { projects: 1, quotations: 1, materials: 1, suppliers: 1, settings: 1, company: 1, designRules: 1, purchaseOrders: 1, boqOverrides: 1, files: 1, drawings: 1, users: 1 };
function pushAudit_(user, action, entity, entityId, details) {
  Store.append('auditLog', {
    id: uid_(), createdAt: nowIso_(), updatedAt: nowIso_(), rev: 1,
    userId: user ? user.id : '', userName: user ? user.name : 'system',
    action: String(action).slice(0, 80), entity: entity || '', entityId: entityId || '', details: String(details || '').slice(0, 1900)
  });
}

// ------------------------------------------------------------------ sync (read)
function dbSync_(user, params) {
  var reqs = params && params.tables;
  if (!Array.isArray(reqs) || reqs.length === 0 || reqs.length > 30) throw E.bad('tables[] required (max 30)');
  var out = {};
  reqs.forEach(function (rq) {
    var t = rq.t;
    if (!SCHEMA[t]) throw E.bad('Unknown table ' + t);
    Policy.assertRole(user, t, 'read');
    var ver = Store.version(t);
    if (t === 'auditLog') {
      var n = clamp_(Number(rq.limit) || 200, 1, 500);
      out[t] = { version: ver, rows: Store.tail('auditLog', n, Number(rq.skip) || 0) };
      return;
    }
    if (!rq.limit && !rq.where && rq.v === ver) { out[t] = { unchanged: true, version: ver }; return; }
    var rows = Store.all(t).filter(function (r) { return Policy.rowVisible(user, t, r); });
    if (rq.where && isObj_(rq.where)) {
      Object.keys(rq.where).forEach(function (k) {
        if (!Store.fieldMap(t)[k] && k !== 'id') throw E.bad('Cannot filter ' + t + ' by ' + k);
        rows = rows.filter(function (r) { return r[k] === rq.where[k]; });
      });
    }
    if (rq.order === 'desc') rows = rows.slice().sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    if (rq.limit) rows = rows.slice(0, clamp_(Number(rq.limit), 1, 2000));
    out[t] = { version: ver, rows: rows.map(function (r) { return Policy.present(user, t, r); }), partial: !!(rq.limit || rq.where) };
  });
  return { tables: out };
}

// ------------------------------------------------------------------ mutate (write)
function cascade_(table, id, deleted, side) {
  var d = SCHEMA[table], row = Store.get(table, id);
  if (!row) return;
  (d.children || []).forEach(function (c) {
    Store.filter(c[0], function (r) { return r[c[1]] === id; }).forEach(function (r) { cascade_(c[0], r.id, deleted, side); });
  });
  if (table === 'projects') {
    Store.filter('stockMovements', function (r) { return r.projectId === id; }).forEach(function (r) { Store.update('stockMovements', r.id, { projectId: '' }); });
    Store.filter('files', function (r) { return r.projectId === id && r.status === 'ACTIVE'; }).forEach(function (r) {
      Store.update('files', r.id, { status: 'DELETED' }); side.trash.push(r.driveFileId);
    });
  }
  if ((table === 'drawings' || table === 'materialImages') ) { Files.markDeleted(row.fileId, side); if (row.bgFileId) Files.markDeleted(row.bgFileId, side); }
  if (Store.remove(table, id)) (deleted[table] = deleted[table] || []).push(id);
}

function deriveProjectId_(user, table, rec) {
  if (table === 'rooms') {
    var fl = Store.get('floors', rec.floorId);
    if (!fl) throw E.validation('Floor not found');
    return fl.projectId;
  }
  if (table === 'points' || table === 'fixtures') {
    var rm = Store.get('rooms', rec.roomId);
    if (!rm) throw E.validation('Room not found');
    return rm.projectId;
  }
  return rec.projectId;
}

function assertFks_(table, rec) {
  var fk = SCHEMA[table].fk || {};
  Object.keys(fk).forEach(function (col) {
    if (rec[col] && !Store.get(fk[col], rec[col])) throw E.validation(col + ' refers to a record that does not exist');
  });
}

function assertSettingWritable_(user, key) {
  if (Policy.isAdmin(user)) return;
  if (!SETTINGS_WRITABLE_PREFIXES.some(function (p) { return key.indexOf(p) === 0; })) throw E.forbidden('Only SUPER_ADMIN may change this setting');
}

function opCreate_(user, op, side, audits) {
  var t = op.t, d = SCHEMA[t];
  Policy.assertRole(user, t, 'create');
  var rec = sanitize_(t, op.data, 'create');
  var id = op.id || (op.data && op.data.id);
  if (d.customId) { if (!validId_(id)) throw E.validation('Valid id (key) required for ' + t); assertSettingWritable_(user, id); }
  else if (id) { if (!validId_(id)) throw E.validation('Invalid id'); if (Store.get(t, id)) throw E.conflict('Record id already exists'); }
  else id = uid_();
  rec.id = id;

  if (d.projectCol) {
    var pid = deriveProjectId_(user, t, rec);
    if (pid || !d.optionalProject) { Policy.assertProject(user, pid); rec.projectId = pid; }
    if (t === 'floors') {
      var dupFloor = Store.find('floors', function (f) { return f.projectId === pid && f.floorNumber === rec.floorNumber; });
      void dupFloor; // floor numbers are not unique in the original model; allow
    }
  }
  assertFks_(t, rec);
  if (t === 'projects') {
    rec.ownerId = Policy.isAdmin(user) && rec.ownerId ? rec.ownerId : user.id;
    if (!Policy.isAdmin(user)) rec.members = '';
    rec.driveFolderId = '';
    try { rec.driveFolderId = Folders.createProject(rec.code, id); } catch (e) { logErr_('createProjectFolder', e); } // retried lazily on first upload
  }
  if (t === 'materialImages' && rec.url && !/^(\/?images\/materials\/[A-Za-z0-9_.\-]+)$/.test(rec.url)) throw E.validation('Material image must be an uploaded Drive file or a bundled sample image');
  if (t === 'boqOverrides') rec.userName = user.name;      // attribution always comes from the session
  if (t === 'priceHistory') rec.changedBy = user.name;
  checkUnique_(t, rec, null);
  var row = Store.insert(t, rec);
  if (AUDITED_ALWAYS[t]) audits.push(['CREATE_' + t.toUpperCase(), t, id, rec.code || rec.name || rec.quotationNo || rec.key || id]);
  return { t: t, op: 'create', id: id, row: row };
}

function opUpdate_(user, op, side, audits) {
  var t = op.t, d = SCHEMA[t];
  Policy.assertRole(user, t, 'update');
  var cur = Store.get(t, op.id);
  if (!cur) throw E.notFound(t + ' record not found');
  if (!Policy.rowVisible(user, t, cur)) throw E.forbidden();
  if (d.projectCol && cur.projectId) Policy.assertProject(user, cur.projectId);
  if (op.rev !== undefined && op.rev !== null && Number(op.rev) !== cur.rev) {
    throw E.conflict('This record was changed by someone else. Reload and try again.', { t: t, id: op.id, currentRev: cur.rev });
  }
  var patch = sanitize_(t, op.data, 'update');
  // immutable links
  ['projectId', 'floorId', 'roomId', 'materialId'].forEach(function (k) { if (d.fk && d.fk[k] || k === 'projectId' && d.projectCol) delete patch[k]; });
  if (t === 'settings') assertSettingWritable_(user, cur.id);
  if (t === 'projects') {
    var ownerChange = ('ownerId' in patch && patch.ownerId !== cur.ownerId) || ('members' in patch && patch.members !== cur.members);
    if (ownerChange && !Policy.isOwnerOrAdmin(user, cur)) throw E.forbidden('Only the project owner or an admin can change ownership/members');
    if ('ownerId' in patch && !Policy.isAdmin(user)) delete patch.ownerId;
    delete patch.driveFolderId;
    if (patch.members !== undefined) patch.members = patch.members.split(',').map(function (s) { return s.trim(); }).filter(Boolean).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(',');
  }
  if (t === 'quotations' && Object.keys(patch).some(function (k) { return ['status', 'date', 'validUntil', 'notes'].indexOf(k) < 0; })) {
    patch = pick_(patch, ['status', 'date', 'validUntil', 'notes']); // snapshot figures are immutable once created
  }
  if (t === 'materialImages' && patch.url && !/^(\/?images\/materials\/[A-Za-z0-9_.\-]+)$/.test(patch.url)) delete patch.url;
  var merged = {}; for (var k in cur) merged[k] = cur[k]; for (var p in patch) merged[p] = patch[p];
  checkUnique_(t, merged, cur.id);
  var row = Store.update(t, cur.id, patch);
  if (AUDITED_ALWAYS[t]) audits.push(['UPDATE_' + t.toUpperCase(), t, cur.id, (patch.status ? 'status=' + patch.status + ' ' : '') + (row.code || row.name || row.quotationNo || row.key || '')]);
  return { t: t, op: 'update', id: cur.id, row: row };
}

function opDelete_(user, op, deleted, side, audits) {
  var t = op.t;
  Policy.assertRole(user, t, 'delete');
  var cur = Store.get(t, op.id);
  if (!cur) return { t: t, op: 'delete', id: op.id, missing: true };
  if (!Policy.rowVisible(user, t, cur)) throw E.forbidden();
  if (SCHEMA[t].projectCol && cur.projectId) Policy.assertProject(user, cur.projectId);
  if (t === 'projects' && !Policy.isOwnerOrAdmin(user, cur)) throw E.forbidden('Only the project owner or an admin can delete a project');
  if (t === 'settings') assertSettingWritable_(user, cur.id);
  var label = cur.code || cur.name || cur.quotationNo || cur.key || cur.id;
  cascade_(t, cur.id, deleted, side);
  audits.push(['DELETE_' + t.toUpperCase(), t, cur.id, label]);
  return { t: t, op: 'delete', id: cur.id };
}

function opDeleteWhere_(user, op, deleted, side, audits) {
  var t = op.t;
  if (!isObj_(op.where) || Object.keys(op.where).length !== 1) throw E.bad('deleteWhere needs exactly one equality filter');
  var col = Object.keys(op.where)[0], val = op.where[col];
  if (!Store.fieldMap(t)[col]) throw E.bad('Cannot filter ' + t + ' by ' + col);
  Policy.assertRole(user, t, 'delete');
  var rows = Store.filter(t, function (r) { return r[col] === val; });
  if (SCHEMA[t].projectCol && col === 'projectId') Policy.assertProject(user, val);
  rows.forEach(function (r) {
    if (!Policy.rowVisible(user, t, r)) throw E.forbidden();
    cascade_(t, r.id, deleted, side);
  });
  audits.push(['DELETE_BULK_' + t.toUpperCase(), t, String(val), rows.length + ' rows']);
  return { t: t, op: 'deleteWhere', count: rows.length };
}

function opUpsert_(user, op, side, audits) {
  var t = op.t, d = SCHEMA[t];
  var existing = null;
  if (d.customId) existing = Store.get(t, op.id);
  else if (t === 'designRules') existing = Store.find(t, function (r) { return r.key === (op.data && op.data.key); });
  else throw E.bad('upsert not supported for ' + t);
  if (existing) return opUpdate_(user, { t: t, id: existing.id, data: op.data }, side, audits);
  return opCreate_(user, op, side, audits);
}

function dbMutate_(user, params) {
  var ops = params && params.ops;
  if (!Array.isArray(ops) || ops.length === 0) throw E.bad('ops[] required');
  if (ops.length > APP.MAX_BATCH_OPS) throw E.bad('Too many operations in one request (max ' + APP.MAX_BATCH_OPS + ')');
  var results = [], deleted = {}, side = { trash: [], folders: [] }, audits = [];
  Policy.reset();
  try {
    ops.forEach(function (op) {
      if (!isObj_(op) || !SCHEMA[op.t]) throw E.bad('Bad operation');
      if (op.op === 'create') results.push(opCreate_(user, op, side, audits));
      else if (op.op === 'update') results.push(opUpdate_(user, op, side, audits));
      else if (op.op === 'delete') results.push(opDelete_(user, op, deleted, side, audits));
      else if (op.op === 'deleteWhere') results.push(opDeleteWhere_(user, op, deleted, side, audits));
      else if (op.op === 'upsert') results.push(opUpsert_(user, op, side, audits));
      else throw E.bad('Unknown op ' + op.op);
    });
    audits.forEach(function (a) { pushAudit_(user, a[0], a[1], a[2], a[3]); });
    var v = Store.commit();
  } catch (e) {
    Store.rollback();
    throw e;
  }
  Files.afterCommit(side);
  return {
    results: results.map(function (r) {
      var o = { t: r.t, op: r.op, id: r.id };
      if (r.count !== undefined) o.count = r.count;
      if (r.row) o.row = Policy.present(user, r.t, r.row);
      return o;
    }),
    deleted: deleted,
    versions: { before: v.before, after: v.after }
  };
}
