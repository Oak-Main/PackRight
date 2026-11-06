/** Shared types and helpers for the packing bins. */
import type { BagType, BagInput } from './api'

export interface PackItem {
  id: string
  name: string
  /** Screen-reader friendly expansion, e.g. "Shampoo over 3.4 ounces". */
  spokenName: string
  weight: number
  tsa: 'safe' | 'checked_only' | 'prohibited'
}

export interface BinDimensions {
  length: number | null
  width: number | null
  height: number | null
}

export interface Bin {
  items: PackItem[]
  dimensions: BinDimensions
  /** Weight of the empty bag itself, in pounds. */
  emptyWeight: number | null
}

export type Bins = Record<BagType, Bin>

export const BIN_ORDER: BagType[] = ['personal', 'carry_on', 'checked']

export const BIN_LABELS: Record<BagType, string> = {
  personal: 'Personal item',
  carry_on: 'Carry-on bag',
  checked: 'Checked bag',
}

export const binTotalWeight = (bin: Bin): number =>
  (bin.emptyWeight ?? 0) + bin.items.reduce((sum, item) => sum + item.weight, 0)

export interface ExtraBag {
  id: string
  weight: number | null
  dimensions: BinDimensions
  baseFeePrepaid: boolean
}

export function toCheckedBag(bag: ExtraBag): BagInput {
  const { length, width, height } = bag.dimensions
  return {
    type: 'checked', weight: bag.weight, baseFeePrepaid: bag.baseFeePrepaid,
    dimensions: length != null && width != null && height != null ? { length, width, height } : null,
  }
}
