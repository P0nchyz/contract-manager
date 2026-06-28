// app/data/models/contract.ts
import type {
  ContractId,
  CorporationId,
  Money,
  Percentage,
  UserId,
} from './common'

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

  amount: Money // contracted amount
  anticipoPercentage: Percentage // advance payment %

  startDate: Date
  endDate: Date

  // Parties
  createdById: UserId // the resident who created it
  residentId: UserId
  superintendentId: UserId | null
  supervisorId: UserId | null
  financialId: UserId | null
  contractorCorporationId: CorporationId | null

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
