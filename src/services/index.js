/**
 * @fileoverview Builds the domain layer. Mounted by the core appservice, which
 * calls this before src/routes and src/views, with the same options object.
 *
 * Attaches to options.context:
 *   domain       { documents, activity, library, seed }
 *   domainReady  Promise that resolves once containers exist.
 */

'use strict';

const path = require('node:path');
const DocumentRepo = require('../data/models/documentRepo');
const ActivityRepo = require('../data/models/activityRepo');
const LibraryService = require('./modules/libraryService');
const { SeedService } = require('./modules/seedService');

/**
 * @param {string} type appservice type (unused).
 * @param {!Object} options appservice options; options.context is required.
 * @param {!EventEmitter} eventEmitter Global event emitter.
 * @return {void}
 */
function createDomain(type, options, eventEmitter) {
  const context = options.context;
  const { logger, dataService, filing, cache, settings } = context.services;

  // Repositories get the app's own data service and logger as dependencies
  // (appDataBase reads them from options.dependencies).
  const repoOptions = { ...options, dependencies: { dataservice: dataService, logging: logger } };
  const documents = new DocumentRepo(repoOptions, eventEmitter);
  const activity = new ActivityRepo(repoOptions, eventEmitter);

  const library = new LibraryService({ documents, activity, filing, cache, settings, logger });
  const seed = new SeedService({
    library,
    documents,
    logger,
    seedDir: path.join(context.rootDir, 'seed')
  });

  context.domain = { documents, activity, library, seed };
  context.domainReady = Promise.all([documents.init(), activity.init()]);
}

module.exports = createDomain;
