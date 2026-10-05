'use strict';

const { createAuthGuards, toAppUser, DEV_USER } = require('../../src/lib/auth');

function fakeAuthservice() {
  return {
    async validateApiToken(token) {
      if (token === 'dtk_good') return { user: { email: 'tok@x.io', fullName: 'Token User', roles: ['user'] } };
      throw new Error('Invalid API token');
    },
    async validateSession(token) {
      if (token === 'session-good') return { email: 'ses@x.io', fullName: 'Session', roles: ['admin'] };
      throw new Error('Invalid session');
    }
  };
}

function mockRes() {
  const res = { statusCode: 200, body: null, redirectedTo: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.redirect = (url) => { res.redirectedTo = url; return res; };
  return res;
}

const req = (overrides = {}) => ({ headers: {}, method: 'GET', originalUrl: '/library', ...overrides });

describe('toAppUser', () => {
  it('normalises roles and admin flag', () => {
    expect(toAppUser({ email: 'a@b', role: 'admin' })).toEqual({ email: 'a@b', fullName: 'a@b', roles: ['admin'], isAdmin: true });
    expect(toAppUser({ email: 'a@b', fullName: 'A', roles: ['user'] }).isAdmin).toBe(false);
    expect(toAppUser(null)).toBeNull();
  });
});

describe('createAuthGuards', () => {
  const guards = createAuthGuards({ authservice: fakeAuthservice(), noAuth: false });

  it('identifies Passport sessions', async () => {
    const user = await guards.identify(req({ isAuthenticated: () => true, user: { email: 'p@x.io', roles: ['user'] } }));
    expect(user.email).toBe('p@x.io');
  });

  it('identifies dtk_ API tokens and session tokens', async () => {
    expect((await guards.identify(req({ headers: { authorization: 'Bearer dtk_good' } }))).email).toBe('tok@x.io');
    expect((await guards.identify(req({ headers: { authorization: 'Bearer session-good' } }))).isAdmin).toBe(true);
  });

  it('treats invalid tokens and no credentials as anonymous', async () => {
    expect(await guards.identify(req({ headers: { authorization: 'Bearer dtk_bad' } }))).toBeNull();
    expect(await guards.identify(req())).toBeNull();
  });

  it('requireUser answers 401, requireAdmin 403 for non-admins', async () => {
    const res401 = mockRes();
    await guards.requireUser(req(), res401, jest.fn());
    expect(res401.statusCode).toBe(401);

    const res403 = mockRes();
    const next = jest.fn();
    await guards.requireAdmin(req({ headers: { authorization: 'Bearer dtk_good' } }), res403, next);
    expect(res403.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('requirePage redirects anonymous browsers to login with a returnUrl', async () => {
    const res = mockRes();
    await guards.requirePage(req(), res, jest.fn());
    expect(res.redirectedTo).toBe('/services/authservice/views/login.html?returnUrl=%2Flibrary');
  });

  it('requireAdminForFilingWrites allows reads and admin writes only', async () => {
    const next = jest.fn();
    await guards.requireAdminForFilingWrites(req({ method: 'GET' }), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);

    const res = mockRes();
    await guards.requireAdminForFilingWrites(req({ method: 'DELETE', headers: { authorization: 'Bearer dtk_good' } }), res, next);
    expect(res.statusCode).toBe(403);

    await guards.requireAdminForFilingWrites(req({ method: 'POST', headers: { authorization: 'Bearer session-good' } }), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('uses the developer identity when noAuth is on', async () => {
    const open = createAuthGuards({ authservice: fakeAuthservice(), noAuth: true });
    expect(await open.identify(req())).toEqual(DEV_USER);
  });
});
