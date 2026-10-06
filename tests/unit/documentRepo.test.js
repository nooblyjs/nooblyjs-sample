'use strict';

const DocumentRepo = require('../../src/data/models/documentRepo');
const ActivityRepo = require('../../src/data/models/activityRepo');
const { fakeLogger, memoryDataService } = require('../helpers/fakes');

function makeRepo(Repo) {
  return new Repo({ dependencies: { dataservice: memoryDataService(), logging: fakeLogger() } });
}

const doc = (id, overrides = {}) => ({
  id,
  title: `Doc ${id}`,
  filename: `${id}.md`,
  tags: [],
  ownerEmail: 'a@x.io',
  status: 'queued',
  createdAt: new Date(Date.UTC(2026, 0, Number(id.replace(/\D/g, '')) || 1)).toISOString(),
  ...overrides
});

describe('DocumentRepo', () => {
  let repo;

  beforeEach(async () => {
    repo = makeRepo(DocumentRepo);
    await repo.init();
  });

  it('init() tolerates an existing container', async () => {
    await expect(repo.init()).resolves.toBeUndefined();
  });

  it('stores records under their own stable id', async () => {
    await repo.add(doc('d1'));
    expect((await repo.get('d1')).title).toBe('Doc d1');
    expect(await repo.get('missing')).toBeNull();
    await expect(repo.add(doc('d1'))).rejects.toThrow('already exists');
  });

  it('returns copies, so callers cannot mutate stored data', async () => {
    await repo.add(doc('d1'));
    const copy = await repo.get('d1');
    copy.title = 'changed';
    expect((await repo.get('d1')).title).toBe('Doc d1');
  });

  it('update() merges, keeps the id and stamps updatedAt', async () => {
    await repo.add(doc('d1'));
    const updated = await repo.update('d1', { id: 'evil', title: 'New' });
    expect(updated).toMatchObject({ id: 'd1', title: 'New' });
    expect(updated.updatedAt).toEqual(expect.any(String));
    expect(await repo.update('missing', { title: 'x' })).toBeNull();
  });

  it('remove() deletes the record', async () => {
    await repo.add(doc('d1'));
    expect(await repo.remove('d1')).toBe(true);
    expect(await repo.get('d1')).toBeNull();
    expect(await repo.remove('d1')).toBe(false);
    expect(await repo.count()).toBe(0);
  });

  it('list() filters and sorts newest first', async () => {
    await repo.add(doc('d1', { tags: ['a'], ownerEmail: 'a@x.io' }));
    await repo.add(doc('d2', { tags: ['b'], ownerEmail: 'b@x.io', status: 'ready' }));
    await repo.add(doc('d3', { tags: ['a', 'b'], ownerEmail: 'b@x.io', title: 'Runbook' }));

    expect((await repo.list()).map((d) => d.id)).toEqual(['d3', 'd2', 'd1']);
    expect((await repo.list({ tag: 'a' })).map((d) => d.id)).toEqual(['d3', 'd1']);
    expect((await repo.list({ owner: 'b@x.io', status: 'ready' })).map((d) => d.id)).toEqual(['d2']);
    expect((await repo.list({ q: 'runb' })).map((d) => d.id)).toEqual(['d3']);
  });
});

describe('ActivityRepo', () => {
  it('records and lists activity newest first, filtered by document', async () => {
    const activity = makeRepo(ActivityRepo);
    await activity.init();
    await activity.record({ type: 'document.uploaded', actor: 'a', docId: 'd1', message: 'one' });
    await new Promise((r) => setTimeout(r, 5));
    await activity.record({ type: 'document.updated', actor: 'a', docId: 'd1', message: 'two' });
    await activity.record({ type: 'document.uploaded', actor: 'b', docId: 'd2', message: 'three' });

    expect((await activity.list({ docId: 'd1' })).map((a) => a.message)).toEqual(['two', 'one']);
    expect(await activity.list({ limit: 1 })).toHaveLength(1);
  });
});

describe('ordering with identical timestamps', () => {
  it('lists the most recently added record first', async () => {
    const activity = makeRepo(ActivityRepo);
    await activity.init();
    const spy = jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-01-01T00:00:00.000Z');
    try {
      await activity.record({ type: 'a', actor: 'x', message: 'first' });
      await activity.record({ type: 'b', actor: 'x', message: 'second' });
    } finally {
      spy.mockRestore();
    }
    expect((await activity.list()).map((a) => a.message)).toEqual(['second', 'first']);

    const repo = makeRepo(DocumentRepo);
    await repo.init();
    await repo.add(doc('a1', { createdAt: '2026-01-01T00:00:00.000Z' }));
    await repo.add(doc('a2', { createdAt: '2026-01-01T00:00:00.000Z' }));
    expect((await repo.list()).map((d) => d.id)).toEqual(['a2', 'a1']);
  });
});
