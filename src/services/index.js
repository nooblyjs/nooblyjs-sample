/**
 * @fileoverview Builds the domain layer. Mounted by the core appservice, which
 * calls this before src/routes and src/views, with the same options object.
 *
 * Attaches to options.context:
 *   domain       { documents, activity, notifications, ingest, library, seed }
 *   domainReady  Promise that resolves once containers, topics and the
 *                ingest workflow exist.
 */

'use strict';

const path = require('node:path');
const DocumentRepo = require('../data/models/documentRepo');
const ActivityRepo = require('../data/models/activityRepo');
const LibraryService = require('./modules/libraryService');
const { NotificationService } = require('./modules/notificationService');
const { IngestService } = require('./modules/ingestService');
const { SeedService } = require('./modules/seedService');

/**
 * @param {string} type appservice type (unused).
 * @param {!Object} options appservice options; options.context is required.
 * @param {!EventEmitter} eventEmitter Global event emitter.
 * @return {void}
 */
function createDomain(type, options, eventEmitter) {
  const context = options.context;
  const {
    logger, dataService, filing, cache, settings, queue, notifying, workflow, filesDir, workDir, activitiesDir
  } = context.services;

  // Repositories get the app's own data service and logger as dependencies
  // (appDataBase reads them from options.dependencies).
  const repoOptions = { ...options, dependencies: { dataservice: dataService, logging: logger } };
  const documents = new DocumentRepo(repoOptions, eventEmitter);
  const activity = new ActivityRepo(repoOptions, eventEmitter);

  const notifications = new NotificationService({ notifying, activity, cache, logger });
  const ingest = new IngestService({
    queue, workflow, documents, filing, cache, settings, notifications, logger, filesDir, workDir, activitiesDir
  });
  const library = new LibraryService({ documents, activity, filing, cache, settings, logger, ingest });
  const seed = new SeedService({
    library,
    documents,
    logger,
    seedDir: path.join(context.rootDir, 'seed')
  });

  context.domain = { documents, activity, notifications, ingest, library, seed };
  context.domainReady = Promise.all([documents.init(), activity.init()])
    .then(() => Promise.all([notifications.init(), ingest.init()]));
}

module.exports = createDomain;
