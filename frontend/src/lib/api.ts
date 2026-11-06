/**
 * Typed PackRight API client.
 *
 * Addresses audit issue P0-06: the previous client only console.error'd on
 * failure, so a temporary Worker or network fault left the interface looking
 * authoritative with no result, no retry and no explanation. Every call here
 * surfaces a classified error the UI can render.
 */

import type { Airline, Benefit, FareFamily, FeeAssumption, RecordStatus } from './data'

export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ??
  (import.meta.env.DEV ? '' : 'https://packright-api.kevynsgrin.workers.dev')

const REQUEST_TIMEOUT_MS = 12_000

export type BagType = 'personal' | 'carry_on' | 'checked'
export type FeeStatus = 'priced' | 'included' | 'waived' | 'prepaid' | 'unpriced' | 'not_accepted'
export type FeeBasis = 'sourced' | 'assumption' | 'traveler' | 'unknown'

export interface Dimensions {
  length: number
  width: number
  height: number
}

export interface BagInput {
  /** The traveler already paid the base bag fee. Excess charges still apply. */
  baseFeePrepaid?: boolean
  type: BagType
  weight: number | null
  dimensions: Dimensions | null
}

export interface CalculationPayload {
  airlineId: string
  fareFamilyId: string
  bookingDate?: string
  passengers: Array<{ id: string; benefitIds: string[]; bags: BagInput[] }>
}

export interface FeeComponent {
  label: string
  amount: number | null
  basis: FeeBasis
  assumptionId?: string
  note?: string
}

export interface BagLine {
  type: BagType
  ordinal: number
  weight: number | null
  dimensions: Dimensions | null
  fee: number | null
  currency: string
  status: FeeStatus
  basis: FeeBasis
  reason: string
  components: FeeComponent[]
  fitsAllowance: boolean | null
  warnings: string[]
}

export interface PassengerLine {
  paxId: string
  paxFee: number
  hasUnpricedItems: boolean
  appliedBenefitIds: string[]
  bags: BagLine[]
}

export interface DataQuality {
  reviewPending: boolean
  reviewIntervalDays: number
  lastVerifiedAt: string | null
  pendingRecords: Array<{ type: string; id: string; status: RecordStatus; verified_at: string | null }>
  sources: Array<{
    type: string
    id: string
    title: string | null
    url: string | null
    scope: string | null
    retrieved_at: string | null
    verified_at: string | null
    status: RecordStatus
  }>
}

export interface CalculationResult {
  apiVersion: string
  currency: string
  totalFee: number
  hasUnpricedItems: boolean
  unpricedItemCount: number
  usesAssumptions: boolean
  passengerBreakdown: PassengerLine[]
  assumptionsApplied: FeeAssumption[]
  dataQuality: DataQuality
  disclaimer: string
  calculatedAt: string
}

export interface ReferenceBundle {
  airlines: Airline[]
  fareFamilies: FareFamily[]
  benefits: Benefit[]
  assumptions: FeeAssumption[]
  retrievedAt: string
}

/** A failure the UI can explain to a person, rather than a raw exception. */
export class ApiClientError extends Error {
  readonly code: string
  readonly status: number | null
  readonly retryable: boolean

  constructor(code: string, message: string, status: number | null, retryable: boolean) {
    super(message)
    this.name = 'ApiClientError'
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

const isAbort = (err: unknown): boolean =>
  err instanceof DOMException ? err.name === 'AbortError' : (err as { name?: string })?.name === 'AbortError'

/** Combines the caller's signal with a timeout, without leaking either. */
function withTimeout(signal?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
    REQUEST_TIMEOUT_MS,
  )
  const onAbort = () => controller.abort(signal?.reason)
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

async function request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const { signal: composed, done } = withTimeout(signal)

  // One try/finally around the whole exchange, not just the fetch. fetch()
  // resolves as soon as the headers arrive, so tearing the timer down there
  // left the body phase completely uncovered: a response that streamed its
  // headers and then stalled would hang until the browser gave up, with the
  // UI stuck in 'loading' and no Retry button.
  try {
    let response: Response
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        signal: composed,
        headers: { Accept: 'application/json', ...(init.headers ?? {}) },
      })
    } catch (err) {
      if (isAbort(err) && signal?.aborted) throw err
      // Timeouts and offline both land here; both are worth retrying.
      throw new ApiClientError('NETWORK', 'We could not reach the PackRight service.', null, true)
    }

    if (!response.ok) {
      let code = 'HTTP_ERROR'
      let message = 'The PackRight service returned an unexpected response.'
      try {
        const body = (await response.json()) as { error?: { code?: string; message?: string } }
        if (body?.error?.code) code = body.error.code
        if (body?.error?.message) message = body.error.message
      } catch {
        // Non-JSON error body. Keep the generic message.
      }
      throw new ApiClientError(code, message, response.status, response.status >= 500 || response.status === 429)
    }

    try {
      return (await response.json()) as T
    } catch (err) {
      if (isAbort(err) && signal?.aborted) throw err
      throw new ApiClientError('BAD_RESPONSE', 'The PackRight service returned a malformed response.', response.status, true)
    }
  } finally {
    done()
  }
}

/**
 * Loads every selector's data.
 *
 * Prefers the single /reference call. Falls back to the three legacy endpoints
 * so the app keeps working during the window where the site is deployed but the
 * Worker has not been updated yet.
 */
export async function fetchReference(signal?: AbortSignal): Promise<ReferenceBundle> {
  try {
    const bundle = await request<ReferenceBundle>('/api/v1/reference', {}, signal)
    // An unseeded or half-migrated database answers 200 with empty arrays. That
    // is not a successful load: it renders an airline picker with nothing in it
    // and no explanation. Treating it as a failure lets Home fall back to the
    // bundled dataset and show the amber "using stored figures" banner, which
    // is both usable and honest.
    if (!Array.isArray(bundle?.airlines) || bundle.airlines.length === 0) {
      throw new ApiClientError('EMPTY_REFERENCE', 'We could not load airline rules.', 200, true)
    }
    if (!Array.isArray(bundle.fareFamilies) || bundle.fareFamilies.length === 0) {
      throw new ApiClientError('EMPTY_REFERENCE', 'We could not load fare rules.', 200, true)
    }
    return { ...bundle, retrievedAt: bundle.retrievedAt ?? new Date().toISOString() }
  } catch (err) {
    if (isAbort(err)) throw err
    if (err instanceof ApiClientError && err.status !== 404) throw err

    const [airlines, fareFamilies, benefits] = await Promise.all([
      request<Airline[]>('/api/airlines', {}, signal),
      request<FareFamily[]>('/api/fare-families', {}, signal),
      request<Benefit[]>('/api/benefits', {}, signal),
    ])
    return { airlines, fareFamilies, benefits, assumptions: [], retrievedAt: new Date().toISOString() }
  }
}

export async function calculateFees(
  payload: CalculationPayload,
  signal?: AbortSignal,
): Promise<CalculationResult> {
  return request<CalculationResult>(
    '/api/v1/calculate-fees',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    signal,
  )
}

/** Retries a retryable failure once, after a short pause. */
export async function withRetry<T>(fn: () => Promise<T>, delayMs = 900): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ApiClientError && err.retryable) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      return fn()
    }
    throw err
  }
}
