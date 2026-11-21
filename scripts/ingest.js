'use strict';
// Ingest: the 27 data.gov.sg "ACRA Information on Corporate Entities" CSVs
// (raw dir) -> bundled clean snapshot. The snapshot is written as a single
// gzipped NDJSON stream (data/entities.ndjson.gz) and then split into
// ordered parts (data/entities-N.ndjson.gz) by scripts/split-snapshot.js —
// the single file is ~71 MB gzipped, over GitHub's 25 MB browser-upload
// limit; only the parts ship. src/snapshot.js loads the parts in order.
// SCOPE RULE: only non-individual entity types ship (Local Company, Limited
// Liability Partnership, Foreign Company Branch). Sole proprietorships,
// partnerships, limited partnerships and unclassifiable rows are excluded
// and counted by reason — see lib.exclusionReason and the Gate-0-lite pack.
// Two passes over the files so the snapshot is streamed to disk (the full
// register is ~2M rows; nothing like the whole set is held in memory).
// Fails loudly if any file's header differs from the expected 53 columns —
// ACRA has renamed columns between releases before; a silent schema drift
// must never ship as a wrong snapshot.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parseCsv, csvHeader, normaliseRecord, exclusionReason } = require('../src/lib');

const rawDir = process.argv[2] || path.join(__dirname, '..', '..', 'data', 'raw', 'acra');
const outPath = path.join(__dirname, '..', 'data', 'entities.ndjson.gz');

const FILES = [
  ['a', 'd_8575e84912df3c28995b8e6e0e05205a'], ['b', 'd_3a3807c023c61ddfba947dc069eb53f2'],
  ['c', 'd_c0650f23e94c42e7a20921f4c5b75c24'], ['d', 'd_acbc938ec77af18f94cecc4a7c9ec720'],
  ['e', 'd_124a9bd407c7a25f8335b93b86e50fdd'], ['f', 'd_4526d47d6714d3b052eed4a30b8b1ed6'],
  ['g', 'd_b58303c68e9cf0d2ae93b73ffdbfbfa1'], ['h', 'd_fa2ed456cf2b8597bb7e064b08fc3c7c'],
  ['i', 'd_85518d970b8178975850457f60f1e738'], ['j', 'd_478f45a9c541cbe679ca55d1cd2b970b'],
  ['k', 'd_5573b0db0575db32190a2ad27919a7aa'], ['l', 'd_a2141adf93ec2a3c2ec2837b78d6d46e'],
  ['m', 'd_9af9317c646a1c881bb5591c91817cc6'], ['n', 'd_67e99e6eabc4aad9b5d48663b579746a'],
  ['o', 'd_5c4ef48b025fdfbc80056401f06e3df9'], ['p', 'd_181005ca270b45408b4cdfc954980ca2'],
  ['q', 'd_4130f1d9d365d9f1633536e959f62bb7'], ['r', 'd_2b8c54b2a490d2fa36b925289e5d9572'],
  ['s', 'd_df7d2d661c0c11a7c367c9ee4bf896c1'], ['t', 'd_72f37e5c5d192951ddc5513c2b134482'],
  ['u', 'd_0cc5f52a1f298b916f317800251057f3'], ['v', 'd_e97e8e7fc55b85a38babf66b0fa46b73'],
  ['w', 'd_af2042c77ffaf0db5d75561ce9ef5688'], ['x', 'd_1cd970d8351b42be4a308d628a6dd9d3'],
  ['y', 'd_31af23fdb79119ed185c256f03cb5773'], ['z', 'd_4e3db8955fdcda6f9944097bef3d2724'],
  ['others', 'd_300ddc8da4e8f7bdc1bfc62d0d99e2e7'],
];

const EXPECTED_COLUMNS = ['uen', 'issuance_agency_id', 'entity_name', 'entity_type_description', 'business_constitution_description', 'company_type_description', 'paf_constitution_description', 'entity_status_description', 'registration_incorporation_date', 'uen_issue_date', 'address_type', 'block', 'street_name', 'level_no', 'unit_no', 'building_name', 'postal_code', 'other_address_line1', 'other_address_line2', 'account_due_date', 'annual_return_date', 'primary_ssic_code', 'primary_ssic_description', 'primary_user_described_activity', 'secondary_ssic_code', 'secondary_ssic_description', 'secondary_user_described_activity', 'no_of_officers', 'former_entity_name1', 'former_entity_name2', 'former_entity_name3', 'former_entity_name4', 'former_entity_name5', 'former_entity_name6', 'former_entity_name7', 'former_entity_name8', 'former_entity_name9', 'former_entity_name10', 'former_entity_name11', 'former_entity_name12', 'former_entity_name13', 'former_entity_name14', 'former_entity_name15', 'uen_of_audit_firm1', 'name_of_audit_firm1', 'uen_of_audit_firm2', 'name_of_audit_firm2', 'uen_of_audit_firm3', 'name_of_audit_firm3', 'uen_of_audit_firm4', 'name_of_audit_firm4', 'uen_of_audit_firm5', 'name_of_audit_firm5'];

function readFileChecked(letter) {
  const fp = path.join(rawDir, `acra_${letter}.csv`);
  const text = fs.readFileSync(fp, 'utf8');
  const header = csvHeader(text);
  if (JSON.stringify(header) !== JSON.stringify(EXPECTED_COLUMNS)) {
    throw new Error(`Header mismatch in ${fp}: got ${header.join(',')}`);
  }
  return parseCsv(text);
}

// Pass 1: counts and coverage only.
let rawTotal = 0;
let included = 0;
const excluded = { sole_proprietorship_partnership: 0, limited_partnership: 0, unclassified_or_other: 0 };
const monthsSeen = new Set();
let minDate = null;
let maxDate = null;
for (const [letter] of FILES) {
  const recs = readFileChecked(letter);
  for (const rec of recs) {
    rawTotal += 1;
    const reason = exclusionReason(rec);
    if (reason) { excluded[reason] += 1; continue; }
    included += 1;
    const d = rec.registration_incorporation_date;
    if (d && d !== 'na') {
      monthsSeen.add(d.slice(0, 7));
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
    }
  }
  console.log(`pass1 ${letter}: cumulative raw=${rawTotal} included=${included}`);
}
const months = [...monthsSeen].sort();
const latestMonth = months[months.length - 1];
const excludedTotal = excluded.sole_proprietorship_partnership + excluded.limited_partnership + excluded.unclassified_or_other;
const meta = {
  dataset: 'ACRA Information on Corporate Entities',
  publisher: 'Accounting and Corporate Regulatory Authority (ACRA), via data.gov.sg',
  dataset_ids: FILES.map(([, id]) => id),
  licence: 'Singapore Open Data Licence v1.0 — https://data.gov.sg/open-data-licence',
  accessed: new Date().toISOString().slice(0, 10),
  source_release: 'November 2026 release (files updated 16 Nov 2026; registrations through 2026-10-31)',
  rows: included,
  raw_rows: rawTotal,
  excluded_person_level: excludedTotal,
  excluded_breakdown: excluded,
  latest_month: latestMonth,
  coverage: `Registrations ${minDate} to ${maxDate}; latest registration month ${latestMonth}. Non-individual entity types only: Local Company, Limited Liability Partnership, Foreign Company Branch (${included} of ${rawTotal} register rows).`,
  personal_data_handling: 'Sole proprietorships, partnerships, limited partnerships and unclassifiable rows are excluded at ingest (' + excludedTotal + ' rows in this release) because those entity names are frequently individuals\' personal names and their registered addresses can be residential. The source publishes no officer names, emails or phone numbers in any column; no_of_officers ships as a count only.',
};

// Pass 2: stream the snapshot out as gzipped NDJSON (line 1 = {"__meta__": ...},
// then one entity per line — see src/snapshot.js for why NDJSON).
const ws = fs.createWriteStream(outPath);
const gz = zlib.createGzip({ level: 9 });
gz.pipe(ws);
gz.write(JSON.stringify({ __meta__: meta }) + '\n');
let written = 0;
for (const [letter] of FILES) {
  const recs = readFileChecked(letter);
  for (const rec of recs) {
    const row = normaliseRecord(rec);
    if (!row) continue;
    gz.write(JSON.stringify(row) + '\n');
    written += 1;
  }
  console.log(`pass2 ${letter}: written=${written}`);
}
gz.end();
ws.on('finish', () => {
  if (written !== included) {
    console.error(`COUNT MISMATCH: pass1 included=${included} but pass2 wrote=${written}`);
    process.exit(1);
  }
  console.log(`ingested ${written} entities (${rawTotal} raw, ${excludedTotal} person-level excluded) -> ${outPath}`);
  // Split into browser-uploadable parts (verifies the reassembled stream
  // by SHA-256 and removes the single file only on a match).
  require('child_process').execFileSync('node', [path.join(__dirname, 'split-snapshot.js')], { stdio: 'inherit' });
});
