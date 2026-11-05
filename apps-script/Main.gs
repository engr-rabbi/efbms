/** File 9/10: Main.gs — web-app entry points, request pipeline, setup, triggers. */

/** Actions: auth=false → public; write=true → serialised under the script lock + idempotency key. */
var ACTIONS = {
  'ping':                { auth: false, fn: function () { return { service: APP.NAME, version: APP.VERSION, time: nowIso_(), ready: isSetup_() }; } },
  'auth.login':          { auth: false, write: true, fn: function (u, p) { return Auth.login(p); } },
  'auth.me':             { fn: function (u) { return Auth.me(u); } },
  'auth.changePassword': { write: true, fn: function (u, p) { return Auth.changePassword(u, p); } },
  'directory':           { fn: function () { return Auth.directory(); } },
  'users.list':          { fn: function (u) { return Auth.listUsers(u); } },
  'users.create':        { write: true, fn: function (u, p) { return Auth.createUser(u, p); } },
  'users.update':        { write: true, fn: function (u, p) { return Auth.updateUser(u, p); } },
  'users.setPassword':   { write: true, fn: function (u, p) { return Auth.setPassword(u, p); } },
  'db.sync':             { fn: function (u, p) { return dbSync_(u, p); } },
  'db.mutate':           { write: true, fn: function (u, p) { return dbMutate_(u, p); } },
  'stock.move':          { write: true, fn: function (u, p) { return Commands.stockMove(u, p); } },
  'quotation.create':    { write: true, fn: function (u, p) { return Commands.quotationCreate(u, p); } },
  'quotation.revise':    { write: true, fn: function (u, p) { return Commands.quotationRevise(u, p); } },
  'file.upload':         { write: true, fn: function (u, p) { return Files.upload(u, p); } },
  'file.get':            { fn: function (u, p) { return Files.get(u, p); } },
  'file.delete':         { write: true, fn: function (u, p) { return Files.remove(u, p); } },
  'drawing.save':        { write: true, fn: function (u, p) { return Files.saveDrawing(u, p); } },
  'drawing.list':        { fn: function (u, p) { return Files.listDrawings(u, p); } },
  'backup.status':       { admin: true, fn: function () { return Backup.status(); } },
  'backup.run':          { admin: true, write: true, fn: function (u) { return Backup.run(u, 'MANUAL'); } },
  'backup.verify':       { admin: true, fn: function (u, p) { return Backup.verify(u, p); } },
  'backup.restorePrepare': { admin: true, fn: function (u, p) { return Backup.restorePrepare(u, p); } },
  'backup.restore':      { admin: true, write: true, fn: function (u, p) { return Backup.restore(u, p); } },
  'integrity.check':     { admin: true, fn: function (u, p) { return Integrity.check(!!(p && p.deep)); } },
  'migration.import':    { admin: true, write: true, fn: function (u, p) { return Migration.importRows(u, p); } }
};

function isSetup_() {
  var p = PropertiesService.getScriptProperties();
  return !!(p.getProperty('SPREADSHEET_ID') && p.getProperty('TOKEN_SECRET'));
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  // Never returns data: only a liveness probe so the front-end can show "server reachable".
  return out_({ ok: true, data: { service: APP.NAME, version: APP.VERSION, ready: isSetup_() } });
}

function doPost(e) {
  var t0 = Date.now(), reqId = '';
  try {
    var raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > APP.MAX_REQUEST_CHARS) throw E.bad('Request body missing or too large');
    var req;
    try { req = JSON.parse(raw); } catch (x) { throw E.bad('Request is not valid JSON'); }
    var action = String(req.action || '');
    var spec = ACTIONS[action];
    if (!spec) throw E.bad('Unknown action');
    reqId = typeof req.reqId === 'string' && req.reqId.length <= 80 ? req.reqId : '';
    var res = spec.write ? runWrite_(spec, req, action, reqId) : runRead_(spec, req, action);
    res.ms = Date.now() - t0;
    return out_(res);
  } catch (err) {
    return out_(errorResponse_(err, reqId, Date.now() - t0));
  }
}

function errorResponse_(err, reqId, ms) {
  if (err instanceof AppError) return { ok: false, error: { code: err.code, message: err.message, status: err.status, details: err.details }, ms: ms };
  var errorId = Utilities.getUuid().slice(0, 8);
  logErr_('doPost#' + errorId, err);
  return { ok: false, error: { code: 'INTERNAL', message: 'Unexpected server error (ref ' + errorId + ')', status: 500 }, ms: ms };
}

function authenticate_(spec, req) {
  if (spec.auth === false) return null;
  var user = Auth.authenticate(req.token);
  if (spec.admin && user.role !== 'SUPER_ADMIN') throw E.forbidden('SUPER_ADMIN only');
  if (bump_('rl:' + user.id + ':' + Math.floor(Date.now() / 60000), 120) > APP.RATE_LIMIT_PER_MIN) throw E.limit();
  return user;
}

function finish_(user, data) {
  var res = { ok: true, data: data };
  if (user && user._tokenLeft < APP.TOKEN_REFRESH_SEC) res.newToken = signToken_(user);
  return res;
}

function runRead_(spec, req, action) {
  Store.reset(); Policy.reset();
  var user = authenticate_(spec, req);
  return finish_(user, spec.fn(user, req.payload || {}));
}

function runWrite_(spec, req, action, reqId) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new AppError('BUSY', 'Server is busy, please retry in a moment', 503);
  try {
    Store.reset(); Policy.reset();
    var cache = CacheService.getScriptCache(), idemKey = '';
    if (reqId && action !== 'auth.login') {
      idemKey = 'idem:' + sha256Hex_(reqId + '|' + action).slice(0, 40);
      var hit = cache.get(idemKey);
      if (hit) {
        try { var prev = JSON.parse(hit); prev.duplicate = true; return prev; } catch (x) { return { ok: true, data: { duplicate: true }, duplicate: true }; }
      }
    }
    var user = authenticate_(spec, req);
    var res = finish_(user, spec.fn(user, req.payload || {}));
    if (idemKey) {
      var s = JSON.stringify(res);
      cache.put(idemKey, s.length < 90000 ? s : JSON.stringify({ ok: true, data: { duplicate: true, note: 'result too large to replay' } }), APP.IDEMPOTENCY_TTL_SEC);
    }
    return res;
  } catch (err) {
    try { Store.rollback(); } catch (x) { /* ignore */ }
    throw err;
  } finally {
    lock.releaseLock();
  }
}

// ====================================================================== one-time setup (run from the editor)
/**
 * Run once from the Apps Script editor (Run ▸ setup).
 * Before running, add Script properties (Project Settings ▸ Script properties):
 *   INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD (≥ 8 chars; removed automatically after use)
 *   ADMIN_ALERT_EMAIL (optional – receives backup failure e-mails)
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var log = [];
  var root;
  if (props.getProperty('ROOT_FOLDER_ID')) { root = DriveApp.getFolderById(props.getProperty('ROOT_FOLDER_ID')); }
  else {
    var it = DriveApp.getRootFolder().getFoldersByName(APP.ROOT_FOLDER_NAME);
    root = it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(APP.ROOT_FOLDER_NAME);
    props.setProperty('ROOT_FOLDER_ID', root.getId());
  }
  ['Projects', 'Material_Images', 'Database_Backups', 'System_Backups', 'System_Data'].forEach(function (n) { Folders.top(n); });
  Folders.mirror(); Folders.blobs();
  log.push('Drive folders ready under "' + root.getName() + '"');

  if (!props.getProperty('SPREADSHEET_ID')) {
    var ss = SpreadsheetApp.create('EFBMS_Database');
    var f = DriveApp.getFileById(ss.getId());
    var sys = Folders.top('System_Data');
    sys.addFile(f);
    try { DriveApp.getRootFolder().removeFile(f); } catch (e) { /* already moved */ }
    props.setProperty('SPREADSHEET_ID', ss.getId());
    log.push('Spreadsheet created: ' + ss.getUrl());
  }
  if (!props.getProperty('TOKEN_SECRET')) {
    props.setProperty('TOKEN_SECRET', sha256Hex_(Utilities.getUuid() + Utilities.getUuid() + Date.now()) + sha256Hex_(Utilities.getUuid()));
    log.push('Token secret generated');
  }
  Store.reset();
  var sheets = Store.ensureSheets();
  log.push('Sheets created: ' + (sheets.created.join(', ') || 'none') + (sheets.upgraded.length ? ' · upgraded: ' + sheets.upgraded.join(', ') : ''));

  var email = props.getProperty('INITIAL_ADMIN_EMAIL'), pw = props.getProperty('INITIAL_ADMIN_PASSWORD');
  if (Store.count('users') === 0) {
    if (!email || !pw) throw new Error('Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD in Script properties, then run setup() again.');
    var rec = sanitize_('users', { email: email, name: 'Super Admin', role: 'SUPER_ADMIN', active: true }, 'create');
    checkPasswordPolicy_(pw, rec.email);
    rec.id = uid_(); rec.passwordHash = hashPassword_(pw); rec.mustChange = true; rec.tokenVersion = 1;
    Store.insert('users', rec);
    pushAudit_(null, 'SETUP', 'User', rec.id, 'initial admin ' + rec.email);
    if (Store.count('company') === 0) Store.insert('company', { id: uid_(), name: 'My Company', logoText: '', address: '', phone: '', email: '', licenseNo: '', vatRegNo: '', quotationTerms: '', paymentTerms: '', deliveryTerms: '' });
    Store.commit();
    props.deleteProperty('INITIAL_ADMIN_PASSWORD');
    log.push('Initial admin created (' + rec.email + '); password removed from properties. You must change it at first sign-in.');
  } else log.push('Users already exist — admin not touched');
  console.log(log.join('\n'));
  return log;
}

/** Installs the daily backup trigger (02:00–03:00 script time zone). Safe to run repeatedly. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'scheduledBackup') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('scheduledBackup').timeBased().everyDays(1).atHour(2).create();
  console.log('Daily backup trigger installed');
}

/** Run after changing code that adds sheet columns. */
function upgradeSchema() { Store.reset(); return Store.ensureSheets(); }
