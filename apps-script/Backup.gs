/**
 * File 8/10: Backup.gs — full backup & restore.
 *
 * A backup is NOT just a list of Drive links. Each run produces
 *   Database_Backups/<backupId>.json.gz  = every table (users, projects, rooms … files registry)
 *                                          + the editable drawing JSON of every floor
 *   System_Backups/FileMirror/           = an independent Drive copy of every uploaded file
 *                                          (copied once, re-copied when the file changes)
 * and records the result (id, time, status, size, sha256, counts, missing files) in the
 * `Backups` sheet. Restore replaces the tables, re-links drawings/images/projects via the
 * original ids and re-creates any Drive file that disappeared from its mirror copy.
 */
var Backup = {
  copyFilesEnabled: function () {
    var s = Store.get('settings', 'backup.copyFiles');
    return s ? s.value !== 'false' : APP.MIRROR_FILES_DEFAULT;
  },
  newId: function () {
    var d = new Date(), p = function (n) { return ('0' + n).slice(-2); };
    return 'BK-' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + '-' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + '-' + Utilities.getUuid().slice(0, 4);
  },
  driveOk: function (id) {
    if (!id) return false;
    try { var f = DriveApp.getFileById(id); return !f.isTrashed(); } catch (e) { return false; }
  },

  /** Make sure every active file has an independent copy; report files that no longer exist anywhere. */
  mirrorFiles: function (enableCopy, deadline) {
    var rep = { total: 0, copied: 0, missing: [], recoverable: [], incomplete: false };
    Store.filter('files', function (f) { return f.status === 'ACTIVE'; }).forEach(function (f) {
      rep.total++;
      if (Date.now() > deadline) { rep.incomplete = true; return; }
      var alive = Backup.driveOk(f.driveFileId), mirrorAlive = Backup.driveOk(f.mirrorId);
      if (!alive) { (mirrorAlive ? rep.recoverable : rep.missing).push(f.id); return; }
      if (enableCopy && !mirrorAlive) {
        try {
          var copy = DriveApp.getFileById(f.driveFileId).makeCopy(f.id + '__' + f.name, Folders.mirror());
          Store.update('files', f.id, { mirrorId: copy.getId() });
          rep.copied++;
        } catch (e) { logErr_('mirror', e); rep.incomplete = true; }
      }
    });
    return rep;
  },

  snapshot: function () {
    var snap = { meta: { app: APP.NAME, version: APP.VERSION, schemaVersion: APP.SCHEMA_VERSION, createdAt: nowIso_(), tables: {} }, tables: {}, drawings: {} };
    BACKUP_TABLES.forEach(function (t) {
      var rows = Store.all(t).map(function (r) { return Store.expand(t, r); });
      snap.tables[t] = rows;
      snap.meta.tables[t] = rows.length;
    });
    Store.all('drawings').forEach(function (d) {
      var fr = Store.get('files', d.fileId);
      if (fr && fr.status === 'ACTIVE') {
        try { snap.drawings[fr.id] = DriveApp.getFileById(fr.driveFileId).getBlob().getDataAsString(); } catch (e) { logErr_('snapDrawing', e); }
      }
    });
    return snap;
  },

  run: function (user, kind, note) {
    kind = kind || 'MANUAL';
    var id = Backup.newId(), started = nowIso_(), createdFile = null;
    try {
      var rep = Backup.mirrorFiles(kind !== 'PRE_RESTORE' && Backup.copyFilesEnabled(), Date.now() + 4 * 60 * 1000);
      var snap = Backup.snapshot();
      snap.meta.backupId = id; snap.meta.kind = kind; snap.meta.files = { total: rep.total, missing: rep.missing, recoverableFromMirror: rep.recoverable };
      var json = JSON.stringify(snap);
      var gz = Utilities.gzip(Utilities.newBlob(json, 'application/json', id + '.json'), id + '.json.gz');
      var bytes = gz.getBytes();
      createdFile = Folders.top('Database_Backups').createFile(gz);
      try { createdFile.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) { /* private by default */ }
      var status = rep.missing.length || rep.incomplete ? 'PARTIAL' : 'SUCCESS';
      var row = Store.insert('backups', {
        id: id, kind: kind, status: status, driveFileId: createdFile.getId(), sizeBytes: bytes.length, sha256: sha256Hex_(bytes),
        tableCounts: JSON.stringify(snap.meta.tables), fileCount: rep.total, missingFiles: rep.missing.length, startedAt: started, finishedAt: nowIso_(),
        createdBy: user ? user.name : 'system', error: '', note: (note || '') + (rep.incomplete ? ' file mirroring incomplete — will continue next run' : '')
      });
      pushAudit_(user, 'BACKUP_' + kind, 'Backup', id, status + ' ' + bytes.length + ' bytes, ' + rep.total + ' files, ' + rep.missing.length + ' missing');
      Store.commit();
      PropertiesService.getScriptProperties().setProperty('LAST_BACKUP', JSON.stringify({ id: id, at: row.finishedAt, status: status }));
      if (status === 'SUCCESS') PropertiesService.getScriptProperties().deleteProperty('LAST_BACKUP_ERROR');
      if (kind === 'SCHEDULED') Backup.prune();
      if (rep.missing.length) Backup.alert('Backup ' + id + ' finished but ' + rep.missing.length + ' Drive file(s) are missing and have no mirror copy.');
      return { backup: row, files: rep };
    } catch (e) {
      Store.rollback();
      if (createdFile) Blobs.trash(createdFile.getId());
      Backup.recordFailure(user, kind, id, started, e);
      throw new AppError('BACKUP_FAILED', 'Backup failed: ' + (e && e.message ? e.message : e), 500);
    }
  },

  recordFailure: function (user, kind, id, started, e) {
    var msg = String(e && e.message ? e.message : e).slice(0, 1500);
    try {
      PropertiesService.getScriptProperties().setProperty('LAST_BACKUP_ERROR', JSON.stringify({ id: id, at: nowIso_(), message: msg }));
      Store.insert('backups', { id: id, kind: kind, status: 'FAILED', driveFileId: '', sizeBytes: 0, sha256: '', tableCounts: '{}', fileCount: 0, missingFiles: 0,
        startedAt: started, finishedAt: nowIso_(), createdBy: user ? user.name : 'system', error: msg, note: '' });
      pushAudit_(user, 'BACKUP_FAILED', 'Backup', id, msg);
      Store.commit();
    } catch (x) { logErr_('recordFailure', x); Store.rollback(); }
    logErr_('backup', e);
    Backup.alert('Backup ' + id + ' FAILED: ' + msg);
  },

  alert: function (text) {
    try {
      var to = PropertiesService.getScriptProperties().getProperty('ADMIN_ALERT_EMAIL');
      if (to) MailApp.sendEmail(to, '[ElectroFlow BMS] Backup alert', text);
    } catch (e) { logErr_('alert', e); }
  },

  prune: function () {
    var rows = Store.filter('backups', function (b) { return b.kind === 'SCHEDULED' && b.status !== 'FAILED'; })
      .sort(function (a, b) { return a.finishedAt < b.finishedAt ? 1 : -1; });
    var extra = rows.slice(APP.BACKUP_KEEP_SCHEDULED);
    if (!extra.length) return;
    extra.forEach(function (b) { Blobs.trash(b.driveFileId); Store.remove('backups', b.id); });
    Store.commit();
  },

  status: function () {
    var props = PropertiesService.getScriptProperties();
    var last = null, err = null;
    try { last = JSON.parse(props.getProperty('LAST_BACKUP') || 'null'); } catch (e) { /* none */ }
    try { err = JSON.parse(props.getProperty('LAST_BACKUP_ERROR') || 'null'); } catch (e) { /* none */ }
    var ageH = last ? (Date.now() - new Date(last.at).getTime()) / 3600000 : null;
    var alert = 'NONE';
    if (err && (!last || err.at > last.at)) alert = 'FAILED';
    else if (!last) alert = 'NEVER';
    else if (ageH > 36) alert = 'STALE';
    else if (last.status === 'PARTIAL') alert = 'PARTIAL';
    return { lastSuccess: last, lastError: err, ageHours: ageH === null ? null : Math.round(ageH * 10) / 10, alert: alert,
             scheduled: ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'scheduledBackup'; }),
             copyFiles: Backup.copyFilesEnabled(), total: Store.count('backups') };
  },

  read: function (row) {
    var blob;
    try { blob = DriveApp.getFileById(row.driveFileId).getBlob(); } catch (e) { throw E.notFound('Backup file is missing from Drive'); }
    var bytes = blob.getBytes();
    if (!safeEqual_(sha256Hex_(bytes), row.sha256)) throw new AppError('BACKUP_CORRUPT', 'Backup checksum does not match — file was modified or damaged', 422);
    var text = Utilities.ungzip(Utilities.newBlob(bytes, 'application/x-gzip', row.id + '.json.gz')).getDataAsString();
    var snap = JSON.parse(text);
    if (!snap || !snap.meta || !snap.tables) throw new AppError('BACKUP_CORRUPT', 'Backup file has an unexpected structure', 422);
    return snap;
  },

  verify: function (user, p) {
    var row = Store.get('backups', String(p && p.id || ''));
    if (!row) throw E.notFound('Backup not found');
    if (row.status === 'FAILED') throw E.conflict('This backup run failed and has no data');
    var snap = Backup.read(row), problems = [];
    if (snap.meta.schemaVersion !== APP.SCHEMA_VERSION) problems.push('schemaVersion ' + snap.meta.schemaVersion + ' ≠ current ' + APP.SCHEMA_VERSION);
    var counts = JSON.parse(row.tableCounts || '{}');
    Object.keys(counts).forEach(function (t) { if ((snap.tables[t] || []).length !== counts[t]) problems.push('row count mismatch in ' + t); });
    var files = (snap.tables.files || []).filter(function (f) { return f.status === 'ACTIVE'; });
    var recoverable = [], lost = [], ok = 0;
    files.forEach(function (f) {
      if (Backup.driveOk(f.driveFileId)) ok++;
      else if (Backup.driveOk(f.mirrorId)) recoverable.push(f.id);
      else if (!(snap.drawings && snap.drawings[f.id])) lost.push(f.id);
    });
    return { id: row.id, ok: problems.length === 0 && lost.length === 0, problems: problems, tables: counts,
             files: { total: files.length, present: ok, recoverableFromMirror: recoverable.length, lost: lost.length, lostIds: lost.slice(0, 20) },
             createdAt: snap.meta.createdAt, schemaVersion: snap.meta.schemaVersion };
  },

  restorePrepare: function (user, p) {
    if (!Policy.isAdmin(user)) throw E.forbidden();
    var rep = Backup.verify(user, p);
    if (rep.schemaVersion !== APP.SCHEMA_VERSION) throw E.conflict('Backup schema version is incompatible with this server');
    var code = sha256Hex_(Utilities.getUuid()).slice(0, 6).toUpperCase();
    CacheService.getScriptCache().put('rc:' + user.id + ':' + rep.id, code, 600);
    var current = Integrity.counts();
    return { verify: rep, confirmCode: code, currentCounts: current, expiresInSec: 600,
             note: 'A safety backup of the current data is created automatically before restoring.' };
  },

  restore: function (user, p) {
    if (!Policy.isAdmin(user)) throw E.forbidden();
    var id = String(p && p.id || '');
    var cache = CacheService.getScriptCache(), key = 'rc:' + user.id + ':' + id;
    if (!p.confirmCode || !safeEqual_(String(p.confirmCode).toUpperCase(), String(cache.get(key) || '~')) || p.typed !== 'RESTORE') {
      throw E.validation('Restore not confirmed. Request a confirmation code first and type RESTORE.');
    }
    cache.remove(key);
    var row = Store.get('backups', id);
    if (!row || row.status === 'FAILED') throw E.notFound('Backup not found');
    var snap = Backup.read(row);
    if (snap.meta.schemaVersion !== APP.SCHEMA_VERSION) throw E.conflict('Backup schema version is incompatible');

    var safety = Backup.run(user, 'PRE_RESTORE', 'automatic safety copy before restoring ' + id);   // throws → restore aborted
    Store.flush();
    var report = { restoredFrom: id, safetyBackupId: safety.backup.id, tables: {}, filesRecoveredFromMirror: 0, drawingsRewritten: 0, filesMissing: [], skippedTables: ['auditLog', 'backups'] };
    try {
      BACKUP_TABLES.forEach(function (t) {
        if (t === 'auditLog' || !snap.tables[t]) return;
        var rows = snap.tables[t].map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; return o; });
        if (t === 'users') {
          var me = Store.get('users', user.id);
          rows = rows.filter(function (r) { return r.id !== user.id; });
          if (me) rows.push(me);
        }
        if (t === 'files') rows.forEach(function (f) { Backup.relinkFile(f, snap, report); });
        Store.replaceAll(t, rows);
        report.tables[t] = rows.length;
      });
      Store.all('files'); // ensure loaded
      var chk = Integrity.check(false);
      report.integrity = { ok: chk.ok, issues: chk.issues };
      pushAudit_(user, 'RESTORE', 'Backup', id, 'safety=' + safety.backup.id + ' tables=' + Object.keys(report.tables).length + ' missingFiles=' + report.filesMissing.length);
      Store.commit();
    } catch (e) {
      Store.rollback();
      logErr_('restore', e);
      throw new AppError('RESTORE_FAILED', 'Restore failed and was rolled back (data unchanged): ' + (e && e.message ? e.message : e), 500);
    }
    Policy.reset();
    return report;
  },

  /** Make the Drive file behind one Files row exist again (own file → trash → mirror copy → rebuilt from snapshot). */
  relinkFile: function (f, snap, report) {
    if (f.status !== 'ACTIVE') return;
    var drawingText = snap.drawings && snap.drawings[f.id];
    if (Backup.driveOk(f.driveFileId)) {
      if (drawingText !== undefined) { try { DriveApp.getFileById(f.driveFileId).setContent(drawingText); report.drawingsRewritten++; } catch (e) { logErr_('rewriteDrawing', e); } }
      return;
    }
    try { var t = DriveApp.getFileById(f.driveFileId); if (t.isTrashed()) { t.setTrashed(false); report.filesRecoveredFromMirror++; return; } } catch (e) { /* gone for good */ }
    if (Backup.driveOk(f.mirrorId)) {
      var folder = f.category === 'Material_Images' || !f.projectId ? Folders.top('Material_Images') : Folders.projectSub(f.projectId, f.category);
      var copy = DriveApp.getFileById(f.mirrorId).makeCopy(f.name, folder);
      f.driveFileId = copy.getId();
      report.filesRecoveredFromMirror++;
      return;
    }
    if (drawingText !== undefined && f.projectId) {
      var nf = Folders.projectSub(f.projectId, f.category).createFile(f.name, drawingText, 'application/json');
      f.driveFileId = nf.getId();
      report.drawingsRewritten++;
      return;
    }
    f.status = 'MISSING';
    report.filesMissing.push({ id: f.id, name: f.name, category: f.category, projectId: f.projectId });
  }
};

/** Time-driven trigger entry point (installed by installTriggers()). */
function scheduledBackup() {
  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    Store.reset(); Policy.reset();
    Backup.run({ id: '', name: 'system (scheduled)', role: 'SUPER_ADMIN' }, 'SCHEDULED', 'daily');
  } catch (e) {
    logErr_('scheduledBackup', e); // already recorded + alerted by Backup.run
  } finally { lock.releaseLock(); }
}
