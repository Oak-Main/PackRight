import { Lightbulb } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { CalculationResult } from '../lib/api'
import type { Airline } from '../lib/data'

interface Props {
  result: CalculationResult | null
  airline: Airline | undefined
}

/**
 * Contextual, non-commercial guidance shown beside a result.
 *
 * Audit issue P0-05: this slot previously held Travelpro, Samsonite and LugLess
 * cards whose links were all href="#", with no destination, no rel policy, no
 * disclosure and no measurement. No partner agreement exists, so the cards are
 * gone. What replaces them is editorial only and links to PackRight's own
 * pages. Nothing commercial ships here until there is a real destination and a
 * disclosure next to it, per /affiliate-disclosure.
 */
export default function FeeAvoidanceTips({ result, airline }: Props) {
  // Same shape guard FeeMatrix applies. Without it an unexpected 200 body threw
  // inside render and, with no error boundary above it, blanked the whole page.
  if (!result || !Array.isArray(result.passengerBreakdown)) return null

  const bags = result.passengerBreakdown.flatMap((p) => (Array.isArray(p?.bags) ? p.bags : []))
  const tips: Array<{ id: string; text: React.ReactNode }> = []

  const unpricedCarryOn = bags.some((b) => b.type === 'carry_on' && b.status === 'unpriced' && b.components.some(c => c.label === 'Carry-on bag'))
  const paidChecked = bags.some((b) => b.type === 'checked' && (b.fee ?? 0) > 0)
  const oversized = bags.some((b) => b.fitsAllowance === false)
  const unmeasured = bags.some((b) => b.fitsAllowance === null)

  if (unpricedCarryOn) {
    tips.push({
      id: 'carry-on',
      text: (
        <>
          Check your booking for the carry-on allowance and any add-on price.
          A personal item is still included, so check whether your things fit that instead. See{' '}
          <Link to="/personal-item-size-comparison">personal item size limits by airline</Link>.
        </>
      ),
    })
  }

  if (paidChecked && airline) {
    tips.push({
      id: 'checked',
      text: (
        <>
          Some airline credit cards waive the first checked bag for the cardholder and a limited
          number of companions. PackRight models the cards it has data for on the{' '}
          <Link to={`/airlines/${airline.slug}/baggage-fees`}>{airline.name} page</Link>, with
          eligibility caveats.
        </>
      ),
    })
  }

  if (oversized) {
    tips.push({
      id: 'oversized',
      text: (
        <>
          One of your bags is over the published allowance. Check it against every airline in the{' '}
          <Link to="/carry-on-size-checker">carry-on size checker</Link> before you fly.
        </>
      ),
    })
  }

  if (unmeasured) {
    tips.push({
      id: 'measure',
      text: (
        <>
          Add your bag measurements above and PackRight will check them against this
          airline&rsquo;s published allowance in any orientation.
        </>
      ),
    })
  }

  if (tips.length === 0) return null

  return (
    <section className="glass-panel p-6" aria-labelledby="fee-tips-heading">
      <div className="flex items-center gap-3 mb-4">
        <span className="p-2 bg-premium-700 rounded-lg">
          <Lightbulb className="w-5 h-5 text-accent-secondary" aria-hidden="true" />
        </span>
        <h2 id="fee-tips-heading" className="text-xl font-semibold">
          Ways to bring this down
        </h2>
      </div>

      <ul className="space-y-3 prose-pr">
        {tips.map((tip) => (
          <li key={tip.id} className="text-sm">
            {tip.text}
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-text-muted">
        These are PackRight&rsquo;s own suggestions. There are no paid placements on this page. See our{' '}
        <Link to="/affiliate-disclosure" className="underline underline-offset-2 hover:text-white">
          affiliate disclosure
        </Link>
        .
      </p>
    </section>
  )
}
