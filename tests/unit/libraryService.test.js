'use strict';

const DocumentRepo = require('../../src/data/models/documentRepo');
const ActivityRepo = require('../../src/data/models/activityRepo');
const LibraryService = require('../../src/services/modules/libraryService');
const { fakeLogger, fakeCache, fakeFiling, fakeSettings, memoryDataService } = require('../helpers/fakes');

const OWNER = { email: 'owner@x.io', fullName: 'Owner', isAdmin: false };
const OTHER = { email: 'other@x.io', fullName: 'Other', isAdmin: false };
const ADMIN = { email: 'admin@x.io', fullName: 'Admin', isAdmin: true };

const file = (name, text = 'hello world') => ({ originalname: name, buffer: Buffer.from(text), size: text.length });

describe('LibraryService', () => {
  let library;
  let filing;
  let cache;
  let activity;

  beforeEach(async () => {
    const deps = { dependencies: { dataservice: memoryDataService(), logging: fakeLogger() } };
    const documents = new DocumentRepo(deps);
    activity = new ActivityRepo(deps);
    await documents.init();
    await activity.init();
    filing = fakeFiling();
    cache = fakeCache();
    library = new LibraryService({
      documents,
      activity,
      filing,
      cache,
      settings: fakeSettings({ library: { maxUploadMb: 0.001, allowedTypes: ['md', 'txt'] } }),
      logger: fakeLogger()
    });
  });

  describe('upload', () => {
    it('stores the file and a queued record, and logs activity', async () => {
      const record = await library.upload(OWNER, file('Team Notes.md'), { tags: 'a, b' });

      expect(record).toMatchObject({ title: 'Team Notes', filename: 'Team-Notes.md', status: 'queued', tags: ['a', 'b'] });
      expect(filing.files.get(record.path).toString()).toBe('hello world');
      expect((await activity.list())[0]).toMatchObject({ type: 'document.uploaded', docId: record.id });
    });

    it('uses a fixed id when given (demo content)', async () => {
      const record = await library.upload(OWNER, file('a.md'), {}, { id: 'seed-a', source: 'seed' });
      expect(record).toMatchObject({ id: 'seed-a', source: 'seed', path: 'library/seed-a/a.md' });
    });

    it.each([
      ['a missing file', undefined, 400],
      ['a disallowed type', file('x.pdf'), 415],
      ['an empty file', file('x.md', ''), 400],
      ['an oversized file', file('x.md', 'x'.repeat(2000)), 413]
    ])('rejects %s', async (label, upload, status) => {
      await expect(library.upload(OWNER, upload)).rejects.toMatchObject({ statusCode: status });
      expect(filing.files.size).toBe(0);
    });

    it('removes the stored file when saving metadata fails', async () => {
      await library.upload(OWNER, file('a.md'), {}, { id: 'dup' });
      await expect(library.upload(OWNER, file('b.md'), {}, { id: 'dup' })).rejects.toThrow('already exists');
      expect([...filing.files.keys()]).toEqual(['library/dup/a.md']);
    });
  });

  describe('get', () => {
    it('caches the record and 404s for unknown ids', async () => {
      const { id } = await library.upload(OWNER, file('a.md'));
      await library.get(id);
      expect(cache.store.has(`doc:${id}`)).toBe(true);
      await expect(library.get('nope')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('update and remove', () => {
    let id;

    beforeEach(async () => {
      ({ id } = await library.upload(OWNER, file('a.md')));
      await library.get(id); // warm the cache
    });

    it('lets the owner edit, invalidating the cache', async () => {
      const updated = await library.update(OWNER, id, { title: 'Renamed', tags: ['x'] });
      expect(updated).toMatchObject({ title: 'Renamed', tags: ['x'] });
      expect(cache.store.has(`doc:${id}`)).toBe(false);
      expect((await library.get(id)).title).toBe('Renamed');
    });

    it('lets an admin edit anyone\'s document', async () => {
      await expect(library.update(ADMIN, id, { title: 'By admin' })).resolves.toMatchObject({ title: 'By admin' });
    });

    it('forbids other users and rejects empty changes', async () => {
      await expect(library.update(OTHER, id, { title: 'x' })).rejects.toMatchObject({ statusCode: 403 });
      await expect(library.remove(OTHER, id)).rejects.toMatchObject({ statusCode: 403 });
      await expect(library.update(OWNER, id, {})).rejects.toMatchObject({ statusCode: 400 });
    });

    it('remove() deletes the file, record and cache entry', async () => {
      await library.remove(OWNER, id);
      expect(filing.files.size).toBe(0);
      expect(cache.store.has(`doc:${id}`)).toBe(false);
      await expect(library.get(id)).rejects.toMatchObject({ statusCode: 404 });
      expect((await activity.list())[0].type).toBe('document.deleted');
    });

    it('remove() succeeds when the file is already gone', async () => {
      filing.files.clear();
      await expect(library.remove(OWNER, id)).resolves.toBeUndefined();
    });
  });

  describe('retry', () => {
    it('re-queues a failed document for its owner, and refuses other cases', async () => {
      const enqueued = [];
      library.ingest = { enqueue: async (id) => { enqueued.push(id); } };
      const { id } = await library.upload(OWNER, file('a.md'));
      expect(enqueued).toEqual([id]);

      await expect(library.retry(OWNER, id)).rejects.toMatchObject({ statusCode: 409 });
      await library.documents.update(id, { status: 'failed', error: 'x' });
      await expect(library.retry(OTHER, id)).rejects.toMatchObject({ statusCode: 403 });

      const queued = await library.retry(OWNER, id);
      expect(queued).toMatchObject({ status: 'queued', error: null });
      expect(enqueued).toEqual([id, id]);
      expect((await activity.list())[0].type).toBe('document.retried');
    });
  });

  it('remove() also deletes the extracted text', async () => {
    const { id, path } = await library.upload(OWNER, file('a.md'));
    await filing.create(`library/${id}/extracted.txt`, 'text');
    await library.documents.update(id, { textPath: `library/${id}/extracted.txt` });
    await library.remove(OWNER, id);
    expect([...filing.files.keys()]).not.toContain(path);
    expect(filing.files.size).toBe(0);
  });

  it('list() pages results and returns all tags', async () => {
    await library.upload(OWNER, file('a.md'), { tags: 'x' });
    await library.upload(OWNER, file('b.md'), { tags: 'y' });
    const result = await library.list({}, { limit: 1, offset: 0 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(2);
    expect(result.tags).toEqual(['x', 'y']);
  });

  it('readFile() returns the bytes, or 404 when the file is missing', async () => {
    const { id, path } = await library.upload(OWNER, file('a.md'));
    expect((await library.readFile(id)).content.toString()).toBe('hello world');
    filing.files.delete(path);
    await expect(library.readFile(id)).rejects.toMatchObject({ statusCode: 404 });
  });
});
