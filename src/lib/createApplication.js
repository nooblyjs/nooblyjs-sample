/**
 * @fileoverview Builds the Noobly Knowledge Hub Express application.
 *
 * Shared by app.js, app-noauth.js and the tests, so the security posture and
 * service wiring are identical everywhere. The sequence mirrors the reference
 * app.js in nooblyjs-core: security middleware → session → registry
 * initialise → core services → health checks → appservice (mounts src/) →
 * error handling.
 *
 * NOTE: appservice discovers ./src/{services,data,routes,views} relative to
 * process.cwd(), so callers must run from the repository root (app.js does
 * process.chdir(__dirname)).
 */

'use strict';

const path = require('node:path');
const express = require('express');
// Forward rejected async route handlers to the error handler. Must be loaded
// before any routes are registered.
require('express-async-errors');
const helmet = require('helmet');
const cors = require('cors');
const session = require('express-session');
const { EventEmitter } = require('node:events');

const serviceRegistry = require('nooblyjs-core');
const { createSessionStore } = require('nooblyjs-core/src/shared/utils/sessionStore');
const { helmetCspOption } = require('nooblyjs-core/src/shared/utils/contentSecurityPolicy');
const { createHealthCheckMiddleware } = require('nooblyjs-core/src/middleware/healthCheck');
const coreErrorHandler = require('nooblyjs-core/src/middleware/errorHandler');

const { createCoreServices } = require('../config/services');
const { ensureSettingsDefaults, readAllSettings } = require('./appSettings');
const { createAuthGuards } = require('./auth');
const pkg = require('../../package.json');

// The auth providers register their serializers on the passport instance that
// nooblyjs-core resolves. Use that same instance so req.logIn() works.
const passport = require(require.resolve('passport', {
  paths: [path.dirname(require.resolve('nooblyjs-core'))]
}));

/** Paths the registry's API-key guard never checks (mirrors core app.js). */
const API_KEY_EXCLUDE_PATHS = [
  '/services/*/status',
  '/services/',
  '/services/*/views/*',
  '/services/authservice/api/login',
  '/services/authservice/api/register'
];

/**
 * Splits a comma-separated environment value into trimmed, non-empty items.
 * @param {string=} value Raw value.
 * @return {!Array<string>} Items.
 */
function parseList(value = '') {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

/**
 * Resolves API keys from the environment. In development a temporary key is
 * generated when none is configured; production refuses to start without one.
 * @param {!Object} env Environment variables.
 * @param {boolean} isProduction Whether NODE_ENV is production.
 * @return {{apiKeys: !Array<string>, generated: ?string}}
 * @throws {Error} In production when no API key is configured.
 */
function resolveApiKeys(env, isProduction) {
  const apiKeys = parseList(env.NOOBLYJS_API_KEYS || env.API_KEYS || env.API_KEY || '');
  if (apiKeys.length > 0) {
    return { apiKeys, generated: null };
  }
  if (isProduction) {
    throw new Error('No API keys configured. Set API_KEYS (comma-separated) for production.');
  }
  const generated = serviceRegistry.generateApiKey();
  return { apiKeys: [generated], generated };
}

/**
 * Creates the application.
 *
 * @param {Object=} options
 * @param {boolean=} options.noAuth Disable the admin login on /services and
 *     API keys (local UI work and Playwright only).
 * @param {!Object=} options.env Environment variables (default process.env).
 * @param {string=} options.rootDir Repository root (default: two levels up).
 * @param {string=} options.dataRoot Runtime data root (default rootDir/.application).
 * @param {boolean=} options.seedDemoContent Load seed/ into an empty library
 *     (default: true unless SEED_DEMO_CONTENT=false).
 * @return {Promise<{app: !express.Application, serviceRegistry: !Object,
 *     services: !Object, health: !Object, logger: !Object, context: !Object,
 *     close: function(): !Promise<void>}>}
 * @throws {Error} When production secrets are missing.
 */
async function createApplication(options = {}) {
  const env = options.env || process.env;
  const noAuth = Boolean(options.noAuth);
  const rootDir = options.rootDir || path.resolve(__dirname, '..', '..');
  const dataRoot = options.dataRoot || path.join(rootDir, '.application');
  const isProduction = env.NODE_ENV === 'production';

  if (isProduction && !env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required in production.');
  }
  if (isProduction && noAuth) {
    throw new Error('The no-auth entry point must never run in production.');
  }

  const app = express();

  if (env.TRUST_PROXY) {
    const trustProxy = env.TRUST_PROXY;
    app.set('trust proxy', trustProxy === 'true' ? true : (/^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy));
  }

  // Security headers with the core Content-Security-Policy, so app pages and
  // the /services dashboards share one policy (CSP_MODE=report-only|off).
  app.use(helmet({ contentSecurityPolicy: helmetCspOption(env) }));

  const corsOrigins = parseList(env.CORS_ORIGINS);
  app.use(cors({ origin: corsOrigins.length > 0 ? corsOrigins : false, credentials: true }));

  const bodyLimit = env.BODY_LIMIT || '1mb';
  app.use(express.json({ limit: bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

  // Sessions: Redis when SESSION_REDIS_URL/REDIS_URL is set, otherwise the
  // core's pruning in-process store.
  const sessionStore = createSessionStore(session);
  app.use(session({
    store: sessionStore.store,
    secret: env.SESSION_SECRET || 'dev-only-insecure-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction,
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    }
  }));
  app.use(passport.initialize());
  app.use(passport.session());

  const { apiKeys, generated } = noAuth
    ? { apiKeys: [], generated: null }
    : resolveApiKeys(env, isProduction);

  const eventEmitter = new EventEmitter();
  serviceRegistry.initialize(app, eventEmitter, {
    logDir: path.join(dataRoot, 'logs'),
    dataDir: path.join(dataRoot, 'data'),
    security: {
      apiKeyAuth: {
        apiKeys,
        requireApiKey: !noAuth && apiKeys.length > 0,
        excludePaths: API_KEY_EXCLUDE_PATHS
      },
      servicesAuth: { requireLogin: !noAuth }
    }
  });

  // The core lets any authenticated caller write through /services/filing/api.
  // Restrict writes there to admins; registered before the filing routes so
  // it runs first, and bound to the guards once authservice exists.
  let guards = null;
  app.use('/services/filing/api', (req, res, next) =>
    (guards ? guards.requireAdminForFilingWrites(req, res, next) : next()));

  const services = createCoreServices(serviceRegistry, { dataRoot, env, rootDir });
  const { logger, settings, cache, dataService, filing } = services;

  if (generated) {
    logger.warn('[KnowledgeHub] DEVELOPMENT: generated a temporary API key. Set API_KEYS for real use.', {
      apiKey: generated
    });
  }
  await services.authReady;
  guards = createAuthGuards({ authservice: services.authservice, noAuth, logger });
  await ensureSettingsDefaults(settings, logger);

  // Health checks: /health, /health/live, /health/ready, /health/startup and
  // the admin-only /health/detailed. Ready only after live dependency probes.
  const setupHealthChecks = createHealthCheckMiddleware({
    logger,
    criticalDependencies: ['settings', 'cache', 'dataService', 'filing'],
    dependencyCheckers: {
      settings: async () => typeof (await settings.get('name', 'app')) === 'string',
      cache: async () => {
        await cache.put('__healthcheck__', '1');
        return (await cache.get('__healthcheck__')) === '1';
      },
      dataService: async () => Number.isInteger(await dataService.count('documents')),
      filing: async () => Array.isArray(await filing.list('.'))
    }
  });
  const health = setupHealthChecks(app, serviceRegistry.servicesAuthMiddleware);

  // appservice mounts every top-level .js file in src/services, src/data,
  // src/routes and src/views (in that order), passing these options through to
  // each one. src/services/index.js adds context.domain and context.domainReady.
  const context = {
    serviceRegistry,
    services,
    guards,
    rootDir,
    version: pkg.version,
    noAuth,
    readAllSettings: () => readAllSettings(settings)
  };
  serviceRegistry.appservice('default', { name: 'Knowledge Hub', baseUrl: '/', context });
  await context.domainReady;

  const seedDemoContent = options.seedDemoContent ?? env.SEED_DEMO_CONTENT !== 'false';
  if (seedDemoContent) {
    await context.domain.seed.seedIfEmpty();
  }

  // Unknown /api routes get a JSON 404 instead of the HTML default.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use(coreErrorHandler);

  if (await health.checkCriticalDependencies()) {
    health.markReady();
  } else {
    logger.warn('[KnowledgeHub] Critical dependencies unhealthy at startup; readiness deferred.');
  }

  logger.info('[KnowledgeHub] Application created', {
    version: pkg.version,
    noAuth,
    services: serviceRegistry.listServices()
  });

  return {
    app,
    serviceRegistry,
    services,
    health,
    logger,
    context,
    async close() {
      // Let in-flight pipeline runs and notification handlers finish first.
      await context.domain?.ingest.stop();
      await context.domain?.notifications.idle();
      await serviceRegistry.shutdown();
      await sessionStore.close();
    }
  };
}

module.exports = { createApplication, API_KEY_EXCLUDE_PATHS };
