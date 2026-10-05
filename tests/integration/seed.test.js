'use strict';

const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { createTestApp, ROOT_DIR } = require('../helpers/testApp');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'seed', 'manifest.json'), 'utf8'));

describe('demo content', () => {
  let application;
  let dataRoot;

  beforeAll(async () => {
    ({ application, dataRoot } = await createTestApp({ label: 'seed', noAuth: true, seedDemoContent: true }));
  });

  afterAll(async () => {
    await application?.close();
  });

  it('loads every manifest document into an empty library on boot', async () => {
    const res = await request(application.app).get('/api/v1/documents?limit=100').expect(200);
    expect(res.body.total).toBe(manifest.documents.length);
    expect(res.body.items.map((d) => d.id).sort()).toEqual(manifest.documents.map((d) => d.id).sort());
    expect(res.body.items.every((d) => d.ownerEmail === 'admin@localhost' && d.source === 'seed')).toBe(true);
  });

  it('stores the files through filing, including the PDF', () => {
    const pdf = path.join(dataRoot, 'files', 'library', 'seed-release-checklist', 'release-checklist.pdf');
    expect(fs.readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('does nothing when the library already has documents', async () => {
    expect(await application.context.domain.seed.seedIfEmpty()).toBe(0);
  });
});
