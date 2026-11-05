/** File 2/10: Util.gs — errors, ids, time, hashing, signed tokens, throttling. */

class AppError extends Error {
  constructor(code, message, status, details) {
    super(message);
    this.code = code;
    this.status = status || 400;
    this.details = details;
  }
}
var E = {
  bad: function (m, d) { return new AppError('BAD_REQUEST', m, 400, d); },
  validation: function (m, d) { return new AppError('VALIDATION', m, 422, d); },
  unauth: function (m) { return new AppError('UNAUTHENTICATED', m || 'Please sign in again', 401); },
  forbidden: function (m) { return new AppError('FORBIDDEN', m || 'You do not have permission for this action', 403); },
  notFound: function (m) { return new AppError('NOT_FOUND', m || 'Not found', 404); },
  conflict: function (m, d) { return new AppError('CONFLICT', m, 409, d); },
  limit: function (m) { return new AppError('RATE_LIMITED', m || 'Too many requests, slow down', 429); }
};

function nowIso_() { return new Date().toISOString(); }

function uid_() {
  var r = Utilities.getUuid().replace(/-/g, '');
  return 'c' + Date.now().toString(36) + r.slice(0, 10);
}

var ID_PATTERN = /^[A-Za-z0-9_.:\-]{1,80}$/;
function validId_(s) { return typeof s === 'string' && ID_PATTERN.test(s); }

function toBytes_(s) { return Array.isArray(s) ? s : Utilities.newBlob(String(s)).getBytes(); }
function bytesToHex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var h = (bytes[i] & 0xff).toString(16);
    out += h.length === 1 ? '0' + h : h;
  }
  return out;
}
function sha256Hex_(bytesOrString) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, toBytes_(bytesOrString)));
}
function hmacHex_(value, key) { return bytesToHex_(Utilities.computeHmacSha256Signature(toBytes_(value), toBytes_(key))); }

function safeEqual_(a, b) {
  a = String(a); b = String(b);
  var diff = a.length ^ b.length;
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** PBKDF2-style password stretching with HMAC-SHA256 (Apps Script has no native PBKDF2). */
function pbkdf_(password, saltHex, iterations) {
  var pw = toBytes_(password);
  var u = Utilities.computeHmacSha256Signature(toBytes_(saltHex + ':1'), pw);
  var acc = u.slice();
  for (var i = 1; i < iterations; i++) {
    u = Utilities.computeHmacSha256Signature(u, pw);
    for (var k = 0; k < acc.length; k++) acc[k] = acc[k] ^ u[k];
  }
  return bytesToHex_(acc);
}
function hashPassword_(password) {
  var salt = sha256Hex_(Utilities.getUuid() + Date.now()).slice(0, 32);
  var it = APP.PBKDF_ITERATIONS;
  return 'pbk1$' + it + '$' + salt + '$' + pbkdf_(password, salt, it);
}
function verifyPassword_(password, stored) {
  var p = String(stored || '').split('$');
  if (p.length !== 4 || p[0] !== 'pbk1') {
    pbkdf_(password, 'dummysaltdummysaltdummysalt0000', APP.PBKDF_ITERATIONS); // equalise timing
    return false;
  }
  return safeEqual_(pbkdf_(password, p[2], Number(p[1])), p[3]);
}
function checkPasswordPolicy_(password, email) {
  password = String(password || '');
  if (password.length < 8) throw E.validation('Password must be at least 8 characters');
  if (password.length > 128) throw E.validation('Password is too long');
  if (email && password.toLowerCase() === String(email).toLowerCase()) throw E.validation('Password must not equal the email');
  if (/^(12345678|password|demo123|qwertyui|11111111)$/i.test(password)) throw E.validation('Password is too common');
}

// ---------------------------------------------------------------- tokens
function tokenSecret_() {
  var s = PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET');
  if (!s) throw new AppError('NOT_SETUP', 'Server is not set up: run setup() in the Apps Script editor', 503);
  return s;
}
function b64u_(s) { return Utilities.base64EncodeWebSafe(toBytes_(s)).replace(/=+$/, ''); }
function b64uDecodeToString_(s) {
  while (s.length % 4) s += '=';
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(s)).getDataAsString();
}
function signToken_(user) {
  var now = Math.floor(Date.now() / 1000);
  var payload = b64u_(JSON.stringify({ u: user.id, v: user.tokenVersion || 1, i: now, e: now + APP.TOKEN_TTL_SEC }));
  return payload + '.' + hmacHex_(payload, tokenSecret_());
}
function parseToken_(token) {
  if (typeof token !== 'string' || token.length > 600 || token.indexOf('.') < 0) throw E.unauth();
  var parts = token.split('.');
  if (parts.length !== 2) throw E.unauth();
  if (!safeEqual_(hmacHex_(parts[0], tokenSecret_()), parts[1])) throw E.unauth();
  var p;
  try { p = JSON.parse(b64uDecodeToString_(parts[0])); } catch (e) { throw E.unauth(); }
  if (!p || !p.u || p.e < Math.floor(Date.now() / 1000)) throw E.unauth('Session expired, please sign in again');
  return p;
}

// ---------------------------------------------------------------- throttling (best-effort, CacheService)
function bump_(key, ttl) {
  var c = CacheService.getScriptCache();
  var n = Number(c.get(key) || 0) + 1;
  c.put(key, String(n), ttl);
  return n;
}
function count_(key) { return Number(CacheService.getScriptCache().get(key) || 0); }

function clamp_(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function isObj_(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function pick_(o, keys) { var r = {}; keys.forEach(function (k) { if (o && k in o) r[k] = o[k]; }); return r; }
function round2_(n) { return Math.round(n * 100) / 100; }
function logErr_(where, e) {
  try { console.error('[' + where + '] ' + (e && e.stack ? e.stack : e)); } catch (x) { /* ignore */ }
}
