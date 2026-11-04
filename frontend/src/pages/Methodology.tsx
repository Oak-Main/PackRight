import { Link } from 'react-router-dom'
import { CalculatorCta, PageHeader, Prose } from '../components/Page'
import { RETRIEVAL_MAX_AGE_DAYS, REVIEW_INTERVAL_DAYS, airlines, isReviewPending } from '../lib/data'
import { CONTACT_EMAIL } from '../lib/seo'
import { LAST_UPDATED } from '../lib/site'

export default function Methodology() {
  // Derived from the dataset rather than written out by hand: a claim that the
  // page makes about its own records has to be true of the records it ships.
  const pendingCount = airlines.filter((a) => isReviewPending(a)).length

  return (
    <>
      <PageHeader
        eyebrow="Methodology"
        title="How PackRight Estimates Airline Baggage Fees"
        lede="PackRight turns your airline, fare, passenger count and bags into an itemised estimate. This page explains exactly what goes into that number, what is left out, and where each figure comes from."
      />

      <Prose>
        <p className="text-white font-medium">
          The airline&rsquo;s booking flow and published contract of carriage control if this
          estimate differs.
        </p>

        <h2 id="what-we-estimate">What PackRight estimates</h2>
        <ul>
          <li>Checked bag fees for the first, second and additional bags on the fare you pick.</li>
          <li>Whether a personal item and a carry-on are included with that fare.</li>
          <li>
            Whether your bag fits the airline&rsquo;s published size allowance. Bags are compared in
            any orientation: both your measurements and the allowance are sorted longest to shortest
            before comparison, so a bag is not called oversized just because you entered its sides in
            a different order.
          </li>
          <li>
            Whether a selected airline credit card waives a bag fee, for the cardholder and up to
            that card&rsquo;s companion limit.
          </li>
          <li>Weight against the airline&rsquo;s published checked-bag limit.</li>
        </ul>

        <h2 id="what-we-do-not-estimate">What we do not estimate</h2>
        <ul>
          <li>
            <strong>Anything we cannot source.</strong> If PackRight has no sourced fee for a bag, it
            says <strong>Not priced</strong> and leaves it out of the total rather than guessing.
            Your real cost will be higher than a total that contains unpriced items.
          </li>
          <li>
            <strong>Dynamic pricing.</strong> Some airlines price bags by route, by fare and by when
            you buy them. A single figure cannot represent that, and we say so on those records.
          </li>
          <li>
            <strong>Elite status.</strong> Only credit-card benefits are modelled. Status is a
            separate eligibility system with its own tiers and itinerary rules, and mixing the two
            into one control would be misleading.
          </li>
          <li>
            International itineraries, interline and codeshare bags, military and mobility
            exemptions, sports and musical equipment, pets, and lounge or bundled fare products.
          </li>
          <li>Taxes, currency conversion, and any airport-specific charge.</li>
        </ul>

        <h2 id="sources">Airline policy sources</h2>
        <p>
          Every airline, fare and card record carries the URL of the policy page it came from, the
          scope it applies to, its status, and the date a reviewer last checked it. Those details
          appear next to the figures on each{' '}
          <Link to="/airlines">airline page</Link> and under every estimate.
        </p>
        <p>
          Numbers that no airline publishes as a single figure are handled separately. They are
          stored as named <strong>assumptions</strong>, shown with an &ldquo;Assumption&rdquo; badge,
          and listed under the estimate that used them. An assumption is a planning aid, never a
          quoted price.
        </p>

        <h2 id="card-benefits">How card benefits are applied</h2>
        <p>
          Selecting a card applies its waivers to the first passenger, then to as many further
          passengers as that card&rsquo;s companion limit allows, in itinerary order. A card that
          waives only the first checked bag does not waive the second. Card terms are set by the
          issuer, change without notice, and usually require the fare to be booked on that card.
          Confirm eligibility with your issuer.
        </p>

        <h2 id="when-fees-differ">When fees can differ</h2>
        <ul>
          <li>You buy the bag at the airport rather than during booking.</li>
          <li>Your itinerary includes a partner or international segment.</li>
          <li>The aircraft or route has a smaller bin or a different allowance.</li>
          <li>The airline changed its policy after our last review.</li>
          <li>Your bag is measured with wheels and handles included, and ours was not.</li>
        </ul>

        <h2 id="review-cadence">How often we review data</h2>
        <p>
          Records are due for review every {REVIEW_INTERVAL_DAYS} days, and every airline&rsquo;s
          source page is re-read at least every {RETRIEVAL_MAX_AGE_DAYS} days. A record that has never
          been verified, or whose check is older than the review interval, is labelled{' '}
          <strong>Review pending</strong> wherever it appears, and any estimate built on it carries
          the same label. We do not make savings claims from a record in that state.
        </p>
        <p>
          PackRight currently models {airlines.length} airlines.{' '}
          <strong>
            {pendingCount === 0
              ? 'Every airline record has been checked against the airline source listed beside it, and the date that page was read is shown with it.'
              : `${pendingCount} of ${airlines.length} airline records are still marked “Review pending”: they have not been checked against the airline sources listed beside them.`}
          </strong>{' '}
          Treat the tool as a planning guide, and check the source page if your airline has changed
          its policy.
        </p>

        <h2 id="report-an-error">How to report an error</h2>
        <p>
          If a figure here does not match what your airline shows, we want to know. Email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with the airline, the fare, what
          PackRight showed and what the airline showed, and a link if you have one. Corrections are
          recorded with the source and the date of the change.
        </p>

        <p className="text-sm">Last updated {LAST_UPDATED}.</p>
      </Prose>

      <CalculatorCta />
    </>
  )
}
