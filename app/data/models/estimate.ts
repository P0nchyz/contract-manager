// app/data/models/estimate.ts
import type {
  ConceptId,
  ContractId,
  CorporationId,
  EstimateId,
  EstimateStatus,
  FileId,
  LogNoteId,
  Money,
  Percentage,
  Signature,
  UserId,
  WorkflowEvent,
} from './common'

/**
 * The estimate "cover" — the predefined header. Mostly DERIVED from the
 * contract + contractor + estimate metadata (read-only/black on screen).
 */
export interface EstimateCover {
  contractCode: string
  contractTitle: string
  contractorName: string
  contractorCorporationId: CorporationId | null
  estimateNumber: number
  periodIndex: number
  periodStart: Date
  periodEnd: Date
}

/**
 * One row of the estimate concept grid. Field comments mark the on-screen
 * color/source per spec:
 *   black = read-only, previously known (contract or prior estimates)
 *   red   = read-only, auto-calculated from THIS estimate
 *   green = editable
 */
export interface EstimateLineItem {
  conceptId: ConceptId // ref to catalog concept
  conceptNumber: number // (1) sequential within this estimate
  specificationNumber: string // (2) from catalog            [black]
  description: string // (3) concept description             [black]
  unit: string // (4) unit                                   [black]
  inProject: number // (5) contracted quantity               [black]
  upToLastEstimate: number // (6) accumulated before this    [black]
  inThisEstimate: number // (7) quantity this estimate       [green / editable]
  totalEstimated: number // (8) = upToLastEstimate + inThisEstimate   [red]
  toExecute: number // (9) = inProject - totalEstimated      [red]
  unitPrice: Money // (10) from contract                     [black]
  totalAmount: Money // (11) = unitPrice * inThisEstimate    [red]
}

// --- Summary: TWO tables ---------------------------------------------------

/**
 * Table 1 — concept rollup. One row per concept in the estimate, summed to a
 * subtotal. (Subtotal === calculations.estimateAmount.)
 */
export interface EstimateConceptSummaryRow {
  conceptId: ConceptId
  specificationNumber: string
  description: string
  amount: Money // this concept's importe in this estimate
}

export interface EstimateConceptSummary {
  rows: EstimateConceptSummaryRow[]
  subtotal: Money
}

/**
 * Table 2 — lists the concept rows AND the financial calculations for this
 * estimate.
 */
export interface EstimateCalculations {
  rows: EstimateConceptSummaryRow[] // same concept rows as table 1
  ivaRate: Percentage // e.g. 16
  estimateAmount: Money // importe de la estimación (= subtotal)
  estimateIva: Money
  estimateTotal: Money // estimateAmount + estimateIva
  anticipoAmortization: Money // amortización de anticipo
  amortizationIva: Money
  amortizationTotal: Money // anticipoAmortization + amortizationIva
  retentions: Money // retenciones / fondo de garantía
  cincoAlMillarSfp: Money // 5 al millar SFP (0.5%)
  total: Money // estimateTotal - amortizationTotal - retentions - cincoAlMillarSfp
}

export interface EstimateSummary {
  conceptSummary: EstimateConceptSummary // table 1
  calculations: EstimateCalculations // table 2
}

/**
 * A construction estimate (estimación). Only Superintendents create these.
 * Lifecycle: draft -> submitted -> (with_notes | rejected -> back to draft)
 *            -> approved -> paid.
 */
export interface Estimate {
  id: EstimateId
  contractId: ContractId
  number: number
  /** 1-based period number matching the period index+1 in the work schedule. */
  periodIndex: number
  status: EstimateStatus
  periodStart: Date  // derived from periodIndex for display
  periodEnd: Date    // derived from periodIndex for display

  cover: EstimateCover
  lineItems: EstimateLineItem[]
  summary: EstimateSummary

  signatures: Signature[] // resident + superintendent + supervisor
  history: WorkflowEvent[] // immutable trace; notes render inline on view

  // Attachments section
  evidenceFileIds: FileId[]
  linkedLogNoteIds: LogNoteId[]

  createdById: UserId // superintendent
  createdAt: Date
  updatedAt: Date
}