// app/data/models/schedule.ts
import type {
  ConceptId,
  ContractId,
  Money,
  Percentage,
  ScheduleId,
  ScheduleItemId,
} from './common'

/**
 * Planned quantity for a specific concept in a specific period.
 * Period indices are 0-based relative to the contract start date.
 * The sum of plannedQuantity across all periods for a concept equals
 * the concept's contractedQuantity.
 */
export interface ConceptScheduleEntry {
  id: ScheduleItemId           // kept for DB identity
  contractId: ContractId
  conceptId: ConceptId
  periodIndex: number          // 0-based period index
  plannedQuantity: number      // units planned in this period
}

/**
 * The contract work schedule (programa de obra).
 * entries replaces the old date-range items array.
 */
export interface WorkSchedule {
  id: ScheduleId
  contractId: ContractId
  entries: ConceptScheduleEntry[]
}

/**
 * A point on the cumulative S-curve shown as "Over Schedule" on the dashboard.
 * periodIndex identifies which period this point represents.
 */
export interface SchedulePoint {
  periodIndex: number
  date: Date                   // period end date (for display)
  // Planned
  programmedCumulativePercentage: Percentage
  programmedCumulativeAmount: Money
  // Physical progress: approved + paid estimates
  actualCumulativePercentage: Percentage | null   // null = future period
  actualCumulativeAmount: Money | null
  // Financial progress: paid estimates only
  financialCumulativePercentage: Percentage | null
  financialCumulativeAmount: Money | null
}