/**
 * @fileoverview Pure text helpers for the ingestion activities. No I/O and no
 * service access, so they are unit-tested directly and are safe to run in a
 * worker thread.
 */

'use strict';

/** Named HTML entities decoded by htmlToText. */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Common English words ignored when picking keywords. */
const STOP_WORDS = new Set((
  'a about above after again against all also am an and any are as at be because been before being below ' +
  'between both but by can could did do does doing down during each few for from further had has have having ' +
  'he her here hers him his how i if in into is it its itself just me more most my no nor not now of off on ' +
  'once only or other our ours out over own same she should so some such than that the their theirs them then ' +
  'there these they this those through to too under until up use used uses using very was we were what when ' +
  'where which while who whom why will with would you your yours one two may every must new'
).split(' '));

/** Average adult silent reading speed, words per minute. */
const WORDS_PER_MINUTE = 230;

/**
 * Converts HTML to readable text: drops scripts, styles and comments, turns
 * block elements into line breaks, strips tags and decodes entities.
 * @param {string} html HTML source.
 * @return {string} Text.
 */
function htmlToText(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/title)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
      const lower = entity.toLowerCase();
      if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16) || 32);
      if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10) || 32);
      return ENTITIES[lower] ?? match;
    });
}

/**
 * Removes Markdown syntax that adds noise to search: heading and list
 * markers, emphasis, link targets and code fences. Link text is kept.
 * @param {string} markdown Markdown source.
 * @return {string} Text.
 */
function markdownToText(markdown) {
  return String(markdown)
    .replace(/^```.*$/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__|\*|_|`)/g, '');
}

/**
 * Flattens JSON into "key: value" lines so keys and values are searchable.
 * @param {string} source JSON text.
 * @return {string} Text.
 * @throws {Error} When the JSON is invalid.
 */
function jsonToText(source) {
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error('The JSON file is not valid JSON');
  }
  const lines = [];
  const walk = (node, label) => {
    if (Array.isArray(node)) {
      node.forEach((item) => walk(item, label));
    } else if (node && typeof node === 'object') {
      Object.entries(node).forEach(([key, child]) => walk(child, key));
    } else if (node !== null && node !== undefined) {
      lines.push(label ? `${label}: ${node}` : String(node));
    }
  };
  walk(value, '');
  return lines.join('\n');
}

/**
 * Converts CSV to text: one line per row with cells separated by " · ".
 * Handles quoted cells with commas and doubled quotes.
 * @param {string} source CSV text.
 * @return {string} Text.
 */
function csvToText(source) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const text = String(source);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows
    .map((cells) => cells.map((c) => c.trim()).filter(Boolean).join(' · '))
    .filter(Boolean)
    .join('\n');
}

/**
 * Converts a plain-text file of a given type to text.
 * @param {string} extension File extension without the dot.
 * @param {string} source File contents (UTF-8).
 * @return {string} Text.
 * @throws {Error} For unsupported types or invalid JSON.
 */
function toText(extension, source) {
  switch (extension) {
    case 'txt': return source;
    case 'md': return markdownToText(source);
    case 'html': return htmlToText(source);
    case 'json': return jsonToText(source);
    case 'csv': return csvToText(source);
    default: throw new Error(`Unsupported file type: ${extension}`);
  }
}

/**
 * Normalises extracted text: Unicode NFC, no control characters, single
 * spaces, at most one blank line between paragraphs, trimmed and capped.
 * @param {string} text Raw text.
 * @param {number} maxChars Maximum characters kept.
 * @return {{text: string, truncated: boolean}}
 */
function normaliseText(text, maxChars) {
  const normalised = String(text)
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (normalised.length <= maxChars) {
    return { text: normalised, truncated: false };
  }
  return { text: normalised.slice(0, maxChars), truncated: true };
}

/**
 * Lower-case words of three or more letters, for keyword counting.
 * @param {string} text Text.
 * @return {!Array<string>} Words.
 */
function words(text) {
  return (String(text).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || [])
    .map((word) => word.replace(/['-]+$/, ''));
}

/**
 * Computes document statistics.
 * @param {string} text Normalised text.
 * @param {number=} keywordCount Number of keywords to return.
 * @return {{words: number, characters: number, readingMinutes: number,
 *     keywords: !Array<string>, preview: string}}
 */
function analyseText(text, keywordCount = 8) {
  const all = words(text);
  const counts = new Map();
  for (const word of all) {
    if (word.length < 3 || STOP_WORDS.has(word) || !/\p{L}/u.test(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  const keywords = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, keywordCount)
    .map(([word]) => word);

  return {
    words: all.length,
    characters: text.length,
    readingMinutes: all.length === 0 ? 0 : Math.max(1, Math.round(all.length / WORDS_PER_MINUTE)),
    keywords,
    preview: text.slice(0, 280)
  };
}

module.exports = {
  htmlToText,
  markdownToText,
  jsonToText,
  csvToText,
  toText,
  normaliseText,
  analyseText
};
