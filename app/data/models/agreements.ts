// app/data/models/agreements.ts
import type {
  AgreementId,
  AgreementStatus,
  ConceptId,
  ContractId,
  FileId,
  FiniquitoStatementId,
  Money,
  ReceptionStatementId,
  Signature,
  UserId,
  WorkflowEvent,
} from './common'

// Derived from the user's selections, not chosen directly:
//   time only            -> 'time'   (plazo)
//   amount only          -> 'amount' (monto)
//   both amount and time -> 'mixed'  (mixto)
export type AgreementKind = 'amount' | 'time' | 'mixed'

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
  // Optional schedule entry for this new concept
  startDate?: Date
  endDate?: Date
}

/**
 * Per-concept change record inside a modification agreement.
 * All override fields are optional — only the ones present are applied on approval.
 */
export interface ConceptChange {
  conceptId: ConceptId
  // Catalog overrides (applied to the concept on approval)
  contractedQuantity?: number
  unitPrice?: Money
  // Schedule overrides (applied to the matching ScheduleItem on approval)
  startDate?: Date
  endDate?: Date
}

/**
 * A modification agreement (convenio modificatorio). Created by Resident or
 * Superintendent. Same workflow as estimates minus `paid`.
 */
export interface ModificationAgreement {
  id: AgreementId
  contractId: ContractId
  number: number
  kind: AgreementKind // derived: 'amount' | 'time' | 'mixed'
  description: string
  // Per-concept changes proposed by this agreement.
  conceptChanges: ConceptChange[]
  // New concepts to be added to the catalog on approval.
  newConcepts: NewConceptDraft[]
  // Aggregate deltas — derived from conceptChanges + newConcepts on save.
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
  initiatedById: UserId // resident
  createdAt: Date
}