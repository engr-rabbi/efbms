/**
 * File 6/10: Files.gs — Google Drive storage.
 *
 * Website_Data/
 *   Projects/<code>_<projectId>/{Drawings,Images,Documents,Reports}
 *   Material_Images/
 *   Database_Backups/
 *   System_Backups/FileMirror/
 *   System_Data/Blobs/
 *
 * Nothing is ever shared publicly: files stay private to the script owner and are
 * only streamed to a signed-in user after a server-side permission check.
 * Every file has a row in the `Files` sheet (id, project, category, name, type,
 * size, sha256, Drive id, uploader, date). Other tables reference the Files row id.
 */
var Folders = {
  _memo: {},
  root: function () {
    var id = PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID');
    if (!id) throw new AppError('NOT_SETUP', 'Drive root folder missing: run setup()', 503);
    return DriveApp.getFolderById(id);
  },
  sub: function (parent, name) {
    var it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next() : parent.createFolder(name);
  },
  top: function (name) {
    if (Folders._memo[name]) return Folders._memo[name];
    var props = PropertiesService.getScriptProperties(), key = 'FOLD_' + name, id = props.getProperty(key), f = null;
    if (id) { try { f = DriveApp.getFolderById(id); if (f.isTrashed()) f = null; } catch (e) { f = null; } }
    if (!f) { f = Folders.sub(Folders.root(), name); props.setProperty(key, f.getId()); }
    Folders._memo[name] = f;
    return f;
  },
  safe: function (s) { return String(s).replace(/[^A-Za-z0-9._\- ]/g, '_').slice(0, 80); },
  createProject: function (code, projectId) {
    var base = Folders.sub(Folders.top('Projects'), Folders.safe(code) + '_' + projectId);
    ['Drawings', 'Images', 'Documents', 'Reports'].forEach(function (n) { Folders.sub(base, n); });
    return base.getId();
  },
  projectSub: function (projectId, category) {
    var p = Store.get('projects', projectId), base = null;
    if (!p) throw E.notFound('Project not found');
    if (p.driveFolderId) { try { base = DriveApp.getFolderById(p.driveFolderId); if (base.isTrashed()) base = null; } catch (e) { base = null; } }
    if (!base) {
      var id = Folders.createProject(p.code, p.id);
      Store.update('projects', p.id, { driveFolderId: id });
      base = DriveApp.getFolderById(id);
    }
    return Folders.sub(base, category);
  },
  blobs: function () { return Folders.sub(Folders.top('System_Data'), 'Blobs'); },
  mirror: function () { return Folders.sub(Folders.top('System_Backups'), 'FileMirror'); }
};

/** Large cell values (e.g. a quotation with hundreds of lines) live in Drive; the cell keeps a pointer. */
var Blobs = {
  put: function (table, id, field, text, existingId) {
    if (existingId) {
      try { DriveApp.getFileById(existingId).setContent(text); return existingId; } catch (e) { /* fall through, create new */ }
    }
    var f = Folders.blobs().createFile(table + '_' + id + '_' + field + '.txt', text, 'text/plain');
    return f.getId();
  },
  get: function (fileId) {
    try { return DriveApp.getFileById(fileId).getBlob().getDataAsString(); } catch (e) { logErr_('blobGet', e); return ''; }
  },
  trash: function (fileId) { try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { /* already gone */ } }
};

var UPLOAD_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  pdf: 'application/pdf', dxf: 'application/dxf', dwg: 'application/acad',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  csv: 'text/csv', json: 'application/json', txt: 'text/plain'
};
var CATEGORY_ROLES = {
  Drawings: ['SUPER_ADMIN', 'ENGINEER'], Images: ['SUPER_ADMIN', 'ENGINEER'], Documents: ['SUPER_ADMIN', 'ENGINEER', 'SALES'],
  Reports: ['SUPER_ADMIN', 'ENGINEER', 'SALES'], Material_Images: ['SUPER_ADMIN', 'ENGINEER', 'INVENTORY']
};

var Files = {
  extOf: function (name) { var m = /\.([A-Za-z0-9]{1,5})$/.exec(name); return m ? m[1].toLowerCase() : ''; },
  cleanName: function (name) {
    var n = String(name || '').replace(/[\\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim();
    if (!n) throw E.validation('File name is required');
    return n.length > 150 ? n.slice(-150) : n;
  },
  /** Reject files whose bytes do not match their extension (basic content sniffing). */
  sniff: function (ext, bytes) {
    function at(i) { return bytes[i] & 0xff; }
    function head(arr) { return arr.every(function (b, i) { return at(i) === b; }); }
    var ok = true;
    if (ext === 'jpg' || ext === 'jpeg') ok = head([0xff, 0xd8, 0xff]);
    else if (ext === 'png') ok = head([0x89, 0x50, 0x4e, 0x47]);
    else if (ext === 'gif') ok = head([0x47, 0x49, 0x46, 0x38]);
    else if (ext === 'webp') ok = head([0x52, 0x49, 0x46, 0x46]) && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50;
    else if (ext === 'pdf') ok = head([0x25, 0x50, 0x44, 0x46]);
    else if (ext === 'xlsx' || ext === 'docx') ok = head([0x50, 0x4b]);
    else if (ext === 'xls') ok = head([0xd0, 0xcf, 0x11, 0xe0]);
    else if (ext === 'dwg') ok = head([0x41, 0x43]);
    else if (ext === 'dxf' || ext === 'csv' || ext === 'txt' || ext === 'json') {
      for (var i = 0; i < Math.min(bytes.length, 2000); i++) if (at(i) === 0) { ok = false; break; }
    }
    if (!ok) throw E.validation('File content does not match its extension (.' + ext + ')');
  },

  assertCanUse: function (user, category, projectId) {
    if (ENUMS.fileCategory.indexOf(category) < 0) throw E.validation('Unknown category');
    if (CATEGORY_ROLES[category].indexOf(user.role) < 0) throw E.forbidden('Your role may not upload to ' + category);
    if (category !== 'Material_Images') Policy.assertProject(user, projectId);
  },

  /** Create Drive file + Files row. Returns the row. Caller commits. */
  store: function (user, meta, bytes, createdIds) {
    var ext = Files.extOf(meta.name);
    if (!UPLOAD_TYPES[ext]) throw E.validation('File type .' + ext + ' is not allowed');
    if (bytes.length === 0) throw E.validation('File is empty');
    if (bytes.length > APP.MAX_UPLOAD_BYTES) throw E.validation('File is too large (max ' + Math.floor(APP.MAX_UPLOAD_BYTES / 1048576) + ' MB)');
    Files.sniff(ext, bytes);
    var folder = meta.category === 'Material_Images' ? Folders.top('Material_Images') : Folders.projectSub(meta.projectId, meta.category);
    var blob = Utilities.newBlob(bytes, UPLOAD_TYPES[ext], meta.name);
    var f = folder.createFile(blob);
    try { f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) { /* inherited private */ }
    createdIds.push(f.getId());
    var rec = {
      id: meta.id || uid_(), projectId: meta.projectId || '', floorId: meta.floorId || '', roomId: meta.roomId || '',
      entityType: meta.entityType || '', entityId: meta.entityId || '', category: meta.category, name: meta.name,
      mime: UPLOAD_TYPES[ext], sizeBytes: bytes.length, sha256: sha256Hex_(bytes), driveFileId: f.getId(), mirrorId: '',
      status: 'ACTIVE', uploadedBy: user.name
    };
    return Store.insert('files', rec);
  },

  upload: function (user, p) {
    if (!isObj_(p)) throw E.bad('Bad upload');
    var category = String(p.category || ''), projectId = String(p.projectId || '');
    Files.assertCanUse(user, category, projectId);
    var name = Files.cleanName(p.name);
    if (typeof p.data !== 'string' || p.data.length > Math.ceil(APP.MAX_UPLOAD_BYTES * 1.4)) throw E.validation('File is too large (max ' + Math.floor(APP.MAX_UPLOAD_BYTES / 1048576) + ' MB)');
    var bytes;
    try { bytes = Utilities.base64Decode(p.data); } catch (e) { throw E.validation('Invalid file encoding'); }
    var created = [], out = {};
    try {
      var meta = { category: category, projectId: category === 'Material_Images' ? '' : projectId, floorId: p.floorId, roomId: p.roomId, entityType: p.entityType, entityId: p.entityId, name: name };
      var row = Files.store(user, meta, bytes, created);
      out.file = row;
      var att = p.attach;
      if (att && category === 'Material_Images') {
        var mat = Store.get('materials', att.materialId);
        if (!mat) throw E.notFound('Material not found');
        if (att.replaceImageId) {
          var img = Store.get('materialImages', att.replaceImageId);
          if (!img || img.materialId !== mat.id) throw E.notFound('Image not found');
          var old = img.fileId;
          out.image = Store.update('materialImages', img.id, { fileId: row.id, url: '', isSample: false, caption: att.caption !== undefined ? String(att.caption).slice(0, 300) : img.caption });
          if (old) Files.markDeleted(old, { trash: (out.trash = []) });
        } else {
          var imgs = Store.filter('materialImages', function (r) { return r.materialId === mat.id; });
          var real = imgs.filter(function (r) { return !r.isSample; }).length;
          out.image = Store.insert('materialImages', {
            id: uid_(), materialId: mat.id, url: '', fileId: row.id, isSample: false, isPrimary: real === 0,
            caption: String(att.caption || '').slice(0, 300), sortOrder: imgs.length
          });
        }
        if (out.image.isPrimary) Store.filter('materialImages', function (r) { return r.materialId === mat.id && r.id !== out.image.id && r.isPrimary; })
          .forEach(function (r) { Store.update('materialImages', r.id, { isPrimary: false }); });
        pushAudit_(user, 'ADD_MATERIAL_IMAGE', 'Material', mat.id, mat.code);
      } else {
        pushAudit_(user, 'UPLOAD_FILE', 'File', row.id, category + '/' + name);
      }
      Store.commit();
    } catch (e) {
      Store.rollback();
      created.forEach(function (id) { Blobs.trash(id); });
      throw e;
    }
    if (out.trash) { out.trash.forEach(function (id) { Blobs.trash(id); }); delete out.trash; }
    return { file: Policy.present(user, 'files', out.file), image: out.image ? Policy.present(user, 'materialImages', out.image) : null };
  },

  rowFor: function (user, id) {
    var r = Store.get('files', id);
    if (!r || r.status !== 'ACTIVE') throw E.notFound('File not found');
    if (r.projectId) { if (!Policy.canProject(user, r.projectId)) throw E.forbidden('You are not a member of this project'); }
    else if (r.category !== 'Material_Images') throw E.forbidden();
    return r;
  },

  get: function (user, p) {
    var r = Files.rowFor(user, String(p && p.id || ''));
    var f = DriveApp.getFileById(r.driveFileId);
    return { id: r.id, name: r.name, mime: r.mime, sizeBytes: r.sizeBytes, data: Utilities.base64Encode(f.getBlob().getBytes()) };
  },

  /** Mark a Files row deleted and queue its Drive file for the trash. */
  markDeleted: function (filesId, side) {
    var r = filesId && Store.get('files', filesId);
    if (r && r.status === 'ACTIVE') { Store.update('files', r.id, { status: 'DELETED' }); side.trash.push(r.driveFileId); }
  },

  remove: function (user, p) {
    var r = Files.rowFor(user, String(p && p.id || ''));
    if (CATEGORY_ROLES[r.category].indexOf(user.role) < 0) throw E.forbidden();
    var used = Store.find('drawings', function (d) { return d.fileId === r.id || d.bgFileId === r.id; }) ||
               Store.find('materialImages', function (m) { return m.fileId === r.id; });
    if (used) throw E.conflict('This file is used by a drawing or material image. Remove it from there instead.');
    var side = { trash: [] };
    Files.markDeleted(r.id, side);
    pushAudit_(user, 'DELETE_FILE', 'File', r.id, r.category + '/' + r.name);
    Store.commit();
    Files.afterCommit(side);
    return { ok: true };
  },

  afterCommit: function (side) {
    (side.trash || []).forEach(function (id) { if (id) Blobs.trash(id); });
  },

  // ---------------------------------------------------------------- editable drawings
  saveDrawing: function (user, p) {
    Policy.assertRole(user, 'projects', 'update');
    var projectId = String(p.projectId || ''), floorNumber = Math.round(Number(p.floorNumber) || 0);
    Policy.assertProject(user, projectId);
    if (typeof p.data !== 'string' || p.data.length > 7 * 1048576) throw E.validation('Drawing data is missing or too large (max 7 MB)');
    var doc;
    try { doc = JSON.parse(p.data); } catch (e) { throw E.validation('Drawing data must be valid JSON'); }
    if (!isObj_(doc)) throw E.validation('Drawing data must be an object');
    var scale = Number(p.scalePxPerMeter);
    if (!isFinite(scale) || scale <= 0) scale = 40;
    var cur = Store.find('drawings', function (d) { return d.projectId === projectId && d.floorNumber === floorNumber; });
    if (cur && p.expectedRev !== undefined && p.expectedRev !== null && Number(p.expectedRev) !== cur.rev) {
      throw E.conflict('This drawing was saved by someone else since you opened it.', { currentRev: cur.rev });
    }
    var created = [];
    try {
      var bgId = cur ? cur.bgFileId : '';
      var bg = doc.backgroundImage, side = { trash: [] };
      if (typeof bg === 'string' && bg.indexOf('data:image/') === 0) {
        var m = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+\/=]+)$/.exec(bg);
        if (!m) throw E.validation('Unsupported background image');
        var ext = m[1] === 'jpeg' ? 'jpg' : m[1];
        var bytes = Utilities.base64Decode(m[2]);
        var brow = Files.store(user, { category: 'Drawings', projectId: projectId, entityType: 'drawing-background', name: 'floor-' + floorNumber + '-background.' + ext }, bytes, created);
        if (bgId) Files.markDeleted(bgId, side);
        bgId = brow.id;
        doc.backgroundImage = 'drive:' + bgId;
      } else if (typeof bg === 'string' && bg.indexOf('drive:') === 0) {
        var ref = bg.slice(6), br = Store.get('files', ref);
        if (!br || br.projectId !== projectId) throw E.validation('Background image reference is invalid');
        bgId = ref;
      } else if (bg === null || bg === undefined || bg === '') {
        if (bgId) Files.markDeleted(bgId, side);
        bgId = ''; doc.backgroundImage = null;
      } else throw E.validation('Unsupported backgroundImage value');

      var text = JSON.stringify(doc), bytesJson = Utilities.newBlob(text).getBytes();
      var frow = cur && cur.fileId ? Store.get('files', cur.fileId) : null, drive;
      if (frow && frow.status === 'ACTIVE') {
        try { drive = DriveApp.getFileById(frow.driveFileId); drive.setContent(text); } catch (e) { drive = null; }
      }
      if (!drive) {
        frow = Files.store(user, { category: 'Drawings', projectId: projectId, entityType: 'drawing', name: 'floor-' + floorNumber + '-drawing.json' }, bytesJson, created);
      } else {
        frow = Store.update('files', frow.id, { sizeBytes: bytesJson.length, sha256: sha256Hex_(bytesJson), mirrorId: '' });
      }
      var rec = { fileId: frow.id, scalePxPerMeter: scale, calibrated: p.calibrated === true || p.calibrated === 'true', sizeBytes: bytesJson.length, sha256: frow.sha256, bgFileId: bgId };
      var row;
      if (cur) row = Store.update('drawings', cur.id, rec);
      else { rec.id = uid_(); rec.projectId = projectId; rec.floorNumber = floorNumber; row = Store.insert('drawings', rec); }
      pushAudit_(user, 'SAVE_DRAWING', 'Drawing', row.id, 'floor ' + floorNumber + ' · ' + bytesJson.length + ' bytes');
      var v = Store.commit();
      Files.afterCommit(side);
      return { drawing: Policy.present(user, 'drawings', row), versions: v };
    } catch (e) {
      Store.rollback();
      created.forEach(function (id) { Blobs.trash(id); });
      throw e;
    }
  },

  listDrawings: function (user, p) {
    var projectId = String(p && p.projectId || '');
    Policy.assertProject(user, projectId);
    var rows = Store.filter('drawings', function (d) { return d.projectId === projectId; }).sort(function (a, b) { return a.floorNumber - b.floorNumber; });
    return {
      drawings: rows.map(function (d) {
        var o = Policy.present(user, 'drawings', d), fr = Store.get('files', d.fileId), data = '{}';
        if (fr && fr.status === 'ACTIVE') {
          try { data = DriveApp.getFileById(fr.driveFileId).getBlob().getDataAsString(); } catch (e) { logErr_('drawingRead', e); data = '{}'; o.missing = true; }
        } else o.missing = true;
        o.data = data;
        return o;
      })
    };
  }
};
