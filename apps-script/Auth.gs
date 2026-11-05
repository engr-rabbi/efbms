/** File 5/10: Auth.gs — sign-in, session tokens, user administration. */

var Auth = {
  publicUser: function (u) {
    return { id: u.id, email: u.email, name: u.name, role: u.role, mustChange: !!u.mustChange };
  },

  /** Resolve the signed-in user from a token; role/active are read fresh from the sheet on every request. */
  authenticate: function (token) {
    var p = parseToken_(token);
    var u = Store.get('users', p.u);
    if (!u || !u.active) throw E.unauth('Account is disabled');
    if ((u.tokenVersion || 1) !== p.v) throw E.unauth('Session is no longer valid, please sign in again');
    u._tokenAge = Math.floor(Date.now() / 1000) - p.i;
    u._tokenLeft = p.e - Math.floor(Date.now() / 1000);
    return u;
  },

  login: function (params) {
    var email = String((params && params.email) || '').trim().toLowerCase();
    var password = String((params && params.password) || '');
    if (!email || !password || email.length > 200 || password.length > 200) throw E.validation('Email and password are required');
    var failKey = 'lf:' + sha256Hex_(email).slice(0, 24);
    if (count_(failKey) >= APP.LOGIN_MAX_FAILS) throw E.limit('Too many failed sign-in attempts. Try again in 15 minutes.');
    var u = Store.find('users', function (r) { return r.email === email; });
    var good = verifyPassword_(password, u ? u.passwordHash : '');
    if (!u || !good || !u.active) {
      bump_(failKey, APP.LOGIN_LOCK_SEC);
      pushAudit_(null, 'LOGIN_FAILED', 'User', u ? u.id : '', email);
      Store.commit();
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }
    CacheService.getScriptCache().remove(failKey);
    Store.update('users', u.id, { lastLoginAt: nowIso_() });
    pushAudit_(u, 'LOGIN', 'User', u.id, u.email);
    Store.commit();
    return { token: signToken_(u), user: Auth.publicUser(u) };
  },

  me: function (user) { return { user: Auth.publicUser(user) }; },

  changePassword: function (user, params) {
    var oldPw = String((params && params.oldPassword) || ''), newPw = String((params && params.newPassword) || '');
    if (!verifyPassword_(oldPw, user.passwordHash)) throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect', 401);
    checkPasswordPolicy_(newPw, user.email);
    var u = Store.update('users', user.id, { passwordHash: hashPassword_(newPw), mustChange: false, tokenVersion: (user.tokenVersion || 1) + 1 });
    pushAudit_(user, 'CHANGE_PASSWORD', 'User', user.id, user.email);
    Store.commit();
    return { token: signToken_(u), user: Auth.publicUser(u) };
  },

  directory: function () {
    return { users: Store.filter('users', function (u) { return u.active; }).map(function (u) { return { id: u.id, name: u.name, role: u.role }; }) };
  },

  // ---------------------------------------------------------- administration (SUPER_ADMIN only)
  assertAdmin: function (user) { if (!Policy.isAdmin(user)) throw E.forbidden('Only SUPER_ADMIN can manage users'); },

  activeAdmins: function (exceptId) {
    return Store.filter('users', function (u) { return u.role === 'SUPER_ADMIN' && u.active && u.id !== exceptId; }).length;
  },

  createUser: function (user, params) {
    Auth.assertAdmin(user);
    var rec = sanitize_('users', { email: params.email, name: params.name, role: params.role || 'VIEWER', active: true }, 'create');
    checkPasswordPolicy_(params.password, rec.email);
    checkUnique_('users', rec, null);
    rec.id = uid_();
    rec.passwordHash = hashPassword_(params.password);
    rec.mustChange = true;
    rec.tokenVersion = 1;
    Store.insert('users', rec);
    pushAudit_(user, 'CREATE_USER', 'User', rec.id, rec.email + ' (' + rec.role + ')');
    Store.commit();
    return { user: Auth.publicUser(rec) };
  },

  updateUser: function (user, params) {
    Auth.assertAdmin(user);
    var cur = Store.get('users', params.id);
    if (!cur) throw E.notFound('User not found');
    var patch = sanitize_('users', pick_(params, ['name', 'role', 'active']), 'update');
    var losesAdmin = cur.role === 'SUPER_ADMIN' && cur.active && (('role' in patch && patch.role !== 'SUPER_ADMIN') || ('active' in patch && !patch.active));
    if (losesAdmin && Auth.activeAdmins(cur.id) === 0) throw E.conflict('At least one active SUPER_ADMIN must remain');
    if (('role' in patch && patch.role !== cur.role) || ('active' in patch && patch.active !== cur.active)) patch.tokenVersion = (cur.tokenVersion || 1) + 1;
    var u = Store.update('users', cur.id, patch);
    pushAudit_(user, 'UPDATE_USER', 'User', cur.id, cur.email + ' ' + JSON.stringify(pick_(patch, ['role', 'active', 'name'])));
    Store.commit();
    return { user: Auth.publicUser(u) };
  },

  setPassword: function (user, params) {
    Auth.assertAdmin(user);
    var cur = Store.get('users', params.id);
    if (!cur) throw E.notFound('User not found');
    checkPasswordPolicy_(params.password, cur.email);
    Store.update('users', cur.id, { passwordHash: hashPassword_(params.password), mustChange: true, tokenVersion: (cur.tokenVersion || 1) + 1 });
    pushAudit_(user, 'RESET_PASSWORD', 'User', cur.id, cur.email);
    Store.commit();
    return { ok: true };
  },

  listUsers: function (user) {
    Auth.assertAdmin(user);
    return { users: Store.all('users').map(function (u) { return Policy.present(user, 'users', u); }) };
  }
};
