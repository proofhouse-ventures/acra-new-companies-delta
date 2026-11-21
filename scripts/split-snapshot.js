'use strict';
// Split the bundled snapshot (data/entities.ndjson.gz, ~71 MB gzipped) into
// ordered parts data/entities-1.ndjson.gz, entities-2.ndjson.gz, ... each
// comfortably under GitHub's 25 MB browser-upload limit (target < 20 MB).
// The split is on line boundaries of the UNCOMPRESSED NDJSON stream, in the
// original order, byte-exact: concatenating the gunzipped parts reproduces
// the original uncompressed stream bit for bit (verified by SHA-256 below
// before the single file is removed). Line 1 ({"__meta__": ...}) therefore
// stays the first line of part 1. Run after scripts/ingest.js (ingest calls
// this automatically on success); safe to re-run when only the single file
// or only parts exist.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const dataDir = path.join(__dirname, '..', 'data');
const singlePath = path.join(dataDir, 'entities.ndjson.gz');
const MAX_PART_BYTES = 20 * 1000 * 1000; // hard ceiling per part, gzipped

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function partPaths() {
  return fs.readdirSync(dataDir)
    .filter((n) => /^entities-\d+\.ndjson\.gz$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    .map((n) => path.join(dataDir, n));
}

function trySplit(buf, budget) {
  // Line end offsets (exclusive, just past each '\n'; a trailing partial
  // line, if any, ends at buf.length).
  const ends = [];
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) ends.push(i + 1);
  if (ends.length === 0 || ends[ends.length - 1] < buf.length) ends.push(buf.length);
  const groups = [];
  let gStart = 0;
  let prevEnd = 0;
  for (const end of ends) {
    if (prevEnd > gStart && end - gStart > budget) { groups.push([gStart, prevEnd]); gStart = prevEnd; }
    prevEnd = end;
  }
  groups.push([gStart, buf.length]);
  const parts = groups.map(([a, b]) => zlib.gzipSync(buf.subarray(a, b), { level: 9 }));
  if (parts.some((p) => p.length >= MAX_PART_BYTES)) return null;
  return parts;
}

function main() {
  if (!fs.existsSync(singlePath)) {
    const existing = partPaths();
    if (existing.length) { console.log(`split-snapshot: nothing to do, ${existing.length} parts already present`); return; }
    throw new Error(`split-snapshot: ${singlePath} not found and no parts present`);
  }
  const originalGz = fs.readFileSync(singlePath);
  const buf = zlib.gunzipSync(originalGz);
  const originalHash = sha256(buf);
  console.log(`split-snapshot: original gz=${originalGz.length} bytes sha256=${sha256(originalGz)}`);
  console.log(`split-snapshot: uncompressed=${buf.length} bytes sha256=${originalHash}`);
  let parts = null;
  for (let budget = 226 * 1000 * 1000; budget >= 100 * 1000 * 1000 && !parts; budget = Math.floor(budget * 0.85)) {
    parts = trySplit(buf, budget);
    if (!parts) console.log(`split-snapshot: budget ${budget} produced an oversized part, retrying smaller`);
  }
  if (!parts) throw new Error('split-snapshot: could not split under the per-part ceiling');
  // Write to temp names first, verify, then move into place.
  const tmpPaths = parts.map((_, i) => path.join(dataDir, `.entities-${i + 1}.ndjson.gz.tmp`));
  parts.forEach((p, i) => fs.writeFileSync(tmpPaths[i], p));
  const reassembled = Buffer.concat(tmpPaths.map((p) => zlib.gunzipSync(fs.readFileSync(p))));
  const reHash = sha256(reassembled);
  if (reHash !== originalHash || reassembled.length !== buf.length) {
    tmpPaths.forEach((p) => fs.unlinkSync(p));
    throw new Error(`split-snapshot: VERIFICATION FAILED reassembled sha256=${reHash} (expected ${originalHash}) — original left untouched`);
  }
  for (const p of partPaths()) fs.unlinkSync(p);
  tmpPaths.forEach((p, i) => fs.renameSync(p, path.join(dataDir, `entities-${i + 1}.ndjson.gz`)));
  fs.unlinkSync(singlePath);
  const finalParts = partPaths();
  finalParts.forEach((p, i) => console.log(`split-snapshot: part ${i + 1}: ${path.basename(p)} ${fs.statSync(p).size} bytes`));
  console.log(`split-snapshot: OK — ${finalParts.length} parts, reassembled sha256 matches original (${reHash}), single file removed`);
}

if (require.main === module) main();
module.exports = { partPaths };
