// app/data/calc/schedule.ts
/**
 * Schedule math — S-curve and per-concept Gantt status.
 *
 * S-CURVE FORMULA (per the domain spec):
 *   1. Weighted average per concept = conceptAmount / contractAmount
 *   2. Partial advance for a period = weightedAvg × fractionCompletedInPeriod
 *   3. Cumulative advance = sum of all partial advances up to and including this period
 *
 * Two actual series:
 *   - Physical  (approved + paid estimates): work is physically done
 *   - Financial (paid estimates only):       money has been disbursed
 *
 * GANTT STATUS per concept per period (compared at period boundary):
 *   done        — actualProgress === 1.0
 *   ahead       — actualProgress > plannedProgress at period end
 *   behind      — actualProgress < plannedProgress at period end
 *   on_track    — actualProgress === plannedProgress (within tolerance)
 *   not_started — concept hasn't started yet in this period
 *   overdue     — period has passed, concept end date passed, progress < 1.0
 */
import type { Money, Percentage, ScheduleItem, SchedulePoint } from '../models'

const round = (n: number) => Math.round(n)
const round1 = (n: number) => Math.round(n * 10) / 10
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

/** All period-end dates spanning start→end with the given periodicity. */
export function periodEnds(
  start: Date,
  end: Date,
  periodicity: 'monthly' | 'biweekly',
): Date[] {
  const result: Date[] = []
  let cur = new Date(start)
  cur.setDate(1) // snap to month start for consistent boundaries

  const endMs = end.getTime()

  while (cur.getTime() <= endMs) {
    if (periodicity === 'monthly') {
      // last day of current month
      const periodEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0)
      result.push(periodEnd)
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
    } else {
      // biweekly: 15th and last day of each month
      const mid = new Date(cur.getFullYear(), cur.getMonth(), 15)
      const last = new Date(cur.getFullYear(), cur.getMonth() + 1, 0)
      result.push(mid, last)
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
    }
  }

  // Always include the contract end date as the final point if not already
  if (result.length === 0 || result[result.length - 1].getTime() < endMs) {
    result.push(new Date(end))
  }

  return result
}

/** Label for a period boundary. */
export function formatPeriodLabel(
  date: Date,
  periodicity: 'monthly' | 'biweekly',
): string {
  const d = date.getDate()
  const month = date.toLocaleDateString('es-MX', { month: 'short' })
  const year = String(date.getFullYear()).slice(-2)
  if (periodicity === 'monthly') return `${month} ${year}`
  return `${d === 15 ? '1a' : '2a'} ${month} ${year}`
}

/** Fraction of [start, end] elapsed at `at`. Clamps to [0, 1]. */
function fraction(start: Date, end: Date, at: Date): number {
  const s = +start, e = +end, a = +at
  if (e <= s) return 0
  return clamp((a - s) / (e - s), 0, 1)
}

// ---------------------------------------------------------------------------
// Concept progress inputs (supplied by the caller from estimate rollup)
// ---------------------------------------------------------------------------

export interface ConceptProgress {
  conceptId: string
  physicalProgress: Percentage  // 0-100 from approved+paid estimates
  financialProgress: Percentage // 0-100 from paid estimates only
}

// ---------------------------------------------------------------------------
// S-curve
// ---------------------------------------------------------------------------

/**
 * Builds cumulative S-curve points.
 *
 * `conceptProgress` maps conceptId → { physicalProgress, financialProgress }.
 * Items without a matching entry are treated as 0% complete.
 */
export function buildScheduleCurve(
  items: ScheduleItem[],
  periodicity: 'monthly' | 'biweekly' = 'monthly',
  conceptProgress: ConceptProgress[] = [],
  today: Date = new Date(),
): SchedulePoint[] {
  if (items.length === 0) return []

  const start = new Date(Math.min(...items.map((i) => +i.startDate)))
  const end   = new Date(Math.max(...items.map((i) => +i.endDate)))

  const totalAmount: Money = items.reduce((s, i) => s + i.programmedAmount, 0)
  if (totalAmount === 0) return []

  // Build progress lookup
  const physProg: Record<string, number> = {}
  const finProg:  Record<string, number> = {}
  for (const cp of conceptProgress) {
    physProg[cp.conceptId] = cp.physicalProgress / 100
    finProg[cp.conceptId]  = cp.financialProgress / 100
  }

  const periods = periodEnds(start, end, periodicity)

  let cumPlanned    = 0
  let cumPhysical   = 0
  let cumFinancial  = 0

  // Previous period end for partial-period fractional calculation
  let prevDate = new Date(start.getTime() - 1)

  // Find the last period boundary that has passed — actual values stop here.
  const lastPassedPeriodIdx = periods.reduce((last, p, i) => (p <= today ? i : last), -1)

  return periods.map((periodEnd, periodIdx): SchedulePoint => {
    // Planned: linear ramp of each item's weight earned during this period window.
    let partialPlanned = 0
    let partialPhysical = 0
    let partialFinancial = 0

    for (const item of items) {
      const weight = item.programmedAmount / totalAmount

      // Planned always accumulates across all periods.
      const fEnd  = fraction(item.startDate, item.endDate, periodEnd)
      const fPrev = fraction(item.startDate, item.endDate, prevDate)
      const plannedGain = (fEnd - fPrev) * weight
      partialPlanned += plannedGain

      // Physical and financial only accumulate up to and including the last passed period.
      // This prevents progress from being distributed into future periods.
      if (periodIdx <= lastPassedPeriodIdx) {
        const physFrac = physProg[item.conceptId] ?? 0
        const finFrac  = finProg[item.conceptId]  ?? 0
        partialPhysical  += physFrac * plannedGain
        partialFinancial += finFrac  * plannedGain
      }
    }

    cumPlanned   += partialPlanned
    cumPhysical  += partialPhysical
    cumFinancial += partialFinancial

    prevDate = new Date(periodEnd)

    const periodHasPassed = periodIdx <= lastPassedPeriodIdx

    return {
      date: periodEnd,
      programmedCumulativePercentage:  round1(clamp(cumPlanned,   0, 1) * 100),
      programmedCumulativeAmount:      round(clamp(cumPlanned,     0, 1) * totalAmount),
      actualCumulativePercentage:      periodHasPassed ? round1(clamp(cumPhysical,  0, 1) * 100) : null,
      actualCumulativeAmount:          periodHasPassed ? round(clamp(cumPhysical,    0, 1) * totalAmount) : null,
      financialCumulativePercentage:   periodHasPassed ? round1(clamp(cumFinancial, 0, 1) * 100) : null,
      financialCumulativeAmount:       periodHasPassed ? round(clamp(cumFinancial,   0, 1) * totalAmount) : null,
    }
  })
}

// ---------------------------------------------------------------------------
// Per-concept Gantt status
// ---------------------------------------------------------------------------

export type ConceptStatus = 'done' | 'ahead' | 'on_track' | 'behind' | 'overdue' | 'not_started' | 'future'

export interface ConceptGanttStatus {
  conceptId: string
  status: ConceptStatus
  /** Planned progress at end of current/last period (0-100) */
  plannedProgress: Percentage
  /** Actual physical progress (0-100) */
  actualProgress: Percentage
  /** Delta: actualProgress - plannedProgress. Positive = ahead, negative = behind. */
  delta: number
}

/**
 * Computes per-concept status for the Gantt view.
 * `today` defaults to the current date.
 */
export function computeConceptStatuses(
  items: ScheduleItem[],
  conceptProgress: ConceptProgress[],
  periodicity: 'monthly' | 'biweekly' = 'monthly',
  today: Date = new Date(),
): ConceptGanttStatus[] {
  const physProg: Record<string, number> = {}
  for (const cp of conceptProgress) {
    physProg[cp.conceptId] = cp.physicalProgress
  }

  // Find the most recently completed period boundary at or before today
  if (items.length === 0) return []
  const schedStart = new Date(Math.min(...items.map((i) => +i.startDate)))
  const schedEnd   = new Date(Math.max(...items.map((i) => +i.endDate)))
  const periods = periodEnds(schedStart, schedEnd, periodicity)

  // The reference period: last period boundary that has passed
  const passedPeriods = periods.filter((p) => p <= today)
  const refDate = passedPeriods.length > 0 ? passedPeriods[passedPeriods.length - 1] : null

  return items.map((item): ConceptGanttStatus => {
    const actualProgress = physProg[item.conceptId ?? ''] ?? 0
    const cid = item.conceptId ?? ''

    if (actualProgress >= 100) {
      return { conceptId: cid, status: 'done', plannedProgress: 100, actualProgress: 100, delta: 0 }
    }

    if (!refDate || today < item.startDate) {
      return { conceptId: cid, status: 'future', plannedProgress: 0, actualProgress, delta: 0 }
    }

    // Planned progress at the reference period boundary
    const f = fraction(item.startDate, item.endDate, refDate) * 100
    const plannedProgress = round1(f)

    if (today > item.endDate && actualProgress < 100) {
      return { conceptId: cid, status: 'overdue', plannedProgress: 100, actualProgress, delta: actualProgress - 100 }
    }

    const delta = round1(actualProgress - plannedProgress)
    const TOLERANCE = 0.5 // percent

    const status: ConceptStatus =
      delta >= TOLERANCE  ? 'ahead' :
      delta <= -TOLERANCE ? 'behind' :
      'on_track'

    return { conceptId: cid, status, plannedProgress, actualProgress, delta }
  })
}