import { Briefcase, Info, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { BagLine, CalculationResult } from '../lib/api'
import { formatDate, formatDimensions, formatMoney } from '../lib/format'
import { ProvenanceNote, ReviewPendingBanner, StatusBadge } from './Provenance'
import { BIN_LABELS } from '../lib/bins'

function BagRow({ bag }: { bag: BagLine }) {
  const dims = formatDimensions(
    bag.dimensions?.length,
    bag.dimensions?.width,
    bag.dimensions?.height,
  )

  return (
    <li className="py-3 first:pt-0 last:pb-0 border-b border-white/5 last:border-0">
      <div className="flex justify-between items-start gap-4">
        <div className="min-w-0">
          <p className="text-white">
            {BIN_LABELS[bag.type]}
            {bag.ordinal > 1 ? ` ${bag.ordinal}` : ''}
          </p>
          <p className="text-xs text-text-muted">
            {bag.weight != null ? `${bag.weight} lb` : 'Weight not entered'}
            {dims ? ` · ${dims}` : ' · Size not entered'}
          </p>
        </div>

        <div className="text-right shrink-0">
          {bag.fee === null ? (
            <span className="text-amber-300 font-medium text-sm">{bag.status === 'not_accepted' ? 'Not accepted' : 'Not priced'}</span>
          ) : (
            <span className={bag.fee === 0 ? 'text-green-400 font-medium' : 'text-white font-medium'}>
              {formatMoney(bag.fee, bag.currency)}
            </span>
          )}
          <p className="text-xs text-text-muted mt-0.5 max-w-[190px] leading-tight">{bag.reason}</p>
        </div>
      </div>

      {bag.components.length > 0 ? (
        <ul className="mt-2 space-y-1 list-none">
          {bag.components.map((component, i) => (
            <li key={i} className="flex justify-between items-start gap-3 text-xs">
              <span className="text-text-muted">
                {component.label}
                {component.basis === 'assumption' ? (
                  <span className="ml-2 align-middle">
                    <StatusBadge status="assumption" />
                  </span>
                ) : null}
                {component.note ? (
                  <span className="block mt-0.5 max-w-prose">{component.note}</span>
                ) : null}
              </span>
              <span className="text-text-muted shrink-0">
                {component.amount === null ? '—' : formatMoney(component.amount, bag.currency)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {bag.warnings.length > 0 ? (
        <ul className="mt-2 space-y-1 list-none">
          {bag.warnings.map((warning, i) => (
            <li key={i} className="flex gap-2 text-xs text-amber-200/90">
              <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" aria-hidden="true" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export default function FeeMatrix({ result }: { result: CalculationResult | null }) {
  if (!result || !Array.isArray(result.passengerBreakdown)) {
    return (
      <div className="glass-panel p-6 flex items-center justify-center min-h-[300px] text-text-muted">
        <div className="text-center max-w-sm">
          <Briefcase className="w-8 h-8 mx-auto mb-3 opacity-50" aria-hidden="true" />
          <p>Choose your airline and fare to see an itemised baggage fee estimate.</p>
        </div>
      </div>
    )
  }

  const verifiedOn = formatDate(result.dataQuality?.lastVerifiedAt)

  return (
    <div className="glass-panel p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <span className="p-2 bg-premium-700 rounded-lg">
            <Briefcase className="w-5 h-5 text-accent-primary" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-xl font-semibold">Baggage Fee Estimate</h2>
            <p className="text-xs text-text-muted">
              {verifiedOn ? `Data last verified: ${verifiedOn}` : 'Data last verified: not yet verified'}
            </p>
          </div>
        </div>

        <div className="text-right">
          <p className="text-sm text-text-muted">{result.hasUnpricedItems ? 'Fully priced bags only' : 'Estimated additional fees'}</p>
          <p className="text-3xl font-bold text-white">
            {result.hasUnpricedItems && result.totalFee === 0 ? 'Total unavailable' : formatMoney(result.totalFee, result.currency)}
          </p>
          {result.hasUnpricedItems ? (
            <p className="text-xs text-amber-300 mt-1 max-w-[220px]">
              {result.unpricedItemCount} item
              {result.unpricedItemCount === 1 ? '' : 's'} excluded
            </p>
          ) : null}
        </div>
      </div>

      {result.dataQuality?.reviewPending ? (
        <div className="mb-6">
          <ReviewPendingBanner reviewIntervalDays={result.dataQuality.reviewIntervalDays} />
        </div>
      ) : null}

      <div className="space-y-4">
        {result.passengerBreakdown.map((pax, index) => (
          <div key={pax.paxId ?? index} className="bg-premium-700/50 rounded-xl p-4 border border-white/5">
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-white/10">
              <h3 className="font-medium text-white">Passenger {index + 1}</h3>
              <div className="text-right">
                <span className="text-lg font-bold">{pax.hasUnpricedItems && pax.paxFee === 0 ? 'Incomplete' : formatMoney(pax.paxFee, result.currency)}</span>
                {pax.hasUnpricedItems ? (
                  <p className="text-[11px] text-amber-300">plus unpriced items</p>
                ) : null}
              </div>
            </div>

            {pax.bags.length === 0 ? (
              <p className="text-sm text-text-muted">No bags added for this passenger.</p>
            ) : (
              <ul className="list-none">
                {pax.bags.map((bag, i) => (
                  <BagRow key={`${bag.type}-${bag.ordinal}-${i}`} bag={bag} />
                ))}
              </ul>
            )}
          </div>
        ))}

        {result.hasUnpricedItems ? (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 flex gap-3">
            <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-amber-100/90">
              The subtotal covers fully priced bags only. A known surcharge on a partly priced bag is shown
              in its breakdown. Check your booking for missing prices or repack a bag outside the acceptance limits.
            </p>
          </div>
        ) : null}

        {result.assumptionsApplied?.length ? (
          <div className="rounded-xl border border-white/10 bg-premium-900/40 p-4">
            <h3 className="text-sm font-semibold text-white mb-2">Assumptions used in this estimate</h3>
            <ul className="space-y-2 list-none">
              {result.assumptionsApplied.map((assumption) => (
                <li key={assumption.id} className="text-xs text-text-muted">
                  <span className="text-white">{assumption.label}</span>{' '}
                  <span>({formatMoney(assumption.amount, assumption.currency)})</span>
                  {assumption.change_note ? <p className="mt-0.5">{assumption.change_note}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {result.dataQuality?.sources?.length ? (
          <div className="rounded-xl border border-white/10 bg-premium-900/40 p-4">
            <h3 className="text-sm font-semibold text-white mb-2">Sources behind this estimate</h3>
            <ul className="space-y-2 list-none">
              {result.dataQuality.sources.map((source) => (
                <li key={`${source.type}-${source.id}`}>
                  <ProvenanceNote
                    record={{
                      source_url: source.url,
                      source_title: source.title,
                      verified_at: source.verified_at,
                      retrieved_at: source.retrieved_at,
                      scope: source.scope,
                      // The API's real status. Deriving it from the date badged
                      // never-verified records as "Verified".
                      status: source.status ?? 'unverified',
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/*
          Audit issue P0-03. This card previously read: "Based on DOT rule
          2026-13450, gate penalties for oversized items are strictly enforced."
          That rule concerns disclosure of airline ancillary fees and does not
          support a gate-enforcement claim, so the citation is gone and the
          replacement makes no regulatory assertion at all.
        */}
        <div className="bg-accent-primary/10 border border-accent-primary/20 rounded-xl p-4 flex gap-3">
          <Info className="w-5 h-5 text-accent-primary shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-violet-200">
            {result.disclaimer ??
              'Airline size, weight, and fee rules can change without notice. PackRight provides an estimate based on the sources and assumptions shown here; confirm your allowance and final price with the airline before travel.'}{' '}
            <Link to="/methodology" className="underline underline-offset-2 hover:text-white">
              How we calculate this estimate
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  )
}
