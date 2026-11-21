#!/usr/bin/env python3
"""Independent verification of the B9 snapshot (scripts/verify.py).

Recomputes everything from the raw ACRA CSVs with a separate implementation
(Python csv module — the ingest is Node), then compares against the bundled
snapshot data/entities-*.ndjson.gz (ordered parts, concatenated):
  1. raw row total, included total, excluded-by-reason totals
  2. snapshot row count and entity-type distribution
  3. latest-month (new-registrations cohort) count
  4. top primary SSIC code by entity count
  5. field-level check of 300 sampled UENs (seeded) across 6 fields
Exits non-zero on any mismatch.
"""
import csv, glob, gzip, json, os, random, re, sys
from collections import Counter

csv.field_size_limit(10**9)
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "data", "raw", "acra")
# The snapshot ships as ordered gzipped-NDJSON parts (the single file
# exceeds GitHub's 25 MB browser-upload limit); read them in part order
# as one logical stream.
PARTS = sorted(
    glob.glob(os.path.join(HERE, "..", "data", "entities-*.ndjson.gz")),
    key=lambda p: int(re.search(r"entities-(\d+)\.ndjson\.gz$", p).group(1)),
)
assert PARTS, "no snapshot parts found"
INCLUDED = {"Local Company", "Limited Liability Partnership", "Foreign Company Branch"}

def reason(row):
    t = row["entity_type_description"]
    if t in INCLUDED:
        return None
    if t == "Sole Proprietorship/ Partnership":
        return "sole_proprietorship_partnership"
    if t == "Limited Partnership":
        return "limited_partnership"
    return "unclassified_or_other"

def na(v):
    return None if v is None or v.strip() in ("", "na") else v.strip()

raw_total = 0
included = 0
excluded = Counter()
by_type = Counter()
cohort_month = Counter()   # registration month -> included count
ssic_counter = Counter()
sample_pool = []
expected = {}               # uen -> expected fields for sampled rows
random.seed(20261122)

files = sorted(glob.glob(os.path.join(RAW, "acra_*.csv")))
assert len(files) == 27, f"expected 27 raw files, found {len(files)}"
for fp in files:
    with open(fp, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            raw_total += 1
            r = reason(row)
            if r:
                excluded[r] += 1
                continue
            included += 1
            by_type[row["entity_type_description"]] += 1
            d = na(row["registration_incorporation_date"])
            if d:
                cohort_month[d[:7]] += 1
            s = na(row["primary_ssic_code"])
            if s:
                ssic_counter[s] += 1
            sample_pool.append(row["uen"])
            expected[row["uen"]] = {
                "entity_name": row["entity_name"],
                "entity_status": na(row["entity_status_description"]),
                "registration_date": d,
                "primary_ssic_code": s,
                "postal_code": na(row["postal_code"]),
            }

latest_month = max(cohort_month)
expected_cohort = cohort_month[latest_month]
expected_top_ssic = ssic_counter.most_common(1)[0]

def snapshot_lines():
    for part in PARTS:
        with gzip.open(part, "rt", encoding="utf-8") as f:
            yield from f

_lines = snapshot_lines()
meta = json.loads(next(_lines))["__meta__"]
rows = [json.loads(line) for line in _lines if line.strip()]
snap_by_type = Counter(r["entity_type"] for r in rows)
snap_cohort = sum(1 for r in rows if r["registration_month"] == latest_month)
snap_ssic = Counter(r["primary_ssic_code"] for r in rows if r["primary_ssic_code"])
snap_top_ssic = snap_ssic.most_common(1)[0]

sample_uens = random.sample(sample_pool, 300)
by_uen = {r["uen"]: r for r in rows}
field_errors = 0
for u in sample_uens:
    got = by_uen.get(u)
    if got is None:
        print(f"FAIL sample UEN {u} missing from snapshot")
        field_errors += 1
        continue
    for k, v in expected[u].items():
        if got[k] != v:
            print(f"FAIL sample UEN {u} field {k}: snapshot={got[k]!r} expected={v!r}")
            field_errors += 1

checks = [
    ("meta.raw_rows == recomputed raw total", meta["raw_rows"] == raw_total, f"{meta['raw_rows']} vs {raw_total}"),
    ("meta.rows == recomputed included total", meta["rows"] == included, f"{meta['rows']} vs {included}"),
    ("snapshot length == recomputed included total", len(rows) == included, f"{len(rows)} vs {included}"),
    ("excluded sole_proprietorship_partnership", meta["excluded_breakdown"]["sole_proprietorship_partnership"] == excluded["sole_proprietorship_partnership"], f"{meta['excluded_breakdown']['sole_proprietorship_partnership']} vs {excluded['sole_proprietorship_partnership']}"),
    ("excluded limited_partnership", meta["excluded_breakdown"]["limited_partnership"] == excluded["limited_partnership"], f"{meta['excluded_breakdown']['limited_partnership']} vs {excluded['limited_partnership']}"),
    ("excluded unclassified_or_other", meta["excluded_breakdown"]["unclassified_or_other"] == excluded["unclassified_or_other"], f"{meta['excluded_breakdown']['unclassified_or_other']} vs {excluded['unclassified_or_other']}"),
    ("entity-type distribution matches", dict(snap_by_type) == dict(by_type), f"{dict(snap_by_type)} vs {dict(by_type)}"),
    ("no excluded entity type in snapshot", set(snap_by_type) <= INCLUDED, str(set(snap_by_type))),
    ("latest month matches", meta["latest_month"] == latest_month, f"{meta['latest_month']} vs {latest_month}"),
    ("latest-month cohort count matches", snap_cohort == expected_cohort, f"{snap_cohort} vs {expected_cohort}"),
    ("top primary SSIC matches", tuple(snap_top_ssic) == tuple(expected_top_ssic), f"{snap_top_ssic} vs {expected_top_ssic}"),
    ("300-UEN field sample exact", field_errors == 0, f"{field_errors} field errors"),
]
failed = 0
for name, ok, detail in checks:
    print(("PASS " if ok else "FAIL ") + name + f"  [{detail}]")
    failed += 0 if ok else 1
print(f"\nraw={raw_total} included={included} excluded={sum(excluded.values())} latest_month={latest_month} cohort={expected_cohort} top_ssic={expected_top_ssic}")
sys.exit(1 if failed else 0)
