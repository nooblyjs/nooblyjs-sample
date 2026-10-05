/**
 * @fileoverview Boots the real application into an isolated .temp/ directory.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

/**
 * Returns a fresh, empty runtime data directory under .temp/tests/data.
 * @param {string} label Short name for the directory.
 * @return {string} Absolute path.
 */
function testDataDir(label) {
  const dir = path.join(ROOT_DIR, '.temp', 'tests', 'data', `${label}-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Creates the application with test-safe settings.
 * @param {{label: string, noAuth: (boolean|undefined), env: (Object|undefined),
 *     seedDemoContent: (boolean|undefined)}} options
 * @return {Promise<{application: !Object, dataRoot: string}>}
 */
async function createTestApp({ label, noAuth = false, env = {}, seedDemoContent = false }) {
  const { createApplication } = require('../../src/lib/createApplication');
  const dataRoot = testDataDir(label);
  const application = await createApplication({
    noAuth,
    seedDemoContent,
    rootDir: ROOT_DIR,
    dataRoot,
    env: {
      NODE_ENV: 'test',
      API_KEYS: 'test-api-key-0123456789abcdef',
      SESSION_SECRET: 'test-session-secret',
      SETTINGS_SECRET: 'test-settings-secret',
      ...env
    }
  });
  return { application, dataRoot };
}

module.exports = { ROOT_DIR, testDataDir, createTestApp };
