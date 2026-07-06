// app/data/models/estimate.ts
import type {
  ConceptId,
  ConceptSectionId,
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
 * The estimate "cover" (Carátula) — the predefined header. DERIVED from the
 * contract + contractor + estimate metadata.
 */
export interface EstimateCover {
  entityName: string
  contractCode: string
  contractTitle: string
  contractStartDate: Date
  contractorName: string
  contractorRfc: string | null
  estimateNumber: number
  periodIndex: number
  periodStart: Date
  periodEnd: Date
}

// --- Hojas Generadoras -----------------------------------------------------

/**
 * A single measurement row inside a Hoja Generadora. Each row records an
 * executed quantity and carries its own evidence (a required photo on submit,
 * plus optional extra files and linked log notes).
 */
export interface HojaRow {
  id: string
  quantity: number            // "Cantidad" executed in this row
  photoFileId: FileId | null  // required to SUBMIT (may be null while draft)
  fileIds: FileId[]           // optional additional files
  logNoteIds: LogNoteId[]     // optional linked log notes
}

/**
 * A Hoja Generadora — the ONLY place quantities are entered. Exactly one
 * concept per Hoja; a Hoja may contain multiple rows of that same concept,
 * each with its own evidence. The Hoja total = sum of its rows' quantities and
 * feeds the estimate's calculations for that concept.
 */
export interface HojaGeneradora {
  id: string
  number: number              // "No. de Hoja Generadora" — sequential within the estimate
  conceptId: ConceptId
  // Snapshot of concept fields (frozen at creation for display)
  specificationNumber: string
  description: string
  unit: string
  sectionId: ConceptSectionId // "Partida"
  contractedQuantity: number  // "Catálogo" cantidad
  unitPrice: Money
  rows: HojaRow[]
}

/**
 * A derived per-concept line used for the "Estimación de Servicios Ejecutados"
 * table. Computed from the Hojas (never edited directly).
 */
export interface EstimateLineItem {
  conceptId: ConceptId
  conceptNumber: number
  specificationNumber: string
  description: string
  unit: string
  inProject: number          // contracted quantity
  upToLastEstimate: number   // accumulated across prior APPROVED estimates
  inThisEstimate: number     // = sum of this concept's Hoja rows
  totalEstimated: number     // upToLastEstimate + inThisEstimate
  toExecute: number          // inProject - totalEstimated
  unitPrice: Money
  totalAmount: Money         // unitPrice * inThisEstimate
}

// --- Summary (Resumen por Partida) -----------------------------------------

/** One row = one concept SECTION (partida) referenced by the Hojas. */
export interface EstimatePartidaRow {
  sectionId: ConceptSectionId
  partidaNumber: string   // "Num. de Partida" (section specificationNumber)
  description: string
  amount: Money           // sum of the section's concept amounts in this estimate
}

export interface EstimateCalculations {
  ivaRate: Percentage
  estimateAmount: Money        // importe de la estimación (= partidas subtotal)
  estimateIva: Money
  estimateTotal: Money         // estimateAmount + estimateIva
  anticipoAmortization: Money  // amortización de anticipo
  amortizationIva: Money       // IVA on the amortization (same ivaRate)
  amortizationTotal: Money     // anticipoAmortization + amortizationIva
  retentions: Money
  cincoAlMillarSfp: Money      // 0.5%
  total: Money                 // estimateTotal - amortizationTotal - retentions - cincoAlMillarSfp
}

/**
 * Payment request — the superintendent submits account details plus
 * supporting documentation once an estimate is approved; financial can only
 * see/pay estimates that have one of these attached.
 */
export interface PaymentRequest {
  accountHolder: string
  bankName: string
  accountNumber: string
  clabe: string
  fileIds: FileId[]
  requestedById: UserId
  requestedAt: Date
}

export interface EstimateSummary {
  partidas: EstimatePartidaRow[]
  partidasSubtotal: Money
  calculations: EstimateCalculations
}

/**
 * Section notes added when rejecting an estimate with notes. Keyed by
 * section: 'cover' | 'services' | 'summary' | 'evidence' | `hoja:${conceptId}`.
 * Informational only; visible to everyone in the viewer.
 */
export type EstimateSectionNotes = Record<string, string>

/**
 * A construction estimate (estimación). Only Superintendents create these.
 * Lifecycle: draft -> submitted -> rejected | approved -> paid.
 * Once approved, the superintendent submits a payment request (account
 * details + supporting docs) before financial can see it to pay it.
 * A rejected estimate carries per-section notes and is NOT editable — a new
 * estimate must be created for the period. Only APPROVED estimates count
 * toward the one-per-period rule.
 */
export interface Estimate {
  id: EstimateId
  contractId: ContractId
  number: number
  periodIndex: number   // 1-based
  status: EstimateStatus
  periodStart: Date
  periodEnd: Date

  cover: EstimateCover
  hojas: HojaGeneradora[]         // the source of truth for quantities
  lineItems: EstimateLineItem[]   // derived from hojas (recomputed on save)
  summary: EstimateSummary        // derived from hojas (recomputed on save)

  /** Photo evidence for the estimate as a whole (not tied to a specific hoja/row). */
  evidenceFileIds: FileId[]

  sectionNotes: EstimateSectionNotes

  /** Set once the superintendent requests payment on an approved estimate. */
  paymentRequest: PaymentRequest | null

  signatures: Signature[]
  history: WorkflowEvent[]

  createdById: UserId
  createdAt: Date
  updatedAt: Date
}