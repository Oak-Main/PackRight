import type { ExtraBag } from '../lib/bins'

interface Props {
  bags: ExtraBag[]
  onChange: (bags: ExtraBag[]) => void
  firstOrdinal: number
}

export default function ExtraCheckedBags({ bags, onChange, firstOrdinal }: Props) {
  function update(id: string, change: Partial<ExtraBag>) {
    onChange(bags.map(b => b.id === id ? { ...b, ...change } : b))
  }
  return (
    <fieldset className="glass-panel p-6 space-y-4">
      <legend className="sr-only">Other checked bags</legend>
      {bags.map((bag, i) => (
        <fieldset key={bag.id} className="space-y-2 border-b border-white/10 pb-3">
          <legend className="text-sm font-medium">Checked bag {firstOrdinal + i}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(['weight', 'length', 'width', 'height'] as const).map(field => (
              <label key={field} className="text-sm capitalize">
                {field} ({field === 'weight' ? 'lb' : 'in'})
                <input type="number" min={field === 'weight' ? 0 : 0.1} step="any"
                  value={(field === 'weight' ? bag.weight : bag.dimensions[field]) ?? ''}
                  className="block w-full rounded bg-premium-900 p-2 text-white"
                  onChange={event => {
                    const value = event.target.value === '' ? null : event.target.valueAsNumber
                    if (value != null && (!Number.isFinite(value) || value < 0)) return
                    update(bag.id, field === 'weight' ? { weight: value } : { dimensions: { ...bag.dimensions, [field]: value } })
                  }}
                />
              </label>
            ))}
          </div>
          <label className="text-sm"><input type="checkbox" checked={bag.baseFeePrepaid}
            onChange={e => update(bag.id, { baseFeePrepaid: e.target.checked })} /> Base bag fee already paid</label>
          <button type="button" className="ml-4 text-sm underline" onClick={() => onChange(bags.filter(b => b.id !== bag.id))}>
            Remove bag {firstOrdinal + i}
          </button>
        </fieldset>
      ))}
      <button type="button" disabled={bags.length >= 7} className="rounded border border-white/25 px-3 py-2 text-sm disabled:opacity-50"
        onClick={() => onChange([...bags, { id: crypto.randomUUID(), weight: null, dimensions: { length: null, width: null, height: null }, baseFeePrepaid: false }])}>
        Add a checked bag per passenger
      </button>
    </fieldset>
  )
}
