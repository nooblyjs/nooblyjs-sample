/**
 * @fileoverview Ingestion step 2: normalise the extracted text (Unicode,
 * whitespace, control characters) and cap its length.
 *
 * Input:  { docId, workDir, maxChars, steps: [extract-text output] }
 * Output: { textPath, characters, truncated }
 */

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { normaliseText } = require('./lib/text');

/**
 * @param {{docId: string, workDir: string, maxChars: number, steps: !Array<!Object>}} data
 * @return {Promise<{textPath: string, characters: number, truncated: boolean}>}
 */
async function run(data) {
  const { rawPath } = data.steps[data.steps.length - 1].data;
  const raw = await fs.readFile(rawPath, 'utf8');
  const { text, truncated } = normaliseText(raw, data.maxChars);
  if (!text) {
    throw new Error('The document contains no readable text');
  }

  const textPath = path.join(data.workDir, `${data.docId}.txt`);
  await fs.writeFile(textPath, text, 'utf8');
  return { textPath, characters: text.length, truncated };
}

module.exports = { run };
