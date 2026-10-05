'use strict';

const path = require('node:path');
const request = require('supertest');
const { createTestApp, ROOT_DIR } = require('../helpers/testApp');

const PASSWORD = 'Str0ng!Passw0rd#2026';
const SEED = path.join(ROOT_DIR, 'seed');

/**
 * Creates a user and returns a supertest agent with a logged-in session.
 */
async function signIn(application, email, role) {
  await application.services.authservice.createUser({ email, fullName: email.split('@')[0], password: PASSWORD, role });
  const agent = request.agent(application.app);
  await agent.post('/services/authservice/api/login').send({ email, password: PASSWORD }).expect(200);
  return agent;
}

describe('library API (Phase 1)', () => {
  let application;
  let alice; // member, owner of the test document
  let bob; // member
  let admin;
  let docId;

  beforeAll(async () => {
    ({ application } = await createTestApp({ label: 'library', seedDemoContent: false }));
    alice = await signIn(application, 'alice@example.com', 'user');
    bob = await signIn(application, 'bob@example.com', 'user');
    admin = await signIn(application, 'boss@example.com', 'admin');

    const res = await alice.post('/api/v1/documents')
      .field('title', 'Alice notes')
      .field('tags', 'notes, team')
      .attach('file', path.join(SEED, 'getting-started.md'))
      .expect(201);
    docId = res.body.id;
  });

  afterAll(async () => {
    await application?.close();
  });

  describe('anonymous callers', () => {
    it.each([
      ['get', '/api/v1/documents'],
      ['get', '/api/v1/me'],
      ['post', '/api/v1/documents'],
      ['get', '/api/v1/documents/x'],
      ['patch', '/api/v1/documents/x'],
      ['delete', '/api/v1/documents/x'],
      ['get', '/api/v1/documents/x/download']
    ])('%s %s → 401', async (method, url) => {
      await request(application.app)[method](url).expect(401);
    });

    it('are redirected from pages to the login page', async () => {
      const res = await request(application.app).get('/library').expect(302);
      expect(res.headers.location).toBe('/services/authservice/views/login.html?returnUrl=%2Flibrary');
    });
  });

  describe('members', () => {
    it('see who they are', async () => {
      const res = await bob.get('/api/v1/me').expect(200);
      expect(res.body.user).toMatchObject({ email: 'bob@example.com', isAdmin: false });
    });

    it('can list, filter, read and download every document', async () => {
      const list = await bob.get('/api/v1/documents?tag=notes').expect(200);
      expect(list.body.items.map((d) => d.id)).toEqual([docId]);
      expect(list.body.limits.allowedTypes).toContain('pdf');

      const detail = await bob.get(`/api/v1/documents/${docId}`).expect(200);
      expect(detail.body).toMatchObject({ title: 'Alice notes', tags: ['notes', 'team'], status: 'queued', canEdit: false });
      expect(detail.body.activity[0].type).toBe('document.uploaded');

      const file = await bob.get(`/api/v1/documents/${docId}/download`).expect(200);
      expect(file.headers['content-disposition']).toBe('attachment; filename="getting-started.md"');
      expect(file.text).toContain('Getting started with the Knowledge Hub');
    });

    it('cannot edit or delete someone else\'s document', async () => {
      await bob.patch(`/api/v1/documents/${docId}`).send({ title: 'Mine now' }).expect(403);
      await bob.delete(`/api/v1/documents/${docId}`).expect(403);
    });

    it('cannot write through the core filing API', async () => {
      await bob.delete(`/services/filing/api/remove/library/${docId}/getting-started.md`).expect(403);
      await bob.get(`/api/v1/documents/${docId}/download`).expect(200);
    });

    it('can open the library and document pages', async () => {
      await bob.get('/library').expect(200).expect('Content-Type', /html/);
      await bob.get(`/doc/${docId}`).expect(200);
    });
  });

  describe('owners', () => {
    it('can edit their document', async () => {
      const res = await alice.patch(`/api/v1/documents/${docId}`).send({ title: 'Alice notes v2', tags: ['notes'] }).expect(200);
      expect(res.body).toMatchObject({ title: 'Alice notes v2', tags: ['notes'] });
      const detail = await alice.get(`/api/v1/documents/${docId}`).expect(200);
      expect(detail.body).toMatchObject({ title: 'Alice notes v2', canEdit: true });
    });
  });

  describe('validation', () => {
    it.each([
      ['an unsupported file type', 'package.json', 'x.exe', 415],
      ['no file', null, null, 400]
    ])('rejects %s', async (label, file, filename, status) => {
      const req = alice.post('/api/v1/documents');
      if (file) req.attach('file', path.join(ROOT_DIR, file), filename);
      else req.field('title', 'nothing');
      const res = await req.expect(status);
      expect(res.body.error).toEqual(expect.any(String));
    });

    it('rejects files over the configured size limit with 413', async () => {
      await application.services.settings.set('maxUploadMb', 0.0001, 'library');
      try {
        await alice.post('/api/v1/documents').attach('file', path.join(SEED, 'caching-guide.md')).expect(413);
      } finally {
        await application.services.settings.set('maxUploadMb', 10, 'library');
      }
    });

    it('rejects bad edits and bad ids', async () => {
      await alice.patch(`/api/v1/documents/${docId}`).send({ tags: ['bad_tag'] }).expect(400);
      await alice.patch(`/api/v1/documents/${docId}`).send({ title: 42 }).expect(400);
      await alice.get('/api/v1/documents/not%20valid').expect(400);
      await alice.get('/api/v1/documents?status=weird').expect(400);
      await alice.get('/api/v1/documents/unknown-id').expect(404);
    });
  });

  describe('personal API tokens', () => {
    it('authenticate API calls as the token owner', async () => {
      const token = await application.services.authservice.createApiToken('bob@example.com', 'cli');
      const res = await request(application.app)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${token.token}`)
        .expect(200);
      expect(res.body.user.email).toBe('bob@example.com');
      await request(application.app).get('/api/v1/me').set('Authorization', 'Bearer dtk_nope').expect(401);
    });
  });

  describe('admins', () => {
    it('can edit and delete anyone\'s document', async () => {
      await admin.patch(`/api/v1/documents/${docId}`).send({ tags: ['reviewed'] }).expect(200);
      await admin.delete(`/api/v1/documents/${docId}`).expect(204);
      await alice.get(`/api/v1/documents/${docId}`).expect(404);
      await expect(application.services.filing.read(`library/${docId}/getting-started.md`))
        .rejects.toMatchObject({ code: 'ENOENT' });
    });
  });
});
