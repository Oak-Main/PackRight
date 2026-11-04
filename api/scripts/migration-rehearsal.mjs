/**
 * Rehearses the D1 migration against a local replica of the REAL production
 * schema (read from Cloudflare earlier) before anything touches production.
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { splitSql } from './sql-split.mjs'

const PROD_SCHEMA = `
CREATE TABLE airlines (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, iata_code TEXT NOT NULL,
  personal_item_length REAL, personal_item_width REAL, personal_item_height REAL,
  carry_on_length REAL, carry_on_width REAL, carry_on_height REAL, carry_on_weight REAL,
  checked_bag_weight REAL, checked_bag_linear_dim REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE benefits (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, airline_id TEXT NOT NULL, type TEXT NOT NULL,
  waives_first_checked BOOLEAN DEFAULT 0, waives_second_checked BOOLEAN DEFAULT 0,
  waives_carry_on BOOLEAN DEFAULT 0, companion_limit INTEGER DEFAULT 0,
  FOREIGN KEY (airline_id) REFERENCES airlines(id)
);
CREATE TABLE fare_families (
  id TEXT PRIMARY KEY, airline_id TEXT NOT NULL, name TEXT NOT NULL,
  includes_personal_item BOOLEAN DEFAULT 1, includes_carry_on BOOLEAN DEFAULT 0,
  first_checked_fee REAL DEFAULT 0, second_checked_fee REAL DEFAULT 0,
  FOREIGN KEY (airline_id) REFERENCES airlines(id)
);
CREATE TABLE tsa_rules (
  id TEXT PRIMARY KEY, item_name TEXT NOT NULL, category TEXT NOT NULL,
  allowed_carry_on BOOLEAN, allowed_checked BOOLEAN, notes TEXT
);
`

// A representative pre-existing row per table, matching what production holds.
const PROD_ROWS = `
INSERT INTO airlines VALUES ('aa','American Airlines','AA',18,14,8,22,14,9,NULL,50,62,'2026-07-31 20:40:00');
INSERT INTO benefits VALUES ('aa-citi','Citi AAdvantage','aa','CREDIT_CARD',1,0,0,4);
INSERT INTO fare_families VALUES ('aa-main','aa','Main Cabin',1,1,40,45);
INSERT INTO tsa_rules VALUES ('liquids','Liquids','Liquids',0,1,'note');
`

const splitStatements = (sql) => splitSql(sql)

const db = new DatabaseSync(':memory:')
db.exec(PROD_SCHEMA)
db.exec(PROD_ROWS)
console.log('Replica of production schema built, with existing rows.')

const results = { migration: [], schema: [], seed: [], prune: [], check: [] }

function apply(label, sql, bucket) {
  for (const stmt of splitStatements(sql)) {
    try {
      db.exec(stmt)
      bucket.push({ ok: true, stmt: stmt.slice(0, 70).replace(/\s+/g, ' ') })
    } catch (e) {
      bucket.push({ ok: false, stmt: stmt.slice(0, 70).replace(/\s+/g, ' '), error: e.message })
    }
  }
  const failed = bucket.filter((r) => !r.ok)
  console.log(`\n${label}: ${bucket.length - failed.length}/${bucket.length} statements ok`)
  for (const f of failed) console.log(`   FAIL  ${f.stmt}\n         -> ${f.error}`)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(resolve(root, rel), 'utf8')

// The dataset is the source of truth for how many records must survive the
// prune. Hard-coding the count meant the rehearsal failed for the wrong
// reason the moment a fare family was added to the dataset.
const dataset = JSON.parse(read('../data/reference-data.json'))
const expectedFares = dataset.fareFamilies.length
const expectedAirlines = dataset.airlines.length

apply('migrations/0002_add_provenance.sql', read('migrations/0002_add_provenance.sql'), results.migration)
apply('schema.sql', read('schema.sql'), results.schema)

// The production order is 0002 -> schema -> 0003 -> 0004 -> seed.
//
// 0003 rebuilds five tables to add the status CHECK, and 0004 adds the band
// columns and the retrieval timestamps. Both run BEFORE the seed, because the
// seed writes every column: applied against a table that is still missing
// overweight_fees_json, every airline row would fail to insert. And 0003 must
// run before 0004, because 0003 rebuilds the tables from an explicit column
// list and would drop any column added to them beforehand.
//
// Nothing is seeded in between, so the migrations have to cope with the rows
// production actually holds - which is what this rehearsal exists to check.
const TABLES = ['airlines', 'fare_families', 'benefits', 'tsa_rules', 'fee_assumptions']

const before0003 = {}
for (const t of TABLES) {
  before0003[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n
}
apply('migrations/0003_status_check.sql', read('migrations/0003_status_check.sql'), results.check)
console.log('\n=== 0003 ROW COUNTS PRESERVED? ===')
let countsOk = true
for (const [t, n] of Object.entries(before0003)) {
  const after = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n
  const ok = after === n
  if (!ok) countsOk = false
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${t.padEnd(16)} ${n} -> ${after}`)
}

const before0004 = {}
for (const t of TABLES) {
  before0004[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n
}
apply('migrations/0004_bands_and_retrieval.sql', read('migrations/0004_bands_and_retrieval.sql'), results.check)
console.log('\n=== 0004 ROW COUNTS PRESERVED? ===')
for (const [t, n] of Object.entries(before0004)) {
  const after = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n
  const ok = after === n
  if (!ok) countsOk = false
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${t.padEnd(16)} ${n} -> ${after}`)
}

// The columns 0004 adds must exist and must be reachable the way the Worker
// reads them: airlines as two parsed band lists, fare_families as a timestamp.
console.log('\n=== 0004 COLUMNS PRESENT? ===')
let columnsOk = true
const expectColumn = (table, column) => {
  const found = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)
  if (!found) columnsOk = false
  console.log(`  ${found ? 'ok  ' : 'FAIL'}  ${table}.${column}`)
}
expectColumn('airlines', 'retrieved_at')
expectColumn('airlines', 'overweight_fees_json')
expectColumn('airlines', 'oversize_fees_json')
expectColumn('fare_families', 'retrieved_at')

apply('seed.sql', read('seed.sql'), results.seed)

// The seed is authoritative over the id set, so prove the prune actually
// retires a stale row -- and, just as importantly, keeps the real ones.
db.exec("INSERT INTO fare_families (id, airline_id, name) VALUES ('zz-ghost', 'wn', 'Retired fare')")
const ghostBefore = db.prepare("SELECT COUNT(*) AS n FROM fare_families WHERE id = 'zz-ghost'").get().n
apply('seed.sql (re-applied over a stale row)', read('seed.sql'), results.prune)
const ghostAfter = db.prepare("SELECT COUNT(*) AS n FROM fare_families WHERE id = 'zz-ghost'").get().n
const realFares = db.prepare('SELECT COUNT(*) AS n FROM fare_families').get().n
const realAirlines = db.prepare('SELECT COUNT(*) AS n FROM airlines').get().n
console.log(`\n=== SEED PRUNE ===`)
console.log(`  stale row present before: ${ghostBefore}, after: ${ghostAfter} (want 1 then 0)`)
console.log(`  real fares surviving: ${realFares} (want ${expectedFares})`)
console.log(`  real airlines surviving: ${realAirlines} (want ${expectedAirlines})`)
const pruneOk =
  ghostBefore === 1 &&
  ghostAfter === 0 &&
  realFares === expectedFares &&
  realAirlines === expectedAirlines

// 0003's status CHECK is enforced by the rebuilt tables; prove it still bites.
console.log('\n=== 0003 CHECK ACTUALLY ENFORCED? ===')
let checkOk = true
for (const t of ['airlines', 'fare_families', 'benefits', 'tsa_rules', 'fee_assumptions']) {
  // Inside a savepoint, so a probe that succeeds does not leave a bad status
  // behind for the verification output below to report as real.
  db.exec('SAVEPOINT status_probe')
  try {
    db.exec(`UPDATE ${t} SET status = 'Unverified' WHERE rowid = (SELECT MIN(rowid) FROM ${t})`)
    console.log(`  FAIL  ${t}: a bad status value was accepted`)
    checkOk = false
  } catch {
    console.log(`  ok    ${t}: a bad status value is rejected`)
  }
  db.exec('ROLLBACK TO status_probe')
  db.exec('RELEASE status_probe')
}

console.log('\n=== POST-MIGRATION VERIFICATION ===')
const counts = {}
for (const t of ['airlines', 'fare_families', 'benefits', 'tsa_rules', 'fee_assumptions', 'data_change_log']) {
  try {
    counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n
  } catch (e) {
    counts[t] = 'MISSING: ' + e.message
  }
}
console.log(JSON.stringify(counts, null, 1))

// The exact queries the new Worker runs must succeed against the migrated shape.
const WORKER_QUERIES = [
  ['airlines list', 'SELECT * FROM airlines ORDER BY name'],
  ['fares by airline', "SELECT * FROM fare_families WHERE airline_id = 'aa' ORDER BY name"],
  ['benefits by airline', "SELECT * FROM benefits WHERE airline_id = 'aa' ORDER BY name"],
  ['tsa rules', 'SELECT * FROM tsa_rules ORDER BY category, item_name'],
  ['assumptions', 'SELECT * FROM fee_assumptions'],
  ['health probe', "SELECT COUNT(*) AS n FROM airlines WHERE status != 'verified'"],
  ['airline by id', "SELECT * FROM airlines WHERE id = 'aa'"],
  ['fare by id', "SELECT * FROM fare_families WHERE id = 'aa-main'"],
]
console.log('\n=== NEW WORKER QUERIES AGAINST MIGRATED SHAPE ===')
let queryFail = 0
for (const [label, sql] of WORKER_QUERIES) {
  try {
    const rows = db.prepare(sql).all()
    console.log(`  ok    ${label.padEnd(22)} ${rows.length} row(s)`)
  } catch (e) {
    queryFail++
    console.log(`  FAIL  ${label.padEnd(22)} ${e.message}`)
  }
}

// Every column the engine reads must be present and populated.
console.log('\n=== PROVENANCE POPULATED? ===')
const a = db.prepare("SELECT id, slug, status, source_url, verified_at, currency FROM airlines WHERE id='aa'").get()
console.log('  airlines.aa ->', JSON.stringify(a))
const f = db.prepare("SELECT id, first_checked_fee, second_checked_fee, third_plus_checked_fee, carry_on_fee, status FROM fare_families WHERE id='ua-basic'").get()
console.log('  fares.ua-basic ->', JSON.stringify(f))
const bn = db.prepare("SELECT id, benefit_type, companion_limit, status FROM benefits WHERE id='ua-explorer'").get()
console.log('  benefits.ua-explorer ->', JSON.stringify(bn))

// The legacy NOT NULL column is the specific hazard.
const legacy = db.prepare("PRAGMA table_info(benefits)").all().filter((c) => c.name === 'type')
console.log('  legacy benefits.type column ->', legacy.length ? JSON.stringify(legacy[0]) : 'gone')

// The band lists and retrieval timestamps have to survive the round trip as
// the Worker reads them: two parsed arrays on the airline, a timestamp on both
// the airline and its fare families.
console.log('\n=== BANDS AND RETRIEVAL TIMESTAMPS POPULATED? ===')
let bandsOk = true
const withBands = db.prepare(
  "SELECT id, overweight_fees_json, oversize_fees_json, retrieved_at FROM airlines WHERE overweight_fees_json IS NOT NULL OR oversize_fees_json IS NOT NULL ORDER BY id",
).all()
for (const row of withBands) {
  try {
    const ow = row.overweight_fees_json ? JSON.parse(row.overweight_fees_json) : null
    const os = row.oversize_fees_json ? JSON.parse(row.oversize_fees_json) : null
    // An airline may publish only one of the two lists: British Airways and
    // Aer Lingus publish an overweight charge and no oversize charge, and that
    // is the fact, not a gap in the data.
    const ok =
      (ow === null || (Array.isArray(ow) && ow.length > 0)) &&
      (os === null || (Array.isArray(os) && os.length > 0)) &&
      !!row.retrieved_at
    if (!ok) bandsOk = false
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${row.id.padEnd(8)} ${JSON.stringify(ow)} / ${JSON.stringify(os)}`)
  } catch (e) {
    bandsOk = false
    console.log(`  FAIL  ${row.id}: band list is not valid JSON (${e.message})`)
  }
}

const malformed = db.prepare(
  "SELECT COUNT(*) AS n FROM airlines WHERE (overweight_fees_json IS NOT NULL AND overweight_fees_json NOT LIKE '[%') OR (oversize_fees_json IS NOT NULL AND oversize_fees_json NOT LIKE '[%')",
).get().n
if (malformed > 0) {
  bandsOk = false
  console.log(`  FAIL  ${malformed} airline(s) have a band list that is not a JSON array`)
}

const missingRetrieval = db.prepare(
  'SELECT COUNT(*) AS n FROM airlines WHERE retrieved_at IS NULL',
).get().n
const missingFareRetrieval = db.prepare(
  'SELECT COUNT(*) AS n FROM fare_families WHERE retrieved_at IS NULL',
).get().n
if (missingRetrieval > 0 || missingFareRetrieval > 0) {
  bandsOk = false
  console.log(`  FAIL  ${missingRetrieval} airline(s) and ${missingFareRetrieval} fare family/families have no retrieved_at`)
} else {
  console.log('  ok    every airline and fare family carries a retrieved_at timestamp')
}

const allFailures =
  Object.values(results).reduce((n, bucket) => n + bucket.filter((r) => !r.ok).length, 0) +
  queryFail +
  (pruneOk ? 0 : 1) +
  (countsOk ? 0 : 1) +
  (checkOk ? 0 : 1) +
  (columnsOk ? 0 : 1) +
  (bandsOk ? 0 : 1)
console.log(`\n=== REHEARSAL RESULT: ${allFailures === 0 ? 'CLEAN' : allFailures + ' FAILURE(S)'} ===`)
// Exits non-zero so CI actually gates on this. Printing the verdict and exiting
// 0 made the rehearsal a report rather than a check.
if (allFailures > 0) process.exitCode = 1
