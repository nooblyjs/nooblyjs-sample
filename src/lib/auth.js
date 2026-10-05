/**
 * @fileoverview Authentication guards for the app's /api/v1 routes and pages.
 *
 * The core createAuthMiddleware() only recognises Passport browser sessions.
 * These guards also accept a personal API token (`Authorization: Bearer dtk_…`,
 * created at /services/authservice/api/profile/tokens) and a core session token
 * (`Authorization: Bearer <token>` from the login API), and normalise every
 * identity to {email, fullName, roles, isAdmin} on req.user.
 */

'use strict';

const LOGIN_PAGE = '/services/authservice/views/login.html';

/** Identity used for every request when the app runs with noAuth. */
const DEV_USER = Object.freeze({
  email: 'dev@localhost',
  fullName: 'Developer (no auth)',
  roles: ['admin'],
  isAdmin: true
});

/**
 * Normalises a user or session record from the auth service.
 * @param {?Object} record Record with email, fullName and roles/role.
 * @return {?{email: string, fullName: string, roles: !Array<string>, isAdmin: boolean}}
 */
function toAppUser(record) {
  if (!record || !record.email) {
    return null;
  }
  const roles = Array.isArray(record.roles) ? record.roles : [record.role || 'user'];
  return {
    email: record.email,
    fullName: record.fullName || record.email,
    roles,
    isAdmin: roles.includes('admin')
  };
}

/**
 * Creates the guards.
 *
 * @param {{authservice: !Object, noAuth: boolean, logger: ?Object}} deps
 * @return {{identify: function(!Object): !Promise<?Object>,
 *     requireUser: !Function, requireAdmin: !Function, requirePage: !Function,
 *     requireAdminForFilingWrites: !Function}}
 */
function createAuthGuards({ authservice, noAuth, logger = null }) {
  /**
   * Resolves the caller's identity, or null when anonymous.
   * @param {!Object} req Express request.
   * @return {Promise<?Object>} The app user.
   */
  async function identify(req) {
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      return toAppUser(req.user);
    }

    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) {
      const token = header.slice(7).trim();
      try {
        if (token.startsWith('dtk_')) {
          const result = await authservice.validateApiToken(token);
          return toAppUser(result.user);
        }
        return toAppUser(await authservice.validateSession(token));
      } catch (error) {
        logger?.debug('[Auth] Bearer token rejected', { reason: error.message });
        return null;
      }
    }

    return noAuth ? { ...DEV_USER } : null;
  }

  /** API guard: 401 JSON when anonymous. */
  async function requireUser(req, res, next) {
    const user = await identify(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.appUser = user;
    return next();
  }

  /** API guard: 401 when anonymous, 403 unless the caller is an admin. */
  async function requireAdmin(req, res, next) {
    const user = await identify(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!user.isAdmin) {
      return res.status(403).json({ error: 'Admin role required' });
    }
    req.appUser = user;
    return next();
  }

  /** Page guard: redirects anonymous browsers to the core login page. */
  async function requirePage(req, res, next) {
    const user = await identify(req);
    if (!user) {
      return res.redirect(`${LOGIN_PAGE}?returnUrl=${encodeURIComponent(req.originalUrl)}`);
    }
    req.appUser = user;
    return next();
  }

  /**
   * The core lets any authenticated caller use /services/filing/api so that
   * members can download files, but that also includes upload and remove.
   * Writes there would bypass the library's ownership checks and metadata, so
   * only admins may use them.
   */
  async function requireAdminForFilingWrites(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || noAuth) {
      return next();
    }
    const user = await identify(req);
    if (!user?.isAdmin) {
      return res.status(403).json({ error: 'Admin role required' });
    }
    return next();
  }

  return { identify, requireUser, requireAdmin, requirePage, requireAdminForFilingWrites };
}

module.exports = { createAuthGuards, toAppUser, DEV_USER, LOGIN_PAGE };
