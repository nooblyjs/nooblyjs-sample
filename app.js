/**
 * @fileoverview Noobly Knowledge Hub entry point.
 *
 * Usage: npm start (or npm run dev). Configuration comes from .env; see
 * .env.example. The wiring lives in src/lib/createApplication.js and the
 * provider choices in src/config/services.js.
 */

'use strict';

require('dotenv').config({ quiet: true });

const { startServer } = require('./src/lib/startServer');

startServer({ rootDir: __dirname }).catch((error) => {
  console.error('FATAL: failed to start Knowledge Hub:', error.message);
  process.exit(1);
});
