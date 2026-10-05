/**
 * @fileoverview Lightweight stand-ins for core services in unit tests, plus a
 * real in-memory data service provider from nooblyjs-core.
 */

'use strict';

const { EventEmitter } = require('node:events');
const MemoryDataService = require('nooblyjs-core/src/dataservice/providers/dataservice');

/** @return {!Object} Logger that records calls. */
function fakeLogger() {
  const calls = [];
  const log = (level) => (message, meta) => calls.push({ level, message, meta });
  return { calls, info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') };
}

/** @return {!Object} Cache with the core caching API. */
function fakeCache() {
  const store = new Map();
  return {
    store,
    async put(key, value) { store.set(key, value); },
    async get(key) { return store.get(key); },
    async delete(key) { store.delete(key); }
  };
}

/** @return {!Object} Filing service with the core filing API. */
function fakeFiling() {
  const files = new Map();
  return {
    files,
    async create(path, content) { files.set(path, Buffer.from(content)); },
    async read(path) {
      if (!files.has(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files.get(path);
    },
    async delete(path) {
      if (!files.delete(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }
  };
}

/**
 * @param {!Object<string, !Object<string, *>>} values Values by group.
 * @return {!Object} Settings service with get(key, group).
 */
function fakeSettings(values) {
  return { async get(key, group) { return values[group]?.[key]; } };
}

/** @return {!Object} The core memory data service provider (no routes). */
function memoryDataService() {
  return new MemoryDataService({}, new EventEmitter());
}

module.exports = { fakeLogger, fakeCache, fakeFiling, fakeSettings, memoryDataService };
