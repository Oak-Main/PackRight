/** Shared record and response types for the PackRight API. */

export type RecordStatus = 'verified' | 'unverified' | 'assumption'

/** How a displayed amount was arrived at. */
export type FeeBasis = 'sourced' | 'assumption' | 'unknown'

/** Outcome for a single bag line. */
export type FeeStatus = 'priced' | 'included' | 'waived' | 'unpriced'

export interface Provenance {
  source_url: string | null
  source_title: string | null
  effective_date: string | null
  /**
   * UTC timestamp of when the source page was read for the current check.
   *
   * `verified_at` is when a steward confirmed the record; `retrieved_at` is when
   * the airline's own page was actually fetched. They are separate facts: a
   * record can be verified against a source read days earlier, and a fresh
   * retrieval that nobody has checked yet is still unverified.
   */
  retrieved_at: string | null
  verified_at: string | null
  verified_by: string | null
  scope: string | null
  currency: string
  status: RecordStatus
  change_note: string | null
}

/**
 * A published overweight band.
 *
 * Airlines price overweight checked bags in bands rather than one flat rate:
 * American charges $30 for 51-53 lb, $100 for 54-70 lb and $200 for 71-100 lb.
 * `max_weight` is the inclusive upper bound of the band in pounds.
 */
export interface OverweightBand {
  max_weight: number
  amount: number
}

/**
 * A published oversize band, priced by total linear dimensions.
 *
 * `max_linear_dim` is the inclusive upper bound of the band in linear inches
 * (length + width + height). A band list may stop short of the airline's
 * acceptance limit, because past that limit a bag is refused rather than
 * charged.
 */
export interface OversizeBand {
  max_linear_dim: number
  amount: number
}

export interface AirlineRecord extends Provenance {
  id: string
  slug: string
  name: string
  iata_code: string
  personal_item_length: number | null
  personal_item_width: number | null
  personal_item_height: number | null
  carry_on_length: number | null
  carry_on_width: number | null
  carry_on_height: number | null
  carry_on_weight: number | null
  checked_bag_weight: number | null
  checked_bag_linear_dim: number | null
  /** Published overweight bands, cheapest applicable band first. Null when unpublished. */
  overweight_fees: OverweightBand[] | null
  /** Published oversize bands, cheapest applicable band first. Null when unpublished. */
  oversize_fees: OversizeBand[] | null
  updated_at?: string | null
}

export interface FareFamilyRecord extends Provenance {
  id: string
  airline_id: string
  name: string
  includes_personal_item: number
  includes_carry_on: number
  first_checked_fee: number | null
  second_checked_fee: number | null
  third_plus_checked_fee: number | null
  carry_on_fee: number | null
}

export interface BenefitRecord extends Provenance {
  id: string
  name: string
  airline_id: string
  benefit_type: string
  tier: string | null
  waives_first_checked: number
  waives_second_checked: number
  waives_carry_on: number
  companion_limit: number
}

export interface FeeAssumptionRecord {
  id: string
  label: string
  amount: number
  currency: string
  status: RecordStatus
  change_note: string | null
}

export interface Dimensions {
  length: number
  width: number
  height: number
}

export type BagType = 'personal' | 'carry_on' | 'checked'

export interface BagInput {
  type: BagType
  weight: number | null
  dimensions: Dimensions | null
}

export interface PassengerInput {
  id: string
  benefitIds: string[]
  bags: BagInput[]
}

export interface CalculationRequest {
  airlineId: string
  fareFamilyId: string
  passengers: PassengerInput[]
}

/** One priced element of a bag. Amount is null when PackRight has no basis for a figure. */
export interface FeeComponent {
  label: string
  amount: number | null
  basis: FeeBasis
  /** Populated when basis is 'assumption', so the UI can explain the number. */
  assumptionId?: string
  note?: string
}

export interface BagLine {
  type: BagType
  /** 1-based position within its own type, for this passenger. */
  ordinal: number
  weight: number | null
  dimensions: Dimensions | null
  /** null when any component is unpriced. */
  fee: number | null
  currency: string
  status: FeeStatus
  basis: FeeBasis
  reason: string
  components: FeeComponent[]
  /** null when either the bag or the airline limit has no dimensions. */
  fitsAllowance: boolean | null
  warnings: string[]
}

export interface PassengerLine {
  paxId: string
  /** Sum of priced bag fees only. */
  paxFee: number
  hasUnpricedItems: boolean
  appliedBenefitIds: string[]
  bags: BagLine[]
}

export interface DataQuality {
  /** True when any record backing this result is unverified or stale. */
  reviewPending: boolean
  reviewIntervalDays: number
  /** Oldest verified_at across every record used, or null if none is verified. */
  lastVerifiedAt: string | null
  /** Ids of records that are unverified or past the review interval. */
  pendingRecords: Array<{ type: string; id: string; status: RecordStatus; verified_at: string | null }>
  sources: Array<{
    type: string
    id: string
    title: string | null
    url: string | null
    verified_at: string | null
    /** The record's real status. Without this the UI can only guess from the date. */
    status: RecordStatus
  }>
}

export interface CalculationResponse {
  apiVersion: string
  currency: string
  /** Sum of every priced bag fee across all passengers. Excludes unpriced items. */
  totalFee: number
  /** True when at least one bag could not be priced from sourced or assumed data. */
  hasUnpricedItems: boolean
  unpricedItemCount: number
  /** True when at least one displayed amount is a labelled assumption rather than a sourced fee. */
  usesAssumptions: boolean
  passengerBreakdown: PassengerLine[]
  assumptionsApplied: FeeAssumptionRecord[]
  dataQuality: DataQuality
  disclaimer: string
  calculatedAt: string
}
