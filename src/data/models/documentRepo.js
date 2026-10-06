/**
 * @fileoverview Document metadata repository over the core data service.
 *
 * The data service generates its own key on add() and ignores ids in the
 * record (specs/spikes.md §3). Documents need stable ids (they appear in URLs
 * and filing paths, and must survive the Phase 4 snapshot restore), so each
 * record carries its own `id` and the repository keeps an id → key map.
 */

'use strict';

const appDataBase = require('nooblyjs-core/src/appservice/baseClasses/appDataBase');
const { CONTAINERS } = require('./records');

class DocumentRepo extends appDataBase {
  /**
   * @param {!Object} options appservice options; options.dependencies must
   *     provide dataservice and logging.
   * @param {!EventEmitter} eventEmitter Global event emitter.
   */
  constructor(options, eventEmitter) {
    super('default', { ...options, containerName: CONTAINERS.documents }, eventEmitter);
    /** @private {!Map<string, string>} Document id → data service key. */
    this.keys_ = new Map();
  }

  /**
   * Creates the container if needed. The memory provider starts empty on
   * every boot, so the id → key map starts empty too; records restored later
   * (Phase 4 snapshot) go through add(), which fills it.
   * @return {Promise<void>}
   */
  async init() {
    try {
      await this.getDataService().createContainer(this.containerName);
    } catch (error) {
      if (!/already exists/.test(error.message)) throw error;
    }
  }

  /**
   * Stores a new record.
   * @param {!Object} record Record with a unique `id`.
   * @return {Promise<!Object>} A copy of the stored record.
   */
  async add(record) {
    if (this.keys_.has(record.id)) {
      throw new Error(`Document already exists: ${record.id}`);
    }
    const key = await this.getDataService().add(this.containerName, structuredClone(record));
    this.keys_.set(record.id, key);
    return structuredClone(record);
  }

  /**
   * @param {string} id Document id.
   * @return {Promise<?Object>} A copy of the record, or null.
   */
  async get(id) {
    const key = this.keys_.get(id);
    if (!key) return null;
    const record = await this.getDataService().getByUuid(this.containerName, key);
    return record ? structuredClone(record) : null;
  }

  /**
   * Merges changes into a record and stamps updatedAt.
   * @param {string} id Document id.
   * @param {!Object} changes Fields to change (id is ignored).
   * @return {Promise<?Object>} The updated record, or null when missing.
   */
  async update(id, changes) {
    const current = await this.get(id);
    if (!current) return null;
    const { id: ignored, ...rest } = changes;
    const updated = { ...current, ...rest, updatedAt: new Date().toISOString() };
    await this.getDataService().update(this.containerName, this.keys_.get(id), structuredClone(updated));
    return updated;
  }

  /**
   * @param {string} id Document id.
   * @return {Promise<boolean>} True when a record was removed.
   */
  async remove(id) {
    const key = this.keys_.get(id);
    if (!key) return false;
    const removed = await this.getDataService().remove(this.containerName, key);
    this.keys_.delete(id);
    return Boolean(removed);
  }

  /**
   * Lists records, newest first, optionally filtered.
   * @param {{tag: (string|undefined), owner: (string|undefined),
   *     status: (string|undefined), q: (string|undefined)}=} filters
   * @return {Promise<!Array<!Object>>} Copies of matching records.
   */
  async list(filters = {}) {
    const { tag, owner, status, q } = filters;
    const records = await this.getDataService().listAll(this.containerName);
    const needle = q ? q.toLowerCase() : null;
    // Reverse insertion order first so ties on createdAt (same ms) still
    // list the newest document first; sort() is stable.
    return records
      .reverse()
      .filter((record) => !tag || record.tags.includes(tag))
      .filter((record) => !owner || record.ownerEmail === owner)
      .filter((record) => !status || record.status === status)
      .filter((record) => !needle
        || record.title.toLowerCase().includes(needle)
        || record.filename.toLowerCase().includes(needle))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((record) => structuredClone(record));
  }

  /** @return {Promise<number>} Number of documents. */
  async count() {
    return this.getDataService().count(this.containerName);
  }
}

module.exports = DocumentRepo;
