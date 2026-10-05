/**
 * @fileoverview App API routes under /api/v1, mounted by the core appservice.
 *
 * appservice calls every top-level .js file in src/routes with
 * (type, options, eventEmitter). options.context carries the registry and the
 * core services created in src/config/services.js.
 */

'use strict';

const express = require('express');
const { sendSafeError } = require('nooblyjs-core/src/shared/utils/safeError');
const { DEFAULT_PROVIDERS, listCoreServices } = require('../config/services');

/**
 * Builds the public application summary returned by GET /api/v1/info.
 *
 * @param {!Object} context The app context passed through appservice.
 * @return {Promise<!Object>} Name, version and core service usage.
 */
async function buildInfo(context) {
  const settingsValues = await context.readAllSettings();
  const running = listCoreServices(context.serviceRegistry);
  const services = Object.entries(DEFAULT_PROVIDERS).map(([service, defaultProvider]) => {
    const instance = running.find((entry) => entry.service === service);
    return {
      service,
      defaultProvider,
      running: Boolean(instance),
      provider: instance ? instance.provider : null
    };
  });

  return {
    name: settingsValues.app.name,
    version: context.version,
    services,
    servicesRunning: services.filter((entry) => entry.running).length,
    servicesTotal: services.length
  };
}

/**
 * Mounts the /api/v1 router.
 *
 * @param {string} type appservice type (unused).
 * @param {!Object} options appservice options; options.context is required.
 * @param {!EventEmitter} eventEmitter Global event emitter.
 * @return {void}
 */
function createRoutes(type, options, eventEmitter) {
  const app = options['express-app'];
  const context = options.context;
  const router = express.Router();

  /**
   * GET /api/v1/info — application name, version and which core services are
   * running with which provider. Public: it contains no user data.
   */
  router.get('/info', async (req, res) => {
    try {
      res.json(await buildInfo(context));
    } catch (error) {
      sendSafeError(res, error, { status: 500, eventEmitter });
    }
  });

  app.use('/api/v1', router);
}

module.exports = createRoutes;
module.exports.buildInfo = buildInfo;
