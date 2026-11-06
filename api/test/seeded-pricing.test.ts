import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { URL } from 'node:url'
import test, { after } from 'node:test'
import app from '../src/index.ts'
import type { AirlineRecord, BagInput, CalculationResponse, FareFamilyRecord } from '../src/types.ts'
import { airlines, fareFamilies } from './fixtures.ts'

// Run the actual route handlers and their SQL against a fresh copy of the shipped seed.
const db = new DatabaseSync(':memory:')
for (const name of ['schema.sql', 'seed.sql']) db.exec(readFileSync(new URL('../' + name, import.meta.url), 'utf8'))
after(() => db.close())
function statement(sql: string, values: string[] = []) {
  return {
    bind: (...args: string[]) => statement(sql, args),
    first: async () => db.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...values) }),
  }
}
const env = { DB: { prepare: statement } as unknown as D1Database }
const checked = (weight: number, linear = 62, prepaid = false): BagInput => ({
  type: 'checked', weight, dimensions: { length: linear - 30, width: 18, height: 12 }, baseFeePrepaid: prepaid,
})
const cabin = (type: 'carry_on' | 'personal', prepaid = false): BagInput => ({
  type, weight: 18, dimensions: { length: 16, width: 12, height: 7 }, baseFeePrepaid: prepaid,
})
async function calculate(fareId: string, bags: BagInput[], bookingDate?: string, airlineId = 'f9') {
  const response = await app.request('/api/v1/calculate-fees', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ airlineId, fareFamilyId: fareId, passengers: [{ id: 'one', bags }], bookingDate }),
  }, env)
  assert.equal(response.status, 200)
  return await response.json() as CalculationResponse
}

test('seeded reference and both API aliases match every canonical airline and fare', async () => {
  const response = await app.request('/api/v1/reference', {}, env)
  const data = await response.json() as { airlines: AirlineRecord[]; fareFamilies: FareFamilyRecord[] }
  const legacy = await (await app.request('/api/fare-families', {}, env)).json()
  assert.deepEqual(legacy, data.fareFamilies)
  for (const [actual, expected] of [[data.airlines, airlines], [data.fareFamilies, fareFamilies]] as const) {
    assert.equal(actual.length, expected.length)
    for (const record of expected) {
      const row = actual.find(r => r.id === record.id)
      assert.ok(row, record.id)
      for (const [key, value] of Object.entries(record)) assert.deepEqual(Reflect.get(row, key), value, record.id + '.' + key)
    }
  }
  assert.equal(new Set(data.airlines.map(a => a.iata_code)).size, data.airlines.length)
})

test('a Frontier personal item is included; Basic carry-on and optional checked bags require a quote', async () => {
  const result = await calculate('f9-standard', [cabin('personal'), cabin('carry_on'), checked(40), checked(40), checked(40)])
  assert.deepEqual(result.passengerBreakdown[0].bags.map(b => b.status), ['included','unpriced','unpriced','unpriced','unpriced'])
  assert.deepEqual(result.passengerBreakdown[0].bags.map(b => b.fee), [0,null,null,null,null])
  assert.equal(result.totalFee, 0)
  assert.equal(result.unpricedItemCount, 4)
  assert.equal(result.usesAssumptions, false)
})
for (const bundle of ['economy','premium','business']) {
  test('Frontier ' + bundle + ' includes one overhead bag and only the documented checked allowance', async () => {
    const result = await calculate('f9-' + bundle, [cabin('carry_on'), checked(50), checked(50), checked(41)])
    const [carry, first, second, third] = result.passengerBreakdown[0].bags
    assert.equal(carry.status, 'included')
    assert.deepEqual([first.fee,second.fee], bundle === 'business' ? [0,0] : [null,null])
    assert.equal(third.status, 'unpriced')
    assert.equal(third.components.find(c => c.label === 'Overweight checked bag')?.amount, 75)
  })
}
test('a purchased individual bag changes only the remaining base charge', async () => {
  const result = await calculate('f9-standard', [cabin('carry_on', true), checked(40,62,true), checked(45,68,true)])
  assert.deepEqual(result.passengerBreakdown[0].bags.map(b => [b.status,b.fee]), [['prepaid',0],['prepaid',0],['priced',150]])
  assert.equal(result.totalFee, 150)
  assert.equal(result.hasUnpricedItems, false)
})
test('the ticket booking date determines the heavier tier and missing dates stay unresolved', async () => {
  for (const [date, fee] of [[undefined,null],['2026-04-03',100],['2026-04-04',129]] as const) {
    const result = await calculate('f9-business', [checked(51), checked(99.99)], date)
    assert.deepEqual(result.passengerBreakdown[0].bags.map(b => b.fee), [fee,fee])
    assert.equal(result.hasUnpricedItems, fee === null)
  }
})
test('Frontier acceptance boundaries and cabin limits cannot become paid or free entitlements', async () => {
  const tooHeavy = { ...cabin('personal'), weight: 36 }
  const result = await calculate('f9-business', [checked(100), checked(40,110.1,true), checked(40,110,true),
    tooHeavy, { ...cabin('carry_on'), weight: 36 }, cabin('carry_on')])
  assert.deepEqual(result.passengerBreakdown[0].bags.map(b => [b.status,b.fee]), [
    ['not_accepted',null],['not_accepted',null],['priced',75],['unpriced',null],['unpriced',null],['unpriced',null],
  ])
})
test('an unknown base never hides a known surcharge or turns it into an all-in price', async () => {
  const result = await calculate('f9-standard', [checked(45)])
  const line = result.passengerBreakdown[0].bags[0]
  assert.deepEqual(line.components.map(c => c.amount), [null,75])
  assert.equal(line.fee,null)
  assert.equal(result.hasUnpricedItems,true)
})
test('booking dates and claimed prepayments are validated on the API route', async () => {
  for (const [bookingDate, baseFeePrepaid] of [['2026-02-30',false],['04/04/2026',false],['2026-04-04','false']]) {
    const body = { airlineId: 'f9', fareFamilyId: 'f9-standard', bookingDate,
      passengers: [{ bags: [{ ...cabin('carry_on'), baseFeePrepaid }] }] }
    const response = await app.request('/api/v1/calculate-fees', {
      method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body),
    }, env)
    assert.equal(response.status,400)
  }
})
test('new carrier fares keep cabin entitlements scoped and conditional base prices open', async () => {
  for (const [airlineId, fareId, included] of [
    ['lh','lh-basic',true],['ei','ei-saver',true],['ha','ha-basic',true],['b6','b6-bluebasic',true],
    ['ac','ac-basic',false],['ac','ac-main',true],['ws','ws-basic',false],['ws','ws-extended',true],
    ['g4','g4-standard',false],['sy','sy-standard',false],['bz','bz-standard',false],['bz','bz-nice',true],
    ['av','av-standard',false],['ba','ba-economy-basic',true],
  ] as const) {
    const result = await calculate(fareId, [cabin('carry_on')], undefined, airlineId)
    assert.equal(result.passengerBreakdown[0].bags[0].fee, included ? 0 : null, fareId)
  }
  for (const [fareId, expected] of [['bz-nice',[null,null]],['bz-nicer',[0,null]],['bz-nicest',[0,0]],
    ['ba-economy',[0,null]],['ba-economy-basic',[null,null]],['av-standard',[null,null]]] as const) {
    const result = await calculate(fareId,[checked(40),checked(40)],undefined,fareId.split('-')[0])
    assert.deepEqual(result.passengerBreakdown[0].bags.map(b => b.fee), expected, fareId)
  }
})

test('combined excess charges respect the carrier and the additional-bag exception', async () => {
  const result = await calculate('ac-main', [checked(60,70),checked(40),checked(60,70)], undefined, 'ac')
  assert.deepEqual(result.passengerBreakdown[0].bags.map(b => b.fee), [145,60,100])
  const beyond = await calculate('ac-main', [checked(40),checked(40),checked(90,70,true)], undefined, 'ac')
  assert.equal(beyond.passengerBreakdown[0].bags[2].fee, null)
  const american = await calculate('aa-main', [checked(60,70)], undefined, 'aa')
  assert.equal(american.totalFee, 250)
})

test('a claimed standalone carry-on purchase cannot grant a restricted fare a cabin allowance', async () => {
  const result = await calculate('ws-basic', [cabin('carry_on', true)], undefined, 'ws')
  assert.equal(result.passengerBreakdown[0].bags[0].status, 'unpriced')
})
