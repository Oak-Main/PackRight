import { useId, useMemo, useState } from 'react'
import { Check, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { CalculatorCta, PageHeader, Prose } from '../components/Page'
import { checkerFaqs } from '../lib/explainerFaq'
import { StatusBadge } from '../components/Provenance'
import { airlines } from '../lib/data'
import { fitsWithin, type Box } from '../lib/fit'
import { formatDimensions } from '../lib/format'
import { airlinePagePath } from '../lib/seo'

export default function CarryOnSizeChecker() {
  const baseId = useId()
  const [bag, setBag] = useState<Box>({ length: null, width: null, height: null })

  const entered = bag.length != null && bag.width != null && bag.height != null

  const rows = useMemo(
    () =>
      airlines.map((airline) => {
        const carryOn: Box = {
          length: airline.carry_on_length,
          width: airline.carry_on_width,
          height: airline.carry_on_height,
        }
        const personal: Box = {
          length: airline.personal_item_length,
          width: airline.personal_item_width,
          height: airline.personal_item_height,
        }
        return {
          airline,
          carryOn,
          personal,
          fitsCarryOn: fitsWithin(bag, carryOn),
          fitsPersonal: fitsWithin(bag, personal),
        }
      }),
    [bag],
  )

  const fitCount = rows.filter((r) => r.fitsCarryOn === true).length

  const Verdict = ({ value }: { value: boolean | null }) => {
    if (value === null) return <span className="text-text-muted text-xs">Enter your bag size</span>
    return value ? (
      <span className="inline-flex items-center gap-1 text-green-400 text-sm font-medium">
        <Check className="w-4 h-4" aria-hidden="true" />
        Fits
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-red-300 text-sm font-medium">
        <X className="w-4 h-4" aria-hidden="true" />
        Too big
      </span>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Tool"
        title="Carry-On Size Checker by Airline"
        lede="Enter your bag's measurements once and see which airlines accept it as a carry-on, and which would only take it as a personal item."
      />

      <section aria-labelledby="measure-heading" className="glass-panel p-6 mb-8 max-w-2xl">
        <h2 id="measure-heading" className="text-lg font-semibold text-white mb-1">
          Your bag
        </h2>
        <p className="text-sm text-text-muted mb-4">
          Measure the widest points, including wheels and handles, in inches.
        </p>

        <div className="grid grid-cols-3 gap-3">
          {(['length', 'width', 'height'] as const).map((axis) => {
            const inputId = `${baseId}-${axis}`
            return (
              <div key={axis}>
                <label htmlFor={inputId} className="block text-sm text-text-muted mb-1 capitalize">
                  {axis}
                </label>
                <input
                  id={inputId}
                  name={axis}
                  type="number"
                  inputMode="decimal"
                  min={1}
                  max={120}
                  step={0.5}
                  placeholder="--"
                  value={bag[axis] ?? ''}
                  onChange={(e) =>
                    setBag((current) => ({
                      ...current,
                      [axis]: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }
                  className="w-full bg-premium-900 border border-white/25 rounded-xl py-2 px-3 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                />
              </div>
            )
          })}
        </div>

        <p role="status" aria-live="polite" className="mt-4 text-sm text-text-muted min-h-[1.5rem]">
          {entered
            ? `Your bag fits the carry-on allowance for ${fitCount} of ${airlines.length} airlines.`
            : 'Enter all three measurements to check your bag.'}
        </p>
      </section>

      <div className="overflow-x-auto rounded-2xl border border-white/10 mb-8">
        <table className="w-full text-sm min-w-[760px]">
          <caption className="sr-only">Whether your bag fits each airline's carry-on and personal item allowance</caption>
          <thead className="bg-premium-800/80 text-left">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold text-white">Airline</th>
              <th scope="col" className="px-4 py-3 font-semibold text-white">Carry-on limit</th>
              <th scope="col" className="px-4 py-3 font-semibold text-white">As a carry-on</th>
              <th scope="col" className="px-4 py-3 font-semibold text-white">As a personal item</th>
              <th scope="col" className="px-4 py-3 font-semibold text-white">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ airline, carryOn, fitsCarryOn, fitsPersonal }) => (
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
                  {formatDimensions(carryOn.length, carryOn.width, carryOn.height) ?? 'Not published'}
                </td>
                <td className="px-4 py-3">
                  <Verdict value={fitsCarryOn} />
                </td>
                <td className="px-4 py-3">
                  <Verdict value={fitsPersonal} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={airline.status} verifiedAt={airline.verified_at} retrievedAt={airline.retrieved_at} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Prose>
        <h2 id="how-measuring-works">How the check works</h2>
        <p>
          A bag fits if its three sides are within the airline&rsquo;s three published measurements in
          any order. PackRight sorts both your bag and the allowance from longest to shortest before
          comparing, so it does not matter which side you call the length. That also means a bag can
          fit even when a naive side-by-side comparison says otherwise.
        </p>

        <h2 id="caveats">What this cannot tell you</h2>
        <ul>
          <li>
            Soft bags compress and hard shells do not. A sizer at the gate is unforgiving in a way a
            table cannot capture.
          </li>
          <li>
            Regional jets and some smaller aircraft have narrower bins, so a bag that fits the
            published allowance may still be gate-checked.
          </li>
          <li>
            Wheels, handles and external pockets count. Measure the widest points, not the marketing
            dimensions on the tag.
          </li>
          <li>Allowances can differ on partner-operated and international segments.</li>
        </ul>
        <p>
          Every limit above shows its own review status. Read the{' '}
          <Link to="/methodology">methodology</Link> for what that means, or compare the smaller bag
          in our <Link to="/personal-item-size-comparison">personal item comparison</Link>.
        </p>

        <h2>Questions people ask</h2>
        {checkerFaqs().map((entry) => (
          <div key={entry.question}>
            <h3>{entry.question}</h3>
            <p>{entry.answer}</p>
          </div>
        ))}
      </Prose>

      <CalculatorCta />
    </>
  )
}
