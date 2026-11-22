# Singapore New Company Registrations — Monthly Delta of 1M+ Companies for KYB & Market Signals

Track company formation in Asia's main incorporation hub. 1,054,279 Singapore business entities (ACRA register, registrations through October 2026) with a monthly-delta mode that returns only newly registered companies — the input KYB providers, B2B data platforms and expansion teams use to spot new-market entrants early. Entity-level records only: companies, LLPs and foreign-company branches; sole proprietorships and partnerships (person-level records) are excluded by design. Snapshot-dated; refreshed monthly.

## What you get

- **Entity rows** matching your filters (registration month range, latest-month cohort, entity type/status, SSIC code or division, postal district, name, company type), each with: UEN, entity name, entity type, company type, entity status, registration date and month, UEN issue date, registered office address (block, street, level, unit, building, postal code and district), primary and secondary SSIC codes with descriptions and user-described activities, officer count, former entity names, audit firms, accounts due date and annual return date.
- **Derived analytics** (key-value store record `ANALYTICS`): rows analysed, registrations by month, status breakdown, counts by entity type, top primary SSIC codes and SSIC divisions, top postal districts, and a latest-month cohort summary — all computed over the full filtered set, not a sample.

## Coverage — read this first

- **1,054,279 entities** from the November 2026 release of the register (files updated 16 Nov 2026; registrations from 1887 to **2026-10-31**). The register is updated monthly on day 16, running to roughly the end of the previous month; this archive is refreshed on the same cadence.
- **Non-individual entities only — by design.** Sole proprietorships, partnerships and limited partnerships are **excluded** (942,790 rows in this release): those entity names are frequently individuals' personal names and their registered addresses can be residential. If you need those classes, ACRA's own BizFile products are the right source.
- **The "delta" in v1 is the new-registrations cohort**: entities registered in the snapshot's latest month (2026-10: 4,761 entities), via `onlyNewThisMonth` or any registration-month range. Deregistration and status-change cohorts need two snapshots to diff and are **not** claimed in v1; the analytics' status breakdown shows the register's current status mix.
- All statuses are in the archive (Live Company, Struck Off, Dissolved, in liquidation, and so on, exactly as published). Use the `entityStatus` filter for live-only views.
- For some gazetted entities, ACRA excludes certain columns at source to comply with the Companies Act; those fields arrive empty (null) here, as published.
- The source publishes **no officer names, no emails and no phone numbers** — officer information exists only as a count. There is nothing to scrub because it was never in the open data.

## Data source, licence and attribution

Source dataset: **"ACRA Information on Corporate Entities"**, Accounting and Corporate Regulatory Authority, published on data.gov.sg as 27 CSV files split by first letter of entity name (dataset IDs `d_8575e84912df3c28995b8e6e0e05205a` through `d_300ddc8da4e8f7bdcd1bfc620d09e2e7`; full list in the snapshot metadata), accessed 22 Nov 2026. Contains information from the Government of Singapore accessed via data.gov.sg, used under the **Singapore Open Data Licence v1.0** (https://data.gov.sg/open-data-licence).

**Independent tool; not affiliated with ACRA or GovTech, and not endorsed by them.**

Personal-data handling: the person-level entity classes named above are excluded at ingest under a hard-coded list; a runtime audit counts every entity type present after ingest and reports the count in the run logs, so any source-side change to those classes is visible. Entity names and registered-office addresses are company-level records.

## Pricing

**US$20 per 1,000 results** (US$0.020 per entity row returned to the dataset), with a free allowance of 250 results. Analytics are delivered to the key-value store and are not metered per row.

## Input

| Field | Meaning |
|---|---|
| `mode` | `rows`, `analytics`, or `both` (default) |
| `monthFrom` / `monthTo` | registration month range as `YYYY-MM` (defaults prefilled to the latest month, 2026-10) |
| `onlyNewThisMonth` | restrict to the snapshot's latest registration month |
| `entityType` | case-insensitive substring match on entity type |
| `entityStatus` | case-insensitive substring match on entity status |
| `ssicCode` | prefix match on primary or secondary SSIC code |
| `ssicDivision` | 2-digit SSIC division prefix |
| `postalDistrict` | 2-digit postal district |
| `nameContains` | case-insensitive substring match on entity name |
| `companyType` | case-insensitive substring match on company type |
| `limit` | max rows returned (default: all matching) |

## Terms

Outputs are derived from the source dataset named above and are provided as-is for business intelligence. Registrations, statuses and coverage are exactly as published by the source, subject to the statements in the coverage section above; check it before relying on any aggregate.
