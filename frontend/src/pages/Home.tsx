import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, RefreshCw, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'

import ExtraCheckedBags from '../components/ExtraCheckedBags'
import FeeMatrix from '../components/FeeMatrix'
import FeeAvoidanceTips from '../components/FeeAvoidanceTips'
import KnapsackAllocator from '../components/KnapsackAllocator'
import { BIN_LABELS, BIN_ORDER, binTotalWeight, toCheckedBag } from '../lib/bins'
import type { BinDimensions, Bins, ExtraBag } from '../lib/bins'
import { ApiClientError, calculateFees, fetchReference, withRetry } from '../lib/api'
import type { BagInput, BagType, CalculationPayload, CalculationResult, ReferenceBundle } from '../lib/api'
import {
  airlines as staticAirlines,
  benefits as staticBenefits,
  fareFamilies as staticFares,
  assumptions as staticAssumptions,
  DATASET_VERSION,
} from '../lib/data'
import { formatDimensions, formatMoney } from '../lib/format'

type ReferenceStatus = 'loading' | 'ready' | 'fallback' | 'error'
type CalcStatus = 'idle' | 'loading' | 'ready' | 'error'

const emptyDimensions = (): BinDimensions => ({ length: null, width: null, height: null })

const INITIAL_BINS: Bins = {
  personal: {
    items: [{ id: 'i1', name: 'Laptop', spokenName: 'Laptop', weight: 5, tsa: 'safe' }],
    dimensions: emptyDimensions(),
    emptyWeight: null,
  },
  carry_on: {
    items: [
      { id: 'i2', name: 'Weekend clothes', spokenName: 'Weekend clothes', weight: 15, tsa: 'safe' },
      {
        id: 'i3',
        name: 'Shampoo >3.4oz',
        spokenName: 'Shampoo over 3.4 ounces',
        weight: 2,
        tsa: 'checked_only',
      },
    ],
    dimensions: emptyDimensions(),
    emptyWeight: null,
  },
  checked: { items: [], dimensions: emptyDimensions(), emptyWeight: null },
}

/** Reference data bundled at build time, used when the live service is unreachable. */
const STATIC_BUNDLE: ReferenceBundle = {
  airlines: staticAirlines,
  fareFamilies: staticFares,
  benefits: staticBenefits,
  assumptions: staticAssumptions,
  retrievedAt: '',
}

const hasDimensions = (d: BinDimensions): boolean =>
  d.length != null && d.width != null && d.height != null

export default function Home() {
  const [reference, setReference] = useState<ReferenceBundle>(STATIC_BUNDLE)
  const [referenceStatus, setReferenceStatus] = useState<ReferenceStatus>('loading')
  const [referenceError, setReferenceError] = useState<string | null>(null)
  const [referenceAttempt, setReferenceAttempt] = useState(0)

  const [airlineId, setAirlineId] = useState('aa')
  const [fareFamilyId, setFareFamilyId] = useState('')
  const [bookingDate, setBookingDate] = useState('')
  const [prepaid, setPrepaid] = useState({ carry_on: false, checked: false })
  const [extraBags, setExtraBags] = useState<ExtraBag[]>([])
  const [passengersCount, setPassengersCount] = useState(1)
  const [benefitId, setBenefitId] = useState('')
  const [bins, setBins] = useState<Bins>(INITIAL_BINS)

  const [result, setResult] = useState<CalculationResult | null>(null)
  /** The input signature the current result was produced from. */
  const [resultKey, setResultKey] = useState<string | null>(null)
  const [calcStatus, setCalcStatus] = useState<CalcStatus>('idle')
  const [calcError, setCalcError] = useState<{ message: string; retryable: boolean } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [calcAttempt, setCalcAttempt] = useState(0)

  const calcAbortRef = useRef<AbortController | null>(null)

  /* ---------------- Reference data ---------------- */

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    setReferenceStatus('loading')
    setReferenceError(null)

    withRetry(() => fetchReference(controller.signal))
      .then((bundle) => {
        if (cancelled) return
        setReference({
          ...bundle,
          assumptions: bundle.assumptions?.length ? bundle.assumptions : staticAssumptions,
        })
        setReferenceStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted) return
        const message =
          err instanceof ApiClientError
            ? err.message
            : 'We could not refresh airline rules right now.'
        // Keep the app usable on the build-time snapshot rather than showing an
        // empty form, and say plainly that this is what happened.
        setReference(STATIC_BUNDLE)
        setReferenceError(message)
        setReferenceStatus('fallback')
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [referenceAttempt])

  const airline = useMemo(
    () => reference.airlines.find((a) => a.id === airlineId),
    [reference.airlines, airlineId],
  )

  const filteredFares = useMemo(
    () => reference.fareFamilies.filter((f) => f.airline_id === airlineId),
    [reference.fareFamilies, airlineId],
  )

  const selectedFare = filteredFares.find(f => f.id === fareFamilyId)
  const bookingDateApplies = airline?.overweight_fees?.some(band => band.booking_change) ?? false
  const filteredBenefits = useMemo(
    () => reference.benefits.filter((b) => b.airline_id === airlineId),
    [reference.benefits, airlineId],
  )

  // Keep the fare selection valid for the chosen airline at all times. The
  // previous build cleared it and then bailed out of the calculation, leaving
  // the last airline's result on screen next to the new airline's name.
  useEffect(() => {
    if (filteredFares.length === 0) return
    if (!filteredFares.some((f) => f.id === fareFamilyId)) {
      const first = staticFares.find(f => filteredFares.some(available => available.id === f.id))
      setFareFamilyId(first?.id ?? filteredFares[0].id)
    }
  }, [filteredFares, fareFamilyId])

  /* ---------------- Payload ---------------- */

  const bags = useMemo<BagInput[]>(() => {
    const out: BagInput[] = []
    for (const type of BIN_ORDER) {
      const bin = bins[type]
      // A measured empty suitcase is still a bag.
      if (!bin.items.length && bin.emptyWeight == null && !hasDimensions(bin.dimensions)) continue
      out.push({
        type,
        weight: bin.items.length || bin.emptyWeight != null ? binTotalWeight(bin) : null,
        ...(type !== 'personal' && prepaid[type] && { baseFeePrepaid: true }),
        dimensions: hasDimensions(bin.dimensions)
          ? {
              length: bin.dimensions.length as number,
              width: bin.dimensions.width as number,
              height: bin.dimensions.height as number,
            }
          : null,
      })
    }
    return [...out, ...extraBags.map(toCheckedBag)]
  }, [bins, prepaid, extraBags])

  const payload = useMemo<CalculationPayload | null>(() => {
    if (!fareFamilyId) return null
    return {
      airlineId,
      fareFamilyId,
      ...(bookingDateApplies && bookingDate && { bookingDate }),
      passengers: Array.from({ length: passengersCount }, (_, i) => ({
        id: `pax-${i + 1}`,
        // The benefit is held by the first passenger. The API applies it to the
        // cardholder plus that card's companion limit.
        benefitIds: i === 0 && benefitId ? [benefitId] : [],
        bags,
      })),
    }
  }, [airlineId, fareFamilyId, passengersCount, benefitId, bags, bookingDate, bookingDateApplies])

  const payloadKey = useMemo(() => (payload ? JSON.stringify(payload) : null), [payload])

  /* ---------------- Calculation ---------------- */

  useEffect(() => {
    if (!payload || !payloadKey) return

    const timer = setTimeout(() => {
      calcAbortRef.current?.abort()
      const controller = new AbortController()
      calcAbortRef.current = controller

      setCalcStatus('loading')
      setCalcError(null)

      calculateFees(payload, controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return
          setResult(data)
          setResultKey(payloadKey)
          setCalcStatus('ready')
          setAnnouncement(
            data.hasUnpricedItems
              ? `Estimate incomplete. ${data.unpricedItemCount} bag(s) require attention.`
              : `Estimated additional fees: ${formatMoney(data.totalFee, data.currency)}.`,
          )
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          const apiError = err instanceof ApiClientError ? err : null
          setCalcStatus('error')
          setCalcError({
            // The surrounding copy already says this, so an error with no
            // message of its own contributes nothing rather than repeating it.
            message: apiError?.message ?? '',
            retryable: apiError?.retryable ?? true,
          })
          setAnnouncement('We could not update your estimate. Your figures may be out of date.')
        })
    }, 300)

    return () => clearTimeout(timer)
  }, [payload, payloadKey, calcAttempt])

  useEffect(() => () => calcAbortRef.current?.abort(), [])

  /**
   * True when figures are on screen but no longer match the form.
   *
   * The `result !== null` guard is the point. The previous test was
   * `resultKey !== payloadKey || calcStatus === 'error'`, which treated a
   * first-load failure as stale -- so an empty panel got a warning ring and a
   * banner announcing that "the figures below were calculated for your previous
   * selection", with no figures and no previous selection.
   */
  const showStale = result !== null && (resultKey !== payloadKey || calcStatus === 'error')

  /* ---------------- Handlers ---------------- */

  const moveItem = useCallback((itemId: string, from: BagType, to: BagType) => {
    if (from === to) return
    setBins((current) => {
      const item = current[from].items.find((i) => i.id === itemId)
      if (!item) return current
      return {
        ...current,
        [from]: { ...current[from], items: current[from].items.filter((i) => i.id !== itemId) },
        [to]: { ...current[to], items: [...current[to].items, item] },
      }
    })
    const item =
      bins[from].items.find((i) => i.id === itemId) ?? { spokenName: 'Item' }
    setAnnouncement(`${item.spokenName} moved to ${BIN_LABELS[to].toLowerCase()}. Updating estimate.`)
  }, [bins])

  const changeDimension = useCallback((bin: BagType, axis: keyof BinDimensions, value: number | null) => {
    setBins((current) => ({
      ...current,
      [bin]: { ...current[bin], dimensions: { ...current[bin].dimensions, [axis]: value } },
    }))
  }, [])

  const changeEmptyWeight = useCallback((bin: BagType, value: number | null) => {
    setBins((current) => ({ ...current, [bin]: { ...current[bin], emptyWeight: value } }))
  }, [])

  const allowanceLabels = useMemo<Partial<Record<BagType, string | null>>>(() => {
    if (!airline) return {}
    const checkedWeight = selectedFare?.included_checked_weight ?? airline.checked_bag_weight
    const checkedParts = [
      airline.checked_bag_linear_dim != null
        ? `${airline.checked_bag_linear_dim} in total (length + width + height)`
        : null,
      checkedWeight != null ? `${checkedWeight} lb` : null,
    ].filter(Boolean)

    return {
      personal: formatDimensions(
        airline.personal_item_length,
        airline.personal_item_width,
        airline.personal_item_height,
      ),
      carry_on: [
        formatDimensions(airline.carry_on_length, airline.carry_on_width, airline.carry_on_height),
        airline.carry_on_weight != null ? `${airline.carry_on_weight} lb` : null,
      ]
        .filter(Boolean)
        .join(', ') || null,
      checked: checkedParts.length > 0 ? checkedParts.join(', ') : null,
    }
  }, [airline, selectedFare])

  const selectClass =
    'w-full bg-premium-900 border border-white/25 rounded-xl py-2.5 px-4 appearance-none text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      {/* Announcements for assistive technology (audit issue P1-12). */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <div className="lg:col-span-4 space-y-6">
        <section className="glass-panel p-6" aria-labelledby="plan-heading">
          <h1 id="plan-heading" className="text-2xl font-bold mb-2 gradient-text pb-1">
            Plan Your Trip
          </h1>
          <p className="text-sm text-text-muted mb-6">
            An itemised baggage fee estimate, with the source behind every figure.
          </p>

          {/* Reference-data status region (audit issue P0-06). */}
          <div role="status" aria-live="polite" className="mb-4 empty:mb-0">
            {referenceStatus === 'loading' ? (
              <p className="text-sm text-text-muted">Loading airline rules...</p>
            ) : null}

            {referenceStatus === 'fallback' ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100/90 space-y-2">
                <p className="flex items-start gap-2">
                  <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" aria-hidden="true" />
                  <span>
                    We could not refresh airline rules. Showing PackRight&rsquo;s built-in copy
                    (dataset v{DATASET_VERSION}) instead, which may be out of date.
                    {referenceError ? ` ${referenceError}` : ''}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => setReferenceAttempt((n) => n + 1)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-500/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  Retry
                </button>
              </div>
            ) : null}
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="airline" className="block text-sm font-medium text-text-muted mb-1">
                Airline
              </label>
              <div className="relative">
                <select
                  id="airline"
                  name="airline"
                  value={airlineId}
                  onChange={(e) => {
                    setAirlineId(e.target.value)
                    setFareFamilyId('')
                    setBenefitId('')
                    setPrepaid({ carry_on: false, checked: false })
                    setExtraBags(bags => bags.map(b => ({ ...b, baseFeePrepaid: false })))
                  }}
                  className={selectClass}
                >
                  {reference.airlines.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="absolute right-4 top-3 w-4 h-4 text-text-muted pointer-events-none"
                  aria-hidden="true"
                />
              </div>
            </div>

            <div>
              <label htmlFor="fare-family" className="block text-sm font-medium text-text-muted mb-1">
                Fare or purchased bundle
              </label>
              <div className="relative">
                <select
                  id="fare-family"
                  name="fare-family"
                  value={fareFamilyId}
                  onChange={(e) => {
                    setFareFamilyId(e.target.value)
                    setPrepaid({ carry_on: false, checked: false })
                    setExtraBags(bags => bags.map(b => ({ ...b, baseFeePrepaid: false })))
                  }}
                  aria-describedby="fare-family-help"
                  className={selectClass}
                >
                  {filteredFares.length === 0 ? <option value="">No fares available</option> : null}
                  {filteredFares.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="absolute right-4 top-3 w-4 h-4 text-text-muted pointer-events-none"
                  aria-hidden="true"
                />
              </div>
              <p id="fare-family-help" className="mt-1 text-xs text-text-muted">
                {selectedFare?.scope ?? 'Select the fare or bundle shown on your booking.'}
              </p>
            </div>

            {bookingDateApplies ? (
              <div>
                <label htmlFor="booking-date" className="block text-sm font-medium mb-1">Ticket booking date (optional)</label>
                <input type="date" id="booking-date" value={bookingDate} className={selectClass}
                  onChange={e => setBookingDate(e.target.value)} />
                <p className="mt-1 text-xs text-text-muted">Used for date-dependent overweight charges.</p>
              </div>
            ) : null}

            <div>
              <label htmlFor="passengers" className="block text-sm font-medium text-text-muted mb-1">
                Passengers
              </label>
              <input
                id="passengers"
                name="passengers"
                type="number"
                inputMode="numeric"
                min={1}
                max={9}
                value={passengersCount}
                aria-describedby="passengers-help"
                onChange={(e) => {
                  const parsed = Number.parseInt(e.target.value, 10)
                  setPassengersCount(Number.isFinite(parsed) ? Math.min(9, Math.max(1, parsed)) : 1)
                }}
                className="w-full bg-premium-900 border border-white/25 rounded-xl py-2.5 px-4 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
              />
              <p id="passengers-help" className="mt-1 text-xs text-text-muted">
                The same bags are applied to every passenger.
              </p>
            </div>

            <div>
              {/*
                Audit issue P0-08: this said "Status / Credit Cards" while only
                credit-card benefits are modelled. Elite status is a separate
                eligibility system and is not in the data.
              */}
              <label htmlFor="benefit" className="block text-sm font-medium text-text-muted mb-1">
                Eligible airline credit card (optional)
              </label>
              <div className="relative">
                <select
                  id="benefit"
                  name="benefit"
                  value={benefitId}
                  onChange={(e) => setBenefitId(e.target.value)}
                  aria-describedby="benefit-help"
                  className={selectClass}
                >
                  <option value="">None</option>
                  {filteredBenefits.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="absolute right-4 top-3 w-4 h-4 text-text-muted pointer-events-none"
                  aria-hidden="true"
                />
              </div>
              <p id="benefit-help" className="mt-1 text-xs text-text-muted">
                Card benefits only. Elite status is not modelled yet. A waiver is applied to the
                cardholder plus that card&rsquo;s companion limit.
              </p>
            </div>
          </div>
        </section>
      </div>

      <div className="lg:col-span-8 space-y-6">
        {/* Calculation status region (audit issue P0-06). */}
        <div role="status" aria-live="polite" className="empty:hidden">
          {calcStatus === 'loading' ? (
            <p className="text-sm text-text-muted flex items-center gap-2">
              <span
                className="w-3.5 h-3.5 border-2 border-white/30 border-t-accent-primary rounded-full animate-spin"
                aria-hidden="true"
              />
              Updating your estimate...
            </p>
          ) : null}

          {calcStatus === 'error' && calcError ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-2">
              <p className="flex items-start gap-2 text-sm text-red-100">
                <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5 text-red-400" aria-hidden="true" />
                <span>
                  We could not work out your estimate right now.
                  {calcError.message ? ` ${calcError.message}` : ''}
                </span>
              </p>
              {calcError.retryable ? (
                <button
                  type="button"
                  onClick={() => setCalcAttempt((n) => n + 1)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/40 px-3 py-1.5 text-xs font-medium text-red-100 hover:bg-red-500/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {showStale ? (
          <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-2 text-xs text-amber-100">
            The figures below were calculated for your previous selection and no longer match the
            form.
          </p>
        ) : null}

        {/*
          Marked with a ring rather than dimmed. An opacity wrapper pushed every
          string inside the panel under the 4.5:1 contrast minimum, including the
          estimate disclaimer, so staleness is signalled without touching colour.
        */}
        <div
          aria-busy={calcStatus === 'loading'}
          className={
            showStale ? 'rounded-2xl ring-2 ring-amber-500/40' : undefined
          }
        >
          <FeeMatrix result={result} />
        </div>

        <KnapsackAllocator
          bins={bins}
          onMoveItem={moveItem}
          onDimensionChange={changeDimension}
          onEmptyWeightChange={changeEmptyWeight}
          allowanceLabels={allowanceLabels}
        />

        {/*
          Hidden while stale. This panel pairs the displayed result with the
          currently selected airline, so between a selection change and the next
          calculation it renders a hybrid: a condition derived from the previous
          airline's figures, labelled and linked with the new airline's name.
          The amber banner above warns about the figures, not about this.
        */}
        {selectedFare && (!selectedFare.includes_carry_on && !!selectedFare.carry_on_purchasable || selectedFare.first_checked_fee !== 0) ? (
          <fieldset className="glass-panel p-5 space-y-2">
            <legend className="sr-only">Previously purchased bags</legend>
            <p className="text-sm">Mark any base bag fee you already paid for every passenger on this booking.</p>
            {!selectedFare.includes_carry_on && !!selectedFare.carry_on_purchasable ? (
              <label className="block text-sm">
                <input type="checkbox" checked={prepaid.carry_on}
                  onChange={e => setPrepaid({ ...prepaid, carry_on: e.target.checked })} /> Packing planner carry-on already paid
              </label>
            ) : null}
            {selectedFare.first_checked_fee !== 0 ? (
              <label className="block text-sm">
                <input type="checkbox" checked={prepaid.checked}
                  onChange={e => setPrepaid({ ...prepaid, checked: e.target.checked })} /> Packing planner checked bag already paid
              </label>
            ) : null}
          </fieldset>
        ) : null}
        <ExtraCheckedBags bags={extraBags} onChange={setExtraBags}
          firstOrdinal={bags.filter(b => b.type === 'checked').length - extraBags.length + 1} />
        {showStale ? null : <FeeAvoidanceTips result={result} airline={airline} />}

        <p className="text-sm text-text-muted">
          Want the detail behind these numbers? Read{' '}
          <Link to="/methodology" className="text-accent-secondary underline underline-offset-2 hover:text-white">
            how PackRight estimates baggage fees
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
