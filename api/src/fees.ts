/**
 * PackRight baggage fee engine.
 *
 * Pure functions only, so the whole engine is unit-testable without a Worker or
 * a database. See api/test/fees.test.ts.
 *
 * Two rules drive the design, both from the August 2026 audit:
 *
 *  1. Never invent a price. If no sourced fee and no labelled assumption covers
 *     a bag, that bag is reported as `unpriced` and is excluded from the total.
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

export const API_VERSION = '1.0.0'

export const DISCLAIMER =
  'Airline size, weight, and fee rules can change without notice. PackRight provides ' +
  'an estimate based on the sources and assumptions shown here; confirm your allowance ' +
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
): T | null {
  if (!bands || bands.length === 0) return null
  const ordered = [...bands].sort((a, b) => boundOf(a) - boundOf(b))
  for (const band of ordered) {
    if (value <= boundOf(band) + EPSILON) return band
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

function basisOf(components: FeeComponent[]): 'sourced' | 'assumption' | 'unknown' {
  if (components.some((c) => c.basis === 'unknown')) return 'unknown'
  if (components.some((c) => c.basis === 'assumption')) return 'assumption'
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

function priceOnePersonalItem(
  bag: BagInput,
  airline: AirlineRecord,
  fare: FareFamilyRecord,
  assumptions: Map<string, FeeAssumptionRecord>,
  used: Set<string>,
): { components: FeeComponent[]; status: FeeStatus; reason: string; fits: boolean | null; warnings: string[] } {
  const warnings: string[] = []
  const limit = airlineDims(airline, 'personal_item')
  const fits = fitsWithin(bag.dimensions, limit)

  if (fits === false) {
    const assumption = assumptions.get('oversize-personal-item')
    if (assumption) used.add(assumption.id)
    warnings.push(
      `Larger than ${airline.name}'s published personal-item allowance ` +
        `(${limit?.length} x ${limit?.width} x ${limit?.height} in).`,
    )
    return {
      components: [
        {
          label: 'Oversized personal item',
          amount: assumption ? assumption.amount : null,
          basis: assumption ? 'assumption' : 'unknown',
          assumptionId: assumption?.id,
          note: assumption
            ? 'Planning assumption, not a published airline fee.'
            : 'PackRight has no sourced or assumed figure for this.',
        },
      ],
      status: assumption ? 'priced' : 'unpriced',
      reason: 'Over the personal-item allowance',
      fits,
      warnings,
    }
  }

  if (fits === null) {
    warnings.push('Enter bag dimensions to check this against the airline allowance.')
  }

  if (fare.includes_personal_item) {
    return { components: [], status: 'included', reason: 'Included with this fare', fits, warnings }
  }

  return {
    components: [
      {
        label: 'Personal item',
        amount: null,
        basis: 'unknown',
        note: 'This fare does not include a personal item and PackRight has no sourced fee for one.',
      },
    ],
    status: 'unpriced',
    reason: 'Not included with this fare',
    fits,
    warnings,
  }
}

function priceOneCarryOn(
  bag: BagInput,
  airline: AirlineRecord,
  fare: FareFamilyRecord,
  waivesCarryOn: boolean,
  assumptions: Map<string, FeeAssumptionRecord>,
  used: Set<string>,
): { components: FeeComponent[]; status: FeeStatus; reason: string; fits: boolean | null; warnings: string[] } {
  const warnings: string[] = []
  const components: FeeComponent[] = []
  let reason: string
  let status: FeeStatus

  if (waivesCarryOn) {
    reason = 'Waived by your selected card benefit'
    status = 'waived'
  } else if (fare.includes_carry_on) {
    reason = 'Included with this fare'
    status = 'included'
  } else if (fare.carry_on_fee != null) {
    components.push({ label: 'Carry-on bag', amount: fare.carry_on_fee, basis: 'sourced' })
    reason = 'Carry-on fee for this fare'
    status = 'priced'
  } else {
    components.push({
      label: 'Carry-on bag',
      amount: null,
      basis: 'unknown',
      note:
        'This fare does not include a carry-on. The price depends on route and when you buy it, ' +
        'so PackRight does not estimate it.',
    })
    reason = 'Not included with this fare, price varies'
    status = 'unpriced'
  }

  const limit = airlineDims(airline, 'carry_on')
  const fits = fitsWithin(bag.dimensions, limit)
  if (fits === false) {
    const assumption = assumptions.get('gate-oversize-carry-on')
    if (assumption) used.add(assumption.id)
    warnings.push(
      `Larger than ${airline.name}'s published carry-on allowance ` +
        `(${limit?.length} x ${limit?.width} x ${limit?.height} in).`,
    )
    components.push({
      label: 'Carry-on too large at the gate',
      amount: assumption ? assumption.amount : null,
      basis: assumption ? 'assumption' : 'unknown',
      assumptionId: assumption?.id,
      note: assumption
        ? 'Planning assumption, not a published airline fee. Gate outcomes vary by airline and airport.'
        : 'PackRight has no sourced or assumed figure for this.',
    })
    reason = 'Over the carry-on allowance'
    status = assumption ? 'priced' : 'unpriced'
  } else if (fits === null) {
    warnings.push('Enter bag dimensions to check this against the airline allowance.')
  }

  if (airline.carry_on_weight != null && bag.weight != null && bag.weight > airline.carry_on_weight) {
    warnings.push(
      `Over ${airline.name}'s ${airline.carry_on_weight} lb carry-on weight limit. ` +
        'PackRight has no sourced fee for this, so nothing is added to the estimate.',
    )
  }

  return { components, status, reason, fits, warnings }
}

function priceOneCheckedBag(
  bag: BagInput,
  ordinal: number,
  airline: AirlineRecord,
  fare: FareFamilyRecord,
  waivesFirst: boolean,
  waivesSecond: boolean,
  assumptions: Map<string, FeeAssumptionRecord>,
  used: Set<string>,
): { components: FeeComponent[]; status: FeeStatus; reason: string; warnings: string[] } {
  const warnings: string[] = []
  const components: FeeComponent[] = []
  let reason: string
  let status: FeeStatus = 'priced'

  const sourcedBase = (amount: number | null, label: string): void => {
    if (amount == null) {
      components.push({
        label,
        amount: null,
        basis: 'unknown',
        note: 'PackRight has no sourced fee for this bag on this fare.',
      })
      status = 'unpriced'
    } else {
      components.push({ label, amount, basis: 'sourced' })
    }
  }

  if (ordinal === 1 && waivesFirst) {
    reason = 'First checked bag waived by your selected card benefit'
    status = 'waived'
  } else if (ordinal === 2 && waivesSecond) {
    reason = 'Second checked bag waived by your selected card benefit'
    status = 'waived'
  } else if (ordinal === 1) {
    sourcedBase(fare.first_checked_fee, 'First checked bag')
    reason = 'First checked bag'
    if (fare.first_checked_fee === 0) status = 'included'
  } else if (ordinal === 2) {
    sourcedBase(fare.second_checked_fee, 'Second checked bag')
    reason = 'Second checked bag'
    if (fare.second_checked_fee === 0) status = 'included'
  } else if (fare.third_plus_checked_fee != null) {
    components.push({
      label: `Checked bag ${ordinal}`,
      amount: fare.third_plus_checked_fee,
      basis: 'sourced',
    })
    reason = `Checked bag ${ordinal}`
  } else {
    const assumption = assumptions.get('excess-checked-3plus')
    if (assumption) used.add(assumption.id)
    components.push({
      label: `Checked bag ${ordinal}`,
      amount: assumption ? assumption.amount : null,
      basis: assumption ? 'assumption' : 'unknown',
      assumptionId: assumption?.id,
      note: assumption ? 'Planning assumption, not a published airline fee.' : undefined,
    })
    reason = `Checked bag ${ordinal}`
    if (!assumption) status = 'unpriced'
  }

  if (
    airline.checked_bag_weight != null &&
    bag.weight != null &&
    bag.weight > airline.checked_bag_weight
  ) {
    warnings.push(
      `Over ${airline.name}'s ${airline.checked_bag_weight} lb checked-bag limit.`,
    )
    // Airlines publish overweight charges in bands, not one flat rate, so the
    // published band for THIS bag's weight is used when the airline has one.
    // Only a bag beyond the last published band falls back to the assumption.
    const band = pickBand(
      airline.overweight_fees ?? null,
      bag.weight,
      (b) => b.max_weight,
    )
    if (band) {
      components.push({
        label: 'Overweight checked bag',
        amount: band.amount,
        basis: 'sourced',
        note: `${airline.name}'s published charge for a checked bag over ${airline.checked_bag_weight} lb ` +
          `and up to ${band.max_weight} lb.`,
      })
    } else {
      const assumption = assumptions.get('overweight-checked')
      if (assumption) used.add(assumption.id)
      components.push({
        label: 'Overweight checked bag',
        amount: assumption ? assumption.amount : null,
        basis: assumption ? 'assumption' : 'unknown',
        assumptionId: assumption?.id,
        note: assumption
          ? 'Planning assumption. Real overweight charges are banded and differ per airline.'
          : undefined,
      })
      if (!assumption) status = 'unpriced'
    }
  }

  if (airline.checked_bag_linear_dim != null && bag.dimensions) {
    const linear = bag.dimensions.length + bag.dimensions.width + bag.dimensions.height
    if (linear > airline.checked_bag_linear_dim + EPSILON) {
      const band = pickBand(
        airline.oversize_fees ?? null,
        linear,
        (b) => b.max_linear_dim,
      )
      if (band) {
        warnings.push(
          `Total of length plus width plus height is ${linear.toFixed(1)} in, over ` +
            `${airline.name}'s ${airline.checked_bag_linear_dim} in limit.`,
        )
        components.push({
          label: 'Oversize checked bag',
          amount: band.amount,
          basis: 'sourced',
          note: `${airline.name}'s published charge for a checked bag over ${airline.checked_bag_linear_dim} ` +
            `linear inches and up to ${band.max_linear_dim} linear inches.`,
        })
      } else {
        warnings.push(
          `Total of length plus width plus height is ${linear.toFixed(1)} in, over ` +
            `${airline.name}'s ${airline.checked_bag_linear_dim} in limit. PackRight has no sourced ` +
            'oversize fee, so nothing is added to the estimate.',
        )
      }
    }
  }

  // A waiver covers the base fare's bag fee, not the overweight surcharge added
  // above it. Leaving status at 'waived' while components carried a charge made
  // the UI label a bag the caller is being charged for as free. The carry-on
  // path already reconciles the two (see the oversize branch); mirror it here.
  // 'unpriced' outranks both: it means part of the total is unknown.
  if (status !== 'unpriced') {
    const charged = components.reduce((sum, c) => sum + (c.amount ?? 0), 0)
    if (charged > 0) status = 'priced'
  }

  return { components, status, reason, warnings }
}

export interface EngineInputs {
  request: CalculationRequest
  airline: AirlineRecord
  fareFamily: FareFamilyRecord
  benefits: BenefitRecord[]
  assumptions: FeeAssumptionRecord[]
  now?: Date
}

export function calculateFees(inputs: EngineInputs): CalculationResponse {
  const { request, airline, fareFamily, benefits, assumptions } = inputs
  const now = inputs.now ?? new Date()

  const assumptionMap = new Map(assumptions.map((a) => [a.id, a]))
  const usedAssumptionIds = new Set<string>()
  const coverage = resolveBenefitCoverage(request.passengers, benefits)

  let totalFee = 0
  let unpricedItemCount = 0
  let usesAssumptions = false
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

      let outcome: {
        components: FeeComponent[]
        status: FeeStatus
        reason: string
        fits?: boolean | null
        warnings: string[]
      }

      if (bag.type === 'personal') {
        outcome = priceOnePersonalItem(bag, airline, fareFamily, assumptionMap, usedAssumptionIds)
      } else if (bag.type === 'carry_on') {
        outcome = priceOneCarryOn(
          bag, airline, fareFamily, waivesCarryOn, assumptionMap, usedAssumptionIds,
        )
      } else {
        outcome = priceOneCheckedBag(
          bag, ordinal, airline, fareFamily, waivesFirst, waivesSecond,
          assumptionMap, usedAssumptionIds,
        )
      }

      const fee = totalComponents(outcome.components)
      const basis = basisOf(outcome.components)
      if (fee === null) {
        paxHasUnpriced = true
        unpricedItemCount += 1
      } else {
        paxFee += fee
      }
      if (basis === 'assumption') usesAssumptions = true

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
  const contributing: Array<{ type: string; record: { id: string; status: RecordStatus; verified_at: string | null; retrieved_at: string | null; source_title: string | null; source_url: string | null } }> = [
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
    usesAssumptions,
    passengerBreakdown,
    assumptionsApplied: assumptions.filter((a) => usedAssumptionIds.has(a.id)),
    dataQuality,
    disclaimer: DISCLAIMER,
    calculatedAt: now.toISOString(),
  }
}
