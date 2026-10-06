'use strict';

const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { createTestApp, ROOT_DIR, testDataDir } = require('../helpers/testApp');

const SEED = path.join(ROOT_DIR, 'seed');

/**
 * Polls a document until it leaves queued/processing.
 * @return {Promise<!Object>} The document.
 */
async function waitForDocument(app, id, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request(app).get(`/api/v1/documents/${id}`).expect(200);
    if (res.body.status === 'ready' || res.body.status === 'failed') return res.body;
    if (Date.now() > deadline) throw new Error(`Document ${id} still ${res.body.status}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

describe('ingestion pipeline (Phase 2)', () => {
  let application;
  let app;
  let dataRoot;

  beforeAll(async () => {
    ({ application, dataRoot } = await createTestApp({ label: 'pipeline', noAuth: true }));
    app = application.app;
  });

  afterAll(async () => {
    await application?.close();
  });

  it('defines the ingest-document workflow on boot', async () => {
    const res = await request(app).get('/services/workflow/api/workflows/ingest-document').expect(200);
    expect(JSON.stringify(res.body)).toContain('extract-text.js');
  });

  it('processes Markdown and PDF uploads in worker threads to ready', async () => {
    const md = await request(app).post('/api/v1/documents').attach('file', path.join(SEED, 'service-registry.md')).expect(202);
    const pdf = await request(app).post('/api/v1/documents').attach('file', path.join(SEED, 'release-checklist.pdf')).expect(202);
    expect(md.body.status).toBe('queued');

    const [mdDoc, pdfDoc] = await Promise.all([waitForDocument(app, md.body.id), waitForDocument(app, pdf.body.id)]);

    expect(mdDoc).toMatchObject({ status: 'ready', error: null, textPath: `library/${md.body.id}/extracted.txt` });
    expect(mdDoc.stats.words).toBeGreaterThan(100);
    expect(mdDoc.stats.keywords).toContain('service');
    expect(pdfDoc).toMatchObject({ status: 'ready' });
    expect(pdfDoc.stats.pages).toBe(1);

    const text = await request(app).get(`/api/v1/documents/${pdf.body.id}/text?maxChars=17`).expect(200);
    expect(text.body).toEqual({ text: 'Release Checklist', truncated: true });

    // Scratch files are removed after every run.
    expect(fs.readdirSync(path.join(dataRoot, 'work'))).toEqual([]);
  });

  it('fails a corrupt PDF with a safe message, then accepts a retry', async () => {
    const bad = path.join(testDataDir('pipeline-bad'), 'broken.pdf');
    fs.writeFileSync(bad, '%PDF-1.4 this is not really a pdf');
    const upload = await request(app).post('/api/v1/documents').attach('file', bad).expect(202);

    const doc = await waitForDocument(app, upload.body.id);
    expect(doc.status).toBe('failed');
    expect(doc.error).toBe('The text in this file could not be read.');

    const text = await request(app).get(`/api/v1/documents/${doc.id}/text`).expect(200);
    expect(text.body).toEqual({ text: null, truncated: false });

    const retry = await request(app).post(`/api/v1/documents/${doc.id}/retry`).expect(202);
    expect(retry.body.status).toBe('queued');
    expect((await waitForDocument(app, doc.id)).status).toBe('failed');

    await request(app).post(`/api/v1/documents/${doc.id}/retry`).expect(202);
    await waitForDocument(app, doc.id);
  });

  it('refuses to retry documents that did not fail', async () => {
    const upload = await request(app).post('/api/v1/documents').attach('file', path.join(SEED, 'glossary.csv')).expect(202);
    await waitForDocument(app, upload.body.id);
    await request(app).post(`/api/v1/documents/${upload.body.id}/retry`).expect(409);
  });

  it('notifies owners and records the pipeline in the activity feed', async () => {
    await application.context.domain.notifications.idle();
    const unread = await request(app).get('/api/v1/activity/unread').expect(200);
    expect(unread.body.unread).toBeGreaterThanOrEqual(4);

    const feed = await request(app).get('/api/v1/activity?mine=true').expect(200);
    const types = feed.body.items.map((item) => item.type);
    expect(types).toEqual(expect.arrayContaining(['document.uploaded', 'document.ingested', 'document.failed', 'document.retried']));

    await request(app).post('/api/v1/activity/read').expect(204);
    expect((await request(app).get('/api/v1/activity/unread').expect(200)).body.unread).toBe(0);
  });

  it('records runs in the workflow service history', async () => {
    const res = await request(app).get('/services/workflow/api/workflows/ingest-document/executions').expect(200);
    expect(JSON.stringify(res.body)).toMatch(/completed/);
  });

  it('serves the activity and admin workflow pages', async () => {
    await request(app).get('/activity').expect(200).expect('Content-Type', /html/);
    await request(app).get('/admin/workflows').expect(200);
  });
});
