'use strict';

const { ensureSettingsDefaults, readAllSettings } = require('../../src/lib/appSettings');

/** In-memory stand-in for the core settings service. */
function fakeSettings() {
  const groups = new Map();
  return {
    groups,
    async listGroups() { return [...groups.keys()].map((name) => ({ name })); },
    async createGroup(name) { groups.set(name, new Map()); },
    async has(key, group) { return groups.get(group)?.has(key) || false; },
    async get(key, group) { return groups.get(group)?.get(key)?.value; },
    async set(key, value, group, meta) {
      if (!groups.has(group)) groups.set(group, new Map());
      groups.get(group).set(key, { value, meta });
      return value;
    }
  };
}

const SCHEMA = {
  app: { description: 'App', keys: { name: { default: 'Hub', type: 'string', description: 'Name' } } },
  ai: {
    description: 'AI',
    keys: {
      model: { default: '', type: 'string', description: 'Model' },
      apiKey: { default: '', type: 'string', description: 'Key', secret: true }
    }
  }
};

describe('ensureSettingsDefaults', () => {
  it('creates missing groups and keys with metadata', async () => {
    const settings = fakeSettings();
    const created = await ensureSettingsDefaults(settings, null, SCHEMA);

    expect(created).toBe(3);
    expect(await settings.get('name', 'app')).toBe('Hub');
    expect(settings.groups.get('ai').get('apiKey').meta).toEqual({ type: 'string', description: 'Key', secret: true });
  });

  it('never overwrites existing values', async () => {
    const settings = fakeSettings();
    await settings.set('name', 'Changed', 'app', {});

    const created = await ensureSettingsDefaults(settings, null, SCHEMA);

    expect(created).toBe(2);
    expect(await settings.get('name', 'app')).toBe('Changed');
  });
});

describe('readAllSettings', () => {
  it('returns values by group and omits secrets', async () => {
    const settings = fakeSettings();
    await ensureSettingsDefaults(settings, null, SCHEMA);
    await settings.set('apiKey', 'sk-secret', 'ai', {});

    const values = await readAllSettings(settings, SCHEMA);

    expect(values).toEqual({ app: { name: 'Hub' }, ai: { model: '' } });
  });
});
