/**
 * @fileoverview The single place where core services and providers are chosen.
 *
 * Every service uses the provider that ServiceRegistry.getDefaultProviderType()
 * returns, with no instanceName. The instance the app uses is therefore the
 * same singleton the registry injects into dependent services (e.g. the queue
 * the app enqueues on is the queue workflow and aiservice receive).
 *
 * To move a service off its default later (e.g. Redis queueing), call
 * serviceRegistry.setDefaultProvider('queueing', 'redis', {...}) at the top of
 * createCoreServices(), before any factory call. Resolved dependencies are
 * cached, so the order matters. Feature code does not change.
 */

'use strict';

const path = require('node:path');

/**
 * The default provider of every core service, as returned by
 * ServiceRegistry.getDefaultProviderType(). appservice ignores its type.
 * @const {!Object<string, string>}
 */
const DEFAULT_PROVIDERS = Object.freeze({
  logging: 'memory',
  caching: 'memory',
  queueing: 'memory',
  notifying: 'memory',
  appservice: 'default',
  fetching: 'node',
  settings: 'file',
  dataservice: 'memory',
  working: 'memory',
  measuring: 'memory',
  scheduling: 'memory',
  searching: 'memory',
  workflow: 'memory',
  filing: 'local',
  authservice: 'file',
  aiservice: 'claude'
});

/**
 * Resolves once the file auth provider has loaded its users, roles and
 * sessions (it loads asynchronously from its constructor and signals with an
 * event). Must be called synchronously after the provider is created so the
 * event cannot be missed.
 *
 * @param {!EventEmitter} eventEmitter The registry's event emitter.
 * @return {!Promise<void>} Rejects if the provider fails to initialise.
 */
function waitForAuthStorage(eventEmitter) {
  return new Promise((resolve, reject) => {
    const onReady = () => {
      eventEmitter.off('auth:file-storage-initialization-error', onError);
      resolve();
    };
    const onError = (event) => {
      eventEmitter.off('auth:file-storage-initialized', onReady);
      reject(new Error(`Auth storage failed to initialise: ${event?.error}`));
    };
    eventEmitter.once('auth:file-storage-initialized', onReady);
    eventEmitter.once('auth:file-storage-initialization-error', onError);
  });
}

/**
 * Creates the core services the app uses directly, in dependency order.
 * Later phases add the remaining services here.
 *
 * @param {!Object} serviceRegistry The initialised nooblyjs-core registry.
 * @param {{dataRoot: string, env: !Object}} config Runtime paths and env.
 * @return {{logger: !Object, settings: !Object, cache: !Object,
 *     queue: !Object, notifying: !Object, dataService: !Object,
 *     working: !Object, workflow: !Object, filing: !Object,
 *     authservice: !Object, authReady: !Promise<void>, filesDir: string,
 *     workDir: string, activitiesDir: string}}
 */
function createCoreServices(serviceRegistry, { dataRoot, env, rootDir }) {
  // Level 0 — logging
  const logger = serviceRegistry.logger(DEFAULT_PROVIDERS.logging);

  // Level 1 — settings: AES-256-GCM encrypted JSON file. The master secret
  // comes from SETTINGS_SECRET, falling back to SESSION_SECRET.
  const settings = serviceRegistry.settings(DEFAULT_PROVIDERS.settings, {
    filepath: path.join(dataRoot, 'settings', 'settings.enc.json')
  });

  // Level 1 — caching: document detail cache (doc:{id}), unread counters.
  const cache = serviceRegistry.cache(DEFAULT_PROVIDERS.caching);

  // Level 1 — queueing: the 'ingest' queue between upload and the pipeline.
  const queue = serviceRegistry.queue(DEFAULT_PROVIDERS.queueing);

  // Level 1 — notifying: pipeline topics (document.ingested, …).
  const notifying = serviceRegistry.notifying(DEFAULT_PROVIDERS.notifying);

  // Level 2 — dataservice: document metadata and the activity log.
  const dataService = serviceRegistry.dataService(DEFAULT_PROVIDERS.dataservice);

  // Level 2 — working: runs activities/*.js in worker threads. Created before
  // workflow so the workflow receives this configured instance.
  const activitiesDir = path.join(rootDir, 'activities');
  const working = serviceRegistry.working(DEFAULT_PROVIDERS.working, { activitiesFolder: activitiesDir });

  // Level 3 — workflow: the 'ingest-document' pipeline. Run history keeps
  // every step's input and output, so it is capped.
  const workflow = serviceRegistry.workflow(DEFAULT_PROVIDERS.workflow, { maxExecutionsPerWorkflow: 200 });

  // Scratch space for pipeline steps (text travels between steps as files).
  const workDir = path.join(dataRoot, 'work');

  // Level 3 — filing: document files on disk. Never the app root, which would
  // expose .env and .application/data through the filing API.
  const filesDir = path.resolve(env.FILING_BASE_DIR || path.join(dataRoot, 'files'));
  require('node:fs').mkdirSync(filesDir, { recursive: true });
  const filing = serviceRegistry.filing(DEFAULT_PROVIDERS.filing, { baseDir: filesDir });

  // Level 4 — authservice: users, roles and sessions in JSON files. A default
  // admin (admin@localhost) is created on first boot; its password comes from
  // DEFAULT_ADMIN_PASSWORD or a 0600 bootstrap file under dataDir. The core
  // login always returns to /library (it overrides any returnUrl).
  const authservice = serviceRegistry.authservice(DEFAULT_PROVIDERS.authservice, {
    dataDir: path.join(dataRoot, 'data', 'auth'),
    loginSuccessRedirectUrl: '/library'
  });
  const authReady = waitForAuthStorage(serviceRegistry.getEventEmitter());

  return {
    logger,
    settings,
    cache,
    queue,
    notifying,
    dataService,
    working,
    workflow,
    filing,
    authservice,
    authReady,
    filesDir,
    workDir,
    activitiesDir
  };
}

/**
 * Lists the core services currently registered, keyed by service name.
 * Registry keys have the form "service:provider:instance".
 *
 * @param {!Object} serviceRegistry The registry.
 * @return {!Array<{service: string, provider: string, instance: string}>}
 */
function listCoreServices(serviceRegistry) {
  return serviceRegistry.listServices().map((key) => {
    const [service, provider, instance] = key.split(':');
    return { service, provider, instance };
  });
}

module.exports = { DEFAULT_PROVIDERS, createCoreServices, listCoreServices };
