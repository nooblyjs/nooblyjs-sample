/**
 * @fileoverview Loads the demo content in seed/ into an empty library.
 *
 * Seed documents have fixed ids (seed/manifest.json), so restarting the app
 * overwrites the same files instead of piling up copies. They are owned by
 * the default admin.
 */

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/** Owner recorded on demo documents. */
const SEED_OWNER = Object.freeze({ email: 'admin@localhost', fullName: 'Administrator' });

class SeedService {
  /**
   * @param {{library: !Object, documents: !Object, logger: !Object,
   *     seedDir: string}} deps
   */
  constructor({ library, documents, logger, seedDir }) {
    this.library = library;
    this.documents = documents;
    this.logger = logger;
    this.seedDir = seedDir;
  }

  /**
   * Loads every manifest document when the library is empty.
   * @return {Promise<number>} Number of documents created (0 when skipped).
   */
  async seedIfEmpty() {
    if (await this.documents.count() > 0) {
      return 0;
    }
    const manifest = JSON.parse(await fs.readFile(path.join(this.seedDir, 'manifest.json'), 'utf8'));
    let created = 0;
    for (const entry of manifest.documents) {
      try {
        const buffer = await fs.readFile(path.join(this.seedDir, entry.file));
        await this.library.upload(
          SEED_OWNER,
          { originalname: entry.file, buffer, size: buffer.length },
          { title: entry.title, tags: entry.tags },
          { id: entry.id, source: 'seed' }
        );
        created++;
      } catch (error) {
        this.logger.warn('[SeedService] Skipped demo document', { file: entry.file, error: error.message });
      }
    }
    this.logger.info('[SeedService] Loaded demo content', { created });
    return created;
  }
}

module.exports = { SeedService, SEED_OWNER };
