# PackRight — build handoff

**Prepared 6 November 2026** · repo `Oak-Main/PackRight` · site [www.luggageliason.com](https://www.luggageliason.com) · API `packright-api.kevynsgrin.workers.dev` · database `packright-db`

This document is the narrative of the build: what the project started as, what it was built to be, what has happened to it since, and where it stands at the moment of writing. It is meant to be read top to bottom by someone picking the project up cold, and it is explicit about which facts were re-verified today and which come from the repository's own history.

**What was verified on 6 Nov 2026 (live, not from memory):** the deployed site's sitemap and homepage, the live API's `/api/v1/health` and `/api/v1/airlines` responses, DNS and HTTP behaviour for the apex and `www`, the Cloudflare Pages project list, `main`'s commit history, the current dataset, and a full local `api` test run plus `frontend` production build. Everything else is read from the repository history.

---

## 1. What this project is for

PackRight is a **baggage-fee calculator and packing planner**. A traveller picks an airline and a fare, says how many passengers are flying and what is in each bag, and gets back an **itemised estimate** — every bag priced, every excess charge itemised, and a link to the page the figure came from.

Around the calculator sit four supporting surfaces, all prerendered and all indexed:

| Surface | What it does |
| --- | --- |
| `/` | The calculator, plus the Smart Packing Allocator (drag items between bags and watch the estimate move) and TSA screening warnings. |
| `/carry-on-size-checker` | Checks a bag's measurements against the carrier's allowance. |
| `/personal-item-size-comparison` | Compares personal-item limits across every airline modelled. |
| `/airlines/<slug>/baggage-fees` | One page per airline: limits, fees, the source, and the date it was read. 17 today. |
| `/how-baggage-fees-work`, `/methodology` | How the estimate is produced, and how the data is governed. |
| `/privacy`, `/terms`, `/affiliate-disclosure`, `/contact` | The trust layer. Operator: Oak and Main Developers LLC, 2108 N St., Sacramento, CA 95816. |

**The brand question is still open.** The tool is called PackRight; the domain is luggageliason.com; the footer reconciles the two ("PackRight is the baggage-planning tool at Luggageliason.com"). The audit listed "decide whether the public brand is PackRight or Luggageliason" as an unresolved P2 item. It has not been decided.

### The build goals, stated plainly

1. **Produce an honest estimate.** Not a plausible-looking one — an honest one.
2. **Make every figure traceable.** Each number carries the URL it came from and the date it was read.
3. **Make staleness impossible to ship.** If a source has not been re-read within 90 days, the build fails.
4. **Be acquirable.** Crawlable routes, real HTML, sitemap, FAQ schema, a legal identity — everything needed to drive search and paid traffic without the site falling over on contact.
5. **Stay maintainable.** One canonical dataset, a generated seed, rehearsed migrations, and a review cadence that forces someone to look at the data again.

### The two rules the engine will not break

These are written into `api/README.md` and the root `README.md`, and they are the standard every change is measured against:

1. **It never invents a price.** No sourced fee and no labelled assumption means the bag comes back `unpriced` and is excluded from the total, and the UI says so.
2. **Fit checks are orientation-insensitive.** Bag and allowance are both sorted longest-to-shortest before comparison.

---

## 2. The beginning state — 31 July 2026

The project began as commit `16d2a11`, *"Initial commit of PackRight MVP"*. It was a working prototype with the right idea and no accountability.

**What it was.** A React + Vite frontend (`App.tsx` plus one `Home.tsx`, three components, no routing) and a **single-file** Cloudflare Worker (`api/src/index.ts`, 168 lines). The database had four tables — `airlines`, `fare_families`, `benefits`, `tsa_rules`. There was **no `data/` directory**: no canonical dataset existed, so the numbers lived inline in the Worker.

**What it got wrong.** The engine read, verbatim from the MVP source:

```js
if (bag.l > airline.personal_item_length || bag.w > airline.personal_item_width || bag.h > airline.personal_item_height) {
  bagFee += 100 // Gate penalty fee assumption
} else if (!fareFamily.includes_personal_item) {
  bagFee += 35 // Base if not included
  ...
  bagFee = 40 // Default carry on fee
  bagFee += 100
  bagFee = 150 // Excess bag
  bagFee += 100
```

- **Every fee was a guess wearing a price tag.** `$35`, `$40`, `$100`, `$150` were constants in code. The estimate added them up and presented the total as if it were a quote.
- **The fit check compared length to length.** A perfectly ordinary 15 × 10 × 5 in personal item was judged "oversized" against Frontier's 14 × 18 × 8 in allowance and drew a phantom $100 gate penalty — because 15 > 14.
- **Nothing recorded where a number came from.** No source URL, no verification date, no change note, no reviewer. There was no way to tell a price from an assumption.
- **Every airline carried an identical 62-inch checked limit.** That is the industry-standard figure, so it was probably right — but eight identical unverified values is the signature of one assumption copied down a column, not eight figures read off eight airline pages.
- **Southwest was modelled as two free checked bags.** Anyone planning a Southwest trip got a materially wrong answer.
- **The site was not actually served.** The apex CNAME for luggageliason.com pointed at `packright-6zl.pages.dev`, and **no Pages project by that name existed** in the Cloudflare account. The August audit could not load the site at all.
- **No safety net.** No CI, no tests, no migration rehearsal, no owner checklist.

The August audit later characterised its own findings as *"37 confirmed findings, 26 rejected"* across 12 dimensions — and one of the rejected ones was a fabricated Southwest dimension in the dataset itself, caught by the audit before it reached a user.

---

## 3. The build arc

### Phase 1 — Rebuild the thing (28 August)

Commits `762f183` and `4ebf817`: *"Rebuild API: provenance, fee-engine correctness, v1 contract"* and *"Rebuild frontend: trust layer, crawlable routes, accessibility, PWA"*.

This is the pivot. The MVP's shape was replaced with the shape the project still has:

- `data/reference-data.json` becomes the **single source of truth**, generated into `api/seed.sql` by `api/scripts/generate-seed.mjs`. The dataset and the database can no longer drift silently.
- The Worker splits into `src/{index,fees,http,types,validate}.ts`. `fees.ts` becomes a real engine with a documented contract; `validate.ts` a request validator; `http.ts` the error envelope, rate limiting and CORS.
- The fee engine adopts the two rules. No inline prices; fit checks become orientation-insensitive.
- The frontend gains real routes, a trust layer, accessibility and a PWA/service worker. Every canonical route becomes a real file; the SPA fallback `/* /index.html 200` is **deliberately removed** — it was what made `robots.txt`, `sitemap.xml`, `/privacy` and `/terms` all return the app shell with HTTP 200.
- CI appears (`cdecfe0`): typecheck, tests, budget, output checks.

### Phase 2 — Close the audit (28–29 August)

PRs #1, #2 and #3. The 12-dimension adversarial audit and a second pass on top of it. What it fixed, among others:

- A card waiver could cover an **entire party** and defeat the companion limit, because benefit coverage was keyed on a client-supplied id that was never checked for uniqueness.
- A bag could be labelled **"waived"** while the traveller was still being charged an overweight surcharge on it.
- The rate limiter ran **after** the database queries it existed to prevent.
- The 32 KB request cap could be **walked past entirely**.
- The airline FAQ **invented a 62-inch size limit** for any airline that publishes none.
- The service worker cached error pages, so one 404 would hide the offline page for that URL until the next deploy.
- The UI rebuilt a green "Verified" badge from a date for records the API had marked unverified.
- Five WCAG 2 AA contrast failures (axe-core); 24 keyboard stops, all named, all with a visible focus ring; zero axe violations across 13 routes.

### Phase 3 — Trust layer and production migration (29 August)

- Migrations `0002` (provenance columns + `benefits` rebuild) and `0003` (the `status` CHECK, which rebuilds five tables) were **rehearsed against a replica of the production schema before being applied**. The rehearsal caught a defect that would have silently wiped benefit provenance, and a second that would have emptied two tables.
- Both were then applied to production `packright-db` and verified against the live database: row counts unchanged, foreign keys re-pointed correctly by the rename, a bad `status` value confirmed rejected by the constraint.
- The legal layer landed: operating entity, postal address, California governing law, a Do Not Track statement, and a corrected privacy claim (the app *does* now write browser storage, because the service worker landed).
- `docs/owner-action-checklist.html` and its PDF were published — the first handoff artifact.

### Phase 4 — Acquirability (23 September – 4 October)

GA4 moved to a native tag with a same-origin bootstrap under the site's own CSP (`2117d76`, `468dd87`, `fa955c7`); canonical host settled on `www` with an IndexNow key file (`9ec33d7`); the explainer page gained exact-question answers and `FAQPage` schema (`722f82d`); the checker gained per-airline FAQs and a per-airline carry-on cost FAQ, generated from the data rather than written by hand (`acc5b5a`, `5ae2b2a`).

### Phase 5 — M9: source verification (4 November)

Branch `mm/m9-baggage-fees-20261104`, PR #9. Every airline was checked against **that airline's own baggage and carry-on pages**. The findings were uncomfortable:

- **Every one of the 8 existing airlines had at least one wrong or unsourced fee.** 38 of 40 individual published fields were confirmed correct; 2 were wrong; 0 of 8 airlines were wholly unchanged.
- American had repriced on 18 May 2026: Main Cabin 1st bag **$40 → $50**, 2nd **$45 → $60**; Basic Economy $40/$45 → $55/$65.
- Delta **$35/$45 → $45/$55**. United **$40/$50 → $50/$60**. Alaska **$35/$45 → $45/$55**. JetBlue **$35/$50 → $60/$75**.
- Southwest's "two free checked bags" became **$45 and $55**.
- Frontier's Economy bundle **does** include a carry-on; the data said it did not.
- Southwest and Alaska publish **no personal-item dimensions at all**, so the carried-over sizes were deleted rather than kept.

The pass grew the dataset from 8 airlines to 18, and added the two things that make it maintainable:

- **`retrieved_at`** on every record — the UTC instant the airline's page was actually read, kept separate from `verified_at` (when a steward confirmed it).
- **A 90-day freshness gate** in the frontend build and the API test suite. A record with no retrieval timestamp counts as a failure, not a pass.

It also replaced the flat `$100` overweight assumption with **per-airline banded charges**, and fixed a genuine hole: an oversize bag had been pricing at **$0**, because the engine said it had no sourced oversize fee and added nothing.

### Phase 6 — Conditional pricing (5–6 November)

Two further commits, folded into the same PR:

- `b2c2ba1` — *"Correct Frontier bundle entitlements and reconcile conditional baggage estimates"*. Frontier is no longer one fare family but four: **Basic (no bundle), Economy bundle, Premium bundle, Business bundle**, with the Business bundle including its first two 50 lb checked bags.
- `d2fe3a8` — *"Show the source and retrieval date for each fare in the rendered comparison"*. The source and retrieval date now appear per fare, not just per airline.

A **Codex policy review** re-verified five airlines against their sources and corrected two IATA designators that the M9 pass had assumed: **Avelo is XP** (ICAO VXP), **Breeze is MX** (ICAO MXY). Both have been confirmed against the airlines' own registrations. Spirit's active fare was retired, and the seed's removal of it is what a retirement looks like in practice.

### Phase 7 — Deployment (6 November)

The Worker was deployed, D1 was re-seeded (rows stamped `2026-11-06 17:45:57`), and `frontend/dist` was deployed to the Pages project `luggageliason`.

---

## 4. Where it stands right now

### Live and verified today

| | |
| --- | --- |
| Site | `https://www.luggageliason.com` — Pages project `luggageliason`, direct upload. Sitemap carries **27 URLs**, of which **17 are airline pages**. All `lastmod` 2026-11-06. |
| API | `https://packright-api.kevynsgrin.workers.dev/api/v1/*` — API version **1.2.0**. |
| Database | D1 `packright-db`. `/api/v1/health` → `{"status":"ok","database":"ok","unverifiedAirlines":0}`. Every airline and fare record is `status: verified`. |
| `main` | `94147ff`. PR #9 merged **2026-11-06T03:23:53Z**. |
| Tests | **78 API tests pass** (`npm run check` in `api`). |
| Build | `npm run build` in `frontend` → freshness gate passes (17 airlines, 34 fare families), **94.8 KB / 120 KB** initial JS, **6.1 KB / 30 KB** CSS, 27 URLs in the sitemap. |
| Local clone | `D:\MiniMax\PackRight` (external HDD), remote `github.com/Oak-Main/PackRight`. |

### The dataset as it now stands

`data/reference-data.json` v1.2.0 — **17 airlines, 34 fare families, 5 benefits, 4 TSA rules, 4 labelled assumptions**.

Every record carries the same provenance contract:

```
source_url · source_title · effective_date · retrieved_at · verified_at
verified_by · scope · currency · status (verified | unverified | assumption) · change_note
```

**Two clocks, deliberately separate:**

| Clock | Means | Limit | Enforced by |
| --- | --- | --- | --- |
| `verified_at` | When a steward confirmed the record | 30 days | `isReviewPending`, the "Review pending" badge |
| `retrieved_at` | When the airline's page was actually read | 90 days | The build gate, the badge, and the API's `dataQuality` |

A record verified today against a page read four months ago is not a current figure. Both clocks have to be inside their limits.

### The conditional-pricing model (new in Phase 6)

The engine no longer assumes one fee fits one airline. It now models:

- **`bookingDate`** on the request, and bands that can carry a `booking_change` — `{ effective_date, previous_amount }` — so a fee that changed on a date is charged at the right rate, and *with no booking date the upper band stays open* rather than a guess being made.
- **`single_excess_fee`** — Air Canada and American charge **one** excess fee when a bag is both overweight and oversize; others charge two. This replaced the naive additive model.
- **`excess_covered_from_bag`** — how many bags the excess fee is drawn from.
- **`checked_reject_weight_at` / `checked_max_accepted_linear_dim`** — past these, the bag is **refused**, not charged. New status: `not_accepted`.
- **`carry_on_purchasable`** — whether a carry-on can still be bought at the airport.
- **`included_checked_weight`** — the weight a fare includes (Frontier Business, two 50 lb bags).
- **`baseFeePrepaid`** on the bag — excess charges still apply to a bag whose base fee was already paid.
- Band bounds are now **two-sided** (`min_weight`/`max_weight`, `min_linear_dim`/`max_linear_dim`).
- New basis: `traveler` — the amount is whatever the traveller's own airline quote says.

### Migrations and the database

| Migration | Adds |
| --- | --- |
| `0002_add_provenance.sql` | Provenance columns; rebuilds `benefits` (the legacy `type TEXT NOT NULL` had no default and would have silently dropped every benefit row). |
| `0003_status_check.sql` | Rebuilds five tables to constrain `status` to the three documented values. |
| `0004_bands_and_retrieval.sql` | `retrieved_at`, `overweight_fees_json`, `oversize_fees_json`. |
| `0005_fare_allowances.sql` | The Phase 6 allowance columns. |

`npm run db:rehearse` replays migration + schema + seed against an in-memory replica of the production schema, then runs the Worker's own queries against the result. **It is the gate, not a formality** — during Phase 5 it caught a real ordering bug: migration 0003 required a non-null `slug` that only the seed could supply, so the migrations had to be reordered and 0003's copy given a `COALESCE(slug, id)` fallback.

---

## 5. Working on it

```bash
cd api && npm ci
npm run check          # strict typecheck + the API test suite (78 tests)
npm run db:rehearse    # replay migrations against a production-shaped replica
npm run generate:seed  # regenerate api/seed.sql from data/reference-data.json

cd ../frontend && npm ci
npm run build          # typecheck -> freshness gate -> client -> ssr -> prerender -> budget
npm run test           # typecheck + lint (oxlint, warnings are errors)
```

### The deploy order, and why it is that order

**A GitHub merge does not deploy anything.** Three targets deploy separately, and the order matters:

1. **Inspect the production columns** and **export a D1 backup** first.
2. **Migrations** — `npm run db:migrate:0004`, then `:0005`. Production already has 0002 and 0003. Skip fully applied migrations; if one is partly present, reconcile its individual columns before continuing.
3. **Seed** — `npm run db:seed`. The seed is **authoritative, not additive**: it writes every record in the canonical dataset and *deletes any row whose id the dataset no longer carries*. That is how a record is retired — and it is why the backup matters.
4. **Worker** — `npm run deploy`, then verify `/api/v1/reference` and `POST /api/v1/calculate-fees`.
5. **Pages** — `npx wrangler pages deploy ../frontend/dist --project-name=luggageliason --branch=main`.

The database must be migrated **before** the new Worker goes live, or reference queries fail on the new columns.

### Gotchas that will bite you

- **The seed is destructive by design.** Never run it against production without a backup, and never hand-edit the database instead of the dataset. The dataset is the source of truth; the database is a projection of it.
- **`data/reference-data.json` is imported directly by the frontend** for prerendered content and as an offline fallback. A malformed dataset breaks the frontend build, not just the API.
- **Airline pages are JavaScript-only.** A plain HTTP fetch returns an empty shell. Strip the markup and read the text; use the in-app Browser for the ones that still yield nothing. Several carriers publish their policy only through their own content API.
- **Adding an airline adds a route.** Routes, sitemap entries and JSON-LD are generated from the dataset, so a new airline gets a page for free — but the prerender step must run, and the build budget must still pass.
- **`frontend/src/lib/data.ts` and `api/test/fixtures.ts` map the dataset by hand.** New dataset fields need a mapper entry in both, and the null-dimension case (`a.carry_on?.length ?? null`) has to be preserved — several airlines publish no dimension for a bag at all.
- **`docs/owner-action-checklist.html` and its PDF are stale.** See below.

---

## 6. What is still open

### The release gate (from the August audit, updated in the README)

The engineering work behind these is done. These need a person, an account, or a decision:

| # | Item | Status now |
| --- | --- | --- |
| 1 | **Verify the dataset** | **Substantially closed.** Every airline and fare record is now verified with a source URL and a retrieval date. Issuer credit-card benefits and TSA records still need their own verification. |
| 2 | **Legal review** | Open. `/privacy`, `/terms` and `/affiliate-disclosure` describe what the code actually does and have been checked against the repository, but no lawyer has read them. Before traffic, particularly the liability limitation and the estimate disclaimer. |
| 3 | **Confirm vendor settings** | Open. The privacy page claims Cloudflare Web Analytics is cookieless and does not fingerprint. Confirm the account's actual configuration and retention. |
| 4 | **HSTS preload** | Open. `_headers` sends `preload`. Confirm every subdomain is HTTPS-ready before submitting — it is hard to reverse. |
| 5 | **Watch the CSP** | Open. Strict, no `unsafe-inline`, validated against the built output. Watch for breakage when enabling Cloudflare features that inject script (Rocket Loader). |
| 6 | **Search Console / Bing** | Open. Verify ownership, submit `sitemap.xml`, request re-indexing. Needs account access. |
| 7 | **Rate limiting** | Open. `api/src/http.ts` enforces a per-isolate limit with accurate `RateLimit-*` headers, which is best effort because Workers isolates do not share memory. Enable the binding in `wrangler.toml` or a WAF rule for a durable account-wide limit. |
| 8 | **Affiliate programme** | Open by choice. No partner links ship. `/affiliate-disclosure` sets the bar any future link must meet: a real destination, `rel="sponsored noopener noreferrer"`, and disclosure next to the link. |

### Still on the P2 list

A broader content library; a published data change log (the `data_change_log` table exists in the schema and is created by `npm run db:schema`, but **the generated seed does not write to it** — it is empty, and nothing surfaces it publicly); and the decision on whether the public brand is PackRight or Luggageliason.

### Things this handoff found that need attention

1. **`docs/owner-action-checklist.html` and `PackRight-Owner-Action-Checklist.pdf` are stale.** They are dated *"Prepared 29 August 2026"*, point at branch `claude/luggageliason-audit-p0-p1-xxun0z`, and name the repo as `kevynsgrin-a11y/PackRight` — the project now lives at `Oak-Main/PackRight`. Their three "Blockers — nothing is live until these are done" (find what is serving the site, deploy the Worker, deploy the frontend) are **all closed**. The checklist should be regenerated or retired.
2. **There is no `AGENTS.md` / `CLAUDE.md` in the repository.** The next agent has no project instructions, only this document and the READMEs.
3. **`data/reference-data.json` points `$schema` at `./reference-data.schema.json`, which does not exist.** A dangling reference; harmless, but it means no schema validation is actually happening.
4. **The 90-day freshness gate only covers airlines and fare families.** Benefits and TSA rules carry `retrieved_at` but are not checked, and their `status` is still `unverified` — consistent with gate item 1, but it means the gate is narrower than the dataset.

---

## 7. The one-paragraph version

PackRight started on 31 July 2026 as a prototype that guessed airline fees in code and compared bag dimensions length-to-length. Between August and November it was rebuilt around two ideas — *never invent a price* and *make every figure traceable* — with a canonical dataset, a rehearsed-migration discipline, a provenance contract on every record, a 90-day build gate that refuses to ship a stale policy, and a conditional-pricing model that handles banded excess fees, booking-date changes, bags that are refused rather than charged, and fare bundles that include their own checked bags. It is live at www.luggageliason.com with 17 airlines, 34 fare families, 27 prerendered URLs, a healthy API and a green build. Every airline figure in it now carries the URL it came from and the date it was read. What remains is not engineering: legal review, a handful of Cloudflare account settings, search-console access, a durable rate limit, and a decision about which of the two names the product should carry.
