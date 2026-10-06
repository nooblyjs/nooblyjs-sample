'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { testDataDir, ROOT_DIR } = require('../helpers/testApp');
const extractText = require('../../activities/extract-text');
const normaliseText = require('../../activities/normalise-text');
const analyseText = require('../../activities/analyse-text');

/** Runs the three steps the way the workflow service chains them. */
async function pipeline(sourcePath, extension, workDir, maxChars = 1000) {
  const input = { docId: 'd1', sourcePath, extension, workDir, maxChars };
  const steps = [];
  for (const activity of [extractText, normaliseText, analyseText]) {
    steps.push({ data: await activity.run({ ...input, steps: [...steps] }) });
  }
  return steps.map((step) => step.data);
}

describe('ingestion activities', () => {
  let workDir;

  beforeEach(() => {
    workDir = testDataDir('activities');
  });

  it('process a Markdown file into scratch files and stats', async () => {
    const [extract, normalise, analyse] = await pipeline(path.join(ROOT_DIR, 'seed', 'caching-guide.md'), 'md', workDir);
    expect(fs.readFileSync(extract.rawPath, 'utf8')).toContain('Caching guide');
    expect(normalise).toMatchObject({ textPath: path.join(workDir, 'd1.txt'), truncated: false });
    expect(analyse.keywords).toContain('cache');
    expect(analyse.preview.startsWith('Caching guide')).toBe(true);
  });

  it('extract text and the page count from a PDF', async () => {
    const [extract, , analyse] = await pipeline(path.join(ROOT_DIR, 'seed', 'release-checklist.pdf'), 'pdf', workDir);
    expect(extract.pages).toBe(1);
    expect(analyse.keywords).toContain('checklist');
  });

  it('truncate long text to maxChars', async () => {
    const [, normalise] = await pipeline(path.join(ROOT_DIR, 'seed', 'caching-guide.md'), 'md', workDir, 50);
    expect(normalise).toMatchObject({ characters: 50, truncated: true });
  });

  it('fail clearly on a corrupt PDF, invalid JSON and empty text', async () => {
    const bad = path.join(workDir, 'bad.pdf');
    fs.writeFileSync(bad, 'not a pdf');
    await expect(pipeline(bad, 'pdf', workDir)).rejects.toThrow('The PDF could not be read');

    const json = path.join(workDir, 'bad.json');
    fs.writeFileSync(json, '{oops');
    await expect(pipeline(json, 'json', workDir)).rejects.toThrow('not valid JSON');

    const empty = path.join(workDir, 'empty.html');
    fs.writeFileSync(empty, '<script>x()</script>   ');
    await expect(pipeline(empty, 'html', workDir)).rejects.toThrow('no readable text');
  });
});
