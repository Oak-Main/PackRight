# PackRight API

Cloudflare Worker that serves PackRight's baggage reference data and calculates
fee estimates. Deployed at `packright-api.kevynsgrin.workers.dev`.

## Contract

Canonical paths are `/api/v1/*`. The unversioned `/api/*` paths are kept as
aliases so a cached client does not hard-fail; they serve identical responses.

| Method | Path | Cache-Control | Notes |
| ------ | ---- | ------------- | ----- |
| GET | `/api/v1/health` | `no-store` | Liveness plus data freshness. 503 when D1 is unreachable. |
| GET | `/api/v1/reference` | `public, max-age=3600, stale-while-revalidate=86400` | Airlines, fares, benefits and assumptions in one round trip. |
| GET | `/api/v1/airlines` | same as above | |
| GET | `/api/v1/fare-families?airline=<id>` | same as above | |
| GET | `/api/v1/benefits?airline=<id>` | same as above | Only `benefit_type: CREDIT_CARD` is modelled today. |
| GET | `/api/v1/tsa-rules` | same as above | |
| GET | `/api/v1/assumptions` | same as above | Historical planning assumptions for legacy clients. |
| POST | `/api/v1/calculate-fees` | `no-store` | |

`GET /api/v1/reference` exists because the audit measured the app blocking on
three separate reference calls (1.585 s for airlines alone) before its selectors
could populate.

### Errors

Every failure returns a classified envelope. Internal exception text is never
returned to a caller.

```json
{ "error": { "code": "INVALID_REQUEST", "message": "airlineId, fareFamilyId, and passengers are required.", "details": [] } }
```

| Status | Code | Cause |
| ------ | ---- | ----- |
| 400 | `INVALID_REQUEST` | Missing or invalid fields. `details` carries field-level messages. |
| 400 | `INVALID_JSON` | Body is not valid JSON. |
| 400 | `FARE_AIRLINE_MISMATCH` | `fareFamilyId` belongs to a different airline. |
| 400 | `UNKNOWN_BENEFIT` | A selected benefit is not available for this airline. |
| 404 | `UNKNOWN_AIRLINE` / `UNKNOWN_FARE_FAMILY` | No such record. |
| 404 | `NOT_FOUND` | Unknown endpoint. |
| 413 | `PAYLOAD_TOO_LARGE` | Body exceeds 32 KB. |
| 429 | `RATE_LIMITED` | Over the rate limit. Includes `Retry-After`. |
| 500 | `INTERNAL_ERROR` | Unexpected failure. Detail goes to the Workers log only. |

### Rate limiting

Every response carries `RateLimit-Limit`, `RateLimit-Remaining`,
`RateLimit-Reset` and `RateLimit-Policy` (120 requests per 60 s).

Enforcement is **best effort**: it is a per-isolate counter, because Workers
isolates do not share memory. It bounds a single abusive client hitting a single
isolate and gives accurate headers. It is not an account-wide guarantee. Enable
the rate-limit binding in `wrangler.toml`, or a Cloudflare WAF rate-limiting
rule, for the durable control.

### CORS

Reference GETs are deliberately public, so an unrecognised origin still receives
`Access-Control-Allow-Origin: *`. Origins in `ALLOWED_ORIGINS` (`src/http.ts`)
are echoed back explicitly. Credentials are never accepted from any origin.

## Two rules the fee engine will not break

1. **It never invents a price.** If the applicable sources cannot fully price a bag, that bag comes back `status: "unpriced"` with `fee: null` and is
   excluded from `totalFee`. `hasUnpricedItems` tells the client to say so.
   The previous build hard-coded `$35`, `$40`, `$100` and `$150` inline with no
   provenance and presented the sum as an exact figure.

2. **Fit checks are orientation-insensitive.** Both the bag and the allowance are
   sorted longest-to-shortest before comparison. The previous build compared
   length-to-length, so a 15x10x5 personal item was judged oversized against
   Frontier's 14x18x8 allowance and drew a spurious $100 penalty.

A request may include a ticket `bookingDate` in `YYYY-MM-DD` form and a boolean
`baseFeePrepaid` on each carry-on or checked bag. Prepayment covers the base
fee for that piece only. The response describes remaining charges. A refused
bag has `status: "not_accepted"` and `fee: null`. Its warning gives the limit.
A partly priced bag exposes its known components and stays out of `totalFee`.
The historical assumptions endpoint and response keys remain available to API clients.

## Data provenance

`data/reference-data.json` at the repository root is the single source of truth.
Every record carries `source_url`, `source_title`, `effective_date`,
`verified_at`, `verified_by`, `scope`, `currency`, `status` and `change_note`.

`status` is one of:

- `verified` — a named steward compared the record against `source_url` on `verified_at`.
- `unverified` — the value is carried over and has a source URL, but no steward has checked it.
- `assumption` — PackRight applies this as a labelled planning assumption, never as a quoted price.

Airline and fare records have retrieval timestamps. Build and test enforce a
90-day source age limit. Issuer benefits and TSA records retain their separate
review status.

## Working on it

```bash
npm run typecheck      # tsc --noEmit, strict
npm test               # engine, seeded HTTP, input and freshness tests
npm run check          # both, and what deploy runs first
npm run generate:seed  # regenerate seed.sql from data/reference-data.json
npm run dev            # wrangler dev
```

For the live D1 migration, Worker and Pages rollout, follow the repository
[deployment steps](../README.md#deploying).
