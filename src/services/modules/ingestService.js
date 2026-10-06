/**
 * @fileoverview Ingestion pipeline: queue → workflow → working → side effects.
 *
 *   enqueue(docId)      queueing.enqueue('ingest', { docId }) and schedule a drain
 *   drain()             dequeue up to pipeline.drainBatch items at a time and
 *                       run the 'ingest-document' workflow for each
 *   processOne(item)    executeWorkflow → on success store extracted text in
 *                       filing, mark the document ready with its stats and
 *                       publish document.ingested; on failure mark it failed
 *                       with a safe message and publish document.failed
 *
 * The workflow's steps (activities/*.js) run in worker threads and only read
 * the source file and write scratch files under workDir. Every change to
 * application state happens here, in the main process.
 */

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { DOCUMENT_STATUS } = require('../../data/models/records');
const { TOPICS } = require('./notificationService');

const WORKFLOW_NAME = 'ingest-document';
const QUEUE_NAME = 'ingest';
const STEPS = ['extract-text', 'normalise-text', 'analyse-text'];

/** Failure message shown to users, by the step that failed. */
const STEP_FAILURE_MESSAGES = Object.freeze({
  'extract-text': 'The text in this file could not be read.',
  'normalise-text': 'The file contains no readable text.',
  'analyse-text': 'The text could not be analysed.'
});
const GENERIC_FAILURE = 'Processing failed. Try again later.';

class IngestService {
  /**
   * @param {{queue: !Object, workflow: !Object, documents: !Object,
   *     filing: !Object, cache: !Object, settings: !Object,
   *     notifications: !Object, logger: !Object, filesDir: string,
   *     workDir: string, activitiesDir: string}} deps
   */
  constructor(deps) {
    Object.assign(this, {
      queue: deps.queue,
      workflow: deps.workflow,
      documents: deps.documents,
      filing: deps.filing,
      cache: deps.cache,
      settings: deps.settings,
      notifications: deps.notifications,
      logger: deps.logger,
      filesDir: deps.filesDir,
      workDir: deps.workDir,
      activitiesDir: deps.activitiesDir
    });
    /** @private {?Promise<number>} The drain in progress. */
    this.draining_ = null;
    /** @private {boolean} Another drain was requested while one was running. */
    this.drainAgain_ = false;
    /** @private {boolean} Set by stop(); no new drains start. */
    this.stopped_ = false;
  }

  /** Creates the scratch directory and defines the workflow. */
  async init() {
    await fs.mkdir(this.workDir, { recursive: true });
    await this.workflow.defineWorkflow(
      WORKFLOW_NAME,
      STEPS.map((step) => path.join(this.activitiesDir, `${step}.js`)),
      { description: 'Extract, normalise and analyse the text of an uploaded document', group: 'pipeline' }
    );
  }

  /**
   * Queues a document for processing and starts a drain.
   * @param {string} docId Document id.
   * @return {Promise<void>}
   */
  async enqueue(docId) {
    await this.queue.enqueue(QUEUE_NAME, { docId, enqueuedAt: new Date().toISOString() });
    this.scheduleDrain();
  }

  /**
   * Starts a drain on the next tick, or asks the running drain to go again.
   * Errors are reported on system.alert instead of escaping.
   */
  scheduleDrain() {
    if (this.stopped_) return;
    if (this.draining_) {
      this.drainAgain_ = true;
      return;
    }
    this.draining_ = new Promise((resolve) => setImmediate(resolve))
      .then(() => this.drain())
      .catch(async (error) => {
        this.logger.error('[IngestService] Drain failed', { error: error.message });
        await this.notifications.publish(TOPICS.systemAlert, { message: 'The ingestion queue stopped unexpectedly.' })
          .catch(() => {});
        return 0;
      })
      .finally(() => {
        this.draining_ = null;
        if (this.drainAgain_) {
          this.drainAgain_ = false;
          this.scheduleDrain();
        }
      });
  }

  /**
   * Processes queued documents until the queue is empty, in batches of
   * pipeline.drainBatch run concurrently.
   * @return {Promise<number>} Documents processed.
   */
  async drain() {
    const batchSize = Math.max(1, Number(await this.settings.get('drainBatch', 'pipeline')) || 1);
    let processed = 0;
    while (!this.stopped_) {
      const batch = [];
      while (batch.length < batchSize) {
        const item = await this.queue.dequeue(QUEUE_NAME);
        if (!item) break;
        batch.push(item);
      }
      if (batch.length === 0) break;
      await Promise.all(batch.map((item) => this.processOne(item)));
      processed += batch.length;
    }
    return processed;
  }

  /**
   * Runs the pipeline for one queued document.
   * @param {{docId: string}} item Queue item.
   * @return {Promise<?string>} Final status, or null when the document is gone.
   */
  async processOne({ docId }) {
    const record = await this.documents.get(docId);
    if (!record) {
      return null; // Deleted while queued.
    }
    await this.setStatus_(docId, { status: DOCUMENT_STATUS.processing, error: null });

    const maxChars = Number(await this.settings.get('maxTextChars', 'pipeline')) || 500000;
    const startedAt = Date.now();
    try {
      const run = await this.workflow.executeWorkflow(WORKFLOW_NAME, {
        docId,
        sourcePath: path.join(this.filesDir, record.path),
        extension: record.extension,
        workDir: this.workDir,
        maxChars
      }, { trigger: 'queue' });

      if (run.status === 'completed') {
        return await this.complete_(record, run, Date.now() - startedAt);
      }
      return await this.fail_(record, run);
    } catch (error) {
      // The workflow could not run, or applying its result failed. Never
      // leave the document stuck in "processing".
      this.logger.error('[IngestService] Pipeline error', { docId, error: error.message });
      return this.fail_(record, { error: error.message, stepExecutions: [] });
    } finally {
      await this.removeScratch_(docId);
    }
  }

  /**
   * Reads the extracted text of a processed document.
   * @param {!Object} record Document record.
   * @param {number} maxChars Characters to return.
   * @return {Promise<?{text: string, truncated: boolean}>} Null when not processed.
   */
  async readText(record, maxChars) {
    if (!record.textPath) return null;
    try {
      const text = (await this.filing.read(record.textPath, 'utf8')).toString();
      return { text: text.slice(0, maxChars), truncated: text.length > maxChars };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  /**
   * Stops scheduling drains and waits for the current one to finish.
   * @param {number=} timeoutMs Maximum wait.
   * @return {Promise<void>}
   */
  async stop(timeoutMs = 10000) {
    this.stopped_ = true;
    if (!this.draining_) return;
    let timer;
    await Promise.race([
      this.draining_,
      new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); })
    ]);
    clearTimeout(timer);
  }

  /** Resolves when no drain is running (used by tests). */
  async idle() {
    while (this.draining_) {
      await this.draining_;
    }
  }

  /**
   * Applies a successful run.
   * @private
   */
  async complete_(record, run, durationMs) {
    const [extract, normalise, analyse] = run.outputData.steps.map((step) => step.data);
    const text = await fs.readFile(normalise.textPath, 'utf8');

    // The document may have been deleted while the workflow ran.
    if (!(await this.documents.get(record.id))) return null;

    const textPath = `library/${record.id}/extracted.txt`;
    await this.filing.create(textPath, text);
    const updated = await this.setStatus_(record.id, {
      status: DOCUMENT_STATUS.ready,
      error: null,
      textPath,
      stats: {
        words: analyse.words,
        characters: analyse.characters,
        readingMinutes: analyse.readingMinutes,
        keywords: analyse.keywords,
        pages: extract.pages ?? null,
        truncated: normalise.truncated
      },
      preview: analyse.preview,
      executionId: run.executionId,
      ingestedAt: new Date().toISOString()
    });
    if (!updated) return null;

    await this.notifications.publish(TOPICS.documentIngested, {
      docId: record.id,
      title: updated.title,
      ownerEmail: updated.ownerEmail
    });
    this.logger.info('[IngestService] Document ready', { docId: record.id, words: analyse.words, durationMs });
    return DOCUMENT_STATUS.ready;
  }

  /**
   * Applies a failed run with a message that is safe to show users.
   * @private
   */
  async fail_(record, run) {
    const failedStep = (run.stepExecutions || []).find((step) => step.status === 'error');
    const stepName = failedStep ? path.basename(failedStep.stepPath, '.js') : null;
    const message = STEP_FAILURE_MESSAGES[stepName] || GENERIC_FAILURE;

    const updated = await this.setStatus_(record.id, {
      status: DOCUMENT_STATUS.failed,
      error: message,
      executionId: run.executionId
    });
    this.logger.warn('[IngestService] Document failed', {
      docId: record.id,
      step: stepName,
      error: run.error,
      executionId: run.executionId
    });
    if (!updated) return null;

    await this.notifications.publish(TOPICS.documentFailed, {
      docId: record.id,
      title: updated.title,
      ownerEmail: updated.ownerEmail,
      error: message
    });
    return DOCUMENT_STATUS.failed;
  }

  /**
   * Updates a document and drops its cached copy.
   * @private
   */
  async setStatus_(docId, changes) {
    const updated = await this.documents.update(docId, changes);
    await this.cache.delete(`doc:${docId}`);
    return updated;
  }

  /**
   * Deletes a run's scratch files.
   * @private
   */
  async removeScratch_(docId) {
    await Promise.all([`${docId}.raw.txt`, `${docId}.txt`].map((name) =>
      fs.rm(path.join(this.workDir, name), { force: true })));
  }
}

module.exports = { IngestService, WORKFLOW_NAME, QUEUE_NAME, STEP_FAILURE_MESSAGES };
