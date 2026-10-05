/**
 * @fileoverview Knowledge Hub without authentication, for local UI work and
 * the Playwright tests only. The /services dashboards need no login and API
 * keys are not checked. Refuses to start unless ALLOW_NOAUTH=1, and never in
 * production.
 *
 * Usage: npm run dev:noauth
 */

'use strict';

require('dotenv').config({ quiet: true });

if (process.env.ALLOW_NOAUTH !== '1') {
  console.error('app-noauth.js disables authentication and is for local testing only.');
  console.error('Set ALLOW_NOAUTH=1 to proceed (npm run dev:noauth does this).');
  process.exit(1);
}

const { startServer } = require('./src/lib/startServer');

startServer({ noAuth: true, rootDir: __dirname }).catch((error) => {
  console.error('FATAL: failed to start Knowledge Hub (no auth):', error.message);
  process.exit(1);
});
