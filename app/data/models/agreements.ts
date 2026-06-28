// app/data/models/agreements.ts
import type {
  AgreementId,
  AgreementStatus,
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
 * A modification agreement (convenio modificatorio). Created by Resident or
 * Superintendent. Same workflow as estimates minus `paid`.
 */
export interface ModificationAgreement {
  id: AgreementId
  contractId: ContractId
  number: number
  kind: AgreementKind // derived from amountDelta / timeDeltaDays presence
  description: string
  amountDelta: Money | null // change to contract amount (if any)
  timeDeltaDays: number | null // change to schedule (if any)
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
