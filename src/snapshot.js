'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
// Snapshot format: gzipped NDJSON, shipped as ordered parts
// data/entities-1.ndjson.gz, entities-2.ndjson.gz, ... (the single file
// would be ~71 MB gzipped — over GitHub's 25 MB browser-upload limit, and
// this portfolio publishes via browser upload). Concatenating the
// gunzipped parts in filename order reproduces the original stream
// byte-exactly (split on line boundaries by scripts/split-snapshot.js,
// SHA-256-verified at split time). Line 1 of part 1 is {"__meta__": {...}};
// each following line is one entity row. NDJSON rather than B6's single
// JSON document because at ~1.05M rows the uncompressed JSON text
// (~620 MB) exceeds Node's maximum string length (ERR_STRING_TOO_LONG) —
// the single-document pattern does not scale to this register. Parsing is
// line-wise from the gunzipped buffer; no string larger than one row is
// ever materialised.
function snapshotPartPaths(dataDir) {
  return fs.readdirSync(dataDir)
    .filter((n) => /^entities-\d+\.ndjson\.gz$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    .map((n) => path.join(dataDir, n));
}

function parseSnapshotBuffer(buf) {
  let meta = null;
  const rows = [];
  let start = 0;
  for (let i = 0; i <= buf.length; i++) {
    if (i === buf.length || buf[i] === 0x0a) {
      if (i > start) {
        const line = buf.toString('utf8', start, i);
        if (!meta) meta = JSON.parse(line).__meta__;
        else rows.push(JSON.parse(line));
      }
      start = i + 1;
    }
  }
  return { meta, rows };
}

function loadSnapshot(gzPath) {
  return parseSnapshotBuffer(zlib.gunzipSync(fs.readFileSync(gzPath)));
}

function loadSnapshotParts(gzPaths) {
  if (!gzPaths.length) throw new Error('loadSnapshotParts: no snapshot part files given');
  const buf = Buffer.concat(gzPaths.map((p) => zlib.gunzipSync(fs.readFileSync(p))));
  return parseSnapshotBuffer(buf);
}

function loadBundledSnapshot(dataDir) {
  return loadSnapshotParts(snapshotPartPaths(dataDir));
}

module.exports = { loadSnapshot, loadSnapshotParts, loadBundledSnapshot, snapshotPartPaths };
