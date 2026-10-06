/**
 * @fileoverview Ingestion step 1: extract the raw text of a document.
 *
 * Runs in a worker thread (working service), so it only reads the source file
 * and writes a scratch file under the run's workDir. Run history stores every
 * step's input and output, so text travels between steps as scratch files,
 * never inside the step data.
 *
 * Input:  { docId, sourcePath, extension, workDir }
 * Output: { rawPath, characters, pages? }
 */

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { toText } = require('./lib/text');

/**
 * @param {{docId: string, sourcePath: string, extension: string, workDir: string}} data
 * @return {Promise<{rawPath: string, characters: number, pages: (number|undefined)}>}
 */
async function run(data) {
  const { docId, sourcePath, extension, workDir } = data;
  const source = await fs.readFile(sourcePath);

  let text;
  let pages;
  if (extension === 'pdf') {
    // The package root runs debug code when loaded without a parent module.
    const pdfParse = require('pdf-parse/lib/pdf-parse.js');
    let parsed;
    try {
      // Pass a copy that owns its memory. Node serves small files as slices
      // of a shared buffer pool (byteOffset > 0), and pdf.js reads the whole
      // underlying ArrayBuffer from byte 0, so small PDFs fail with
      // "bad XRef entry" (it happened to work on the main thread).
      parsed = await pdfParse(new Uint8Array(source));
    } catch (error) {
      throw new Error(`The PDF could not be read (${error.message})`);
    }
    text = parsed.text;
    pages = parsed.numpages;
  } else {
    text = toText(extension, source.toString('utf8'));
  }

  const rawPath = path.join(workDir, `${docId}.raw.txt`);
  await fs.writeFile(rawPath, text, 'utf8');
  return { rawPath, characters: text.length, pages };
}

module.exports = { run };
