'use strict';

const {
  sanitizeFilename,
  titleFromFilename,
  normaliseTitle,
  normaliseTags,
  newDocumentRecord
} = require('../../src/data/models/records');

describe('sanitizeFilename', () => {
  it.each([
    ['report.pdf', 'report.pdf'],
    ['../../etc/passwd.txt', 'passwd.txt'],
    ['..\\windows\\evil.md', 'evil.md'],
    ['my notes (final)!.MD', 'my-notes-final.md'],
    ['.hidden.txt', 'hidden.txt'],
    ['café menu.csv', 'cafe-menu.csv']
  ])('%s → %s', (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it('bounds the length and keeps the extension', () => {
    const name = sanitizeFilename(`${'a'.repeat(300)}.json`);
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith('.json')).toBe(true);
  });

  it('rejects names with nothing usable', () => {
    expect(() => sanitizeFilename('!!!.txt')).toThrow('File name is not valid');
  });
});

describe('titleFromFilename', () => {
  it('turns separators into spaces and capitalises', () => {
    expect(titleFromFilename('release-notes_2026.md')).toBe('Release notes 2026');
  });
});

describe('normaliseTitle', () => {
  it('trims and collapses whitespace', () => {
    expect(normaliseTitle('  Hello   world ')).toBe('Hello world');
  });

  it('rejects empty and overly long titles with 400', () => {
    expect(() => normaliseTitle('   ')).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => normaliseTitle('x'.repeat(201))).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('normaliseTags', () => {
  it('accepts arrays and comma strings, lower-cases and de-duplicates', () => {
    expect(normaliseTags('Onboarding, Run Book ,onboarding,')).toEqual(['onboarding', 'run-book']);
    expect(normaliseTags(['A', 'b'])).toEqual(['a', 'b']);
    expect(normaliseTags(undefined)).toEqual([]);
  });

  it('rejects invalid characters, non-strings and too many tags', () => {
    expect(() => normaliseTags('bad_tag')).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => normaliseTags([1])).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => normaliseTags(Array.from({ length: 11 }, (_, i) => `t${i}`)))
      .toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('newDocumentRecord', () => {
  it('builds a queued record with a server-chosen MIME type', () => {
    const record = newDocumentRecord({
      id: 'abc',
      title: 'T',
      filename: 'page.html',
      sizeBytes: 5,
      owner: { email: 'a@b.c', fullName: 'A' },
      tags: []
    });
    expect(record).toMatchObject({
      path: 'library/abc/page.html',
      mime: 'text/html; charset=utf-8',
      status: 'queued',
      source: 'upload',
      ownerEmail: 'a@b.c'
    });
  });
});
