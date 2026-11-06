import { useMemo, useState } from 'react'
import { ArrowUpDown } from 'lucide-react'
import { Link } from 'react-router-dom'
import { CalculatorCta, PageHeader, Prose } from '../components/Page'
import { StatusBadge } from '../components/Provenance'
import { airlines } from '../lib/data'
import { formatDimensions } from '../lib/format'
import { airlinePagePath } from '../lib/seo'

type SortKey = 'name' | 'volume' | 'longest'

const volumeOf = (a: (typeof airlines)[number]): number | null => {
  const { personal_item_length: l, personal_item_width: w, personal_item_height: h } = a
  if (l == null || w == null || h == null) return null
  return l * w * h
}

const longestSideOf = (a: (typeof airlines)[number]): number | null => {
  const sides = [a.personal_item_length, a.personal_item_width, a.personal_item_height]
  if (sides.some((s) => s == null)) return null
  return Math.max(...(sides as number[]))
}

/**
 * Fixed width classes in 5% steps.
 *
 * A `style={{ width }}` attribute would be blocked by the site's
 * `style-src 'self'` Content Security Policy, and Tailwind cannot generate a
 * class from a runtime-built string, so the steps are written out literally.
 */
const WIDTH_CLASSES = [
  'w-0', 'w-[5%]', 'w-[10%]', 'w-[15%]', 'w-[20%]', 'w-[25%]', 'w-[30%]', 'w-[35%]',
  'w-[40%]', 'w-[45%]', 'w-[50%]', 'w-[55%]', 'w-[60%]', 'w-[65%]', 'w-[70%]', 'w-[75%]',
  'w-[80%]', 'w-[85%]', 'w-[90%]', 'w-[95%]', 'w-full',
] as const

const widthClassFor = (percent: number): string =>
  WIDTH_CLASSES[Math.min(WIDTH_CLASSES.length - 1, Math.max(0, Math.round(percent / 5)))]

export default function PersonalItemComparison() {
  const [sortKey, setSortKey] = useState<SortKey>('volume')

  const sorted = useMemo(() => {
    const rows = [...airlines]
    rows.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name)
      const va = sortKey === 'volume' ? volumeOf(a) : longestSideOf(a)
      const vb = sortKey === 'volume' ? volumeOf(b) : longestSideOf(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      return vb - va
    })
    return rows
  }, [sortKey])

  const largest = sorted.reduce<number>((max, a) => Math.max(max, volumeOf(a) ?? 0), 0)

  const SortButton = ({ value, label }: { value: SortKey; label: string }) => (
    <button
      type="button"
      onClick={() => setSortKey(value)}
      aria-pressed={sortKey === value}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary ${
        sortKey === value
          ? 'border-accent-primary/50 bg-accent-primary/15 text-white'
          : 'border-white/25 text-text-muted hover:text-white'
      }`}
    >
      <ArrowUpDown className="w-3.5 h-3.5" aria-hidden="true" />
      {label}
    </button>
  )

  return (
    <>
      <PageHeader
        eyebrow="Comparison"
        title="Personal Item Size Limits by Airline"
        lede="The under-seat bag is the one allowance almost every fare includes. These are the limits PackRight models, sorted so you can see which airlines are most and least generous."
      />

      <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Sort airlines by">
        <SortButton value="volume" label="Most space first" />
        <SortButton value="longest" label="Longest side first" />
        <SortButton value="name" label="Airline name" />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/10 mb-8">
        <table className="w-full text-sm min-w-[720px]">
          <caption className="sr-only">Personal item size limits by airline</caption>
          <thead className="bg-premium-800/80 text-left">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold text-white">Airline</th>
              <th scope="col" className="px-4 py-3 font-semibold text-white">Personal item limit</th>
              <th scope="col" className="px-4 py-3 font-semibold text-white">Approximate volume</th>
              <th scope="col" className="px-4 py-3 font-semibold text-white">Relative space</th>
              <th scope="col" className="px-4 py-3 font-semibold text-white">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((airline) => {
              const volume = volumeOf(airline)
              const share = volume && largest ? Math.round((volume / largest) * 100) : 0
              return (
                <tr key={airline.id} className="border-t border-white/5">
                  <th scope="row" className="px-4 py-3 text-left font-medium">
                    <Link
                      to={airlinePagePath(airline.slug)}
                      className="text-white hover:text-accent-secondary underline underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                    >
                      {airline.name}
                    </Link>
                  </th>
                  <td className="px-4 py-3 text-text-muted">
                    {formatDimensions(
                      airline.personal_item_length,
                      airline.personal_item_width,
                      airline.personal_item_height,
                    ) ?? 'Not published'}
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {volume ? `${Math.round(volume).toLocaleString('en-US')} cu in` : 'Not published'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2 w-24 rounded-full bg-premium-700 overflow-hidden"
                        role="img"
                        aria-label={`${share} percent of the largest personal item allowance shown`}
                      >
                        <div
                          className={`h-full rounded-full bg-gradient-to-r from-accent-primary to-accent-secondary ${widthClassFor(share)}`}
                        />
                      </div>
                      <span className="text-xs text-text-muted">{share}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={airline.status} verifiedAt={airline.verified_at} retrievedAt={airline.retrieved_at} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Prose>
        <h2 id="why-it-matters">Why the personal item matters</h2>
        <p>
          Every fare family PackRight models includes a personal item, including basic fares that
          exclude a carry-on. On those fares the under-seat bag is the whole free allowance, which
          makes its size the difference between paying nothing and paying for a bag.
        </p>

        <h2 id="how-to-read">How to read the comparison</h2>
        <p>
          Volume is length times width times height, which is a rough guide only: a long, flat
          allowance and a short, deep one can have the same volume and hold very different things.
          The relative bar compares each airline against the largest allowance shown.
        </p>
        <p>
          Sizes include wheels and handles. A bag fits if its three sides are within the three
          published measurements in any order, which is how our{' '}
          <Link to="/carry-on-size-checker">size checker</Link> compares them.
        </p>

        <h2 id="caveats">Caveats</h2>
        <ul>
          <li>Some airlines describe the personal item by what fits under a seat rather than by a strict box.</li>
          <li>Aircraft type and seat position change how much room is actually under the seat.</li>
          <li>Partner-operated and international segments can apply a different allowance.</li>
        </ul>
        <p>
          Each row shows its own review status. See the <Link to="/methodology">methodology</Link> for
          what that means.
        </p>
      </Prose>

      <CalculatorCta />
    </>
  )
}
