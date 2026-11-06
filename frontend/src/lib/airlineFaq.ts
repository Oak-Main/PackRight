/**
 * Question and answer text for airline pages.
 *
 * Shared by the page (which renders these visibly) and by the FAQPage schema in
 * seo.ts, so the structured data can never describe questions a reader cannot
 * see. The audit was explicit: do not manufacture an FAQ schema block without
 * visible questions and answers.
 *
 * All wording is original and generated from PackRight's own data. No airline
 * policy text is reproduced.
 */

import type { Airline } from './data'
import { faresForAirline, isReviewPending } from './data'
import { formatDimensions, formatDate, formatMoney } from './format'

export interface FaqEntry {
  question: string
  answer: string
}


/** Says which fares include a personal item, from the data rather than by assertion. */
function personalItemClause(airline: Airline): string {
  const fares = faresForAirline(airline.id)
  if (fares.length === 0) return ''
  const included = fares.filter((f) => f.includes_personal_item)
  if (included.length === fares.length) {
    return `Every fare family PackRight models for ${airline.name} includes a personal item. `
  }
  if (included.length === 0) {
    return `No fare family PackRight models for ${airline.name} includes a personal item. `
  }
  return (
    `${included.length} of the ${fares.length} fare families PackRight models for ` +
    `${airline.name} include a personal item. `
  )
}

export function airlineFaqs(airline: Airline): FaqEntry[] {
  const entries: FaqEntry[] = []

  // Derived from the record, not hard-coded. A fixed "not yet checked" sentence
  // is right today -- every record is unverified -- but it would keep saying so
  // after a steward verified the record, contradicting the badge next to it.
  const provenance = (record: Airline): string =>
    isReviewPending(record)
      ? 'This figure has not yet been checked against the airline source, so confirm it before you travel.'
      : `PackRight last checked this against the airline's own page on ${formatDate(record.verified_at)}. ` +
        'Airlines can change a policy at any time, so confirm it before you travel.'

  const unverified = provenance(airline)

  const carryOn = formatDimensions(
    airline.carry_on_length,
    airline.carry_on_width,
    airline.carry_on_height,
  )
  if (carryOn) {
    entries.push({
      question: `What size carry-on does ${airline.name} allow?`,
      answer:
        `PackRight models ${airline.name}'s carry-on allowance as ${carryOn}. A bag fits if its ` +
        `three sides are within those three measurements in any order, so it does not matter which ` +
        `side you call the length. Measure with wheels and handles included. ${unverified}`,
    })
  }

  const personal = formatDimensions(
    airline.personal_item_length,
    airline.personal_item_width,
    airline.personal_item_height,
  )
  if (personal) {
    entries.push({
      question: `What counts as a personal item on ${airline.name}?`,
      answer:
        `A personal item is the smaller bag that goes under the seat in front of you. PackRight ` +
        `models ${airline.name}'s limit as ${personal}. ` +
        personalItemClause(airline) +
        unverified,
    })
  }

  const fares = faresForAirline(airline.id)
  if (fares.length) {
    const prices = fares.map(fare => {
      const fee = fare.first_checked_fee
      const price = fee === null ? 'check your itinerary' : fee === 0 ? 'included' : formatMoney(fee, fare.currency)
      return `${fare.name}: ${price}`
    })
    entries.push({
      question: `How much is a checked bag on ${airline.name}?`,
      answer: `First checked bag, one way per passenger. ${prices.join('. ')}. See the route and conditions for each fare above.`,
    })
    const withCarryOn = fares.filter(f => f.includes_carry_on).map(f => f.name)
    const without = fares.filter(f => !f.includes_carry_on).map(f => f.name)
    const parts = []
    if (withCarryOn.length) parts.push(`Includes one carry-on: ${withCarryOn.join(', ')}.`)
    if (without.length) parts.push(`Outside the standard carry-on allowance: ${without.join(', ')}. Check your fare for add-on or checked-bag options.`)
    entries.push({ question: `Does a carry-on cost money on ${airline.name}?`, answer: parts.join(' ') })
  }

  if (airline.checked_bag_weight != null) {
    entries.push({
      question: `How heavy can a checked bag be on ${airline.name}?`,
      answer:
        `PackRight models ${airline.name}'s standard checked-bag weight limit as ` +
        `${airline.checked_bag_weight} lb` +
        (airline.checked_bag_linear_dim != null
          ? `, with a total of length plus width plus height up to ${airline.checked_bag_linear_dim} inches`
          : '. PackRight has no published size limit recorded for this airline') +
        `. ${fares.filter(f => f.included_checked_weight).map(f => `${f.name} allows ${f.included_checked_weight} lb per included checked bag. `).join('')}${unverified}`,
    })
  }

  return entries
}
