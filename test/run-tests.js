'use strict';
// Tests for B9. Run: npm test
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { normaliseRecord, exclusionReason, filterEntities, computeAnalytics, INCLUDED_ENTITY_TYPES } = require('../src/lib');
const { loadBundledSnapshot } = require('../src/snapshot');

const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`ok - ${name}`); }

const raw = fx('raw_extract.json');
const meta = { latest_month: '2026-10' };
const rows = raw.map(normaliseRecord).filter(Boolean);

check('scope rule: sole proprietorship, partnership and limited partnership are excluded with reasons', () => {
  assert.strictEqual(raw.map(normaliseRecord).filter(Boolean).length, 5);
  assert.strictEqual(exclusionReason(raw[2]), 'sole_proprietorship_partnership');
  assert.strictEqual(exclusionReason(raw[3]), 'sole_proprietorship_partnership');
  assert.strictEqual(exclusionReason(raw[6]), 'limited_partnership');
  assert.strictEqual(exclusionReason(raw[0]), null);
  assert.strictEqual(normaliseRecord(raw[2]), null);
});
check('normalisation: types converted, "na" -> null, derived fields computed', () => {
  const a = rows[0];
  assert.strictEqual(a.no_of_officers, 2);
  assert.strictEqual(a.registration_month, '2026-10');
  assert.strictEqual(a.postal_district, '07');
  assert.strictEqual(a.secondary_ssic_code, null);
  const old = rows[1];
  assert.strictEqual(old.block, null);
  assert.strictEqual(old.postal_code, null);
  assert.strictEqual(old.postal_district, null);
  assert.strictEqual(old.primary_ssic_code, null);
  assert.strictEqual(old.no_of_officers, null);
  assert.deepStrictEqual(old.former_entity_names, []);
  assert.deepStrictEqual(old.audit_firms, []);
});
check('former names and audit firms are compacted into arrays', () => {
  assert.deepStrictEqual(rows[0].former_entity_names, ['ACME TECH PTE. LTD.']);
  assert.deepStrictEqual(rows[0].audit_firms, [{ name: 'ABC AUDIT LLP', uen: 'T12LL0001A' }]);
});
check('filters compose: cohort, month range, SSIC prefix/division, district, status', () => {
  assert.strictEqual(filterEntities(rows, { onlyNewThisMonth: true }, meta).length, 3);
  assert.strictEqual(filterEntities(rows, { monthFrom: '2026-09', monthTo: '2026-10' }, meta).length, 4);
  assert.strictEqual(filterEntities(rows, { ssicCode: '6201' }, meta).length, 2); // primary of #1, secondary of #8
  assert.strictEqual(filterEntities(rows, { ssicDivision: '70' }, meta).length, 1);
  assert.strictEqual(filterEntities(rows, { postalDistrict: '07' }, meta).length, 1);
  assert.strictEqual(filterEntities(rows, { entityStatus: 'live' }, meta).length, 4);
  assert.strictEqual(filterEntities(rows, { entityType: 'limited liability' }, meta).length, 1);
  assert.strictEqual(filterEntities(rows, { nameContains: 'foundation' }, meta).length, 1);
});
check('analytics: hand-verified on fixture', () => {
  const an = computeAnalytics(rows, meta);
  assert.strictEqual(an.rows_analysed, 5);
  assert.strictEqual(an.registrations_by_month['2026-10'], 3);
  assert.strictEqual(an.registrations_by_month['1998-03'], 1);
  assert.strictEqual(an.status_breakdown['Live Company'], 3);
  assert.strictEqual(an.by_entity_type['Local Company'], 3);
  assert.strictEqual(an.latest_month_cohort.month, '2026-10');
  assert.strictEqual(an.latest_month_cohort.entities, 3);
  assert.strictEqual(an.latest_month_cohort.by_entity_type['Limited Liability Partnership'], 1);
  assert.strictEqual(an.top_primary_ssic[0].entities, 1); // all distinct in fixture
});
check('full bundled snapshot: exact row count, exact output keys, no excluded entity types, no contact data', () => {
  const snap = loadBundledSnapshot(path.join(__dirname, '..', 'data'));
  assert.strictEqual(snap.rows.length, 1054279);
  assert.strictEqual(snap.meta.raw_rows, 1997069);
  assert.strictEqual(snap.meta.excluded_person_level, 942790);
  assert.strictEqual(snap.meta.latest_month, '2026-10');
  const expectedKeys = ['uen', 'entity_name', 'entity_type', 'company_type', 'entity_status', 'registration_date', 'registration_month', 'uen_issue_date', 'block', 'street_name', 'level_no', 'unit_no', 'building_name', 'postal_code', 'postal_district', 'primary_ssic_code', 'primary_ssic_description', 'primary_user_described_activity', 'secondary_ssic_code', 'secondary_ssic_description', 'secondary_user_described_activity', 'no_of_officers', 'former_entity_names', 'audit_firms', 'account_due_date', 'annual_return_date', 'source_dataset'].sort();
  assert.deepStrictEqual(Object.keys(snap.rows[0]).sort(), expectedKeys);
  const types = new Set(snap.rows.map((r) => r.entity_type));
  assert.deepStrictEqual([...types].sort(), [...INCLUDED_ENTITY_TYPES].sort());
  const blob = JSON.stringify(snap.rows.slice(0, 5000));
  assert.ok(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(blob), 'email-like string in snapshot');
});
console.log(`\n${passed} tests passed`);
