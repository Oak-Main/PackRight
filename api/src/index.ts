/**
 * PackRight API (v1).
 *
 * Contract notes:
 *  - Canonical paths are /api/v1/*. The unversioned /api/* paths are kept as
 *    aliases so an older cached client does not hard-fail, and serve identical
 *    responses.
 *  - Every response carries security headers, an explicit cache directive, and
 *    RateLimit-* headers.
 *  - Every error is a classified JSON envelope: { error: { code, message, details? } }.
 *    Internal exception text is never returned to a caller.
 */

import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import {
  API_VERSION,
  DISCLAIMER,
  REVIEW_INTERVAL_DAYS,
  calculateFees,
} from './fees.ts'
import { ApiError, parseCalculationRequest, readJsonBody } from './validate.ts'
import {
  CALCULATION_CACHE_CONTROL,
  REFERENCE_CACHE_CONTROL,
  SECURITY_HEADERS,
  clientKeyFor,
  consumeRateLimit,
  rateLimitHeaders,
  resolveCorsOrigin,
} from './http.ts'
import type {
  AirlineRecord,
  BenefitRecord,
  FareFamilyRecord,
  FeeAssumptionRecord,
  OverweightBand,
  OversizeBand,
} from './types.ts'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

/* ------------------------------------------------------------------ *
 * Middleware
 * ------------------------------------------------------------------ */

app.use('*', async (c: Context, next: Next) => {
  const origin = c.req.header('origin')
  const allowedOrigin = resolveCorsOrigin(origin)

  // Reference data is deliberately public, so an unrecognised origin still gets
  // read access via '*'. Credentials are never accepted, on any origin.
  const corsOrigin = allowedOrigin ?? '*'

  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...SECURITY_HEADERS,
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      },
    })
  }

  const rate = consumeRateLimit(clientKeyFor(c.req.raw))

  const baseHeaders = (): Headers => {
    const headers = new Headers()
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value)
    for (const [key, value] of Object.entries(rateLimitHeaders(rate))) headers.set(key, value)
    headers.set('Access-Control-Allow-Origin', corsOrigin)
    headers.set('Vary', 'Origin')
    headers.set('X-API-Version', API_VERSION)
    return headers
  }

  if (!rate.allowed) {
    // Returned BEFORE next(), so a rate-limited caller never reaches a route and
    // never touches D1 -- the point of a limiter is to shed load, and running
    // the handler first shed none of it.
    //
    // The response is built from scratch rather than by reassigning c.res.
    // Hono's `set res` re-applies the outgoing headers it already holds, so a
    // 429 assembled after the handler inherited the handler's own
    // 'Cache-Control: public, max-age=3600' -- a cacheable rate-limit response.
    const headers = baseHeaders()
    headers.set('Content-Type', 'application/json')
    headers.set('Retry-After', String(rate.resetSeconds))
    headers.set('Cache-Control', 'no-store')

    return new Response(
      JSON.stringify({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please retry shortly.',
        },
      }),
      { status: 429, headers },
    )
  }

  // Applied in a finally rather than after next(). Hono's compose already runs
  // onError in the handler's own dispatch frame, so an ApiError does not skip
  // this block today -- but a non-Error throw is rethrown, and that path would
  // lose every security and RateLimit-* header. Costs nothing to close.
  try {
    await next()
  } finally {
    for (const [key, value] of baseHeaders()) c.header(key, value)
  }
})

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(err.toBody(), err.status as 400, { 'Cache-Control': 'no-store' })
  }
  // Deliberately opaque. The detail goes to the Workers log, not to the caller.
  console.error('Unhandled API error:', err)
  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } },
    500,
    { 'Cache-Control': 'no-store' },
  )
})

app.notFound((c) =>
  c.json(
    { error: { code: 'NOT_FOUND', message: 'Unknown endpoint.' } },
    404,
    { 'Cache-Control': 'no-store' },
  ),
)

/* ------------------------------------------------------------------ *
 * Data access
 * ------------------------------------------------------------------ */

/**
 * A row of `airlines` with the band columns still in their stored form.
 *
 * The band lists are stored as JSON text because a band list is a value, not a
 * relation: it is read with its airline, written with it, and never queried
 * across airlines. Normalising it into a table would add joins to the one
 * request the calculator makes per calculation for no query benefit.
 */
type AirlineRow = AirlineRecord & {
  overweight_fees_json?: string | null
  oversize_fees_json?: string | null
}

/**
 * Parses a stored band list.
 *
 * A malformed or empty list returns null rather than throwing, so one bad row
 * leaves the excess charge unpriced instead of taking
 * the whole reference endpoint down.
 */
const parseBands = <T>(raw: string | null | undefined): T[] | null => {
  if (raw == null || raw === '') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    return parsed as T[]
  } catch {
    return null
  }
}

const toAirlineRecord = (row: AirlineRow): AirlineRecord => {
  const { overweight_fees_json, oversize_fees_json, ...rest } = row
  return {
    ...rest,
    overweight_fees: parseBands<OverweightBand>(overweight_fees_json),
    oversize_fees: parseBands<OversizeBand>(oversize_fees_json),
  }
}

async function allAirlines(c: Context<{ Bindings: Bindings }>): Promise<AirlineRecord[]> {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM airlines ORDER BY name',
  ).all<AirlineRow>()
  return (results ?? []).map(toAirlineRecord)
}

async function allFareFamilies(
  c: Context<{ Bindings: Bindings }>,
  airlineId?: string,
): Promise<FareFamilyRecord[]> {
  const stmt = airlineId
    ? c.env.DB.prepare('SELECT * FROM fare_families WHERE airline_id = ? ORDER BY name').bind(airlineId)
    : c.env.DB.prepare('SELECT * FROM fare_families ORDER BY airline_id, name')
  const { results } = await stmt.all<FareFamilyRecord>()
  return results ?? []
}

async function allBenefits(
  c: Context<{ Bindings: Bindings }>,
  airlineId?: string,
): Promise<BenefitRecord[]> {
  const stmt = airlineId
    ? c.env.DB.prepare('SELECT * FROM benefits WHERE airline_id = ? ORDER BY name').bind(airlineId)
    : c.env.DB.prepare('SELECT * FROM benefits ORDER BY airline_id, name')
  const { results } = await stmt.all<BenefitRecord>()
  return results ?? []
}

async function allAssumptions(
  c: Context<{ Bindings: Bindings }>,
): Promise<FeeAssumptionRecord[]> {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM fee_assumptions',
  ).all<FeeAssumptionRecord>()
  return results ?? []
}

/** Rejects an airline filter that is obviously not an id, before it reaches D1. */
function readAirlineFilter(c: Context): string | undefined {
  const value = c.req.query('airline')
  if (value === undefined || value === '') return undefined
  if (value.length > 64) {
    throw new ApiError(400, 'INVALID_REQUEST', 'airline must be 64 characters or fewer.')
  }
  return value
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

function register(basePath: string) {
  const reference = { 'Cache-Control': REFERENCE_CACHE_CONTROL }

  app.get(`${basePath}/health`, async (c) => {
    // Reports data freshness as well as liveness, so the service is observable
    // without a dashboard (audit: "service health check").
    let dbOk = false
    let unverifiedAirlines: number | null = null
    try {
      const row = await c.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM airlines WHERE status != 'verified'",
      ).first<{ n: number }>()
      unverifiedAirlines = row?.n ?? null
      dbOk = true
    } catch (err) {
      console.error('Health check database probe failed:', err)
    }

    return c.json(
      {
        status: dbOk ? 'ok' : 'degraded',
        apiVersion: API_VERSION,
        database: dbOk ? 'ok' : 'unavailable',
        reviewIntervalDays: REVIEW_INTERVAL_DAYS,
        unverifiedAirlines,
        time: new Date().toISOString(),
      },
      dbOk ? 200 : 503,
      { 'Cache-Control': 'no-store' },
    )
  })

  app.get(`${basePath}/airlines`, async (c) => c.json(await allAirlines(c), 200, reference))

  app.get(`${basePath}/fare-families`, async (c) =>
    c.json(await allFareFamilies(c, readAirlineFilter(c)), 200, reference))

  app.get(`${basePath}/benefits`, async (c) =>
    c.json(await allBenefits(c, readAirlineFilter(c)), 200, reference))

  app.get(`${basePath}/tsa-rules`, async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM tsa_rules ORDER BY category, item_name').all()
    return c.json(results ?? [], 200, reference)
  })

  app.get(`${basePath}/assumptions`, async (c) => c.json(await allAssumptions(c), 200, reference))

  /**
   * Single round trip for everything the calculator needs to render its
   * selectors. The audit measured 1.585s for the airlines call alone and noted
   * the app blocks on three separate requests before its controls populate.
   */
  app.get(`${basePath}/reference`, async (c) => {
    const [airlines, fareFamilies, benefits, assumptions] = await Promise.all([
      allAirlines(c),
      allFareFamilies(c),
      allBenefits(c),
      allAssumptions(c),
    ])
    return c.json(
      {
        apiVersion: API_VERSION,
        airlines,
        fareFamilies,
        benefits,
        assumptions,
        reviewIntervalDays: REVIEW_INTERVAL_DAYS,
        disclaimer: DISCLAIMER,
        retrievedAt: new Date().toISOString(),
      },
      200,
      reference,
    )
  })

  app.post(`${basePath}/calculate-fees`, async (c) => {
    const body = await readJsonBody(c.req.raw)
    const request = parseCalculationRequest(body)

    const [airlineRow, fareFamily] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM airlines WHERE id = ?')
        .bind(request.airlineId)
        .first<AirlineRow>(),
      c.env.DB.prepare('SELECT * FROM fare_families WHERE id = ?')
        .bind(request.fareFamilyId)
        .first<FareFamilyRecord>(),
    ])
    const airline = airlineRow ? toAirlineRecord(airlineRow) : null

    if (!airline) {
      throw new ApiError(404, 'UNKNOWN_AIRLINE', 'No airline matches the supplied airlineId.')
    }
    if (!fareFamily) {
      throw new ApiError(404, 'UNKNOWN_FARE_FAMILY', 'No fare family matches the supplied fareFamilyId.')
    }
    if (fareFamily.airline_id !== airline.id) {
      throw new ApiError(
        400,
        'FARE_AIRLINE_MISMATCH',
        'The supplied fareFamilyId does not belong to the supplied airlineId.',
      )
    }

    const benefits = await allBenefits(c, airline.id)

    const knownBenefitIds = new Set(benefits.map((b) => b.id))
    const unknown = request.passengers
      .flatMap((p, i) => p.benefitIds.map((id) => ({ id, field: `passengers[${i}].benefitIds` })))
      .filter((entry) => !knownBenefitIds.has(entry.id))

    if (unknown.length > 0) {
      throw new ApiError(
        400,
        'UNKNOWN_BENEFIT',
        'One or more selected benefits are not available for this airline.',
        unknown.map((entry) => ({ field: entry.field, message: `Unknown benefit '${entry.id}'.` })),
      )
    }

    const result = calculateFees({ request, airline, fareFamily, benefits })
    return c.json(result, 200, { 'Cache-Control': CALCULATION_CACHE_CONTROL })
  })
}

register('/api/v1')
register('/api')

export default app
