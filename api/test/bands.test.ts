/**
 * Per-airline overweight and oversize charge bands.
 *
 * The fee engine used to apply one flat $100 "overweight checked bag"
 * assumption to every airline, and to price an oversize bag at nothing at all
 * ("PackRight has no sourced oversize fee"). Both were wrong: airlines publish
 * these charges in bands that differ per airline, and every airline checked
 * publishes them.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { calculateFees } from '../src/fees.ts'
import { airline, assumptions, benefitsFor, fare } from './fixtures.ts'
import type { BagInput, CalculationRequest } from '../src/types.ts'

const run = (airlineId: string, fareId: string, bags: BagInput[]) => {
  const request: CalculationRequest = {
    airlineId,
    fareFamilyId: fareId,
    passengers: [{ id: 'pax-1', benefitIds: [], bags }],
  }
  return calculateFees({
    request,
    airline: airline(airlineId),
    fareFamily: fare(fareId),
    benefits: benefitsFor(airlineId),
    assumptions,
  })
}

/**
 * A checked bag of a given weight, whose three sides sum to `linearInches`.
 *
 * The linear total is what airlines measure an oversize bag by, so the box is
 * built to land exactly on the number under test.
 */
const checked = (weight: number, linearInches: number): BagInput => ({
  type: 'checked',
  weight,
  dimensions: { length: linearInches - 28, width: 16, height: 12 },
})

const component = (line: { components: Array<{ label: string; amount: number | null; basis: string }> }, label: string) =>
  line.components.find((c) => c.label === label)

test('an overweight bag is charged the airline\'s published band, not the flat assumption', () => {
  const aa = airline('aa')
  assert.ok(
    aa.overweight_fees && aa.overweight_fees.length > 0,
    'American must publish overweight bands',
  )

  // American: 51-53 lb is $30, 54-70 lb is $100, 71-100 lb is $200.
  const result = run('aa', 'aa-main', [checked(52, 62)])
  const line = result.passengerBreakdown[0].bags[0]
  const over = component(line, 'Overweight checked bag')

  assert.equal(over?.basis, 'sourced', 'the charge must come from the airline, not the assumption')
  assert.equal(over?.amount, 30, 'a 52 lb bag falls in American\'s 51-53 lb band')
})

test('a heavier bag is charged the higher published band', () => {
  const result = run('aa', 'aa-main', [checked(65, 62)])
  const over = component(result.passengerBreakdown[0].bags[0], 'Overweight checked bag')
  assert.equal(over?.basis, 'sourced')
  assert.equal(over?.amount, 100, 'a 65 lb bag falls in American\'s 54-70 lb band')
})

test('the top band is used for the heaviest bag the airline accepts', () => {
  const result = run('aa', 'aa-main', [checked(90, 62)])
  const over = component(result.passengerBreakdown[0].bags[0], 'Overweight checked bag')
  assert.equal(over?.basis, 'sourced')
  assert.equal(over?.amount, 200, 'a 90 lb bag falls in American\'s 71-100 lb band')
})

test('Delta uses its own bands, not American\'s', () => {
  // Delta: 51-70 lb is $100, 71-99 lb is $200.
  const mid = run('dl', 'dl-main', [checked(60, 62)])
  assert.equal(component(mid.passengerBreakdown[0].bags[0], 'Overweight checked bag')?.amount, 100)

  const heavy = run('dl', 'dl-main', [checked(80, 62)])
  assert.equal(component(heavy.passengerBreakdown[0].bags[0], 'Overweight checked bag')?.amount, 200)
})

test('a bag inside the weight limit is not charged an overweight fee', () => {
  const result = run('aa', 'aa-main', [checked(45, 62)])
  const line = result.passengerBreakdown[0].bags[0]
  assert.equal(component(line, 'Overweight checked bag'), undefined)
})

test('an oversize bag now carries the published oversize charge', () => {
  // American: 63-65 linear in is $30, 66-115 linear in is $200.
  const result = run('aa', 'aa-main', [checked(40, 70)])
  const line = result.passengerBreakdown[0].bags[0]
  const over = component(line, 'Oversize checked bag')

  assert.ok(over, 'an oversize bag must carry an oversize component')
  assert.equal(over?.basis, 'sourced')
  assert.equal(over?.amount, 200, 'a 70 linear inch bag falls in American\'s 66-115 in band')
  assert.notEqual(line.fee, null)
})

test('an oversized bag is charged the airline fee, not $0', () => {
  const result = run('dl', 'dl-main', [checked(40, 70)])
  const line = result.passengerBreakdown[0].bags[0]
  const over = component(line, 'Oversize checked bag')
  assert.equal(over?.basis, 'sourced')
  assert.equal(over?.amount, 200, 'Delta charges $200 for a 63-80 linear inch bag')
})

test('a bag beyond the last published band is not priced from the band list', () => {
  // Delta refuses bags larger than 80 linear inches rather than charging for
  // them, so there is no published band to price from.
  const result = run('dl', 'dl-main', [checked(40, 90)])
  const line = result.passengerBreakdown[0].bags[0]
  assert.equal(component(line, 'Oversize checked bag')?.amount, null)
  assert.equal(line.fee, null)
  assert.equal(result.hasUnpricedItems, true)
})

test('an unpublished excess band keeps the full amount unknown', () => {
  // Build a synthetic airline with no band lists at all.
  const bare = { ...airline('aa'), overweight_fees: null, oversize_fees: null }
  const request: CalculationRequest = {
    airlineId: 'aa',
    fareFamilyId: 'aa-main',
    passengers: [{ id: 'pax-1', benefitIds: [], bags: [checked(60, 62)] }],
  }
  const result = calculateFees({
    request,
    airline: bare,
    fareFamily: fare('aa-main'),
    benefits: benefitsFor('aa'),
    assumptions,
  })
  const over = component(result.passengerBreakdown[0].bags[0], 'Overweight checked bag')
  assert.equal(over?.basis, 'unknown')
  assert.equal(over?.amount, null)
  assert.equal(result.hasUnpricedItems, true)
})
