/**
 * Builds engine fixtures from the canonical dataset so the tests fail if
 * data/reference-data.json regresses, not just if the code does.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import type {
  AirlineRecord,
  BenefitRecord,
  FareFamilyRecord,
  FeeAssumptionRecord,
  RecordStatus,
} from '../src/types.ts'

const here = dirname(fileURLToPath(import.meta.url))
const raw = JSON.parse(
  readFileSync(resolve(here, '../../data/reference-data.json'), 'utf8'),
) as {
  meta: { currency: string }
  airlines: Array<Record<string, any>>
  fareFamilies: Array<Record<string, any>>
  benefits: Array<Record<string, any>>
  assumptions: Array<Record<string, any>>
}

const bool = (v: unknown): number => (v ? 1 : 0)

/**
 * Narrows a raw dataset value to the documented status enum.
 *
 * Record<string, any> above erases every field's type, so a typo such as
 * "Unverified" in reference-data.json would have flowed into the fixtures and
 * out through the engine unchallenged -- and, because every reader treats a
 * non-'verified' value as pending, would have failed silently rather than
 * loudly. The tests exist to catch a dataset regression, so the dataset's one
 * enumerated field gets checked rather than asserted.
 */
const asStatus = (v: unknown): RecordStatus => {
  if (v !== 'verified' && v !== 'unverified' && v !== 'assumption') {
    throw new Error(`reference-data.json: unrecognised status ${JSON.stringify(v)}`)
  }
  return v
}

export const airlines: AirlineRecord[] = raw.airlines.map((a) => ({
  id: a.id,
  slug: a.slug,
  name: a.name,
  iata_code: a.iata_code,
  personal_item_length: a.personal_item?.length ?? null,
  personal_item_width: a.personal_item?.width ?? null,
  personal_item_height: a.personal_item?.height ?? null,
  carry_on_length: a.carry_on?.length ?? null,
  carry_on_width: a.carry_on?.width ?? null,
  carry_on_height: a.carry_on?.height ?? null,
  carry_on_weight: a.carry_on?.weight ?? null,
  checked_bag_weight: a.checked.weight,
  checked_bag_linear_dim: a.checked.linear_dim,
  overweight_fees: a.checked.overweight_fees ?? null,
  oversize_fees: a.checked.oversize_fees ?? null,
  source_url: a.source_url,
  source_title: a.source_title,
  effective_date: a.effective_date,
  retrieved_at: a.retrieved_at ?? null,
  verified_at: a.verified_at,
  verified_by: a.verified_by,
  scope: a.scope,
  currency: a.currency,
  status: asStatus(a.status),
  change_note: a.change_note,
}))

export const fareFamilies: FareFamilyRecord[] = raw.fareFamilies.map((f) => ({
  id: f.id,
  airline_id: f.airline_id,
  name: f.name,
  includes_personal_item: bool(f.includes_personal_item),
  includes_carry_on: bool(f.includes_carry_on),
  first_checked_fee: f.first_checked_fee,
  second_checked_fee: f.second_checked_fee,
  third_plus_checked_fee: f.third_plus_checked_fee,
  carry_on_fee: f.carry_on_fee,
  source_url: f.source_url,
  source_title: f.source_title,
  effective_date: f.effective_date,
  retrieved_at: f.retrieved_at ?? null,
  verified_at: f.verified_at,
  verified_by: f.verified_by,
  scope: f.scope,
  currency: f.currency,
  status: asStatus(f.status),
  change_note: f.change_note,
}))

export const benefits: BenefitRecord[] = raw.benefits.map((b) => ({
  id: b.id,
  name: b.name,
  airline_id: b.airline_id,
  benefit_type: b.benefit_type,
  tier: b.tier,
  waives_first_checked: bool(b.waives_first_checked),
  waives_second_checked: bool(b.waives_second_checked),
  waives_carry_on: bool(b.waives_carry_on),
  companion_limit: b.companion_limit,
  source_url: b.source_url,
  source_title: b.source_title,
  effective_date: b.effective_date,
  retrieved_at: b.retrieved_at ?? null,
  verified_at: b.verified_at,
  verified_by: b.verified_by,
  scope: b.scope,
  currency: b.currency,
  status: asStatus(b.status),
  change_note: b.change_note,
}))

export const assumptions: FeeAssumptionRecord[] = raw.assumptions.map((a) => ({
  id: a.id,
  label: a.label,
  amount: a.amount,
  currency: raw.meta.currency,
  status: asStatus(a.status),
  change_note: a.change_note,
}))

export const airline = (id: string): AirlineRecord => {
  const found = airlines.find((a) => a.id === id)
  if (!found) throw new Error(`No airline fixture '${id}'`)
  return found
}

export const fare = (id: string): FareFamilyRecord => {
  const found = fareFamilies.find((f) => f.id === id)
  if (!found) throw new Error(`No fare fixture '${id}'`)
  return found
}

export const benefitsFor = (airlineId: string): BenefitRecord[] =>
  benefits.filter((b) => b.airline_id === airlineId)

/** A typical carry-on sized bag that fits every mainline allowance. */
export const CARRY_ON = { length: 21, width: 13, height: 8 }
/** A small under-seat bag. */
export const PERSONAL = { length: 15, width: 10, height: 5 }
