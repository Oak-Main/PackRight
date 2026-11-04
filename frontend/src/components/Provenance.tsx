import { AlertTriangle, CheckCircle2, ExternalLink, Info } from 'lucide-react'
import { formatDate, formatTimestamp } from '../lib/format'
import { REVIEW_INTERVAL_DAYS, isReviewPending } from '../lib/data'
import type { RecordStatus } from '../lib/data'

interface SourceLike {
  source_url?: string | null
  source_title?: string | null
  verified_at?: string | null
  retrieved_at?: string | null
  status?: RecordStatus
  scope?: string | null
}

/**
 * Shows where a figure came from and when it was last checked.
 *
 * Audit issue P0-07 required every displayed fee or limit to carry a source and
 * a verified date, and results backed by an unverified or stale record to be
 * labelled "Review pending" rather than presented as confirmed.
 */
export function StatusBadge({ status, verifiedAt }: { status?: RecordStatus; verifiedAt?: string | null }) {
  // A record whose check has aged past the review interval is NOT verified any
  // more. Showing a green badge for a two-year-old check would contradict the
  // promise the methodology page makes about the review cadence.
  const verified =
    status === 'verified' && !!verifiedAt && !isReviewPending({ status, verified_at: verifiedAt })

  if (verified) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-300 border border-green-500/25">
        <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
        Verified {formatDate(verifiedAt)}
      </span>
    )
  }

  if (status === 'assumption') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300 border border-amber-500/25">
        <Info className="w-3 h-3" aria-hidden="true" />
        Assumption
      </span>
    )
  }

  const expired = status === 'verified' && !!verifiedAt
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300 border border-amber-500/25"
      title={
        expired
          ? `Last checked ${formatDate(verifiedAt)}, more than ${REVIEW_INTERVAL_DAYS} days ago.`
          : undefined
      }
    >
      <AlertTriangle className="w-3 h-3" aria-hidden="true" />
      {expired ? `Review due (checked ${formatDate(verifiedAt)})` : 'Review pending'}
    </span>
  )
}

export function SourceLink({ record }: { record: SourceLike }) {
  if (!record.source_url) return null
  return (
    <a
      href={record.source_url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex items-center gap-1 text-accent-secondary hover:text-white underline underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
    >
      {record.source_title ?? 'Airline policy'}
      <ExternalLink className="w-3 h-3" aria-hidden="true" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

export function ProvenanceNote({ record, className = '' }: { record: SourceLike; className?: string }) {
  const retrieved = formatTimestamp(record.retrieved_at)
  return (
    <p className={`text-xs text-text-muted flex flex-wrap items-center gap-x-2 gap-y-1 ${className}`}>
      <StatusBadge status={record.status} verifiedAt={record.verified_at} />
      {record.source_url ? (
        <span className="inline-flex items-center gap-1">
          Source: <SourceLink record={record} />
        </span>
      ) : (
        <span>No source recorded.</span>
      )}
      {retrieved ? <span>Retrieved {retrieved}.</span> : null}
      {record.scope ? <span>Scope: {record.scope}.</span> : null}
    </p>
  )
}

/**
 * The banner shown above any estimate built on unverified or stale records.
 * Deliberately blunt: the numbers below have not been confirmed against source.
 */
export function ReviewPendingBanner({ reviewIntervalDays = 30 }: { reviewIntervalDays?: number }) {
  return (
    <div
      className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex gap-3"
      role="note"
      aria-label="Data review status"
    >
      <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="text-sm text-amber-100/90 space-y-1">
        <p className="font-medium text-amber-200">Review pending</p>
        <p>
          At least one figure behind this estimate has not been checked against its airline source, or
          was last checked more than {reviewIntervalDays} days ago. Treat it as a planning guide, not a
          price.{' '}
          <a
            href="/methodology"
            className="underline underline-offset-2 hover:text-white rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            How we calculate this estimate
          </a>
          .
        </p>
      </div>
    </div>
  )
}
