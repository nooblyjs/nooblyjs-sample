'use strict';

const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { createTestApp } = require('../helpers/testApp');

describe('application bootstrap (Phase 0)', () => {
  let application;
  let dataRoot;

  beforeAll(async () => {
    ({ application, dataRoot } = await createTestApp({ label: 'bootstrap' }));
  });

  afterAll(async () => {
    await application?.close();
  });

  it('serves liveness and readiness probes', async () => {
    await request(application.app).get('/health/live').expect(200);
    const ready = await request(application.app).get('/health/ready').expect(200);
    expect(ready.body.status).toBe('ready');
  });

  it('runs the Phase 0 services with their default providers', async () => {
    const res = await request(application.app).get('/api/v1/info').expect(200);

    expect(res.body.name).toBe('Noobly Knowledge Hub');
    expect(res.body.servicesTotal).toBe(16);
    const running = Object.fromEntries(
      res.body.services.filter((s) => s.running).map((s) => [s.service, s.provider])
    );
    // Created directly, plus authservice's injected dependencies.
    expect(running).toMatchObject({
      logging: 'memory',
      settings: 'file',
      authservice: 'file',
      appservice: 'default',
      caching: 'memory',
      dataservice: 'memory',
      queueing: 'memory'
    });
    for (const entry of res.body.services.filter((s) => s.running)) {
      expect(entry.provider).toBe(entry.defaultProvider);
    }
  });

  it('serves the home page and its assets', async () => {
    const res = await request(application.app).get('/').expect(200);
    expect(res.text).toContain('/js/home.js');
    await request(application.app).get('/js/home.js').expect(200);
    await request(application.app).get('/css/app.css').expect(200);
  });

  it('does not expose the view module source', async () => {
    await request(application.app).get('/index.js').expect(404);
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(application.app).get('/api/v1/nope').expect(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('stores settings defaults in an encrypted file', async () => {
    const file = path.join(dataRoot, 'settings', 'settings.enc.json');
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).not.toContain('Noobly Knowledge Hub');
    expect(await application.services.settings.get('maxUploadMb', 'library')).toBe(10);
  });

  it('protects core service APIs with the API key guard', async () => {
    await request(application.app).get('/services/caching/api/list').expect(401);
  });

  it('serves the built-in login page publicly', async () => {
    await request(application.app).get('/services/authservice/views/login.html').expect(200);
  });
});
