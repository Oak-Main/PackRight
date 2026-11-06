import test from 'node:test'
import assert from 'node:assert/strict'

import { calculateFees, fitsWithin, resolveBenefitCoverage } from '../src/fees.ts'
import {
  CARRY_ON,
  PERSONAL,
  airline,
  assumptions,
  benefitsFor,
  fare,
} from './fixtures.ts'
import type { BagInput, CalculationRequest } from '../src/types.ts'

const run = (
  airlineId: string,
  fareId: string,
  bags: BagInput[],
  opts: { benefitIds?: string[]; passengers?: number } = {},
) => {
  const count = opts.passengers ?? 1
  const request: CalculationRequest = {
    airlineId,
    fareFamilyId: fareId,
    passengers: Array.from({ length: count }, (_, i) => ({
      id: `pax-${i + 1}`,
      benefitIds: i === 0 ? (opts.benefitIds ?? []) : [],
      bags,
    })),
  }
  return calculateFees({
    request,
    airline: airline(airlineId),
    fareFamily: fare(fareId),
    benefits: benefitsFor(airlineId),
    assumptions,
  })
}

const bag = (type: BagInput['type'], dimensions: BagInput['dimensions'], weight: number | null = null): BagInput =>
  ({ type, dimensions, weight })

/* ---------------------------------------------------------------- *
 * Orientation-insensitive fit (the Frontier / Alaska regression)
 * ---------------------------------------------------------------- */

test('fitsWithin ignores which axis is called length', () => {
  // Same box, different axis order on each side. Both must fit.
  assert.equal(fitsWithin({ length: 15, width: 10, height: 5 }, { length: 18, width: 14, height: 8 }), true)
  assert.equal(fitsWithin({ length: 15, width: 10, height: 5 }, { length: 14, width: 18, height: 8 }), true)
  assert.equal(fitsWithin({ length: 5, width: 15, height: 10 }, { length: 18, width: 14, height: 8 }), true)
})

test('fitsWithin still rejects a genuinely oversized bag', () => {
  assert.equal(fitsWithin({ length: 30, width: 20, height: 12 }, { length: 22, width: 14, height: 9 }), false)
})

test('fitsWithin returns null when either side has no dimensions', () => {
  assert.equal(fitsWithin(null, { length: 22, width: 14, height: 9 }), null)
  assert.equal(fitsWithin({ length: 22, width: 14, height: 9 }, null), null)
})

test('a bag exactly at the limit fits', () => {
  assert.equal(fitsWithin({ length: 22, width: 14, height: 9 }, { length: 22, width: 14, height: 9 }), true)
})

test('regression: a small personal item is not charged an oversize penalty on Frontier', () => {
  // Frontier stored its personal-item allowance as 14x18x8 while every other
  // airline used longest-first ordering, so the old axis-by-axis comparison
  // charged a $100 "Oversized Personal Item Penalty" for a 15x10x5 bag.
  const result = run('f9', 'f9-standard', [bag('personal', PERSONAL, 3)])
  const line = result.passengerBreakdown[0].bags[0]
  assert.equal(line.fitsAllowance, true)
  assert.equal(line.fee, 0)
  assert.equal(line.status, 'included')
  assert.equal(result.totalFee, 0)
})

test('regression: a small personal item is not charged an oversize penalty', () => {
  // American publishes a personal item of 18 x 14 x 8 in.
  const result = run('aa', 'aa-main', [bag('personal', PERSONAL, 3)])
  const line = result.passengerBreakdown[0].bags[0]
  assert.equal(line.fitsAllowance, true)
  assert.equal(line.fee, 0)
})

test('an airline that publishes no personal item size reports cannot-tell, not a verdict', () => {
  // Alaska publishes no personal-item dimensions at all, so the engine must not
  // claim the bag fits - and must not claim it does not.
  const result = run('as', 'as-main', [bag('personal', { length: 14, width: 11, height: 9 }, 3)])
  const line = result.passengerBreakdown[0].bags[0]
  assert.equal(line.fitsAllowance, null)
  assert.equal(line.fee, 0)
})

/* ---------------------------------------------------------------- *
 * Never invent a price
 * ---------------------------------------------------------------- */

test('United Basic Economy carry-on is reported as unpriced, not guessed at $40', () => {
  // The audit recorded the live app returning $40 here. That figure existed only
  // as an inline constant with no source, so it is no longer produced.
  const result = run('ua', 'ua-basic', [bag('carry_on', CARRY_ON, 18)])
  const line = result.passengerBreakdown[0].bags[0]
  assert.equal(line.status, 'unpriced')
  assert.equal(line.fee, null)
  assert.equal(line.basis, 'unknown')
  assert.equal(result.totalFee, 0)
  assert.equal(result.hasUnpricedItems, true)
  assert.equal(result.unpricedItemCount, 1)
})

test('unpriced bags are excluded from the total rather than counted as zero', () => {
  const result = run('ua', 'ua-basic', [
    bag('carry_on', CARRY_ON, 18),
    bag('checked', { length: 25, width: 15, height: 10 }, 40),
  ])
  assert.equal(result.totalFee, 50) // the sourced first-checked fee only
  assert.equal(result.hasUnpricedItems, true)
  assert.equal(result.unpricedItemCount, 1)
})

test('a bag above the published bands never receives a generic planning price', () => {
  const result = run('aa', 'aa-main', [bag('checked', { length: 25, width: 15, height: 10 }, 120)])
  assert.equal(result.usesAssumptions, false)
  assert.deepEqual(result.assumptionsApplied, [])
  assert.equal(result.passengerBreakdown[0].bags[0].fee, null)
  assert.equal(result.hasUnpricedItems, true)
})

/* ---------------------------------------------------------------- *
 * Reviewed fixtures: AA / DL / UA  (launch checklist)
 * ---------------------------------------------------------------- */

test('American Main Cabin: one checked bag matches the sourced fee', () => {
  const result = run('aa', 'aa-main', [bag('checked', { length: 25, width: 15, height: 10 }, 40)])
  assert.equal(result.totalFee, 50)
  assert.equal(result.passengerBreakdown[0].bags[0].basis, 'sourced')
  assert.equal(result.hasUnpricedItems, false)
})

test('American Main Cabin: two checked bags sum the first and second fees', () => {
  const result = run('aa', 'aa-main', [
    bag('checked', { length: 25, width: 15, height: 10 }, 40),
    bag('checked', { length: 25, width: 15, height: 10 }, 40),
  ])
  assert.equal(result.totalFee, 110) // 50 + 60
})

test('Delta Basic Economy: personal item and carry-on are included, one checked bag is $45', () => {
  const result = run('dl', 'dl-basic', [
    bag('personal', PERSONAL, 5),
    bag('carry_on', CARRY_ON, 15),
    bag('checked', { length: 25, width: 15, height: 10 }, 45),
  ])
  assert.equal(result.totalFee, 45)
  const [personal, carryOn, checked] = result.passengerBreakdown[0].bags
  assert.equal(personal.status, 'included')
  assert.equal(carryOn.status, 'included')
  assert.equal(checked.fee, 45)
})

test('United Main Cabin: carry-on included, first checked bag $50', () => {
  const result = run('ua', 'ua-main', [
    bag('carry_on', CARRY_ON, 15),
    bag('checked', { length: 25, width: 15, height: 10 }, 45),
  ])
  assert.equal(result.totalFee, 50)
  assert.equal(result.hasUnpricedItems, false)
})

test('Southwest Wanna Get Away: two checked bags cost the published 1st and 2nd fees', () => {
  const result = run('wn', 'wn-wanna', [
    bag('checked', { length: 25, width: 15, height: 10 }, 40),
    bag('checked', { length: 25, width: 15, height: 10 }, 40),
  ])
  assert.equal(result.totalFee, 100) // 45 + 55
  assert.equal(result.hasUnpricedItems, false)
})

/* ---------------------------------------------------------------- *
 * Benefits and companion limits
 * ---------------------------------------------------------------- */

test('the United Explorer card waives the first checked bag and the carry-on', () => {
  const result = run(
    'ua',
    'ua-basic',
    [bag('carry_on', CARRY_ON, 15), bag('checked', { length: 25, width: 15, height: 10 }, 45)],
    { benefitIds: ['ua-explorer'] },
  )
  const [carryOn, checked] = result.passengerBreakdown[0].bags
  assert.equal(carryOn.status, 'waived')
  assert.equal(carryOn.fee, 0)
  assert.equal(checked.status, 'waived')
  assert.equal(result.totalFee, 0)
  assert.equal(result.hasUnpricedItems, false)
})

test('a card waiver covers the holder plus the companion limit, and no further', () => {
  // United Explorer has companion_limit 1: the cardholder plus one companion.
  const result = run(
    'ua',
    'ua-main',
    [bag('checked', { length: 25, width: 15, height: 10 }, 45)],
    { benefitIds: ['ua-explorer'], passengers: 3 },
  )
  const fees = result.passengerBreakdown.map((p) => p.paxFee)
  assert.deepEqual(fees, [0, 0, 50])
  assert.equal(result.totalFee, 50)
})

test('resolveBenefitCoverage does not extend a waiver past the companion limit', () => {
  const passengers = [1, 2, 3, 4].map((n) => ({
    id: `pax-${n}`,
    benefitIds: n === 1 ? ['ua-explorer'] : [],
    bags: [],
  }))
  const coverage = resolveBenefitCoverage(passengers, benefitsFor('ua'))
  // Keyed by position, not by id -- see the duplicate-id test below.
  assert.equal(coverage.get(0)?.length, 1)
  assert.equal(coverage.get(1)?.length, 1)
  assert.equal(coverage.get(2)?.length, 0)
  assert.equal(coverage.get(3)?.length, 0)
})

test('duplicate passenger ids cannot spread one waiver across the whole party', () => {
  // The engine must not key coverage on a client-supplied id. Two passengers
  // sharing 'pax-3' used to share one coverage entry, so the cardholder's
  // waiver silently covered both and the companion limit was never enforced.
  const passengers = [
    { id: 'pax-3', benefitIds: ['ua-explorer'], bags: [bag('checked', null, 40)] },
    { id: 'pax-2', benefitIds: [], bags: [bag('checked', null, 40)] },
    { id: 'pax-3', benefitIds: [], bags: [bag('checked', null, 40)] },
  ]
  const result = calculateFees({
    request: { airlineId: 'ua', fareFamilyId: 'ua-main', passengers },
    airline: airline('ua'),
    fareFamily: fare('ua-main'),
    benefits: benefitsFor('ua'),
    assumptions,
  })
  // ua-explorer waives the first checked bag for the holder plus one companion.
  assert.deepEqual(
    result.passengerBreakdown.map((p) => p.bags[0].status),
    ['waived', 'waived', 'priced'],
  )
  assert.equal(result.totalFee, 50)
})

test('every passenger sharing one id is still charged individually', () => {
  const passengers = [1, 2, 3, 4].map((n) => ({
    id: 'dup',
    benefitIds: n === 1 ? ['ua-explorer'] : [],
    bags: [bag('checked', null, 40)],
  }))
  const result = calculateFees({
    request: { airlineId: 'ua', fareFamilyId: 'ua-main', passengers },
    airline: airline('ua'),
    fareFamily: fare('ua-main'),
    benefits: benefitsFor('ua'),
    assumptions,
  })
  // Holder plus one companion are waived; the other two pay $50 each.
  assert.equal(result.totalFee, 100)
})

test('a second holder of the same card gets their own companion allowance', () => {
  // `seen` used to be keyed on the benefit id alone, so the third passenger's
  // own copy of the card was skipped and they paid full fare.
  const passengers = [
    { id: 'p1', benefitIds: ['ua-explorer'], bags: [bag('checked', null, 40)] },
    { id: 'p2', benefitIds: [] as string[], bags: [bag('checked', null, 40)] },
    { id: 'p3', benefitIds: ['ua-explorer'], bags: [bag('checked', null, 40)] },
  ]
  const result = calculateFees({
    request: { airlineId: 'ua', fareFamilyId: 'ua-main', passengers },
    airline: airline('ua'),
    fareFamily: fare('ua-main'),
    benefits: benefitsFor('ua'),
    assumptions,
  })
  assert.equal(result.totalFee, 0)
  for (const line of result.passengerBreakdown) {
    // A companion covered by two holders must not collect the benefit twice.
    assert.equal(new Set(line.appliedBenefitIds).size, line.appliedBenefitIds.length)
  }
})

test('a waived bag carrying an overweight charge is reported as priced, not waived', () => {
  // The waiver covers the base fee, not the surcharge stacked on top of it.
  // Reporting 'waived' while charging the caller was the defect.
  const result = run(
    'ua',
    'ua-main',
    [bag('checked', { length: 25, width: 15, height: 10 }, 60)],
    { benefitIds: ['ua-explorer'] },
  )
  const checked = result.passengerBreakdown[0].bags[0]
  assert.equal(checked.status, 'priced')
  assert.ok((checked.fee ?? 0) > 0, 'a charged bag must carry a fee')
  assert.match(checked.reason, /waived/i)
})

test('a second checked bag is not waived by a card that only waives the first', () => {
  const result = run(
    'aa',
    'aa-main',
    [
      bag('checked', { length: 25, width: 15, height: 10 }, 40),
      bag('checked', { length: 25, width: 15, height: 10 }, 40),
    ],
    { benefitIds: ['aa-citi'] },
  )
  assert.equal(result.totalFee, 60)
})

/* ---------------------------------------------------------------- *
 * Oversize, excess and warnings
 * ---------------------------------------------------------------- */

test('an oversized carry-on requires a fresh quote', () => {
  const result = run('aa', 'aa-main', [bag('carry_on', { length: 30, width: 20, height: 12 }, 20)])
  const line = result.passengerBreakdown[0].bags[0]
  assert.equal(line.fitsAllowance, false)
  assert.equal(line.fee, null)
  assert.equal(line.basis, 'unknown')
  assert.ok(line.warnings.some((w) => w.includes('carry-on allowance')))
})

test('a third checked bag remains unpriced when the airline publishes no fee', () => {
  const dims = { length: 25, width: 15, height: 10 }
  // American now publishes a 3rd bag fee, so the fallback is exercised with a
  // fare family that carries no third-bag figure.
  const noThirdBag = { ...fare('aa-main'), id: 'aa-main-no-third', third_plus_checked_fee: null }
  const result = calculateFees({
    request: {
      airlineId: 'aa',
      fareFamilyId: 'aa-main-no-third',
      passengers: [
        {
          id: 'pax-1',
          benefitIds: [],
          bags: [bag('checked', dims, 40), bag('checked', dims, 40), bag('checked', dims, 40)],
        },
      ],
    },
    airline: airline('aa'),
    fareFamily: noThirdBag,
    benefits: benefitsFor('aa'),
    assumptions,
  })
  assert.equal(result.totalFee, 110) // first and second bags only
  assert.equal(result.passengerBreakdown[0].bags[2].fee, null)
  assert.equal(result.hasUnpricedItems, true)
})

test('an over-linear checked bag is charged the airline oversize fee', () => {
  const result = run('aa', 'aa-main', [bag('checked', { length: 40, width: 25, height: 20 }, 40)])
  const line = result.passengerBreakdown[0].bags[0]
  // 85 linear inches falls in American's published 66-115 in oversize band.
  assert.equal(line.fee, 250) // 50 bag + 200 oversize
  const over = line.components.find((c) => c.label === 'Oversize checked bag')
  assert.equal(over?.basis, 'sourced')
  assert.equal(over?.amount, 200)
})

test('an over-linear checked bag warns without inventing an oversize fee when the airline publishes none', () => {
  // British Airways publishes no oversize charge, so the bag is reported as
  // having no known fee rather than being priced at zero silently.
  const result = run('ba', 'ba-economy', [bag('checked', { length: 40, width: 25, height: 20 }, 40)])
  const line = result.passengerBreakdown[0].bags[0]
  assert.equal(line.fee, null)
  assert.equal(line.components.find(c => c.label === 'Oversize checked bag')?.basis, 'unknown')
})

test('missing dimensions produce a prompt, not a false oversize verdict', () => {
  const result = run('aa', 'aa-main', [bag('carry_on', null, 15)])
  const line = result.passengerBreakdown[0].bags[0]
  assert.equal(line.fitsAllowance, null)
  assert.ok(line.warnings.some((w) => w.includes('Enter bag dimensions')))
})

/* ---------------------------------------------------------------- *
 * Data governance
 * ---------------------------------------------------------------- */

test('unverified source records mark the whole result as review pending', () => {
  // Every shipped record has now been checked against its airline's own page,
  // so the pending state is exercised with a record that has not been.
  const unverified = { ...airline('aa'), status: 'unverified' as const, verified_at: null }
  const unverifiedFare = { ...fare('aa-main'), status: 'unverified' as const, verified_at: null }
  const result = calculateFees({
    request: {
      airlineId: 'aa',
      fareFamilyId: 'aa-main',
      passengers: [{ id: 'p1', benefitIds: [], bags: [bag('checked', { length: 25, width: 15, height: 10 }, 40)] }],
    },
    airline: unverified,
    fareFamily: unverifiedFare,
    benefits: [],
    assumptions,
  })
  assert.equal(result.dataQuality.reviewPending, true)
  assert.ok(result.dataQuality.pendingRecords.length > 0)
  assert.equal(result.dataQuality.reviewIntervalDays, 30)
})

test('a record whose source was never re-read is review pending even when verified', () => {
  const stale = { ...airline('aa'), retrieved_at: null }
  const result = calculateFees({
    request: { airlineId: 'aa', fareFamilyId: 'aa-main', passengers: [{ id: 'p1', benefitIds: [], bags: [] }] },
    airline: stale,
    fareFamily: fare('aa-main'),
    benefits: [],
    assumptions,
  })
  assert.equal(result.dataQuality.reviewPending, true)
})

test('every result carries source links and the estimate disclaimer', () => {
  const result = run('dl', 'dl-main', [bag('checked', { length: 25, width: 15, height: 10 }, 40)])
  assert.ok(result.dataQuality.sources.length >= 2)
  assert.ok(result.dataQuality.sources.every((s) => typeof s.url === 'string' && s.url.startsWith('https://')))
  assert.match(result.disclaimer, /confirm your allowance and final price with the airline/i)
})

test('a record verified today is not flagged as review pending', () => {
  const fresh = { ...airline('aa'), status: 'verified' as const, verified_at: new Date().toISOString() }
  const freshFare = { ...fare('aa-main'), status: 'verified' as const, verified_at: new Date().toISOString() }
  const result = calculateFees({
    request: { airlineId: 'aa', fareFamilyId: 'aa-main', passengers: [{ id: 'p1', benefitIds: [], bags: [] }] },
    airline: fresh,
    fareFamily: freshFare,
    benefits: [],
    assumptions,
  })
  assert.equal(result.dataQuality.reviewPending, false)
})

test('a record verified 60 days ago is flagged as review pending', () => {
  const old = new Date(Date.now() - 60 * 86_400_000).toISOString()
  const stale = { ...airline('aa'), status: 'verified' as const, verified_at: old }
  const staleFare = { ...fare('aa-main'), status: 'verified' as const, verified_at: old }
  const result = calculateFees({
    request: { airlineId: 'aa', fareFamilyId: 'aa-main', passengers: [{ id: 'p1', benefitIds: [], bags: [] }] },
    airline: stale,
    fareFamily: staleFare,
    benefits: [],
    assumptions,
  })
  assert.equal(result.dataQuality.reviewPending, true)
})

test('an empty bag list produces a zero estimate rather than an error', () => {
  const result = run('aa', 'aa-main', [])
  assert.equal(result.totalFee, 0)
  assert.equal(result.hasUnpricedItems, false)
  assert.equal(result.passengerBreakdown[0].bags.length, 0)
})
