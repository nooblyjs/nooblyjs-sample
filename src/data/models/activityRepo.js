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
   *     title: (string|undefined), recipient: (string|undefined),
   *     message: string}} entry `recipient` is the user a notification is for.
   * @return {Promise<!Object>} The stored record.
   */
  async record({ type, actor, docId = null, title = null, recipient = null, message }) {
    const record = {
      id: crypto.randomUUID(),
      type,
      actor,
      docId,
      title,
      recipient,
      message,
      createdAt: new Date().toISOString()
    };
    await this.getDataService().add(this.containerName, record);
    return { ...record };
  }

  /**
   * Lists recent activity, newest first.
   * @param {{docId: (string|undefined), user: (string|undefined),
   *     limit: (number|undefined)}=} options `user` keeps entries the user
   *     did or that were sent to them.
   * @return {Promise<!Array<!Object>>} Records.
   */
  async list({ docId, user, limit = 50 } = {}) {
    const records = await this.getDataService().listAll(this.containerName);
    // listAll() returns insertion order and sort() is stable, so reversing
    // first keeps the newest record first when timestamps tie (same ms).
    return records
      .reverse()
      .filter((record) => !docId || record.docId === docId)
      .filter((record) => !user || record.actor === user || record.recipient === user)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((record) => ({ ...record }));
  }
}

module.exports = ActivityRepo;
