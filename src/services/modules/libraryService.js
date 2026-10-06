/**
 * @fileoverview Document library: upload, list, read, edit, delete.
 *
 * Composes several core services through direct registry calls:
 * filing (file bytes), dataservice via DocumentRepo/ActivityRepo (metadata
 * and activity log), caching (document detail) and settings (upload limits).
 * New and retried documents go to the ingestion pipeline (IngestService).
 */

'use strict';

const crypto = require('node:crypto');
const { ClientError } = require('nooblyjs-core/src/shared/utils/httpErrors');
const {
  DOCUMENT_STATUS,
  extensionOf,
  sanitizeFilename,
  titleFromFilename,
  normaliseTitle,
  normaliseTags,
  newDocumentRecord
} = require('../../data/models/records');

const BYTES_PER_MB = 1024 * 1024;

class LibraryService {
  /**
   * @param {{documents: !Object, activity: !Object, filing: !Object,
   *     cache: !Object, settings: !Object, logger: !Object,
   *     ingest: (?Object|undefined)}} deps `ingest` queues documents for
   *     processing; without it documents stay queued.
   */
  constructor({ documents, activity, filing, cache, settings, logger, ingest = null }) {
    this.ingest = ingest;
    this.documents = documents;
    this.activity = activity;
    this.filing = filing;
    this.cache = cache;
    this.settings = settings;
    this.logger = logger;
  }

  /**
   * Current upload limits from the settings service (library group).
   * @return {Promise<{maxBytes: number, allowedTypes: !Array<string>}>}
   */
  async getUploadLimits() {
    const maxUploadMb = Number(await this.settings.get('maxUploadMb', 'library')) || 10;
    const allowedTypes = await this.settings.get('allowedTypes', 'library');
    return {
      maxBytes: Math.round(maxUploadMb * BYTES_PER_MB),
      allowedTypes: Array.isArray(allowedTypes) ? allowedTypes.map((t) => String(t).toLowerCase()) : []
    };
  }

  /**
   * Stores an uploaded file and its metadata.
   *
   * @param {{email: string, fullName: string}} user The uploader.
   * @param {{originalname: string, buffer: !Buffer, size: number}} file Upload.
   * @param {{title: (string|undefined), tags: *}=} fields Optional form fields.
   * @param {{id: (string|undefined), source: (string|undefined)}=} options
   *     A fixed id (demo content) and the document source.
   * @return {Promise<!Object>} The new document record.
   * @throws {ClientError} 400/413/415 for invalid uploads.
   */
  async upload(user, file, fields = {}, options = {}) {
    if (!file || !file.buffer) {
      throw new ClientError(400, 'A file is required');
    }
    const filename = sanitizeFilename(file.originalname);
    const { maxBytes, allowedTypes } = await this.getUploadLimits();
    const ext = extensionOf(filename);
    if (!allowedTypes.includes(ext)) {
      throw new ClientError(415, `File type not allowed. Allowed: ${allowedTypes.join(', ')}`);
    }
    if (file.buffer.length === 0) {
      throw new ClientError(400, 'The file is empty');
    }
    if (file.buffer.length > maxBytes) {
      throw new ClientError(413, `File is larger than ${maxBytes / BYTES_PER_MB} MB`);
    }

    const title = normaliseTitle(fields.title || titleFromFilename(filename));
    const tags = normaliseTags(fields.tags);
    const record = newDocumentRecord({
      id: options.id || crypto.randomUUID(),
      title,
      filename,
      sizeBytes: file.buffer.length,
      owner: user,
      tags,
      source: options.source
    });

    await this.filing.create(record.path, file.buffer);
    try {
      await this.documents.add(record);
    } catch (error) {
      // Keep file storage and metadata consistent.
      await this.filing.delete(record.path).catch(() => {});
      throw error;
    }

    await this.activity.record({
      type: 'document.uploaded',
      actor: user.email,
      docId: record.id,
      title: record.title,
      message: `${user.fullName} uploaded "${record.title}"`
    });
    this.logger.info('[LibraryService] Document uploaded', {
      docId: record.id,
      owner: user.email,
      filename,
      sizeBytes: record.sizeBytes
    });
    await this.ingest?.enqueue(record.id);
    return record;
  }

  /**
   * Queues a failed document for processing again.
   * @param {{email: string, fullName: string, isAdmin: boolean}} user Caller.
   * @param {string} id Document id.
   * @return {Promise<!Object>} The queued record.
   * @throws {ClientError} 403/404, or 409 when the document has not failed.
   */
  async retry(user, id) {
    const record = await this.requireModifiable_(user, id);
    if (record.status !== DOCUMENT_STATUS.failed) {
      throw new ClientError(409, 'Only failed documents can be retried');
    }
    const updated = await this.documents.update(id, { status: DOCUMENT_STATUS.queued, error: null });
    await this.cache.delete(`doc:${id}`);
    await this.activity.record({
      type: 'document.retried',
      actor: user.email,
      docId: id,
      title: record.title,
      message: `${user.fullName} retried processing "${record.title}"`
    });
    this.logger.info('[LibraryService] Document retried', { docId: id, by: user.email });
    await this.ingest?.enqueue(id);
    return updated;
  }

  /**
   * Returns the start of a processed document's extracted text.
   * @param {string} id Document id.
   * @param {number} maxChars Characters to return.
   * @return {Promise<{text: ?string, truncated: boolean}>} text is null
   *     until the document has been processed.
   */
  async getText(id, maxChars) {
    const record = await this.get(id);
    const result = this.ingest ? await this.ingest.readText(record, maxChars) : null;
    return result || { text: null, truncated: false };
  }

  /**
   * Lists documents with filters and paging.
   * @param {{tag: (string|undefined), owner: (string|undefined),
   *     status: (string|undefined), q: (string|undefined)}} filters
   * @param {{limit: number, offset: number}} page
   * @return {Promise<{items: !Array<!Object>, total: number, tags: !Array<string>}>}
   */
  async list(filters, { limit, offset }) {
    const all = await this.documents.list(filters);
    const tags = [...new Set((await this.documents.list()).flatMap((doc) => doc.tags))].sort();
    return { items: all.slice(offset, offset + limit), total: all.length, tags };
  }

  /**
   * Gets one document, through the doc:{id} cache.
   * @param {string} id Document id.
   * @return {Promise<!Object>} The record.
   * @throws {ClientError} 404 when missing.
   */
  async get(id) {
    const cacheKey = `doc:${id}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return structuredClone(cached);
    }
    const record = await this.documents.get(id);
    if (!record) {
      throw new ClientError(404, 'Document not found');
    }
    await this.cache.put(cacheKey, structuredClone(record));
    return record;
  }

  /**
   * Edits the title and/or tags.
   * @param {{email: string, fullName: string, isAdmin: boolean}} user Caller.
   * @param {string} id Document id.
   * @param {{title: (string|undefined), tags: *}} changes
   * @return {Promise<!Object>} The updated record.
   * @throws {ClientError} 403/404/400.
   */
  async update(user, id, changes) {
    const record = await this.requireModifiable_(user, id);
    const update = {};
    if (changes.title !== undefined) update.title = normaliseTitle(changes.title);
    if (changes.tags !== undefined) update.tags = normaliseTags(changes.tags);
    if (Object.keys(update).length === 0) {
      throw new ClientError(400, 'Nothing to update: provide title and/or tags');
    }

    const updated = await this.documents.update(id, update);
    await this.cache.delete(`doc:${id}`);
    await this.activity.record({
      type: 'document.updated',
      actor: user.email,
      docId: id,
      title: updated.title,
      message: `${user.fullName} edited "${updated.title}"`
    });
    this.logger.info('[LibraryService] Document updated', { docId: id, by: user.email, fields: Object.keys(update) });
    return updated;
  }

  /**
   * Deletes the file, metadata and cache entry.
   * @param {{email: string, fullName: string, isAdmin: boolean}} user Caller.
   * @param {string} id Document id.
   * @return {Promise<void>}
   * @throws {ClientError} 403/404.
   */
  async remove(user, id) {
    const record = await this.requireModifiable_(user, id);
    for (const filePath of [record.path, record.textPath].filter(Boolean)) {
      await this.filing.delete(filePath).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    await this.documents.remove(id);
    await this.cache.delete(`doc:${id}`);
    await this.activity.record({
      type: 'document.deleted',
      actor: user.email,
      docId: id,
      title: record.title,
      message: `${user.fullName} deleted "${record.title}"`
    });
    this.logger.info('[LibraryService] Document deleted', { docId: id, by: user.email });
  }

  /**
   * Reads a document's file.
   * @param {string} id Document id.
   * @return {Promise<{record: !Object, content: !Buffer}>}
   * @throws {ClientError} 404 when the document or file is missing.
   */
  async readFile(id) {
    const record = await this.get(id);
    try {
      const content = await this.filing.read(record.path);
      return { record, content: Buffer.isBuffer(content) ? content : Buffer.from(content) };
    } catch (error) {
      if (error.code === 'ENOENT') throw new ClientError(404, 'File not found');
      throw error;
    }
  }

  /**
   * Whether the user may edit or delete the record.
   * @param {{email: string, isAdmin: boolean}} user Caller.
   * @param {!Object} record Document record.
   * @return {boolean}
   */
  canModify(user, record) {
    return Boolean(user.isAdmin || record.ownerEmail === user.email);
  }

  /**
   * @param {!Object} user Caller.
   * @param {string} id Document id.
   * @return {Promise<!Object>} The record.
   * @throws {ClientError} 404 when missing, 403 when not owner or admin.
   * @private
   */
  async requireModifiable_(user, id) {
    const record = await this.documents.get(id);
    if (!record) {
      throw new ClientError(404, 'Document not found');
    }
    if (!this.canModify(user, record)) {
      throw new ClientError(403, 'Only the owner or an admin can change this document');
    }
    return record;
  }
}

module.exports = LibraryService;
