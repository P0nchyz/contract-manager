// app/data/models/contract.ts
import type {
  ContractId,
  CorporationId,
  Money,
  Percentage,
  UserId,
} from './common'

// Re-export convenience: EntityId is just a UserId with role==='entity'
type EntityId = UserId

export type ContractStatus =
  | 'active'
  | 'closing' // receive/close process initiated
  | 'closed'

/**
 * The core contract entity. Created by a Resident, who assigns the
 * Superintendent and Supervisor. The contractor corporation is the
 * Superintendent's corporation.
 */
export interface Contract {
  id: ContractId
  code: string // tender code, e.g. "LPI-SRO-..."
  title: string // e.g. "Diseñar e instrumentar el modelo virtual AutoDesk"
  status: ContractStatus

  amount: Money // derived: sum of (unitPrice × contractedQuantity) across all concepts
  anticipoPercentage: Percentage // advance payment %
  ivaRate: Percentage            // e.g. 16 — set at contract creation
  retentionPercentage: Percentage // retenciones / fondo de garantía — set at creation
  estimatePeriodicity: 'monthly' | 'biweekly' // monthly = one per month, biweekly = twice per month

  startDate: Date
  endDate: Date

  // Parties
  entityId: EntityId              // the entity that created and owns this contract
  createdById: UserId             // the entity user who created it
  residentId: UserId | null       // assigned by the entity from their resident pool
  superintendentId: UserId | null // assigned by the entity
  supervisorId: UserId | null     // assigned by the entity
  superintendentCorporationId: CorporationId | null // frozen at assignment time
  supervisorCorporationId: CorporationId | null     // frozen at assignment time
  contractorCorporationId: CorporationId | null     // same as superintendentCorporationId

  createdAt: Date
  updatedAt: Date
}

/**
 * Derived financial + progress snapshot for a contract. Computed by the
 * backend. Powers the Balance gauge, the executed/contracted figure, and
 * physical-vs-financial progress.
 */
export interface ContractFinancials {
  contractId: ContractId
  contractedAmount: Money
  executedAmount: Money // approved/executed
  paidAmount: Money // sum of paid estimates
  balancePercentage: Percentage // executed / contracted (the gauge)
  anticipoPercentage: Percentage
  anticipoAmount: Money
  physicalProgress: Percentage
  financialProgress: Percentage
}