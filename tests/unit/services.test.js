'use strict';

const serviceRegistry = require('nooblyjs-core');
const { DEFAULT_PROVIDERS } = require('../../src/config/services');

describe('DEFAULT_PROVIDERS', () => {
  it('covers all 16 core services', () => {
    expect(Object.keys(DEFAULT_PROVIDERS)).toHaveLength(16);
  });

  it('matches the registry default for every service except appservice', () => {
    for (const [service, provider] of Object.entries(DEFAULT_PROVIDERS)) {
      if (service === 'appservice') continue;
      expect([service, serviceRegistry.getDefaultProviderType(service)]).toEqual([service, provider]);
    }
  });
});
