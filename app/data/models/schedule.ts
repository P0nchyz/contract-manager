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
 * A single Gantt row: a concept or a concept group with a planned window and
 * progress tracked in BOTH percentage and money. The schedule is defined when
 * the contract is created.
 */
export interface ScheduleItem {
  id: ScheduleItemId
  contractId: ContractId
  label: string // concept or concept-group name
  conceptId: ConceptId | null // null when the row represents a group
  startDate: Date // planned start
  endDate: Date // planned end
  programmedPercentage: Percentage
  actualPercentage: Percentage | null // null = not started / future
  programmedAmount: Money
  actualAmount: Money | null
}

/**
 * A point on the cumulative S-curve shown as "Over Schedule" on the contract
 * dashboard. Cumulative in both percentage and money. COMPUTED BY US from the
 * Gantt items (see a `buildScheduleCurve` util), not returned by the backend.
 */
export interface SchedulePoint {
  date: Date
  programmedCumulativePercentage: Percentage
  actualCumulativePercentage: Percentage | null
  programmedCumulativeAmount: Money
  actualCumulativeAmount: Money | null
}

/**
 * The contract work schedule (programa de obra). Rendered as a Gantt chart; the
 * dashboard S-curve is derived from `items` on our side.
 */
export interface WorkSchedule {
  id: ScheduleId
  contractId: ContractId
  items: ScheduleItem[] // Gantt rows
}
