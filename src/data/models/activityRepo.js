/**
 * @fileoverview Activity log repository: one record per library change.
 * Phase 2 adds pipeline events through the notifying service.
 */

'use strict';

const crypto = require('node:crypto');
const appDataBase = require('nooblyjs-core/src/appservice/baseClasses/appDataBase');
const { CONTAINERS } = require('./records');

class ActivityRepo extends appDataBase {
  /**
   * @param {!Object} options appservice options with dependencies.dataservice.
   * @param {!EventEmitter} eventEmitter Global event emitter.
   */
  constructor(options, eventEmitter) {
    super('default', { ...options, containerName: CONTAINERS.activity }, eventEmitter);
  }

  /** Creates the container if needed. */
  async init() {
    try {
      await this.getDataService().createContainer(this.containerName);
    } catch (error) {
      if (!/already exists/.test(error.message)) throw error;
    }
  }

  /**
   * Records an activity.
   * @param {{type: string, actor: string, docId: (string|undefined),
   *     title: (string|undefined), message: string}} entry
   * @return {Promise<!Object>} The stored record.
   */
  async record({ type, actor, docId = null, title = null, message }) {
    const record = {
      id: crypto.randomUUID(),
      type,
      actor,
      docId,
      title,
      message,
      createdAt: new Date().toISOString()
    };
    await this.getDataService().add(this.containerName, record);
    return { ...record };
  }

  /**
   * Lists recent activity, newest first.
   * @param {{docId: (string|undefined), limit: (number|undefined)}=} options
   * @return {Promise<!Array<!Object>>} Records.
   */
  async list({ docId, limit = 50 } = {}) {
    const records = await this.getDataService().listAll(this.containerName);
    return records
      .filter((record) => !docId || record.docId === docId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((record) => ({ ...record }));
  }
}

module.exports = ActivityRepo;
