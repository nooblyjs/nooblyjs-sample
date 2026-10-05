/**
 * @fileoverview Starts the HTTP(S) server and handles graceful shutdown.
 * Shared by app.js and app-noauth.js.
 */

'use strict';

const { createServer } = require('nooblyjs-core/src/shared/utils/createServer');
const { createApplication } = require('./createApplication');

/**
 * Creates the application, listens on PORT and installs signal handlers.
 *
 * @param {{noAuth: (boolean|undefined), rootDir: string}} options
 * @return {Promise<void>}
 */
async function startServer({ noAuth = false, rootDir }) {
  // appservice discovers ./src/* relative to the working directory.
  process.chdir(rootDir);

  const application = await createApplication({ noAuth, rootDir });
  const { app, logger } = application;

  const port = Number(process.env.PORT) || 3000;
  const { server, protocol } = createServer(app, { baseDir: rootDir });

  server.listen(port, () => {
    logger.info(`[KnowledgeHub] Listening on ${protocol}://localhost:${port}${noAuth ? ' (NO AUTH)' : ''}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[KnowledgeHub] ${signal} received, shutting down`);

    const forceTimer = setTimeout(() => {
      logger.error('[KnowledgeHub] Shutdown timed out; forcing exit');
      process.exit(1);
    }, Number(process.env.SHUTDOWN_TIMEOUT_MS) || 15000);
    forceTimer.unref();

    try {
      await new Promise((resolve) => server.close(resolve));
      await application.close();
      clearTimeout(forceTimer);
      process.exit(0);
    } catch (error) {
      logger.error('[KnowledgeHub] Error during shutdown', { error: error.message });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('[KnowledgeHub] Unhandled rejection', {
      error: reason instanceof Error ? reason.stack : String(reason)
    });
    shutdown('unhandledRejection');
  });
  process.on('uncaughtException', (error) => {
    logger.error('[KnowledgeHub] Uncaught exception', { error: error.stack || error.message });
    shutdown('uncaughtException');
  });
}

module.exports = { startServer };
