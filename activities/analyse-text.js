/**
 * @fileoverview Ingestion step 3: compute document statistics (word count,
 * reading time, keywords, preview) from the normalised text.
 *
 * Input:  { steps: [extract-text output, normalise-text output] }
 * Output: { words, characters, readingMinutes, keywords, preview }
 */

'use strict';

const fs = require('node:fs/promises');
const { analyseText } = require('./lib/text');

/**
 * @param {{steps: !Array<!Object>}} data
 * @return {Promise<!Object>} Statistics.
 */
async function run(data) {
  const { textPath } = data.steps[data.steps.length - 1].data;
  const text = await fs.readFile(textPath, 'utf8');
  return analyseText(text);
}

module.exports = { run };
