/**
 * The 90-day source freshness rule.
 *
 * An airline can reprice its bags without warning -- American Airlines changed
 * its checked-bag fees on 18 May 2026 -- so a figure that was correct when it
 * was read can be wrong by the time somebody packs for Thanksgiving. The
 * dataset therefore records, per record, the URL it was read from and the UTC
 * instant of that read.
 *
 * The threshold itself lives in the dataset (meta.retrievalMaxAgeDays) so the
 * build gate, the badge a reader sees and this test all read the same number
 * and cannot drift apart.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const data = JSON.parse(
  readFileSync(resolve(here, '../../data/reference-data.json'), 'utf8'),
) as {
  meta: { retrievalMaxAgeDays?: number }
  airlines: Array<{ id: string; retrieved_at?: string | null; source_url?: string | null }>
  fareFamilies: Array<{ id: string; retrieved_at?: string | null; source_url?: string | null }>
}

const MAX_AGE_DAYS = data.meta.retrievalMaxAgeDays ?? 90
const DAY_MS = 86_400_000

test('the dataset declares the retrieval freshness limit', () => {
  assert.equal(
    typeof data.meta.retrievalMaxAgeDays,
    'number',
    'meta.retrievalMaxAgeDays must be set so the build gate and the UI read the same limit',
  )
  assert.ok(
    data.meta.retrievalMaxAgeDays! > 0 && data.meta.retrievalMaxAgeDays! <= 365,
    `meta.retrievalMaxAgeDays should be a sensible number of days, got ${data.meta.retrievalMaxAgeDays}`,
  )
})

test('every airline carries a retrieval timestamp inside the limit', () => {
  const now = Date.now()
  const stale: string[] = []

  for (const airline of data.airlines) {
    assert.ok(
      typeof airline.retrieved_at === 'string' && airline.retrieved_at !== '',
      `airline "${airline.id}" has no retrieved_at timestamp`,
    )
    const parsed = Date.parse(airline.retrieved_at!)
    assert.ok(
      !Number.isNaN(parsed),
      `airline "${airline.id}" has an unparseable retrieved_at: ${airline.retrieved_at}`,
    )
    const ageDays = (now - parsed) / DAY_MS
    if (ageDays > MAX_AGE_DAYS) {
      stale.push(`${airline.id} (${ageDays.toFixed(1)} days old)`)
    }
  }

  assert.deepEqual(
    stale,
    [],
    `These airlines have not been re-checked within ${MAX_AGE_DAYS} days: ${stale.join(', ')}`,
  )
})

test('every airline records the source page it was read from', () => {
  for (const airline of data.airlines) {
    assert.ok(
      typeof airline.source_url === 'string' && airline.source_url.startsWith('http'),
      `airline "${airline.id}" has no source_url`,
    )
  }
})

test('every fare family carries a retrieval timestamp inside the limit', () => {
  const now = Date.now()
  const stale: string[] = []

  for (const fare of data.fareFamilies) {
    assert.ok(
      typeof fare.retrieved_at === 'string' && fare.retrieved_at !== '',
      `fare family "${fare.id}" has no retrieved_at timestamp`,
    )
    const parsed = Date.parse(fare.retrieved_at!)
    assert.ok(
      !Number.isNaN(parsed),
      `fare family "${fare.id}" has an unparseable retrieved_at: ${fare.retrieved_at}`,
    )
    const ageDays = (now - parsed) / DAY_MS
    if (ageDays > MAX_AGE_DAYS) {
      stale.push(`${fare.id} (${ageDays.toFixed(1)} days old)`)
    }
  }

  assert.deepEqual(
    stale,
    [],
    `These fare families have not been re-checked within ${MAX_AGE_DAYS} days: ${stale.join(', ')}`,
  )
})
