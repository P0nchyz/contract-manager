// app/data/models/agreements.ts
import type {
  AgreementId,
  AgreementStatus,
  ConceptId,
  ConceptSectionId,
  ContractId,
  FileId,
  FiniquitoStatementId,
  LogNoteId,
  Money,
  ReceptionStatementId,
  Signature,
  UserId,
  WorkflowEvent,
} from './common'

// Chosen explicitly by the user at the start of the wizard — no more mixing:
//   'amount'   (de monto) — add/reduce concepts and their quantities
//   'schedule' (de plazo) — move not-yet-estimated scheduled quantity between periods
export type AgreementKind = 'amount' | 'schedule'

/**
 * A new concept to be added to the catalog on approval of this agreement.
 * Mirrors CreateConceptInput but lives in the model layer to avoid circular deps.
 */
export interface NewConceptDraft {
  specificationNumber: string
  description: string
  unit: string
  unitPrice: Money
  contractedQuantity: number
  sectionId?: ConceptSectionId | null
  /** Set when this is extra quantity for a concept that already existed, not a brand-new one. */
  extendsConceptId?: ConceptId | null
}

/**
 * Per-concept change record inside a modification agreement. Amount-type only
 * — used to REDUCE a previously-defined concept's quantity/price. Additions
 * go through `newConcepts` instead (with `extendsConceptId` set), so extra
 * quantity is always tracked as its own separate concept row.
 */
export interface ConceptChange {
  conceptId: ConceptId
  // Catalog overrides (applied to the concept on approval)
  newQuantity?: number
  newUnitPrice?: Money
}

/**
 * A modification agreement (convenio modificatorio). Created by Resident or
 * Superintendent. Same workflow as estimates minus `paid`.
 */
export interface NewSectionDraft {
  specificationNumber: string
  description: string
  order: number
}

/** Schedule-type move: shifts not-yet-estimated planned quantity for a concept from one period to another. */
export interface ScheduleMove {
  conceptId: ConceptId
  fromPeriodIndex: number // 0-based
  toPeriodIndex: number   // 0-based — must have no claims on this concept yet
  quantity: number
}

export interface ModificationAgreement {
  id: AgreementId
  contractId: ContractId
  number: number
  kind: AgreementKind // chosen explicitly at creation — 'amount' | 'schedule'
  description: string
  // Per-concept changes proposed by this agreement. Amount-type only.
  conceptChanges: ConceptChange[]
  // New concepts to be added to the catalog on approval. Amount-type only.
  newConcepts: NewConceptDraft[]
  // New sections to be added to the catalog on approval. Amount-type only.
  newSections: NewSectionDraft[]
  // Schedule-type only: moves of not-yet-estimated quantity between periods.
  scheduleMoves: ScheduleMove[]
  // Contract date change (applied on approval). Schedule-type only.
  newContractEndDate: Date | null
  newContractStartDate: Date | null
  // Aggregate deltas — derived on save. Amount-type sets amountDelta only;
  // schedule-type sets timeDeltaDays only (moves never change the total).
  amountDelta: Money | null
  timeDeltaDays: number | null
  status: AgreementStatus
  signatures: Signature[]
  history: WorkflowEvent[]
  attachmentFileIds: FileId[]
  createdById: UserId
  createdAt: Date
  updatedAt: Date
}

/**
 * Acta de recepción — the reception flow. Initiated by the Resident as the
 * first step of closing a contract. Separate flow from finiquito.
 */
export interface ReceptionStatement {
  id: ReceptionStatementId
  contractId: ContractId
  status: AgreementStatus
  signatures: Signature[]
  history: WorkflowEvent[]
  attachmentFileIds: FileId[]
  initiatedById: UserId // resident
  createdAt: Date
}

/**
 * Finiquito — the settlement flow. Separate entity/flow from reception.
 */
export interface FiniquitoStatement {
  id: FiniquitoStatementId
  contractId: ContractId
  status: AgreementStatus
  signatures: Signature[]
  history: WorkflowEvent[]
  attachmentFileIds: FileId[]
  /** Log notes (bitácora) linked as supporting context — editable while in draft. */
  linkedLogNoteIds: LogNoteId[]
  initiatedById: UserId // resident
  createdAt: Date
}