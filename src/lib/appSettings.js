/**
 * @fileoverview Helpers over the core settings service for the app's schema.
 */

'use strict';

const { SETTINGS_SCHEMA } = require('../config/settingsSchema');

/**
 * Creates missing settings groups and keys with their defaults. Existing
 * values are never overwritten, so admin changes survive restarts.
 *
 * @param {!Object} settings The core settings service.
 * @param {?Object=} logger Logger for reporting created keys.
 * @param {!Object=} schema Schema to apply (default SETTINGS_SCHEMA).
 * @return {Promise<number>} The number of keys created.
 */
async function ensureSettingsDefaults(settings, logger = null, schema = SETTINGS_SCHEMA) {
  const existingGroups = new Set((await settings.listGroups()).map((group) => group.name));
  let created = 0;

  for (const [group, definition] of Object.entries(schema)) {
    if (!existingGroups.has(group)) {
      await settings.createGroup(group, definition.description);
    }
    for (const [key, setting] of Object.entries(definition.keys)) {
      if (await settings.has(key, group)) {
        continue;
      }
      await settings.set(key, setting.default, group, {
        type: setting.type,
        description: setting.description,
        secret: Boolean(setting.secret)
      });
      created++;
    }
  }

  if (created > 0) {
    logger?.info('[KnowledgeHub] Created default settings', { created });
  }
  return created;
}

/**
 * Reads every schema group into a plain object, e.g. `{ app: { name } }`.
 * Secret values are omitted so the result is safe to log or return to clients.
 *
 * @param {!Object} settings The core settings service.
 * @param {!Object=} schema Schema to read (default SETTINGS_SCHEMA).
 * @return {Promise<!Object<string, !Object<string, *>>>} Values by group.
 */
async function readAllSettings(settings, schema = SETTINGS_SCHEMA) {
  const result = {};
  for (const [group, definition] of Object.entries(schema)) {
    result[group] = {};
    for (const [key, setting] of Object.entries(definition.keys)) {
      if (setting.secret) {
        continue;
      }
      const value = await settings.get(key, group);
      result[group][key] = value === undefined ? setting.default : value;
    }
  }
  return result;
}

module.exports = { ensureSettingsDefaults, readAllSettings };
