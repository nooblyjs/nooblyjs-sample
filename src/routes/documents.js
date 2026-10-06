/**
 * @fileoverview /api/v1/documents — the document library API.
 * Mounted by the core appservice; uses options.context.domain.library.
 *
 *   GET    /api/v1/documents              list (tag, owner, status, q, limit, offset)
 *   POST   /api/v1/documents              upload (multipart: file, title?, tags?) → 202, queued
 *   GET    /api/v1/documents/:id          detail (+ canEdit, recent activity)
 *   PATCH  /api/v1/documents/:id          edit title/tags (owner or admin)
 *   DELETE /api/v1/documents/:id          delete (owner or admin)
 *   POST   /api/v1/documents/:id/retry    re-queue a failed document (owner or admin)
 *   GET    /api/v1/documents/:id/text     start of the extracted text (?maxChars)
 *   GET    /api/v1/documents/:id/download file download
 */

'use strict';

const express = require('express');
const multer = require('multer');
const { ClientError } = require('nooblyjs-core/src/shared/utils/httpErrors');
const { sendSafeError } = require('nooblyjs-core/src/shared/utils/safeError');
const { validate, parseLimit, parseOffset } = require('nooblyjs-core/src/shared/utils/validation');
const { DOCUMENT_STATUS } = require('../data/models/records');

const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Parses a single multipart file into memory with the current size limit.
 * Multer errors become client errors (413 for oversized files).
 *
 * @param {!Object} library LibraryService.
 * @return {function(!Object, !Object): !Promise<void>}
 */
function createUploadParser(library) {
  return async (req, res) => {
    const { maxBytes } = await library.getUploadLimits();
    const parser = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: maxBytes, files: 1, fields: 10, fieldSize: 4096 }
    }).single('file');

    await new Promise((resolve, reject) => {
      parser(req, res, (error) => {
        if (!error) return resolve();
        if (error.code === 'LIMIT_FILE_SIZE') {
          return reject(new ClientError(413, `File is larger than ${maxBytes / (1024 * 1024)} MB`));
        }
        if (error instanceof multer.MulterError) {
          return reject(new ClientError(400, 'Invalid upload: send one file in the "file" field'));
        }
        return reject(error);
      });
    });
  };
}

/**
 * Mounts the documents router.
 * @param {string} type appservice type (unused).
 * @param {!Object} options appservice options with context.
 * @param {!EventEmitter} eventEmitter Global event emitter.
 * @return {void}
 */
function createDocumentRoutes(type, options, eventEmitter) {
  const app = options['express-app'];
  const { guards, domain } = options.context;
  const { library, activity } = domain;
  const parseUpload = createUploadParser(library);
  const router = express.Router();

  /** Runs a handler and maps errors to safe JSON responses. */
  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      sendSafeError(res, error, { status: 500, eventEmitter, operation: `${req.method} ${req.baseUrl}${req.route?.path}` });
    }
  };

  const idParam = validate({ params: { id: { type: 'string', required: true, pattern: ID_PATTERN } } });

  router.use(guards.requireUser);

  router.get('/', validate({
    query: {
      tag: { type: 'string', maxLength: 32 },
      owner: { type: 'string', maxLength: 254 },
      status: { type: 'string', enum: Object.values(DOCUMENT_STATUS) },
      q: { type: 'string', maxLength: 200 }
    }
  }), handle(async (req, res) => {
    const { tag, owner, status, q } = req.query;
    const page = {
      limit: parseLimit(req.query.limit, { defaultValue: 50, max: 200 }),
      offset: parseOffset(req.query.offset)
    };
    const result = await library.list({ tag, owner, status, q: q?.trim() || undefined }, page);
    const limits = await library.getUploadLimits();
    res.json({ ...result, ...page, limits });
  }));

  router.post('/', handle(async (req, res) => {
    await parseUpload(req, res);
    const record = await library.upload(req.appUser, req.file, {
      title: req.body.title,
      tags: req.body.tags
    });
    // Accepted: the ingestion pipeline processes the document in the background.
    res.status(202).json(record);
  }));

  router.get('/:id', idParam, handle(async (req, res) => {
    const record = await library.get(req.params.id);
    const recentActivity = await activity.list({ docId: record.id, limit: 10 });
    res.json({ ...record, canEdit: library.canModify(req.appUser, record), activity: recentActivity });
  }));

  router.patch('/:id', idParam, validate({
    body: {
      title: { type: 'string', maxLength: 500 },
      tags: { type: 'array', maxLength: 50 }
    }
  }), handle(async (req, res) => {
    res.json(await library.update(req.appUser, req.params.id, {
      title: req.body.title,
      tags: req.body.tags
    }));
  }));

  router.delete('/:id', idParam, handle(async (req, res) => {
    await library.remove(req.appUser, req.params.id);
    res.status(204).end();
  }));

  router.post('/:id/retry', idParam, handle(async (req, res) => {
    res.status(202).json(await library.retry(req.appUser, req.params.id));
  }));

  router.get('/:id/text', idParam, handle(async (req, res) => {
    const maxChars = parseLimit(req.query.maxChars, { defaultValue: 20000, max: 100000 });
    res.json(await library.getText(req.params.id, maxChars));
  }));

  router.get('/:id/download', idParam, handle(async (req, res) => {
    const { record, content } = await library.readFile(req.params.id);
    // Always download (never render) user-supplied HTML in the app's origin.
    res.set('Content-Type', record.mime);
    res.set('X-Content-Type-Options', 'nosniff');
    res.attachment(record.filename);
    res.send(content);
  }));

  app.use('/api/v1/documents', router);
}

module.exports = createDocumentRoutes;
