# PackRight

Airline baggage fee calculator and packing planner, published at
[luggageliason.com](https://luggageliason.com).

```
data/reference-data.json   Canonical policy dataset. Single source of truth.
api/                       Cloudflare Worker: fee engine + reference API.
frontend/                  React + Vite site, prerendered to static HTML.
```

## Working on it

```bash
# API
cd api && npm ci
npm run check          # strict typecheck + API tests
npm run dev            # wrangler dev

# Frontend
cd frontend && npm ci
npm run dev
npm run build          # typecheck -> client -> ssr -> prerender -> budget gate
npm run test           # typecheck + lint
```

`frontend/npm run build` runs five stages and fails on any of them: strict
typecheck, client build, SSR build, prerender of all canonical routes, and a Brotli
performance budget (initial JS <= 120 KB, CSS <= 30 KB).

## Deploying

The Worker, D1 and Pages deploy separately. The production Pages project is
`luggageliason` (direct upload), the Worker is `packright-api`, and the database
is `packright-db`. A GitHub merge does not deploy these targets.

From the reviewed commit, run `npm ci` in `api` and `frontend`, then
`npm run check` and `npm run db:rehearse` in `api`. Build `frontend/dist` with
`npm run build` in `frontend`. Use the authorized Cloudflare account for the
following steps.

1. Inspect the production columns before choosing a migration. Confirm the
   status constraints from 0003, the 0004 retrieval and band columns, and
   the 0005 allowance columns. Check the target and capture a D1 backup before
   applying the authoritative seed.

   ```bash
   cd api
   npx wrangler d1 execute packright-db --remote --command="SELECT name, sql FROM sqlite_schema WHERE name IN ('airlines','fare_families','fee_assumptions')"
   npx wrangler d1 export packright-db --remote --output=../packright-pre-release.sql
   ```

2. The recorded August production baseline already has 0002 and 0003. From
   that exact shape run `npm run db:migrate:0004` followed by
   `npm run db:migrate:0005`. Skip fully applied migrations. If a migration
   is partly present, reconcile its individual columns before continuing.
   For a fresh empty database use `npm run db:schema` alone.
3. Run `npm run db:seed`. The seed replaces rows from the canonical dataset
   and removes retired IDs, including Spirit's active fare. Deploy the Worker
   with `npm run deploy`. Verify `/api/v1/reference` and
   `POST /api/v1/calculate-fees` on `packright-api.kevynsgrin.workers.dev`.
   Confirm Frontier Basic has a separately priced carry-on, Business includes
   its first two 50 lb checked bags, and an unknown booking date leaves the
   upper overweight charge open.
4. From `api` run
   `npx wrangler pages deploy ../frontend/dist --project-name=luggageliason --branch=main`.
   Check the fare selector, an actual estimate, the Frontier detail table, and
   the sitemap on `https://www.luggageliason.com/`.

There is deliberately **no SPA fallback** (`/* /index.html 200`). That rule is
what made `robots.txt`, `sitemap.xml`, `/privacy` and `/terms` all return the app
shell with HTTP 200. Every canonical route is a real file; everything else gets
`404.html` with a 404 status.

## Two rules the fee engine will not break

1. **It never invents a price.** An unavailable fee means
   the bag is reported `unpriced` and excluded from the total, with the UI saying
   so. The previous build hard-coded `$35`, `$40`, `$100` and `$150` inline.
2. **Fit checks are orientation-insensitive.** Bag and allowance are both sorted
   longest-to-shortest before comparison. The previous build compared
   length-to-length, so an ordinary 15x10x5 personal item was judged oversized
   against Frontier's 14x18x8 allowance and drew a phantom $100 penalty.

Details in [`api/README.md`](api/README.md).

## Outstanding before traffic acquisition

The August 2026 audit set a release gate. The engineering work behind it is
done; these items need a person, an account, or a decision, and are **not**
closed:

| # | Item | Why it is still open |
| - | ---- | -------------------- |
| 1 | **Verify the dataset** | Airline and fare rows carry source retrieval dates. Issuer and TSA records still require their own verification. |
| 2 | **Legal review** | `/privacy`, `/terms` and `/affiliate-disclosure` describe what the code actually does, verified against this repository. They have not been reviewed by counsel. |
| 3 | **Confirm vendor settings** | The privacy page states Cloudflare Web Analytics is cookieless and does not fingerprint. Confirm the account's actual configuration and retention before publication. |
| 4 | **HSTS preload** | `_headers` sends `preload`. Confirm every subdomain is HTTPS-ready before submitting to the preload list, because it is hard to reverse. |
| 5 | **Watch the CSP** | The policy is strict with no `unsafe-inline`, validated against the built output (two script sources, one stylesheet, no fonts, no third-party images). Watch for breakage after enabling Cloudflare features that inject script, such as Rocket Loader. |
| 6 | **Search Console / Bing** | Verify ownership, submit `sitemap.xml`, and request re-indexing of the home page so the "frontend" title is replaced. Needs account access. |
| 7 | **Rate limiting** | `api/src/http.ts` enforces a per-isolate limit and emits accurate `RateLimit-*` headers, which is best effort because Workers isolates do not share memory. Enable the binding in `wrangler.toml` or a WAF rule for a durable account-wide limit. |
| 8 | **Affiliate programme** | No partner links ship. `/affiliate-disclosure` sets the standard any future link must meet: a real destination, `rel="sponsored noopener noreferrer"`, and disclosure next to the link. |

`hello@luggageliason.com` and `privacy@luggageliason.com` are live and route to the
owner's Google Workspace, so the contact and privacy-rights channels the policy pages
publish are real.

The audit's P2 items (a broader content library, a published data change log,
and a final decision on whether the public brand is PackRight or Luggageliason)
are not addressed here beyond `/methodology` and the footer line reconciling the
two names.
