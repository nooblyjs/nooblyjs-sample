/**
 * @fileoverview Regenerates seed/release-checklist.pdf, a small text PDF used
 * as demo content. Run: node scripts/make-seed-pdf.js
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LINES = [
  'Release Checklist',
  '',
  'Use this checklist before every production release of a NooblyJS application.',
  '',
  '1. All Jest suites pass and coverage meets the threshold.',
  '2. Playwright smoke tests pass on desktop and mobile.',
  '3. npm audit reports no high or critical vulnerabilities.',
  '4. SESSION_SECRET, SETTINGS_SECRET and API_KEYS are set in the environment.',
  '5. The Docker image builds and /health/ready returns 200.',
  '6. Release notes are written and linked from the knowledge hub.',
  '7. A rollback plan is agreed with the on-call engineer.',
  '',
  'Owner: Platform team. Review this document every quarter.'
];

/** Escapes text for a PDF literal string. */
const escape = (text) => text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const content = ['BT', '/F1 12 Tf', '16 TL', '72 740 Td']
  .concat(LINES.flatMap((line, i) => (i === 0 ? ['/F1 20 Tf', `(${escape(line)}) Tj`, '/F1 12 Tf', 'T*'] : [`(${escape(line)}) Tj`, 'T*'])))
  .concat(['ET'])
  .join('\n');

const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
];

let pdf = '%PDF-1.4\n';
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(Buffer.byteLength(pdf, 'latin1'));
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});
const xrefOffset = Buffer.byteLength(pdf, 'latin1');
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f\r\n`;
pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n\r\n`).join('');
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

const out = path.join(__dirname, '..', 'seed', 'release-checklist.pdf');
fs.writeFileSync(out, Buffer.from(pdf, 'latin1'));
console.log(`Wrote ${out} (${pdf.length} bytes)`);
