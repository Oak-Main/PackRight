#!/usr/bin/env node
// Generates api/seed.sql from the canonical dataset at data/reference-data.json.
// Run: npm run generate:seed  (from api/)
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const dataPath = resolve(here, '../../data/reference-data.json')
const outPath = resolve(here, '../seed.sql')

const data = JSON.parse(readFileSync(dataPath, 'utf8'))

// A raw SQL expression, distinguishable from data. The previous version used
// the magic string "datetime('now')_RAW" and unquoted it with a regex over the
// finished file -- so the same characters appearing inside a change_note would
// have been unquoted too, splicing an expression into a data string.
const RAW = (sql) => ({ __raw: sql })
const NOW = RAW("datetime('now')")

const q = (v) => {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'object' && v !== null && typeof v.__raw === 'string') return v.__raw
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? '1' : '0'
  return `'${String(v).replace(/'/g, "''")}'`
}

const row = (values) => `  (${values.map(q).join(', ')})`

/**
 * Serialises a published band list for storage.
 *
 * An absent list becomes NULL rather than an empty JSON array, so "the airline
 * publishes no bands" and "the airline publishes an empty list" cannot be
 * confused by the reader.
 */
const bands = (list) => (Array.isArray(list) && list.length > 0 ? JSON.stringify(list) : null)

/**
 * Removes rows the dataset no longer contains.
 *
 * REPLACE INTO alone is additive: a record deleted from
 * data/reference-data.json stayed in D1 forever and kept being served, with no
 * way to notice short of reading the table. The dataset is the source of truth,
 * so the seed has to be able to retire a record as well as add one.
 *
 * Children are pruned before parents so a fare or benefit whose airline was
 * removed does not outlive it.
 */
const prune = (table, ids) =>
  `DELETE FROM ${table} WHERE id NOT IN (\n${ids.map((id) => `  ${q(id)}`).join(',\n')}\n);`

const sections = []

sections.push(`-- GENERATED FILE. Do not edit by hand.
-- Source: data/reference-data.json
-- Regenerate: cd api && npm run generate:seed
-- Apply:      wrangler d1 execute packright-db --remote --file=./schema.sql
--             wrangler d1 execute packright-db --remote --file=./seed.sql
--
-- Dataset version ${data.meta.version}. Records marked 'unverified' have a source
-- URL recorded but have NOT been confirmed against that source by a data steward.
-- The application surfaces those as "Review pending" and suppresses savings claims.`)

sections.push(`REPLACE INTO airlines (
  id, slug, name, iata_code,
  personal_item_length, personal_item_width, personal_item_height, personal_item_weight,
  carry_on_length, carry_on_width, carry_on_height, carry_on_weight,
  checked_bag_weight, checked_bag_linear_dim, checked_reject_weight_at, checked_max_accepted_linear_dim, single_excess_fee, excess_covered_from_bag,
  overweight_fees_json, oversize_fees_json,
  source_url, source_title, effective_date, retrieved_at, verified_at, verified_by,
  scope, currency, status, change_note, updated_at
) VALUES
${data.airlines.map((a) => row([
  a.id, a.slug, a.name, a.iata_code,
  // Some airlines publish no dimension at all for a bag, so the dimension
  // block is null rather than absent. Those columns are nullable and NULL
  // means "not published" to the reader.
  a.personal_item?.length ?? null, a.personal_item?.width ?? null, a.personal_item?.height ?? null, a.personal_item?.weight ?? null,
  a.carry_on?.length ?? null, a.carry_on?.width ?? null, a.carry_on?.height ?? null, a.carry_on?.weight ?? null,
  a.checked.weight, a.checked.linear_dim, a.checked.reject_weight_at, a.checked.max_accepted_linear_dim, a.checked.single_excess_fee ?? false, a.checked.excess_covered_from_bag,
  bands(a.checked.overweight_fees), bands(a.checked.oversize_fees),
  a.source_url, a.source_title, a.effective_date, a.retrieved_at, a.verified_at, a.verified_by,
  a.scope, a.currency, a.status, a.change_note, NOW,
])).join(',\n')};`)

sections.push(`REPLACE INTO fare_families (
  id, airline_id, name, includes_personal_item, includes_carry_on,
  first_checked_fee, second_checked_fee, third_plus_checked_fee, carry_on_fee, carry_on_purchasable, included_checked_weight,
  source_url, source_title, effective_date, retrieved_at, verified_at, verified_by,
  scope, currency, status, change_note, updated_at
) VALUES
${data.fareFamilies.map((f) => row([
  f.id, f.airline_id, f.name, f.includes_personal_item, f.includes_carry_on,
  f.first_checked_fee, f.second_checked_fee, f.third_plus_checked_fee, f.carry_on_fee, f.carry_on_purchasable ?? false, f.included_checked_weight,
  f.source_url, f.source_title, f.effective_date, f.retrieved_at, f.verified_at, f.verified_by,
  f.scope, f.currency, f.status, f.change_note, NOW,
])).join(',\n')};`)

sections.push(`REPLACE INTO benefits (
  id, name, airline_id, benefit_type, tier,
  waives_first_checked, waives_second_checked, waives_carry_on, companion_limit,
  source_url, source_title, effective_date, verified_at, verified_by,
  scope, currency, status, change_note, updated_at
) VALUES
${data.benefits.map((b) => row([
  b.id, b.name, b.airline_id, b.benefit_type, b.tier,
  b.waives_first_checked, b.waives_second_checked, b.waives_carry_on, b.companion_limit,
  b.source_url, b.source_title, b.effective_date, b.verified_at, b.verified_by,
  b.scope, b.currency, b.status, b.change_note, NOW,
])).join(',\n')};`)

sections.push(`REPLACE INTO tsa_rules (
  id, item_name, category, allowed_carry_on, allowed_checked, notes,
  source_url, source_title, verified_at, verified_by, status, change_note, updated_at
) VALUES
${data.tsaRules.map((t) => row([
  t.id, t.item_name, t.category, t.allowed_carry_on, t.allowed_checked, t.notes,
  t.source_url, t.source_title, t.verified_at, t.verified_by, t.status, t.change_note,
  NOW,
])).join(',\n')};`)

sections.push(`REPLACE INTO fee_assumptions (
  id, label, amount, currency, status, verified_at, verified_by, change_note, updated_at
) VALUES
${data.assumptions.map((a) => row([
  a.id, a.label, a.amount, data.meta.currency, a.status, a.verified_at, a.verified_by,
  a.change_note, NOW,
])).join(',\n')};`)

sections.push(`-- Retire anything the dataset no longer carries. Children first.
${prune('fare_families', data.fareFamilies.map((f) => f.id))}

${prune('benefits', data.benefits.map((b) => b.id))}

${prune('airlines', data.airlines.map((a) => a.id))}

${prune('tsa_rules', data.tsaRules.map((t) => t.id))}

${prune('fee_assumptions', data.assumptions.map((a) => a.id))}`)

const sql = sections.join('\n\n') + '\n'

writeFileSync(outPath, sql)
console.log(`Wrote ${outPath} (${sql.split('\n').length} lines) from dataset v${data.meta.version}`)
