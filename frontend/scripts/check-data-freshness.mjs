#!/usr/bin/env node
/**
 * Build-time data freshness gate.
 *
 * Every airline record in data/reference-data.json carries the URL it was read
 * from and the UTC timestamp of that retrieval. A fee page can change at any
 * time without warning -- American Airlines repriced its checked bags in May
 * 2026 -- so a number that was right when we looked can be wrong by the time
 * somebody packs for Thanksgiving. This check fails the build when a source
 * has not been re-read for longer than meta.retrievalMaxAgeDays.
 *
 * It runs as part of `npm run build` (before the client bundle is produced) and
 * as part of the API test suite, so a stale dataset cannot ship through either
 * door.
 *
 * Run: node scripts/check-data-freshness.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const dataPath = resolve(here, '../../data/reference-data.json')

const DEFAULT_MAX_AGE_DAYS = 90

const data = JSON.parse(readFileSync(dataPath, 'utf8'))
const maxAgeDays = Number(data.meta?.retrievalMaxAgeDays ?? DEFAULT_MAX_AGE_DAYS)

if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) {
  console.error(
    `reference-data.json: meta.retrievalMaxAgeDays must be a positive number, got ${JSON.stringify(
      data.meta?.retrievalMaxAgeDays,
    )}.`,
  )
  process.exit(1)
}

const now = Date.now()
const failures = []

/**
 * Checks one record's retrieval timestamp.
 *
 * A missing or unparseable timestamp is a failure in its own right: an
 * undated source cannot be shown to be current, so treating it as fresh would
 * make the check pass by omitting the very data it exists to require.
 */
const checkRecord = (kind, id, record) => {
  const retrievedAt = record.retrieved_at

  if (typeof retrievedAt !== 'string' || retrievedAt.trim() === '') {
    failures.push({ kind, id, reason: 'no retrieved_at timestamp recorded' })
    return
  }

  const parsed = Date.parse(retrievedAt)
  if (Number.isNaN(parsed)) {
    failures.push({ kind, id, reason: `retrieved_at is not a parseable date: ${retrievedAt}` })
    return
  }

  const ageDays = (now - parsed) / 86_400_000
  if (ageDays > maxAgeDays) {
    failures.push({
      kind,
      id,
      reason: `source retrieved ${ageDays.toFixed(1)} days ago (limit ${maxAgeDays} days)`,
      ageDays,
    })
  }
}

for (const airline of data.airlines ?? []) {
  checkRecord('airline', airline.id, airline)
}

for (const fare of data.fareFamilies ?? []) {
  checkRecord('fare family', fare.id, fare)
}

const airlineCount = (data.airlines ?? []).length
const fareCount = (data.fareFamilies ?? []).length

if (failures.length > 0) {
  console.error(
    `Data freshness check FAILED: ${failures.length} record(s) are missing a retrieval timestamp ` +
      `or were retrieved more than ${maxAgeDays} days ago.`,
  )
  for (const f of failures) {
    console.error(`  - ${f.kind} "${f.id}": ${f.reason}`)
  }
  console.error(
    '\nRe-read each airline\'s own baggage page, update the values in ' +
      'data/reference-data.json, and set retrieved_at to the UTC timestamp of that retrieval.',
  )
  process.exit(1)
}

console.log(
  `Data freshness check passed: ${airlineCount} airlines and ${fareCount} fare families ` +
    `were retrieved within ${maxAgeDays} days.`,
)
