/**
 * @fileoverview Serves the app's pages and browser assets, mounted by the core
 * appservice. Only src/views/public is exposed, so this module's own source
 * is never served.
 */

'use strict';

const path = require('node:path');
const express = require('express');

/**
 * Mounts src/views/public at the app's base URL.
 *
 * @param {string} type appservice type (unused).
 * @param {!Object} options appservice options.
 * @return {void}
 */
function createViews(type, options) {
  const app = options['express-app'];
  app.use(options.baseUrl || '/', express.static(path.join(__dirname, 'public')));
}

module.exports = createViews;
