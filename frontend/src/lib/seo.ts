/**
 * Per-route metadata, structured data, and the canonical route inventory.
 *
 * One module drives three things so they cannot drift apart:
 *  - the <head> injected into each prerendered HTML file,
 *  - the head updated on client-side navigation,
 *  - the sitemap and the prerender route list.
 *
 * Addresses audit issues P0-01 (title was "frontend", no description, canonical
 * or JSON-LD) and P1-17 (no Open Graph, X card, or structured data).
 */

import { airlines, retiredAirlines } from './data'
import { airlineFaqs } from './airlineFaq'
import { checkerFaqs, explainerFaqs } from './explainerFaq'
import { LEGAL_ENTITY, MAILING_ADDRESS } from './site'

export const SITE_URL = 'https://www.luggageliason.com'
export const SITE_NAME = 'PackRight'
export const OG_IMAGE = `${SITE_URL}/og/packright-home.png`
export const CONTACT_EMAIL = 'hello@luggageliason.com'
export const PRIVACY_EMAIL = 'privacy@luggageliason.com'

export interface PageMeta {
  path: string
  title: string
  description: string
  /** Omitted from the sitemap and marked noindex when true. */
  noindex?: boolean
  changefreq?: 'daily' | 'weekly' | 'monthly' | 'yearly'
  priority?: number
  jsonLd?: Record<string, unknown>[]
}

const organization = {
  '@type': 'Organization',
  '@id': `${SITE_URL}/#organization`,
  name: SITE_NAME,
  legalName: LEGAL_ENTITY,
  url: SITE_URL,
  description: 'PackRight is the baggage-planning tool at Luggageliason.com.',
  address: {
    '@type': 'PostalAddress',
    streetAddress: MAILING_ADDRESS.street,
    addressLocality: MAILING_ADDRESS.locality,
    addressRegion: MAILING_ADDRESS.region,
    postalCode: MAILING_ADDRESS.postalCode,
    addressCountry: MAILING_ADDRESS.country,
  },
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'customer support',
    email: CONTACT_EMAIL,
    url: `${SITE_URL}/contact`,
  },
}

const webApplication = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  '@id': `${SITE_URL}/#webapp`,
  name: SITE_NAME,
  url: SITE_URL,
  applicationCategory: 'TravelApplication',
  operatingSystem: 'Any modern web browser',
  browserRequirements: 'Requires JavaScript for the interactive calculator.',
  description:
    'Estimate airline baggage fees, compare carry-on and personal-item limits, and plan a lighter trip.',
  isAccessibleForFree: true,
  publisher: organization,
}

const breadcrumb = (trail: Array<{ name: string; path: string }>) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: trail.map((item, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: item.name,
    item: `${SITE_URL}${item.path}`,
  })),
})

/** Only ever emitted for pages that render the same questions and answers visibly. */
export const faqSchema = (entries: Array<{ question: string; answer: string }>) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: entries.map((entry) => ({
    '@type': 'Question',
    name: entry.question,
    acceptedAnswer: { '@type': 'Answer', text: entry.answer },
  })),
})

export const STATIC_PAGES: PageMeta[] = [
  {
    path: '/',
    title: 'Airline Baggage Fee Calculator & Carry-On Size Checker | PackRight',
    description:
      'Estimate airline baggage fees, compare carry-on and personal-item limits, and plan a lighter trip with PackRight. Always verify final fees with your airline.',
    changefreq: 'weekly',
    priority: 1.0,
    jsonLd: [webApplication],
  },
  {
    path: '/airlines',
    title: 'Airline Baggage Fees and Carry-On Limits | PackRight',
    description:
      'Compare baggage fees, carry-on sizes and personal-item limits across the airlines PackRight models, each with its source and review status.',
    changefreq: 'weekly',
    priority: 0.9,
    jsonLd: [breadcrumb([{ name: 'Home', path: '/' }, { name: 'Airlines', path: '/airlines' }])],
  },
  {
    path: '/carry-on-size-checker',
    title: 'Carry-On Size Checker by Airline | PackRight',
    description:
      'Enter your bag dimensions and see which airlines accept it as a carry-on. Sizes are checked in any orientation, and every limit shows its review status.',
    changefreq: 'weekly',
    priority: 0.8,
    jsonLd: [
      breadcrumb([
        { name: 'Home', path: '/' },
        { name: 'Carry-on size checker', path: '/carry-on-size-checker' },
      ]),
      // Only emitted because the page renders exactly these questions and
      // answers visibly. See src/lib/explainerFaq.ts (checkerFaqs).
      faqSchema(checkerFaqs()),
    ],
  },
  {
    path: '/personal-item-size-comparison',
    title: 'Personal Item Size Limits by Airline | PackRight',
    description:
      'A side-by-side comparison of personal-item size limits across airlines, each figure shown with its review status.',
    changefreq: 'weekly',
    priority: 0.8,
    jsonLd: [
      breadcrumb([
        { name: 'Home', path: '/' },
        { name: 'Personal item comparison', path: '/personal-item-size-comparison' },
      ]),
    ],
  },
  {
    path: '/how-baggage-fees-work',
    title: 'How Airline Baggage Fees Work: What Changes the Price | PackRight',
    description:
      'What actually moves the price of a checked bag or carry-on: fare family, bag count, size, weight, card benefits and when you pay.',
    changefreq: 'monthly',
    priority: 0.7,
    jsonLd: [
      breadcrumb([
        { name: 'Home', path: '/' },
        { name: 'How baggage fees work', path: '/how-baggage-fees-work' },
      ]),
      // Only emitted because the page renders exactly these questions and
      // answers visibly. See src/lib/explainerFaq.ts.
      faqSchema(explainerFaqs()),
    ],
  },
  {
    path: '/methodology',
    title: 'How PackRight Estimates Airline Baggage Fees | PackRight',
    description:
      'What PackRight estimates, what it does not, where the numbers come from, how card benefits are applied, and how to report an error.',
    changefreq: 'monthly',
    priority: 0.8,
    jsonLd: [
      breadcrumb([{ name: 'Home', path: '/' }, { name: 'Methodology', path: '/methodology' }]),
    ],
  },
  {
    path: '/privacy',
    title: 'Privacy Policy | PackRight',
    description:
      'What PackRight collects, what it sends to its calculation service, the analytics it uses, and how to exercise your privacy rights.',
    changefreq: 'yearly',
    priority: 0.4,
  },
  {
    path: '/terms',
    title: 'Terms of Use | PackRight',
    description:
      'The terms that apply to using PackRight, including the limits of a baggage fee estimate.',
    changefreq: 'yearly',
    priority: 0.3,
  },
  {
    path: '/affiliate-disclosure',
    title: 'Affiliate Disclosure | PackRight',
    description:
      'How PackRight would handle commercial links, and the current status of affiliate relationships on this site.',
    changefreq: 'yearly',
    priority: 0.3,
  },
  {
    path: '/contact',
    title: 'Contact PackRight | PackRight',
    description:
      'Report a wrong baggage fee, ask a privacy question, or get in touch with the PackRight team.',
    changefreq: 'yearly',
    priority: 0.4,
  },
]

export const airlinePagePath = (slug: string): string => `/airlines/${slug}/baggage-fees`

export function airlinePageMeta(slug: string): PageMeta | null {
  const airline = airlines.find((a) => a.slug === slug)
  if (!airline) {
    const retired = retiredAirlines.find(a => a.slug === slug)
    return retired ? { path: airlinePagePath(slug), title: retired.name + ' | PackRight',
      description: 'This carrier has ceased operations. Current baggage estimates are unavailable.', noindex: true } : null
  }
  const path = airlinePagePath(slug)
  return {
    path,
    title: `${airline.name} Baggage Fees and Carry-On Limits | PackRight`,
    description:
      `${airline.name} carry-on, personal item and checked bag limits, with the fee figures PackRight models, ` +
      'the source behind each one, and its current review status.',
    changefreq: 'weekly',
    priority: 0.8,
    jsonLd: [
      breadcrumb([
        { name: 'Home', path: '/' },
        { name: 'Airlines', path: '/airlines' },
        { name: airline.name, path },
      ]),
      // Only emitted because the page renders exactly these questions and
      // answers visibly. See src/lib/airlineFaq.ts.
      faqSchema(airlineFaqs(airline)),
    ],
  }
}

export const NOT_FOUND_META: PageMeta = {
  path: '/404',
  title: 'Page not found | PackRight',
  description: 'That page does not exist on PackRight.',
  noindex: true,
}

/** Every canonical route, for prerendering and the sitemap. */
export function allPageMeta(): PageMeta[] {
  const airlinePages = [...airlines, ...retiredAirlines]
    .map((a) => airlinePageMeta(a.slug))
    .filter((m): m is PageMeta => m !== null)
  return [...STATIC_PAGES, ...airlinePages]
}

/** Resolves the metadata for a pathname, including dynamic airline routes. */
export function resolvePageMeta(pathname: string): PageMeta {
  const path = pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  const staticMatch = STATIC_PAGES.find((p) => p.path === path)
  if (staticMatch) return staticMatch

  const airlineMatch = /^\/airlines\/([^/]+)\/baggage-fees$/.exec(path)
  if (airlineMatch) {
    const meta = airlinePageMeta(airlineMatch[1])
    if (meta) return meta
  }
  return { ...NOT_FOUND_META, path }
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Escapes a JSON-LD payload so it cannot terminate its own script element. */
const escapeJsonLd = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')

/** Renders the full head fragment for a page. Used by the prerenderer. */
export function renderHeadTags(meta: PageMeta): string {
  const canonical = `${SITE_URL}${meta.path === '/404' ? '/404' : meta.path}`
  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}">`,
    `<link rel="canonical" href="${canonical}">`,
    meta.noindex
      ? '<meta name="robots" content="noindex, follow">'
      : '<meta name="robots" content="index, follow, max-image-preview:large">',
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}">`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}">`,
    `<meta property="og:url" content="${canonical}">`,
    `<meta property="og:image" content="${OG_IMAGE}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="PackRight, the airline baggage fee calculator at Luggageliason.com">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}">`,
    `<meta name="twitter:image" content="${OG_IMAGE}">`,
  ]
  for (const block of meta.jsonLd ?? []) {
    // data-packright marks these as ours so SeoHead can clear them on a
    // client-side route change. Without it the previous page's structured data
    // would stay in the head and describe the wrong URL.
    tags.push(
      `<script type="application/ld+json" data-packright="true">${escapeJsonLd(block)}</script>`,
    )
  }
  return tags.join('\n    ')
}
