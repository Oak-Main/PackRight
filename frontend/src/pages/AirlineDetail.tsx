import { Link, useParams } from 'react-router-dom'
import { CalculatorCta, PageHeader, Prose } from '../components/Page'
import { ProvenanceNote, ReviewPendingBanner, StatusBadge } from '../components/Provenance'
import NotFound from './NotFound'
import { airlineBySlug, benefitsForAirline, faresForAirline, isReviewPending } from '../lib/data'
import { airlineFaqs } from '../lib/airlineFaq'
import { formatDimensions, formatMoney, formatWeight } from '../lib/format'

export default function AirlineDetail() {
  const { slug } = useParams<{ slug: string }>()
  const airline = slug ? airlineBySlug(slug) : undefined

  if (!airline) return <NotFound />

  const fares = faresForAirline(airline.id)
  const benefits = benefitsForAirline(airline.id)
  const faqs = airlineFaqs(airline)
  const pending = isReviewPending(airline) || fares.some(isReviewPending)

  const fee = (value: number | null) =>
    value === null ? <span className="text-amber-300">Not published</span> : formatMoney(value)

  return (
    <>
      <PageHeader
        eyebrow={`${airline.name} (${airline.iata_code})`}
        title={`${airline.name} Baggage Fees and Carry-On Limits`}
        lede={`The size, weight and fee figures PackRight uses for ${airline.name}, what each fare family includes, and where every number comes from.`}
      />

      {pending ? (
        <div className="mb-8 max-w-3xl">
          <ReviewPendingBanner />
        </div>
      ) : null}

      <section aria-labelledby="limits-heading" className="mb-10">
        <h2 id="limits-heading" className="text-2xl font-semibold text-white mb-4">
          Bag size and weight limits
        </h2>
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-sm min-w-[560px]">
            <caption className="sr-only">{airline.name} bag size and weight limits</caption>
            <thead className="bg-premium-800/80 text-left">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold text-white">Bag</th>
                <th scope="col" className="px-4 py-3 font-semibold text-white">Maximum size</th>
                <th scope="col" className="px-4 py-3 font-semibold text-white">Maximum weight</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-white/5">
                <th scope="row" className="px-4 py-3 text-white text-left font-medium">Personal item</th>
                <td className="px-4 py-3 text-text-muted">
                  {formatDimensions(
                    airline.personal_item_length,
                    airline.personal_item_width,
                    airline.personal_item_height,
                  ) ?? 'Not published'}
                </td>
                <td className="px-4 py-3 text-text-muted">Not published</td>
              </tr>
              <tr className="border-t border-white/5">
                <th scope="row" className="px-4 py-3 text-white text-left font-medium">Carry-on</th>
                <td className="px-4 py-3 text-text-muted">
                  {formatDimensions(
                    airline.carry_on_length,
                    airline.carry_on_width,
                    airline.carry_on_height,
                  ) ?? 'Not published'}
                </td>
                <td className="px-4 py-3 text-text-muted">{formatWeight(airline.carry_on_weight)}</td>
              </tr>
              <tr className="border-t border-white/5">
                <th scope="row" className="px-4 py-3 text-white text-left font-medium">Checked bag</th>
                <td className="px-4 py-3 text-text-muted">
                  {airline.checked_bag_linear_dim != null
                    ? `${airline.checked_bag_linear_dim} in total (length + width + height)`
                    : 'Not published'}
                </td>
                <td className="px-4 py-3 text-text-muted">{formatWeight(airline.checked_bag_weight)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <ProvenanceNote record={airline} />
        </div>
      </section>

      <section aria-labelledby="fares-heading" className="mb-10">
        <h2 id="fares-heading" className="text-2xl font-semibold text-white mb-4">
          What each fare includes
        </h2>
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-sm min-w-[680px]">
            <caption className="sr-only">{airline.name} fare families and checked bag fees</caption>
            <thead className="bg-premium-800/80 text-left">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold text-white">Fare</th>
                <th scope="col" className="px-4 py-3 font-semibold text-white">Personal item</th>
                <th scope="col" className="px-4 py-3 font-semibold text-white">Carry-on</th>
                <th scope="col" className="px-4 py-3 font-semibold text-white">First checked</th>
                <th scope="col" className="px-4 py-3 font-semibold text-white">Second checked</th>
              </tr>
            </thead>
            <tbody>
              {fares.map((fare) => (
                <tr key={fare.id} className="border-t border-white/5">
                  <th scope="row" className="px-4 py-3 text-white text-left font-medium">
                    {fare.name}
                    <span className="block mt-1">
                      <StatusBadge status={fare.status} verifiedAt={fare.verified_at} />
                    </span>
                  </th>
                  <td className="px-4 py-3 text-text-muted">
                    {fare.includes_personal_item ? 'Included' : 'Not included'}
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {fare.includes_carry_on ? 'Included' : 'Not included'}
                  </td>
                  <td className="px-4 py-3 text-text-muted">{fee(fare.first_checked_fee)}</td>
                  <td className="px-4 py-3 text-text-muted">{fee(fare.second_checked_fee)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Scope: {fares[0]?.scope ?? 'the published airline policy'}. Where a figure is marked{' '}
          <span className="text-amber-300">Not published</span>, PackRight has no sourced number and
          will not guess one.
        </p>
        {fares[0] ? (
          <div className="mt-2">
            <ProvenanceNote record={fares[0]} />
          </div>
        ) : null}
      </section>

      {benefits.length > 0 ? (
        <section aria-labelledby="benefits-heading" className="mb-10">
          <h2 id="benefits-heading" className="text-2xl font-semibold text-white mb-4">
            Card benefits PackRight models
          </h2>
          <ul className="space-y-3 list-none">
            {benefits.map((benefit) => (
              <li key={benefit.id} className="rounded-xl border border-white/10 bg-premium-900/40 p-4">
                <p className="text-white font-medium">{benefit.name}</p>
                <ul className="mt-2 text-sm text-text-muted space-y-1 list-disc pl-5">
                  <li>
                    {benefit.waives_first_checked ? 'Waives the first checked bag' : 'Does not waive a checked bag'}
                    {benefit.waives_second_checked ? ' and the second checked bag' : ''}
                    {benefit.waives_carry_on ? '. Also waives a carry-on where the fare excludes one' : ''}
                    .
                  </li>
                  <li>
                    Applies to the cardholder plus up to {benefit.companion_limit} companion
                    {benefit.companion_limit === 1 ? '' : 's'} on the same reservation.
                  </li>
                  <li>{benefit.scope ?? 'Scope not recorded'}.</li>
                </ul>
                <p className="mt-2 text-xs text-text-muted">
                  Card terms are set by the issuer, not the airline, and change without notice. Annual
                  fees and eligibility conditions apply. Confirm with your issuer before you rely on a
                  waiver.
                </p>
                <div className="mt-2">
                  <ProvenanceNote record={benefit} />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-text-muted">
            Elite status is not modelled. It is a separate eligibility system and is kept out of this
            list rather than blended into it.
          </p>
        </section>
      ) : null}

      <section aria-labelledby="example-heading" className="mb-10 max-w-3xl">
        <h2 id="example-heading" className="text-2xl font-semibold text-white mb-4">
          A worked example
        </h2>
        <Prose>
          <p>
            Say two people fly {airline.name} on {fares[0]?.name ?? 'a standard fare'} with one checked
            bag each, no card benefit.{' '}
            {fares[0]?.first_checked_fee != null ? (
              <>
                PackRight estimates {formatMoney(fares[0].first_checked_fee)} per bag, so{' '}
                {formatMoney(fares[0].first_checked_fee * 2)} for the pair, one way.
              </>
            ) : (
              <>
                PackRight has no sourced first-checked-bag fee for that fare, so it reports the bags as
                not priced rather than inventing a figure.
              </>
            )}{' '}
            This is an example of how the calculator works, not a price guarantee.
          </p>
        </Prose>
      </section>

      {faqs.length > 0 ? (
        <section aria-labelledby="faq-heading" className="mb-10 max-w-3xl">
          <h2 id="faq-heading" className="text-2xl font-semibold text-white mb-4">
            Common questions
          </h2>
          <dl className="prose-pr">
            {faqs.map((entry) => (
              <div key={entry.question}>
                <dt>{entry.question}</dt>
                <dd>{entry.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <Prose>
        <p>
          Compare this airline against the others in the{' '}
          <Link to="/airlines">airline table</Link>, check a specific bag in the{' '}
          <Link to="/carry-on-size-checker">size checker</Link>, or read{' '}
          <Link to="/methodology">how these figures are produced</Link>.
        </p>
      </Prose>

      <CalculatorCta label={`Estimate my ${airline.name} baggage fees`} />
    </>
  )
}
