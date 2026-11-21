'use strict';
// B9 core logic — pure functions, no Apify dependency. Shared by main.js, ingest and tests.
// Scope: data.gov.sg "ACRA Information on Corporate Entities" (ACRA), Singapore
// Open Data Licence v1.0. PERSON-LEVEL SCOPE RULE (Gate-0-lite, 2026-11-22):
// only non-individual entity types ship — Local Company, Limited Liability
// Partnership, Foreign Company Branch. Sole proprietorships, partnerships and
// limited partnerships are excluded at ingest: their entity names are
// frequently individuals' personal names and their registered addresses can
// be residential. The source contains no officer names, emails or phone
// numbers in any column (verified against the 53-column header).

const INCLUDED_ENTITY_TYPES = [
  'Local Company',
  'Limited Liability Partnership',
  'Foreign Company Branch',
];
const INCLUDED_SET = new Set(INCLUDED_ENTITY_TYPES);

function isIncludedEntityType(t) {
  return INCLUDED_SET.has(t);
}

// Why a raw record does not ship; null when it ships.
function exclusionReason(r) {
  const t = r.entity_type_description;
  if (INCLUDED_SET.has(t)) return null;
  if (t === 'Sole Proprietorship/ Partnership') return 'sole_proprietorship_partnership';
  if (t === 'Limited Partnership') return 'limited_partnership';
  return 'unclassified_or_other';
}

// Parse one CSV line (RFC4180 quoting handled; ACRA files quote fields that
// contain commas, e.g. street names and activity descriptions).
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function csvHeader(text) {
  const firstLine = text.split(/\r?\n/, 1)[0];
  return parseCsvLine(firstLine).map((h) => h.trim().replace(/^\uFEFF/, ''));
}

// Parse a whole CSV file's text into raw record objects keyed by header.
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = csvHeader(text);
  return lines.slice(1).map((line) => {
    const vals = parseCsvLine(line);
    const rec = {};
    header.forEach((h, i) => { rec[h] = vals[i] !== undefined ? vals[i].trim() : ''; });
    return rec;
  });
}

// ACRA publishes the literal string "na" for absent values.
function naToNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' || s === 'na' ? null : s;
}

function toIntOrNull(v) {
  const s = naToNull(v);
  if (s === null) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

// Normalise one raw CSV record into the clean store shape.
// Returns null for excluded entity types (see the scope rule above).
function normaliseRecord(r) {
  if (!INCLUDED_SET.has(r.entity_type_description)) return null;
  const regDate = naToNull(r.registration_incorporation_date);
  const postal = naToNull(r.postal_code);
  const former = [];
  for (let i = 1; i <= 15; i++) {
    const v = naToNull(r['former_entity_name' + i]);
    if (v) former.push(v);
  }
  const firms = [];
  for (let i = 1; i <= 5; i++) {
    const name = naToNull(r['name_of_audit_firm' + i]);
    const uen = naToNull(r['uen_of_audit_firm' + i]);
    if (name || uen) firms.push({ name, uen });
  }
  return {
    uen: r.uen,
    entity_name: r.entity_name,
    entity_type: r.entity_type_description,
    company_type: naToNull(r.company_type_description),
    entity_status: naToNull(r.entity_status_description),
    registration_date: regDate, // YYYY-MM-DD
    registration_month: regDate ? regDate.slice(0, 7) : null, // YYYY-MM
    uen_issue_date: naToNull(r.uen_issue_date),
    block: naToNull(r.block),
    street_name: naToNull(r.street_name),
    level_no: naToNull(r.level_no),
    unit_no: naToNull(r.unit_no),
    building_name: naToNull(r.building_name),
    postal_code: postal,
    postal_district: postal ? postal.slice(0, 2) : null,
    primary_ssic_code: naToNull(r.primary_ssic_code),
    primary_ssic_description: naToNull(r.primary_ssic_description),
    primary_user_described_activity: naToNull(r.primary_user_described_activity),
    secondary_ssic_code: naToNull(r.secondary_ssic_code),
    secondary_ssic_description: naToNull(r.secondary_ssic_description),
    secondary_user_described_activity: naToNull(r.secondary_user_described_activity),
    no_of_officers: toIntOrNull(r.no_of_officers), // a count only; the source publishes no officer names
    former_entity_names: former,
    audit_firms: firms,
    account_due_date: naToNull(r.account_due_date),
    annual_return_date: naToNull(r.annual_return_date),
    source_dataset: 'ACRA Information on Corporate Entities (data.gov.sg)',
  };
}

function filterEntities(rows, input, meta) {
  const entityType = input.entityType ? String(input.entityType).toLowerCase() : null;
  const entityStatus = input.entityStatus ? String(input.entityStatus).toLowerCase() : null;
  const companyType = input.companyType ? String(input.companyType).toLowerCase() : null;
  const nameContains = input.nameContains ? String(input.nameContains).toLowerCase() : null;
  const ssic = input.ssicCode != null && input.ssicCode !== '' ? String(input.ssicCode) : null;
  const division = input.ssicDivision != null && input.ssicDivision !== '' ? String(input.ssicDivision).padStart(2, '0') : null;
  const district = input.postalDistrict != null && input.postalDistrict !== '' ? String(input.postalDistrict).padStart(2, '0') : null;
  const latest = meta ? meta.latest_month : null;
  return rows.filter((r) => {
    if (input.onlyNewThisMonth && (!latest || r.registration_month !== latest)) return false;
    if (input.monthFrom && (!r.registration_month || r.registration_month < input.monthFrom)) return false;
    if (input.monthTo && (!r.registration_month || r.registration_month > input.monthTo)) return false;
    if (entityType && !r.entity_type.toLowerCase().includes(entityType)) return false;
    if (entityStatus && !(r.entity_status || '').toLowerCase().includes(entityStatus)) return false;
    if (companyType && !(r.company_type || '').toLowerCase().includes(companyType)) return false;
    if (nameContains && !r.entity_name.toLowerCase().includes(nameContains)) return false;
    if (ssic && !((r.primary_ssic_code || '').startsWith(ssic) || (r.secondary_ssic_code || '').startsWith(ssic))) return false;
    if (division && !((r.primary_ssic_code || '').startsWith(division) || (r.secondary_ssic_code || '').startsWith(division))) return false;
    if (district && r.postal_district !== district) return false;
    return true;
  });
}

function bump(map, key) { map.set(key, (map.get(key) || 0) + 1); }

function topCounts(map, limit, keyName) {
  return [...map.entries()]
    .map(([k, v]) => ({ [keyName]: k, entities: v }))
    .sort((a, b) => b.entities - a.entities || String(a[keyName]).localeCompare(String(b[keyName])))
    .slice(0, limit);
}

function computeAnalytics(rows, meta) {
  const byMonth = {};
  const byStatus = {};
  const byType = {};
  const ssic = new Map(); // code -> {code, description, entities}
  const divisions = new Map();
  const districts = new Map();
  const latest = meta ? meta.latest_month : null;
  const cohortType = {};
  const cohortSsic = new Map();
  const cohortDistricts = new Map();
  let cohortCount = 0;
  for (const r of rows) {
    if (r.registration_month) byMonth[r.registration_month] = (byMonth[r.registration_month] || 0) + 1;
    const st = r.entity_status || 'unknown';
    byStatus[st] = (byStatus[st] || 0) + 1;
    byType[r.entity_type] = (byType[r.entity_type] || 0) + 1;
    if (r.primary_ssic_code) {
      const e = ssic.get(r.primary_ssic_code) || { code: r.primary_ssic_code, description: r.primary_ssic_description, entities: 0 };
      e.entities += 1;
      ssic.set(r.primary_ssic_code, e);
      bump(divisions, r.primary_ssic_code.slice(0, 2));
    }
    if (r.postal_district) bump(districts, r.postal_district);
    if (latest && r.registration_month === latest) {
      cohortCount += 1;
      cohortType[r.entity_type] = (cohortType[r.entity_type] || 0) + 1;
      if (r.primary_ssic_code) bump(cohortSsic, r.primary_ssic_code);
      if (r.postal_district) bump(cohortDistricts, r.postal_district);
    }
  }
  const topSsic = [...ssic.values()].sort((a, b) => b.entities - a.entities || a.code.localeCompare(b.code)).slice(0, 50);
  return {
    rows_analysed: rows.length,
    registrations_by_month: byMonth,
    status_breakdown: byStatus,
    by_entity_type: byType,
    top_primary_ssic: topSsic,
    top_ssic_divisions: topCounts(divisions, 30, 'division'),
    top_postal_districts: topCounts(districts, 30, 'district'),
    latest_month_cohort: {
      month: latest,
      entities: cohortCount,
      by_entity_type: cohortType,
      top_primary_ssic: topCounts(cohortSsic, 20, 'code'),
      top_postal_districts: topCounts(cohortDistricts, 20, 'district'),
      definition: 'Entities whose registration/incorporation date falls in the snapshot\'s latest registration month — the new-registrations delta of this release. Deregistration and status-change cohorts require a second snapshot and are not claimed in v1.',
    },
    coverage: 'Non-individual entities only (Local Company, Limited Liability Partnership, Foreign Company Branch) from the ACRA register as published on data.gov.sg; sole proprietorships, partnerships and limited partnerships are excluded by design (see README). All statuses are included; use the entityStatus filter for live-only views.',
  };
}

module.exports = {
  INCLUDED_ENTITY_TYPES,
  isIncludedEntityType,
  exclusionReason,
  parseCsv,
  parseCsvLine,
  csvHeader,
  naToNull,
  normaliseRecord,
  filterEntities,
  computeAnalytics,
};
