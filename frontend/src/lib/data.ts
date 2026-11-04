/**
 * Build-time reference data.
 *
 * Imports the canonical dataset at data/reference-data.json so that:
 *  - prerendered content pages have real airline data without a network call,
 *  - the calculator has an explicitly dated fallback when the API is unreachable.
 *
 * The API remains the runtime source of truth. Anything rendered from this
 * snapshot is labelled with where it came from and when it was last checked.
 */
import raw from '../../../data/reference-data.json'

export type RecordStatus = 'verified' | 'unverified' | 'assumption'

export interface Provenance {
  source_url: string | null
  source_title: string | null
  effective_date: string | null
  /** UTC timestamp of when the source page was read for the current check. */
  retrieved_at: string | null
  verified_at: string | null
  verified_by: string | null
  scope: string | null
  currency: string
  status: RecordStatus
  change_note: string | null
}

/** A published overweight band: checked bags over the weight limit, up to max_weight lb. */
export interface OverweightBand {
  max_weight: number
  amount: number
}

/** A published oversize band: checked bags over the linear limit, up to max_linear_dim in. */
export interface OversizeBand {
  max_linear_dim: number
  amount: number
}

export interface Airline extends Provenance {
  id: string
  slug: string
  name: string
  iata_code: string
  personal_item_length: number | null
  personal_item_width: number | null
  personal_item_height: number | null
  carry_on_length: number | null
  carry_on_width: number | null
  carry_on_height: number | null
  carry_on_weight: number | null
  checked_bag_weight: number | null
  checked_bag_linear_dim: number | null
  overweight_fees: OverweightBand[] | null
  oversize_fees: OversizeBand[] | null
}

export interface FareFamily extends Provenance {
  id: string
  airline_id: string
  name: string
  includes_personal_item: number
  includes_carry_on: number
  first_checked_fee: number | null
  second_checked_fee: number | null
  third_plus_checked_fee: number | null
  carry_on_fee: number | null
}

export interface Benefit extends Provenance {
  id: string
  name: string
  airline_id: string
  benefit_type: string
  tier: string | null
  waives_first_checked: number
  waives_second_checked: number
  waives_carry_on: number
  companion_limit: number
}

export interface FeeAssumption {
  id: string
  label: string
  amount: number
  currency: string
  status: RecordStatus
  change_note: string | null
}

const bool = (v: unknown): number => (v ? 1 : 0)

export const DATASET_VERSION: string = raw.meta.version
export const REVIEW_INTERVAL_DAYS: number = raw.meta.reviewIntervalDays
/**
 * How old a source retrieval may be before the build refuses to ship.
 *
 * Same number as the build-time freshness gate, so the badge a reader sees and
 * the gate that guards the build cannot drift apart.
 */
export const RETRIEVAL_MAX_AGE_DAYS: number = raw.meta.retrievalMaxAgeDays ?? 90
export const DEFAULT_SCOPE: string = raw.meta.defaultScope

/**
 * Narrows a raw dataset value to the documented status enum.
 *
 * The previous `as RecordStatus` cast asserted the shape without checking it,
 * so a typo such as "Unverified" flowed straight through the type system into
 * every badge and provenance line. Every reader treats a non-'verified' value
 * as pending, so the failure was silent rather than visible -- which is exactly
 * why it needs to be caught here, at the boundary, and loudly.
 */
const asStatus = (value: unknown): RecordStatus => {
  if (value !== 'verified' && value !== 'unverified' && value !== 'assumption') {
    throw new Error(`reference-data.json: unrecognised status ${JSON.stringify(value)}`)
  }
  return value
}

export const airlines: Airline[] = raw.airlines.map((a) => ({
  id: a.id,
  slug: a.slug,
  name: a.name,
  iata_code: a.iata_code,
  // Some airlines publish no dimension at all for a bag. The block is null
  // rather than absent, and a null dimension reads as "not published" rather
  // than as a zero-sized bag.
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

export const fareFamilies: FareFamily[] = raw.fareFamilies.map((f) => ({
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

export const benefits: Benefit[] = raw.benefits.map((b) => ({
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

export const assumptions: FeeAssumption[] = raw.assumptions.map((a) => ({
  id: a.id,
  label: a.label,
  amount: a.amount,
  currency: raw.meta.currency,
  status: asStatus(a.status),
  change_note: a.change_note,
}))

export const airlineBySlug = (slug: string): Airline | undefined =>
  airlines.find((a) => a.slug === slug)

export const airlineById = (id: string): Airline | undefined => airlines.find((a) => a.id === id)

export const faresForAirline = (airlineId: string): FareFamily[] =>
  fareFamilies.filter((f) => f.airline_id === airlineId)

export const benefitsForAirline = (airlineId: string): Benefit[] =>
  benefits.filter((b) => b.airline_id === airlineId)

/**
 * True when a record has never been verified, or is past either review clock.
 *
 * Two clocks run against a record. `verified_at` is when a steward confirmed
 * the figures against the airline's page; `retrieved_at` is when that page was
 * read. A record verified today against a page read four months ago is not a
 * current figure, so both dates have to be inside their own limit.
 */
export const isReviewPending = (record: {
  status: RecordStatus
  verified_at: string | null
  retrieved_at?: string | null
}): boolean => {
  if (record.status !== 'verified') return true
  if (!record.verified_at) return true
  const then = Date.parse(record.verified_at)
  if (Number.isNaN(then)) return true
  if ((Date.now() - then) / 86_400_000 > REVIEW_INTERVAL_DAYS) return true

  if (record.retrieved_at) {
    const retrieved = Date.parse(record.retrieved_at)
    if (Number.isNaN(retrieved)) return true
    if ((Date.now() - retrieved) / 86_400_000 > RETRIEVAL_MAX_AGE_DAYS) return true
  }
  return false
}
