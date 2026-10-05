/**
 * @fileoverview Serves the app's pages and browser assets, mounted by the core
 * appservice.
 *
 * - Signed-in pages (src/views/pages) go through the page guard, which sends
 *   anonymous browsers to the core login page.
 * - src/views/public holds the public home page and static assets. This
 *   module's own source is never served.
 */

'use strict';

const path = require('node:path');
const express = require('express');

const PAGES_DIR = path.join(__dirname, 'pages');

/**
 * @param {string} type appservice type (unused).
 * @param {!Object} options appservice options with context.guards.
 * @return {void}
 */
function createViews(type, options) {
  const app = options['express-app'];
  const { guards } = options.context;
  const page = (file) => (req, res) => res.sendFile(path.join(PAGES_DIR, file));

  app.get('/library', guards.requirePage, page('library.html'));
  app.get('/doc/:id', guards.requirePage, page('document.html'));

  app.use(options.baseUrl || '/', express.static(path.join(__dirname, 'public')));
}

module.exports = createViews;
