/**
 * @fileoverview Record shapes and input normalisation for library documents.
 */

'use strict';

const path = require('node:path');
const { ClientError } = require('nooblyjs-core/src/shared/utils/httpErrors');

/** Container names in the data service. */
const CONTAINERS = Object.freeze({
  documents: 'documents',
  activity: 'activity'
});

/** Document lifecycle states (processing states arrive in Phase 2). */
const DOCUMENT_STATUS = Object.freeze({
  queued: 'queued',
  processing: 'processing',
  ready: 'ready',
  failed: 'failed'
});

/** MIME type served for each supported extension (never trust the client's). */
const MIME_TYPES = Object.freeze({
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  json: 'application/json',
  csv: 'text/csv; charset=utf-8',
  html: 'text/html; charset=utf-8',
  pdf: 'application/pdf'
});

const MAX_TITLE_LENGTH = 200;
const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 32;
const MAX_FILENAME_LENGTH = 120;
const TAG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Returns the lower-case extension of a filename without the dot.
 * @param {string} filename File name.
 * @return {string} Extension, or '' when there is none.
 */
function extensionOf(filename) {
  return path.extname(filename || '').slice(1).toLowerCase();
}

/**
 * Reduces an uploaded filename to a safe basename: no directories, no control
 * or shell-special characters, bounded length, extension preserved.
 * @param {string} filename Client-supplied name.
 * @return {string} Safe filename.
 * @throws {ClientError} 400 when nothing usable remains.
 */
function sanitizeFilename(filename) {
  const base = path.basename(String(filename || '').replace(/\\/g, '/'));
  const ext = extensionOf(base);
  let stem = (ext ? base.slice(0, -(ext.length + 1)) : base)
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._ -]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/^[.-]+/, '');
  const maxStem = MAX_FILENAME_LENGTH - (ext ? ext.length + 1 : 0);
  stem = stem.slice(0, maxStem);
  if (!stem) {
    throw new ClientError(400, 'File name is not valid');
  }
  return ext ? `${stem}.${ext}` : stem;
}

/**
 * Derives a title from a filename: "release-notes_2026.md" → "Release notes 2026".
 * @param {string} filename File name.
 * @return {string} Title.
 */
function titleFromFilename(filename) {
  const ext = extensionOf(filename);
  const stem = ext ? filename.slice(0, -(ext.length + 1)) : filename;
  const words = stem.replace(/[-_.]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Untitled';
}

/**
 * Validates and trims a title.
 * @param {*} title Raw title.
 * @return {string} Title.
 * @throws {ClientError} 400 when empty or too long.
 */
function normaliseTitle(title) {
  const value = typeof title === 'string' ? title.trim().replace(/\s+/g, ' ') : '';
  if (!value) {
    throw new ClientError(400, 'Title is required');
  }
  if (value.length > MAX_TITLE_LENGTH) {
    throw new ClientError(400, `Title must be at most ${MAX_TITLE_LENGTH} characters`);
  }
  return value;
}

/**
 * Normalises tags from an array or comma-separated string: lower-case,
 * spaces to hyphens, de-duplicated.
 * @param {*} tags Raw tags.
 * @return {!Array<string>} Tags.
 * @throws {ClientError} 400 when a tag is invalid or there are too many.
 */
function normaliseTags(tags) {
  if (tags === undefined || tags === null || tags === '') {
    return [];
  }
  const raw = Array.isArray(tags) ? tags : String(tags).split(',');
  const result = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new ClientError(400, 'Tags must be strings');
    }
    const tag = item.trim().toLowerCase().replace(/\s+/g, '-');
    if (!tag) continue;
    if (tag.length > MAX_TAG_LENGTH || !TAG_PATTERN.test(tag)) {
      throw new ClientError(400, `Invalid tag "${tag.slice(0, MAX_TAG_LENGTH)}": use letters, numbers and hyphens`);
    }
    if (!result.includes(tag)) result.push(tag);
  }
  if (result.length > MAX_TAGS) {
    throw new ClientError(400, `At most ${MAX_TAGS} tags are allowed`);
  }
  return result;
}

/**
 * Builds a new document record.
 * @param {{id: string, title: string, filename: string, sizeBytes: number,
 *     owner: {email: string, fullName: string}, tags: !Array<string>,
 *     source: (string|undefined)}} input
 * @return {!Object} The record.
 */
function newDocumentRecord({ id, title, filename, sizeBytes, owner, tags, source = 'upload' }) {
  const now = new Date().toISOString();
  const ext = extensionOf(filename);
  return {
    id,
    title,
    filename,
    path: `library/${id}/${filename}`,
    extension: ext,
    mime: MIME_TYPES[ext] || 'application/octet-stream',
    sizeBytes,
    ownerEmail: owner.email,
    ownerName: owner.fullName,
    tags,
    status: DOCUMENT_STATUS.queued,
    source,
    createdAt: now,
    updatedAt: now
  };
}

module.exports = {
  CONTAINERS,
  DOCUMENT_STATUS,
  MIME_TYPES,
  MAX_TAGS,
  extensionOf,
  sanitizeFilename,
  titleFromFilename,
  normaliseTitle,
  normaliseTags,
  newDocumentRecord
};
