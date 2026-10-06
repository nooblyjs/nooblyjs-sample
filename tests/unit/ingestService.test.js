'use strict';

const fs = require('node:fs');
const path = require('node:path');
const DocumentRepo = require('../../src/data/models/documentRepo');
const { IngestService, STEP_FAILURE_MESSAGES } = require('../../src/services/modules/ingestService');
const { TOPICS } = require('../../src/services/modules/notificationService');
const { testDataDir } = require('../helpers/testApp');
const { fakeCache, fakeFiling, fakeLogger, fakeSettings, memoryDataService } = require('../helpers/fakes');

/** Queue with the core queueing API. */
function fakeQueue() {
  const items = [];
  return {
    items,
    async enqueue(name, item) { items.push(item); },
    async dequeue() { return items.shift(); }
  };
}

const DOC = { id: 'd1', title: 'Doc', path: 'library/d1/doc.md', extension: 'md', ownerEmail: 'o@x.io', status: 'queued', createdAt: '2026-01-01T00:00:00Z' };

describe('IngestService', () => {
  let ingest;
  let documents;
  let filing;
  let cache;
  let published;
  let workflow;
  let workDir;

  /** A completed run whose step 2 wrote the normalised text. */
  function completedRun(docId, text = 'hello world') {
    const textPath = path.join(workDir, `${docId}.txt`);
    fs.writeFileSync(textPath, text);
    fs.writeFileSync(path.join(workDir, `${docId}.raw.txt`), text);
    return {
      status: 'completed',
      executionId: 'run-1',
      outputData: {
        steps: [
          { data: { rawPath: 'x', characters: text.length, pages: 2 } },
          { data: { textPath, characters: text.length, truncated: false } },
          { data: { words: 2, characters: text.length, readingMinutes: 1, keywords: ['hello'], preview: text } }
        ]
      }
    };
  }

  beforeEach(async () => {
    workDir = testDataDir('ingest');
    documents = new DocumentRepo({ dependencies: { dataservice: memoryDataService(), logging: fakeLogger() } });
    await documents.init();
    await documents.add({ ...DOC });
    filing = fakeFiling();
    cache = fakeCache();
    published = [];
    workflow = { defineWorkflow: jest.fn(), executeWorkflow: jest.fn() };
    ingest = new IngestService({
      queue: fakeQueue(),
      workflow,
      documents,
      filing,
      cache,
      settings: fakeSettings({ pipeline: { drainBatch: 2, maxTextChars: 1000 } }),
      notifications: { publish: async (topic, payload) => { published.push({ topic, payload }); } },
      logger: fakeLogger(),
      filesDir: '/files',
      workDir,
      activitiesDir: '/app/activities'
    });
  });

  it('defines the three-step workflow', async () => {
    await ingest.init();
    expect(workflow.defineWorkflow).toHaveBeenCalledWith('ingest-document', [
      '/app/activities/extract-text.js',
      '/app/activities/normalise-text.js',
      '/app/activities/analyse-text.js'
    ], expect.objectContaining({ group: 'pipeline' }));
  });

  it('passes file paths, not contents, to the workflow', async () => {
    workflow.executeWorkflow.mockResolvedValue(completedRun('d1'));
    await ingest.processOne({ docId: 'd1' });
    expect(workflow.executeWorkflow).toHaveBeenCalledWith('ingest-document', {
      docId: 'd1', sourcePath: '/files/library/d1/doc.md', extension: 'md', workDir, maxChars: 1000
    }, { trigger: 'queue' });
  });

  it('marks a completed document ready, stores its text and notifies the owner', async () => {
    workflow.executeWorkflow.mockResolvedValue(completedRun('d1'));
    await cache.put('doc:d1', { stale: true });

    expect(await ingest.processOne({ docId: 'd1' })).toBe('ready');

    const doc = await documents.get('d1');
    expect(doc).toMatchObject({ status: 'ready', textPath: 'library/d1/extracted.txt', executionId: 'run-1', error: null });
    expect(doc.stats).toMatchObject({ words: 2, keywords: ['hello'], pages: 2 });
    expect(filing.files.get('library/d1/extracted.txt').toString()).toBe('hello world');
    expect(cache.store.has('doc:d1')).toBe(false);
    expect(published).toEqual([{ topic: TOPICS.documentIngested, payload: { docId: 'd1', title: 'Doc', ownerEmail: 'o@x.io' } }]);
    expect(fs.readdirSync(workDir)).toEqual([]);
  });

  it('marks a failed run failed with the step\'s safe message', async () => {
    workflow.executeWorkflow.mockResolvedValue({
      status: 'error',
      executionId: 'run-2',
      error: 'ENOENT /secret/path',
      stepExecutions: [{ status: 'completed', stepPath: '/a/extract-text.js' }, { status: 'error', stepPath: '/a/normalise-text.js' }]
    });

    expect(await ingest.processOne({ docId: 'd1' })).toBe('failed');
    const doc = await documents.get('d1');
    expect(doc).toMatchObject({ status: 'failed', error: STEP_FAILURE_MESSAGES['normalise-text'] });
    expect(doc.error).not.toContain('/secret');
    expect(published[0]).toMatchObject({ topic: TOPICS.documentFailed, payload: { error: doc.error } });
  });

  it('marks the document failed when the workflow cannot run at all', async () => {
    workflow.executeWorkflow.mockRejectedValue(new Error('Working service not available'));
    expect(await ingest.processOne({ docId: 'd1' })).toBe('failed');
    expect((await documents.get('d1')).error).toBe('Processing failed. Try again later.');
  });

  it('skips documents deleted before or during processing', async () => {
    expect(await ingest.processOne({ docId: 'gone' })).toBeNull();

    workflow.executeWorkflow.mockImplementation(async () => {
      await documents.remove('d1');
      return completedRun('d1');
    });
    expect(await ingest.processOne({ docId: 'd1' })).toBeNull();
    expect(filing.files.size).toBe(0);
    expect(published).toEqual([]);
  });

  it('drains the queue in batches and stops when asked', async () => {
    for (const id of ['d2', 'd3', 'd4']) await documents.add({ ...DOC, id, path: `library/${id}/doc.md` });
    workflow.executeWorkflow.mockImplementation(async (name, input) => completedRun(input.docId));

    for (const id of ['d1', 'd2', 'd3', 'd4']) await ingest.enqueue(id);
    await ingest.idle();

    expect((await documents.list()).every((d) => d.status === 'ready')).toBe(true);
    expect(workflow.executeWorkflow).toHaveBeenCalledTimes(4);

    await ingest.stop();
    await ingest.enqueue('d1');
    await ingest.idle();
    expect(workflow.executeWorkflow).toHaveBeenCalledTimes(4);
  });

  it('readText returns the start of the stored text, or null before processing', async () => {
    expect(await ingest.readText({ textPath: null }, 5)).toBeNull();
    await filing.create('library/d1/extracted.txt', 'hello world');
    expect(await ingest.readText({ textPath: 'library/d1/extracted.txt' }, 5)).toEqual({ text: 'hello', truncated: true });
    expect(await ingest.readText({ textPath: 'library/d1/missing.txt' }, 5)).toBeNull();
  });
});
