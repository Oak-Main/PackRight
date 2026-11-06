/**
 * Request validation for the PackRight API.
 *
 * The August 2026 audit found that a malformed POST to /api/calculate-fees
 * returned HTTP 500 with a raw JSON parser message. Every rejection now returns
 * a classified 4xx with a stable error envelope and no internal detail.
 */

import type { BagInput, BagType, CalculationRequest, Dimensions } from './types.ts'

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: Array<{ field: string; message: string }>
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: Array<{ field: string; message: string }>

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Array<{ field: string; message: string }>,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && this.details.length ? { details: this.details } : {}),
      },
    }
  }
}

/** Guard rails so a single request cannot be used to burn Worker CPU. */
export const LIMITS = {
  maxBodyBytes: 32 * 1024,
  maxPassengers: 9,
  maxBagsPerPassenger: 10,
  maxBenefitsPerPassenger: 5,
  maxIdLength: 64,
  maxDimensionInches: 120,
  maxWeightPounds: 500,
} as const

const BAG_TYPES: readonly BagType[] = ['personal', 'carry_on', 'checked']

type Detail = { field: string; message: string }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function readId(value: unknown, field: string, details: Detail[]): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    details.push({ field, message: 'Must be a non-empty string.' })
    return null
  }
  if (value.length > LIMITS.maxIdLength) {
    details.push({ field, message: `Must be ${LIMITS.maxIdLength} characters or fewer.` })
    return null
  }
  return value
}

function readNumber(
  value: unknown,
  field: string,
  min: number,
  max: number,
  details: Detail[],
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    details.push({ field, message: 'Must be a finite number.' })
    return null
  }
  if (value < min || value > max) {
    details.push({ field, message: `Must be between ${min} and ${max}.` })
    return null
  }
  return value
}

function readDimensions(value: unknown, field: string, details: Detail[]): Dimensions | null {
  if (value === null || value === undefined) return null
  if (!isPlainObject(value)) {
    details.push({ field, message: 'Must be an object with length, width, and height, or null.' })
    return null
  }
  const length = readNumber(value.length, `${field}.length`, 0.1, LIMITS.maxDimensionInches, details)
  const width = readNumber(value.width, `${field}.width`, 0.1, LIMITS.maxDimensionInches, details)
  const height = readNumber(value.height, `${field}.height`, 0.1, LIMITS.maxDimensionInches, details)
  if (length === null || width === null || height === null) return null
  return { length, width, height }
}

function readBag(value: unknown, field: string, details: Detail[]): BagInput | null {
  if (!isPlainObject(value)) {
    details.push({ field, message: 'Must be an object.' })
    return null
  }
  const type = value.type
  if (typeof type !== 'string' || !BAG_TYPES.includes(type as BagType)) {
    details.push({ field: `${field}.type`, message: `Must be one of: ${BAG_TYPES.join(', ')}.` })
    return null
  }
  let weight: number | null = null
  if (value.weight !== null && value.weight !== undefined) {
    weight = readNumber(value.weight, `${field}.weight`, 0, LIMITS.maxWeightPounds, details)
  }
  const dimensions = readDimensions(value.dimensions, `${field}.dimensions`, details)
  if (value.baseFeePrepaid !== undefined && (typeof value.baseFeePrepaid !== 'boolean' || (type === 'personal' && value.baseFeePrepaid))) {
    details.push({ field: field + '.baseFeePrepaid', message: 'Use a boolean for a carry-on or checked bag payment.' })
  }
  return { type: type as BagType, weight, dimensions, ...(value.baseFeePrepaid === true && { baseFeePrepaid: true }) }
}

/**
 * Validates and normalises a calculate-fees request body.
 * Throws ApiError(400) with field-level detail on any problem.
 */
export function parseCalculationRequest(body: unknown): CalculationRequest {
  if (!isPlainObject(body)) {
    throw new ApiError(400, 'INVALID_REQUEST', 'Request body must be a JSON object.')
  }

  const hasCore =
    body.airlineId !== undefined && body.fareFamilyId !== undefined && body.passengers !== undefined
  if (!hasCore) {
    throw new ApiError(
      400,
      'INVALID_REQUEST',
      'airlineId, fareFamilyId, and passengers are required.',
    )
  }

  const details: Detail[] = []
  const airlineId = readId(body.airlineId, 'airlineId', details)
  const fareFamilyId = readId(body.fareFamilyId, 'fareFamilyId', details)

  if (!Array.isArray(body.passengers)) {
    details.push({ field: 'passengers', message: 'Must be an array.' })
    throw new ApiError(400, 'INVALID_REQUEST', 'airlineId, fareFamilyId, and passengers are required.', details)
  }
  if (body.passengers.length < 1 || body.passengers.length > LIMITS.maxPassengers) {
    details.push({
      field: 'passengers',
      message: `Must contain between 1 and ${LIMITS.maxPassengers} passengers.`,
    })
  }

  const bookingDate = body.bookingDate
  if (bookingDate !== undefined) {
    const date = typeof bookingDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(bookingDate)
      ? new Date(bookingDate + 'T00:00:00Z') : null
    if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== bookingDate) {
      details.push({ field: 'bookingDate', message: 'Use a valid booking date in YYYY-MM-DD format.' })
    }
  }
  const passengers: CalculationRequest['passengers'] = []
  // Ids reach the response as `paxId` and are used as React keys, so a
  // collision between a client-supplied id and the positional default assigned
  // to a passenger that omitted one has to be a 400, not a silent merge.
  const seenIds = new Set<string>()
  body.passengers.slice(0, LIMITS.maxPassengers).forEach((raw, i) => {
    const field = `passengers[${i}]`
    if (!isPlainObject(raw)) {
      details.push({ field, message: 'Must be an object.' })
      return
    }
    const id = typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id.slice(0, LIMITS.maxIdLength) : `pax-${i + 1}`

    let benefitIds: string[] = []
    if (raw.benefitIds !== undefined && raw.benefitIds !== null) {
      if (!Array.isArray(raw.benefitIds)) {
        details.push({ field: `${field}.benefitIds`, message: 'Must be an array of strings.' })
      } else if (raw.benefitIds.length > LIMITS.maxBenefitsPerPassenger) {
        details.push({
          field: `${field}.benefitIds`,
          message: `Must contain ${LIMITS.maxBenefitsPerPassenger} entries or fewer.`,
        })
      } else {
        benefitIds = raw.benefitIds.filter(
          (b): b is string => typeof b === 'string' && b.trim() !== '' && b.length <= LIMITS.maxIdLength,
        )
      }
    }

    let bags: BagInput[] = []
    if (raw.bags !== undefined && raw.bags !== null) {
      if (!Array.isArray(raw.bags)) {
        details.push({ field: `${field}.bags`, message: 'Must be an array.' })
      } else if (raw.bags.length > LIMITS.maxBagsPerPassenger) {
        details.push({
          field: `${field}.bags`,
          message: `Must contain ${LIMITS.maxBagsPerPassenger} bags or fewer.`,
        })
      } else {
        bags = raw.bags
          .map((b, j) => readBag(b, `${field}.bags[${j}]`, details))
          .filter((b): b is BagInput => b !== null)
      }
    }

    if (seenIds.has(id)) {
      details.push({ field: `${field}.id`, message: 'Must be unique across passengers.' })
    }
    seenIds.add(id)

    passengers.push({ id, benefitIds, bags })
  })

  if (details.length > 0 || airlineId === null || fareFamilyId === null) {
    throw new ApiError(400, 'INVALID_REQUEST', 'One or more fields are invalid.', details)
  }

  return { airlineId, fareFamilyId, passengers, ...(typeof bookingDate === 'string' && { bookingDate }) }
}

/**
 * Reads a JSON body with a hard size cap, converting any parse failure into a 400.
 *
 * The cap is enforced by counting bytes off the stream as they arrive, not by
 * trusting `content-length`. A chunked request omits that header entirely, so
 * the old pre-check let an unbounded body through; and the post-check compared
 * `String.length`, which counts UTF-16 code units, so a multibyte payload of
 * twice the byte limit still passed. Both are closed here, and the read is
 * cancelled the moment the running total goes over rather than after the whole
 * body has been buffered.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length')
  if (declared && Number(declared) > LIMITS.maxBodyBytes) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.')
  }

  let text: string
  try {
    text = await readCappedText(request, LIMITS.maxBodyBytes)
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError(400, 'INVALID_JSON', 'Request body could not be read.')
  }

  if (text.trim() === '') {
    throw new ApiError(400, 'INVALID_REQUEST', 'airlineId, fareFamilyId, and passengers are required.')
  }

  try {
    return JSON.parse(text)
  } catch {
    // Deliberately does not echo the parser message back to the caller.
    throw new ApiError(400, 'INVALID_JSON', 'Request body is not valid JSON.')
  }
}

/** Drains a request body, aborting as soon as it exceeds `maxBytes` real bytes. */
async function readCappedText(request: Request, maxBytes: number): Promise<string> {
  const body = request.body
  // No stream to read (an empty body, or a runtime that does not expose one).
  if (!body) return await request.text()

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock?.()
  }

  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(joined)
}
