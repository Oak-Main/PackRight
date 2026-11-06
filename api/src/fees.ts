/**
 * PackRight baggage fee engine.
 *
 * Pure functions only, so the whole engine is unit-testable without a Worker or
 * a database. See api/test/fees.test.ts.
 *
 * Two rules drive the design, both from the August 2026 audit:
 *
 *  1. Never invent a price. If the applicable source does not fully price
 *     a bag, it is reported as `unpriced` and is excluded from the total.
 *     The earlier build hard-coded $35/$40/$100/$150 inline with no provenance.
 *
 *  2. Fit checks must be orientation-insensitive. The earlier build compared
 *     length-to-length, width-to-width, height-to-height, so a 15x10x5 bag was
 *     judged "oversized" against Frontier's 14x18x8 personal-item allowance even
 *     though it fits easily. Both the bag and the allowance are now sorted
 *     longest-to-shortest before comparison.
 */

import type {
  AirlineRecord,
  BagInput,
  BagLine,
  BenefitRecord,
  CalculationRequest,
  CalculationResponse,
  DataQuality,
  Dimensions,
  FareFamilyRecord,
  FeeAssumptionRecord,
  FeeComponent,
  FeeStatus,
  PassengerLine,
  RecordStatus,
} from './types.ts'

export const API_VERSION = '1.2.0'

export const DISCLAIMER =
  'Airline size, weight, and fee rules can change without notice. PackRight provides ' +
  'an estimate using the sources shown here. Please confirm your allowance ' +
  'and final price with the airline before travel.'

/** A record is treated as needing review once its check is this old. */
export const REVIEW_INTERVAL_DAYS = 30

/**
 * How old a source retrieval may be before the record counts as stale.
 *
 * The same limit the build-time freshness gate and the site's badges use, so
 * an estimate cannot be reported as current when the airline's own page has
 * not been re-read for months. A record verified today against a page read
 * four months ago is not a current figure.
 */
export const RETRIEVAL_MAX_AGE_DAYS = 90

/** Floating-point slack so 22.0 does not read as larger than 22. */
const EPSILON = 1e-9

/**
 * True when `bag` fits inside `limit` in some orientation.
 * Returns null when either side has no dimensions, so callers can distinguish
 * "does not fit" from "cannot tell".
 */
export function fitsWithin(bag: Dimensions | null, limit: Dimensions | null): boolean | null {
  if (!bag || !limit) return null
  const desc = (d: Dimensions) => [d.length, d.width, d.height].sort((a, b) => b - a)
  const b = desc(bag)
  const l = desc(limit)
  if (b.some((n) => !Number.isFinite(n)) || l.some((n) => !Number.isFinite(n))) return null
  return b.every((value, i) => value <= l[i] + EPSILON)
}

/**
 * Picks the published band that covers a bag.
 *
 * Bands are ordered cheapest-first by their upper bound, and the first band
 * whose bound is at least the bag's value is the one the airline charges. A bag
 * beyond the last band returns null: that is either a band the airline has not
 * published or a bag the airline refuses outright, and neither may be priced
 * from the band list.
 */
function pickBand<T extends { amount: number }>(
  bands: ReadonlyArray<T> | null | undefined,
  value: number,
  boundOf: (band: T) => number,
  minimumOf: (band: T) => number | undefined,
): T | null {
  if (!bands || bands.length === 0) return null
  const ordered = [...bands].sort((a, b) => boundOf(a) - boundOf(b))
  for (const band of ordered) {
    if (value >= (minimumOf(band) ?? 0) - EPSILON && value <= boundOf(band) + EPSILON) return band
  }
  return null
}

function airlineDims(
  a: AirlineRecord,
  kind: 'personal_item' | 'carry_on',
): Dimensions | null {
  const l = kind === 'personal_item' ? a.personal_item_length : a.carry_on_length
  const w = kind === 'personal_item' ? a.personal_item_width : a.carry_on_width
  const h = kind === 'personal_item' ? a.personal_item_height : a.carry_on_height
  if (l == null || w == null || h == null) return null
  return { length: l, width: w, height: h }
}

/** Sums components. Any unpriced component makes the whole bag unpriced. */
function totalComponents(components: FeeComponent[]): number | null {
  if (components.length === 0) return 0
  if (components.some((c) => c.amount === null)) return null
  return components.reduce((sum, c) => sum + (c.amount ?? 0), 0)
}

function basisOf(components: FeeComponent[]): BagLine['basis'] {
  if (components.some((c) => c.basis === 'unknown')) return 'unknown'
  if (components.some((c) => c.basis === 'traveler')) return 'traveler'
  return 'sourced'
}

/**
 * Works out which passengers a benefit actually covers.
 *
 * A card waiver covers the cardholder plus up to `companion_limit` other
 * passengers on the same reservation. The earlier build applied a waiver to any
 * passenger the client happened to tag, ignoring the companion limit entirely.
 */
export function resolveBenefitCoverage(
  passengers: CalculationRequest['passengers'],
  benefits: BenefitRecord[],
): Map<number, BenefitRecord[]> {
  // Keyed by the passenger's position, never by pax.id. Ids are client-supplied
  // and validate.ts substitutes positional defaults for missing ones, so a body
  // that names one passenger 'pax-3' and omits the rest yields two passengers
  // with the same id. Keying on that id collapsed them into a single entry, and
  // a waiver granted to one leaked to every passenger sharing it -- defeating
  // the companion limit outright.
  const coverage = new Map<number, BenefitRecord[]>()
  passengers.forEach((_, index) => coverage.set(index, []))

  const byId = new Map(benefits.map((b) => [b.id, b]))
  // Keyed by holder AND benefit. Keyed on the benefit alone, a second passenger
  // holding the same card was skipped entirely, so their own companion
  // allowance was never applied.
  const seen = new Set<string>()

  passengers.forEach((holder, holderIndex) => {
    for (const benefitId of holder.benefitIds ?? []) {
      const seenKey = `${holderIndex}|${benefitId}`
      if (seen.has(seenKey)) continue
      const benefit = byId.get(benefitId)
      if (!benefit) continue
      seen.add(seenKey)

      // The holder, then companions in itinerary order up to the companion limit.
      const covered = [holderIndex]
      const limit = Math.max(0, benefit.companion_limit ?? 0)
      for (let other = 0; other < passengers.length; other++) {
        if (covered.length > limit) break
        if (other === holderIndex) continue
        covered.push(other)
      }
      for (const index of covered) {
        const list = coverage.get(index)
        // A companion can fall under two holders of the same card. Without this
        // guard the benefit would appear twice in appliedBenefitIds.
        if (list && !list.includes(benefit)) list.push(benefit)
      }
    }
  })
  return coverage
}

function isStale(verifiedAt: string | null, retrievedAt: string | null, now: Date): boolean {
  if (!verifiedAt) return true
  const then = Date.parse(verifiedAt)
  if (Number.isNaN(then)) return true
  if ((now.getTime() - then) / 86_400_000 > REVIEW_INTERVAL_DAYS) return true
  // A record with no retrieval time cannot be shown to be current, so it is
  // treated as stale rather than as fresh by default.
  if (!retrievedAt) return true
  const retrieved = Date.parse(retrievedAt)
  if (Number.isNaN(retrieved)) return true
  return (now.getTime() - retrieved) / 86_400_000 > RETRIEVAL_MAX_AGE_DAYS
}

type BagPrice = {
  components: FeeComponent[]
  status: FeeStatus
  reason: string
  fits?: boolean | null
  warnings: string[]
}

function unknown(label: string, note: string): FeeComponent {
  return { label, amount: null, basis: 'unknown', note }
}

function priceCabinBag(
  bag: BagInput, ordinal: number, airline: AirlineRecord, fare: FareFamilyRecord, waivesCarryOn: boolean,
): BagPrice {
  const personal = bag.type === 'personal'
  const label = personal ? 'Personal item' : 'Carry-on bag'
  const limit = airlineDims(airline, personal ? 'personal_item' : 'carry_on')
  const fits = fitsWithin(bag.dimensions, limit)
  const weight = personal ? airline.personal_item_weight : airline.carry_on_weight
  const warnings: string[] = []
  if (fits === false) {
    warnings.push(`Larger than ${airline.name}'s ${personal ? 'personal-item' : 'carry-on'} allowance (` +
      `${limit!.length} x ${limit!.width} x ${limit!.height} in).`)
  }
  if (weight != null && bag.weight != null && bag.weight > weight) {
    warnings.push(`Over the ${weight} lb weight limit for this ${label.toLowerCase()}.`)
  }
  if (ordinal > 1 || warnings.length) {
    const reason = ordinal > 1 ? 'Extra cabin bag' : 'Over the cabin allowance'
    const note = 'Confirm with the airline whether this bag must be checked and what it will cost.'
    return { components: [unknown(reason, note)], status: 'unpriced', reason, fits, warnings }
  }
  if (fits === null) warnings.push(limit ? 'Enter bag dimensions to check the allowance.' : 'No size limit is recorded for this item.')
  if (!personal && waivesCarryOn) {
    return { components: [], status: 'waived', reason: 'Waived by your selected card benefit', fits, warnings }
  }
  if (personal ? fare.includes_personal_item : fare.includes_carry_on) {
    return { components: [], status: 'included', reason: 'Included with this fare', fits, warnings }
  }
  if (bag.baseFeePrepaid && (fare.carry_on_purchasable || fare.carry_on_fee != null)) {
    return { components: [prepaidComponent(label)], status: 'prepaid', reason: 'Base bag fee already paid', fits, warnings }
  }
  if (!personal && fare.carry_on_fee != null) {
    return { components: [{ label, amount: fare.carry_on_fee, basis: 'sourced' }], status: 'priced', reason: 'Carry-on fee for this fare', fits, warnings }
  }
  return {
    components: [unknown(label, 'Check your itinerary for permitted add-ons, checked-bag requirements and the price.')],
    status: 'unpriced', reason: 'Outside the fare allowance; check your booking', fits, warnings,
  }
}

function prepaidComponent(label: string): FeeComponent {
  return { label, amount: 0, basis: 'traveler', note: 'You marked the base fee as paid. Only additional charges are estimated.' }
}

function overweightComponent(airline: AirlineRecord, bagWeight: number, bookingDate?: string): FeeComponent {
  const label = 'Overweight checked bag'
  const band = pickBand(airline.overweight_fees, bagWeight, b => b.max_weight, b => b.min_weight)
  if (!band) return unknown(label, 'No published charge covers this weight in the selected policy. Confirm acceptance and price.')
  const change = band.booking_change
  if (change && !bookingDate) {
    const note = `The booking date determines this charge: ${airline.currency} ${change.previous_amount} before ` +
      `${change.effective_date}, or ${airline.currency} ${band.amount} from that date.`
    return unknown(label, note)
  }
  const amount = change && bookingDate && bookingDate < change.effective_date ? change.previous_amount : band.amount
  return { label, amount, basis: 'sourced', note: `Published weight band up to ${band.max_weight} lb. ` +
    (change ? `Based on booking date ${bookingDate}.` : 'Per bag, one way.') }
}

function priceOneCheckedBag(
  bag: BagInput, ordinal: number, airline: AirlineRecord, fare: FareFamilyRecord,
  waivesFirst: boolean, waivesSecond: boolean, bookingDate?: string,
): BagPrice {
  const warnings: string[] = []
  const linear = bag.dimensions ? bag.dimensions.length + bag.dimensions.width + bag.dimensions.height : null
  if (airline.checked_reject_weight_at != null && bag.weight != null && bag.weight >= airline.checked_reject_weight_at) {
    warnings.push(`Ordinary checked bags must weigh less than ${airline.checked_reject_weight_at} lb.`)
  }
  if (airline.checked_max_accepted_linear_dim != null && linear != null && linear > airline.checked_max_accepted_linear_dim + EPSILON) {
    warnings.push(`Ordinary checked bags may measure at most ${airline.checked_max_accepted_linear_dim} linear inches.`)
  }
  if (warnings.length) {
    return { components: [], status: 'not_accepted', reason: 'Outside the airline’s acceptance limit', warnings }
  }

  const label = ordinal === 1 ? 'First checked bag' : ordinal === 2 ? 'Second checked bag' : `Checked bag ${ordinal}`
  const base = ordinal === 1 ? fare.first_checked_fee : ordinal === 2 ? fare.second_checked_fee : fare.third_plus_checked_fee
  const waived = (ordinal === 1 && waivesFirst) || (ordinal === 2 && waivesSecond)
  const included = base === 0
  const components: FeeComponent[] = []
  let status: FeeStatus = 'priced'
  let reason = label
  if (waived) {
    status = 'waived'
    reason = `${label} waived by your selected card benefit`
  } else if (included) {
    status = 'included'
    reason = `${label} included with this fare`
    components.push({ label, amount: 0, basis: 'sourced' })
  } else if (bag.baseFeePrepaid) {
    status = 'prepaid'
    reason = 'Base bag fee already paid'
    components.push(prepaidComponent(label))
  } else if (base == null) {
    components.push(unknown(label, 'Check the airline’s price for this bag on your itinerary.'))
  } else {
    components.push({ label, amount: base, basis: 'sourced' })
  }

  const weightLimit = included ? fare.included_checked_weight ?? airline.checked_bag_weight : airline.checked_bag_weight
  const excess: FeeComponent[] = []
  if (weightLimit != null && bag.weight != null && bag.weight > weightLimit) {
    warnings.push(`Over the ${weightLimit} lb allowance for this checked bag.`)
    excess.push(overweightComponent(airline, bag.weight, bookingDate))
  }
  if (airline.checked_bag_linear_dim != null && linear != null && linear > airline.checked_bag_linear_dim + EPSILON) {
    warnings.push(`At ${linear.toFixed(1)} linear inches, this bag exceeds the ${airline.checked_bag_linear_dim} in standard limit.`)
    const band = pickBand(airline.oversize_fees, linear, b => b.max_linear_dim, b => b.min_linear_dim)
    excess.push(band
      ? { label: 'Oversize checked bag', amount: band.amount, basis: 'sourced' }
      : unknown('Oversize checked bag', 'No published charge covers these dimensions. Confirm acceptance and price.'))
  }
  const excessCovered = airline.excess_covered_from_bag != null && ordinal >= airline.excess_covered_from_bag &&
    (bag.baseFeePrepaid || (base != null && base > 0)) && excess.length > 0 && excess.every(c => c.amount != null)
  if (excessCovered) {
    components.push({ label: 'Excess covered by the additional-bag fee', amount: 0, basis: 'sourced' })
  } else if (airline.single_excess_fee && excess.length === 2) {
    const amounts = excess.map(c => c.amount)
    components.push(amounts[0] == null || amounts[1] == null
      ? unknown('Combined excess baggage', 'Confirm the single applicable excess charge with the airline.')
      : { label: 'Combined excess baggage', amount: Math.max(amounts[0], amounts[1]), basis: 'sourced', note: 'Only the higher excess fee applies.' })
  } else {
    components.push(...excess)
  }
  if (components.some(c => c.amount === null)) status = 'unpriced'
  else if (excess.length && !excessCovered) status = 'priced'
  if (excess.length && !excessCovered) reason += status === 'unpriced' ? ' · confirm the full price with the airline' : ' · additional excess charges apply'
  return { components, status, reason, warnings }
}

export interface EngineInputs {
  request: CalculationRequest
  airline: AirlineRecord
  fareFamily: FareFamilyRecord
  benefits: BenefitRecord[]
  assumptions?: FeeAssumptionRecord[]
  now?: Date
}

export function calculateFees(inputs: EngineInputs): CalculationResponse {
  const { request, airline, fareFamily, benefits } = inputs
  const now = inputs.now ?? new Date()

  const coverage = resolveBenefitCoverage(request.passengers, benefits)

  let totalFee = 0
  let unpricedItemCount = 0
  const passengerBreakdown: PassengerLine[] = []

  for (let paxIndex = 0; paxIndex < request.passengers.length; paxIndex++) {
    const pax = request.passengers[paxIndex]
    const paxBenefits = coverage.get(paxIndex) ?? []
    const waivesFirst = paxBenefits.some((b) => !!b.waives_first_checked)
    const waivesSecond = paxBenefits.some((b) => !!b.waives_second_checked)
    const waivesCarryOn = paxBenefits.some((b) => !!b.waives_carry_on)

    const bags: BagLine[] = []
    const ordinals: Record<string, number> = { personal: 0, carry_on: 0, checked: 0 }
    let paxFee = 0
    let paxHasUnpriced = false

    for (const bag of pax.bags) {
      ordinals[bag.type] += 1
      const ordinal = ordinals[bag.type]

      const outcome = bag.type === 'checked'
        ? priceOneCheckedBag(bag, ordinal, airline, fareFamily, waivesFirst, waivesSecond, request.bookingDate)
        : priceCabinBag(bag, ordinal, airline, fareFamily, waivesCarryOn)
      const rejected = outcome.status === 'not_accepted'
      const fee = rejected ? null : totalComponents(outcome.components)
      const basis = rejected ? 'unknown' : basisOf(outcome.components)
      if (fee === null) {
        paxHasUnpriced = true
        unpricedItemCount += 1
      } else {
        paxFee += fee
      }

      bags.push({
        type: bag.type,
        ordinal,
        weight: bag.weight,
        dimensions: bag.dimensions,
        fee,
        currency: airline.currency || 'USD',
        status: outcome.status,
        basis,
        reason: outcome.reason,
        components: outcome.components,
        fitsAllowance: outcome.fits ?? null,
        warnings: outcome.warnings,
      })
    }

    totalFee += paxFee
    passengerBreakdown.push({
      paxId: pax.id,
      paxFee,
      hasUnpricedItems: paxHasUnpriced,
      appliedBenefitIds: paxBenefits.map((b) => b.id),
      bags,
    })
  }

  const usedBenefits = benefits.filter((b) =>
    passengerBreakdown.some((p) => p.appliedBenefitIds.includes(b.id)),
  )
  const contributing: Array<{ type: string; record: { id: string; scope: string | null; status: RecordStatus; verified_at: string | null; retrieved_at: string | null; source_title: string | null; source_url: string | null } }> = [
    { type: 'airline', record: airline },
    { type: 'fare_family', record: fareFamily },
    ...usedBenefits.map((b) => ({ type: 'benefit', record: b })),
  ]

  const pendingRecords = contributing
    .filter((c) => c.record.status !== 'verified' || isStale(c.record.verified_at, c.record.retrieved_at, now))
    .map((c) => ({
      type: c.type,
      id: c.record.id,
      status: c.record.status,
      verified_at: c.record.verified_at,
    }))

  // Every contributing record must carry a usable date, or there is no date the
  // estimate as a whole can honestly claim. Filtering the nulls out and taking
  // the oldest survivor reported a check that covered only part of the answer.
  const recordDates = contributing.map((c) => c.record.verified_at)
  const verifiedDates = recordDates.every((d) => !!d && !Number.isNaN(Date.parse(d)))
    ? (recordDates as string[]).slice().sort()
    : []

  const dataQuality: DataQuality = {
    reviewPending: pendingRecords.length > 0,
    reviewIntervalDays: REVIEW_INTERVAL_DAYS,
    lastVerifiedAt: verifiedDates.length ? verifiedDates[0] : null,
    pendingRecords,
    sources: contributing.map((c) => ({
      type: c.type,
      id: c.record.id,
      title: c.record.source_title,
      url: c.record.source_url,
      scope: c.record.scope,
      retrieved_at: c.record.retrieved_at,
      verified_at: c.record.verified_at,
      // Carried through deliberately. When this was omitted the UI reconstructed
      // a status from the date alone and badged unverified records "Verified".
      status: c.record.status,
    })),
  }

  return {
    apiVersion: API_VERSION,
    currency: airline.currency || 'USD',
    totalFee: Math.round(totalFee * 100) / 100,
    hasUnpricedItems: unpricedItemCount > 0,
    unpricedItemCount,
    usesAssumptions: false,
    passengerBreakdown,
    assumptionsApplied: [],
    dataQuality,
    disclaimer: DISCLAIMER,
    calculatedAt: now.toISOString(),
  }
}
