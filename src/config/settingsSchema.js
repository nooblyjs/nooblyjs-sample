/**
 * @fileoverview Settings groups, keys and defaults for the settings service.
 *
 * Runtime-tunable values live here (and are edited in the admin settings
 * screen); environment variables hold only secrets and infrastructure.
 * ensureSettingsDefaults() creates any missing group or key on boot and never
 * overwrites a value an admin has changed.
 */

'use strict';

/**
 * @typedef {{
 *   default: *,
 *   type: string,
 *   description: string,
 *   secret: (boolean|undefined)
 * }} SettingDefinition
 */

/** @const {!Object<string, {description: string, keys: !Object<string, SettingDefinition>}>} */
const SETTINGS_SCHEMA = Object.freeze({
  app: {
    description: 'General application settings',
    keys: {
      name: { default: 'Noobly Knowledge Hub', type: 'string', description: 'Name shown in the header' }
    }
  },
  library: {
    description: 'Document library limits',
    keys: {
      maxUploadMb: { default: 10, type: 'number', description: 'Maximum upload size in megabytes' },
      allowedTypes: { default: ['txt', 'md', 'json', 'csv', 'html', 'pdf'], type: 'json', description: 'Allowed file extensions' }
    }
  },
  pipeline: {
    description: 'Ingestion pipeline',
    keys: {
      drainBatch: { default: 5, type: 'number', description: 'Queue items processed per drain' },
      drainIntervalSec: { default: 10, type: 'number', description: 'Seconds between scheduled queue drains' },
      maxTextChars: { default: 500000, type: 'number', description: 'Maximum characters of extracted text kept per document' }
    }
  },
  digest: {
    description: 'Daily digest of new documents',
    keys: {
      enabled: { default: true, type: 'boolean', description: 'Build the daily digest' },
      cron: { default: '0 8 * * *', type: 'string', description: 'When the digest runs (5-field cron)' }
    }
  },
  ai: {
    description: 'AI summaries (requires an Anthropic API key)',
    keys: {
      enabled: { default: true, type: 'boolean', description: 'Use AI when a key is available' },
      model: { default: '', type: 'string', description: 'Model override (blank: AI_MODEL or the provider default)' },
      apiKey: { default: '', type: 'string', description: 'API key override (blank: ANTHROPIC_API_KEY)', secret: true },
      maxChars: { default: 20000, type: 'number', description: 'Maximum document characters sent for a summary' }
    }
  }
});

module.exports = { SETTINGS_SCHEMA };
