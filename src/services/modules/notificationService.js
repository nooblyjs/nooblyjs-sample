/**
 * @fileoverview Pipeline notifications over the core notifying service.
 *
 * Publishers call publish(topic, payload). Subscribers turn messages into
 * activity records (dataservice) and per-user unread counters (caching).
 *
 * The core notify() calls subscribers synchronously and does not await them,
 * so every subscriber here catches its own errors. An escaped async error
 * would become an unhandled rejection, which shuts the app down.
 */

'use strict';

/** Topics the app publishes to. */
const TOPICS = Object.freeze({
  documentIngested: 'document.ingested',
  documentFailed: 'document.failed',
  digestReady: 'digest.ready',
  systemAlert: 'system.alert'
});

class NotificationService {
  /**
   * @param {{notifying: !Object, activity: !Object, cache: !Object, logger: !Object}} deps
   */
  constructor({ notifying, activity, cache, logger }) {
    this.notifying = notifying;
    this.activity = activity;
    this.cache = cache;
    this.logger = logger;
    /** @private {!Set<!Promise>} Subscriber work still running (tests and shutdown wait on it). */
    this.pending_ = new Set();
  }

  /** Creates the topics and subscribes the handlers. */
  async init() {
    for (const topic of Object.values(TOPICS)) {
      await this.notifying.createTopic(topic);
    }
    await this.subscribe_(TOPICS.documentIngested, (message) => this.recordForOwner_(message, {
      type: TOPICS.documentIngested,
      text: `"${message.title}" is ready`
    }));
    await this.subscribe_(TOPICS.documentFailed, (message) => this.recordForOwner_(message, {
      type: TOPICS.documentFailed,
      text: `"${message.title}" could not be processed: ${message.error}`
    }));
    await this.subscribe_(TOPICS.systemAlert, async (message) => {
      this.logger.warn('[NotificationService] System alert', message);
      await this.activity.record({ type: TOPICS.systemAlert, actor: 'system', message: message.message });
    });
  }

  /**
   * Publishes a message.
   * @param {string} topic One of TOPICS.
   * @param {!Object} payload Message body.
   * @return {Promise<void>}
   */
  async publish(topic, payload) {
    await this.notifying.notify(topic, { ...payload, publishedAt: new Date().toISOString() });
  }

  /**
   * @param {string} email User email.
   * @return {Promise<number>} Unread notifications for the user.
   */
  async getUnread(email) {
    return Number(await this.cache.get(`unread:${email}`)) || 0;
  }

  /** @param {string} email User email whose notifications were seen. */
  async markRead(email) {
    await this.cache.delete(`unread:${email}`);
  }

  /** Resolves when all subscriber work started so far has finished. */
  async idle() {
    while (this.pending_.size > 0) {
      await Promise.allSettled([...this.pending_]);
    }
  }

  /**
   * Subscribes a handler that never throws into the notifying service.
   * @param {string} topic Topic.
   * @param {function(!Object): !Promise<void>} handler Async handler.
   * @private
   */
  async subscribe_(topic, handler) {
    await this.notifying.subscribe(topic, (message) => {
      const work = Promise.resolve()
        .then(() => handler(message))
        .catch((error) => {
          this.logger.error('[NotificationService] Subscriber failed', { topic, error: error.message });
        })
        .finally(() => this.pending_.delete(work));
      this.pending_.add(work);
    });
  }

  /**
   * Records a document notification and bumps the owner's unread count.
   * @param {{docId: string, title: string, ownerEmail: string}} message
   * @param {{type: string, text: string}} entry
   * @private
   */
  async recordForOwner_(message, { type, text }) {
    await this.activity.record({
      type,
      actor: 'system',
      docId: message.docId,
      title: message.title,
      recipient: message.ownerEmail,
      message: text
    });
    const key = `unread:${message.ownerEmail}`;
    await this.cache.put(key, (Number(await this.cache.get(key)) || 0) + 1);
  }
}

module.exports = { NotificationService, TOPICS };
