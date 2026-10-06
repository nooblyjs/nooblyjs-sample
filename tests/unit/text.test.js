'use strict';

const {
  htmlToText, markdownToText, jsonToText, csvToText, toText, normaliseText, analyseText
} = require('../../activities/lib/text');

describe('text helpers', () => {
  it('htmlToText drops scripts, styles and tags and decodes entities', () => {
    const text = htmlToText('<title>T</title><style>p{}</style><script>alert(1)</script><p>Fish &amp; chips&nbsp;&#169;&#x41;</p><!-- c -->');
    expect(text).not.toMatch(/alert|p\{\}|<|c -->/);
    expect(text).toContain('Fish & chips ©A');
  });

  it('markdownToText keeps text and link labels, drops syntax', () => {
    const text = markdownToText('# Title\n- [x] done item\n1. step\n> quote\n**bold** and [docs](https://x.io)\n```js\ncode\n```');
    expect(text).toBe('Title\ndone item\nstep\nquote\nbold and docs\n\ncode\n');
  });

  it('jsonToText flattens keys and values and rejects invalid JSON', () => {
    expect(jsonToText('{"a":{"b":[1,"two"]},"c":null}')).toBe('b: 1\nb: two');
    expect(() => jsonToText('{oops')).toThrow('not valid JSON');
  });

  it('csvToText handles quoted cells, doubled quotes and CRLF', () => {
    expect(csvToText('term,definition\r\n"Cache, memory","Says ""hi"""\r\n')).toBe('term · definition\nCache, memory · Says "hi"');
  });

  it('toText dispatches by extension', () => {
    expect(toText('txt', 'plain')).toBe('plain');
    expect(() => toText('exe', 'x')).toThrow('Unsupported file type');
  });

  it('normaliseText cleans whitespace and control characters and caps length', () => {
    expect(normaliseText('  a\u0000b \t c\r\n\r\n\r\n\r\nd  ', 100)).toEqual({ text: 'a b c\n\nd', truncated: false });
    expect(normaliseText('abcdef', 3)).toEqual({ text: 'abc', truncated: true });
  });

  it('analyseText counts words and picks keywords without stop words or dates', () => {
    const stats = analyseText('The cache stores cache entries. Cache hits on 2026-10-05 are fast; the queue is slow.');
    expect(stats.words).toBe(15);
    expect(stats.readingMinutes).toBe(1);
    expect(stats.keywords[0]).toBe('cache');
    expect(stats.keywords).not.toContain('the');
    expect(stats.keywords).not.toContain('2026-10-05');
    expect(analyseText('').readingMinutes).toBe(0);
  });
});
