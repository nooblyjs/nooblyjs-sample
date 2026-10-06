/**
 * @fileoverview /api/v1/activity: the team activity feed and the signed-in
 * user's unread notification count. Mounted by the core appservice.
 *
 *   GET  /api/v1/activity?mine=true&limit  newest first
 *   GET  /api/v1/activity/unread           { unread }
 *   POST /api/v1/activity/read             marks notifications as seen
 */

'use strict';

const express = require('express');
const { sendSafeError } = require('nooblyjs-core/src/shared/utils/safeError');
const { validate, parseLimit } = require('nooblyjs-core/src/shared/utils/validation');

/**
 * @param {string} type appservice type (unused).
 * @param {!Object} options appservice options with context.
 * @param {!EventEmitter} eventEmitter Global event emitter.
 * @return {void}
 */
function createActivityRoutes(type, options, eventEmitter) {
  const app = options['express-app'];
  const { guards, domain } = options.context;
  const { activity, notifications } = domain;
  const router = express.Router();

  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      sendSafeError(res, error, { status: 500, eventEmitter, operation: `${req.method} ${req.originalUrl}` });
    }
  };

  router.use(guards.requireUser);

  router.get('/', validate({ query: { mine: { type: 'boolean' } } }), handle(async (req, res) => {
    const items = await activity.list({
      user: req.query.mine === 'true' ? req.appUser.email : undefined,
      limit: parseLimit(req.query.limit, { defaultValue: 50, max: 200 })
    });
    res.json({ items });
  }));

  router.get('/unread', handle(async (req, res) => {
    res.json({ unread: await notifications.getUnread(req.appUser.email) });
  }));

  router.post('/read', handle(async (req, res) => {
    await notifications.markRead(req.appUser.email);
    res.status(204).end();
  }));

  app.use('/api/v1/activity', router);
}

module.exports = createActivityRoutes;
