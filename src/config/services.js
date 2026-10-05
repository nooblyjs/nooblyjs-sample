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
 * Creates the core services the app uses directly, in dependency order.
 *
 * Phase 0 wires logging, settings and authservice (the built-in login is what
 * protects the /services dashboards). Creating authservice also creates its
 * injected dependencies, caching and dataservice, with their default providers.
 * Later phases add the remaining services here.
 *
 * @param {!Object} serviceRegistry The initialised nooblyjs-core registry.
 * @param {{dataRoot: string, env: !Object}} config Runtime paths and env.
 * @return {{logger: !Object, settings: !Object, authservice: !Object}}
 */
function createCoreServices(serviceRegistry, { dataRoot }) {
  // Level 0 — logging
  const logger = serviceRegistry.logger(DEFAULT_PROVIDERS.logging);

  // Level 1 — settings: AES-256-GCM encrypted JSON file. The master secret
  // comes from SETTINGS_SECRET, falling back to SESSION_SECRET.
  const settings = serviceRegistry.settings(DEFAULT_PROVIDERS.settings, {
    filepath: path.join(dataRoot, 'settings', 'settings.enc.json')
  });

  // Level 4 — authservice: users, roles and sessions in JSON files. A default
  // admin (admin@localhost) is created on first boot; its password comes from
  // DEFAULT_ADMIN_PASSWORD or a 0600 bootstrap file under dataDir.
  const authservice = serviceRegistry.authservice(DEFAULT_PROVIDERS.authservice, {
    dataDir: path.join(dataRoot, 'data', 'auth'),
    loginSuccessRedirectUrl: '/'
  });

  return { logger, settings, authservice };
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
