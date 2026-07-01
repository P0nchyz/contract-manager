// app/data/calc/schedule.ts
/**
 * Period-based schedule math — S-curve and Gantt status.
 *
 * S-CURVE FORMULA:
 *   weight(concept) = (unitPrice × contractedQuantity) / totalContractAmount
 *   partialAdvance(period) = Σ weight(c) × (actualQtyInPeriod(c) / contractedQty(c))
 *   cumulativeAdvance(n) = partialAdvance(n) + cumulativeAdvance(n-1)
 *
 * Two actual series:
 *   Physical  — approved + paid estimates
 *   Financial — paid estimates only
 */
import type { ConceptScheduleEntry, SchedulePoint } from '../models'

// ─── Period helpers ──────────────────────────────────────────────────────────

/**
 * All period cutoff dates for a contract, 0-based.
 * Period 0: contractStart → first cutoff
 * Period N: previous cutoff + 1 day → next cutoff
 * Last period: last cutoff + 1 day → contractEnd
 */
export function buildPeriods(
  contractStart: Date,
  contractEnd: Date,
  periodicity: 'monthly' | 'biweekly',
): { start: Date; end: Date }[] {
  const periods: { start: Date; end: Date }[] = []
  let curStart = new Date(contractStart)

  while (curStart <= contractEnd) {
    const cutoffs = nextCutoffs(curStart, periodicity)
    let cutoff = cutoffs.find((c) => c > curStart) ?? cutoffs[cutoffs.length - 1]
    // If the cutoff is past contract end, the last period ends at contractEnd
    const periodEnd = cutoff > contractEnd ? new Date(contractEnd) : new Date(cutoff)
    periods.push({ start: new Date(curStart), end: periodEnd })
    if (periodEnd >= contractEnd) break
    // next period starts the day after this cutoff
    curStart = new Date(periodEnd)
    curStart.setDate(curStart.getDate() + 1)
  }
  return periods
}

/** Returns the cutoff dates (15th and/or last day) for the month containing `d`. */
function nextCutoffs(d: Date, periodicity: 'monthly' | 'biweekly'): Date[] {
  const y = d.getFullYear()
  const m = d.getMonth()
  const lastDay = new Date(y, m + 1, 0)
  if (periodicity === 'monthly') return [lastDay]
  const mid = new Date(y, m, 15)
  return [mid, lastDay]
}

/** Human-readable label for a period. */
export function periodLabel(
  period: { start: Date; end: Date },
  index: number,
): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' })
  return `P${index + 1}  ${fmt(period.start)} – ${fmt(period.end)}`
}

// ─── S-curve ─────────────────────────────────────────────────────────────────

export interface ConceptMeta {
  conceptId: string
  contractedQuantity: number
  unitPrice: number // Money (cents)
}

export interface PeriodProgress {
  conceptId: string
  periodIndex: number  // 0-based
  physicalQty: number  // from approved+paid estimates
  financialQty: number // from paid estimates only
}

/**
 * Builds the cumulative S-curve for every period.
 * Periods in the future (index > currentPeriodIndex) get null for actual series.
 */
export function buildScheduleCurve(
  periods: { start: Date; end: Date }[],
  entries: ConceptScheduleEntry[],
  concepts: ConceptMeta[],
  progress: PeriodProgress[],
  currentPeriodIndex: number,
): SchedulePoint[] {
  const totalAmount = concepts.reduce(
    (s, c) => s + c.unitPrice * c.contractedQuantity,
    0,
  )
  if (totalAmount === 0 || periods.length === 0) return []

  // Weight per concept
  const weight: Record<string, number> = {}
  for (const c of concepts) {
    weight[c.conceptId] = (c.unitPrice * c.contractedQuantity) / totalAmount
  }

  // Planned quantity per concept per period (from schedule entries)
  const planned: Record<string, Record<number, number>> = {}
  for (const e of entries) {
    const cid = String(e.conceptId)
    if (!planned[cid]) planned[cid] = {}
    planned[cid][e.periodIndex] = (planned[cid][e.periodIndex] ?? 0) + e.plannedQuantity
  }

  // Actual progress indexed by [conceptId][periodIndex]
  const physQty: Record<string, Record<number, number>> = {}
  const finQty:  Record<string, Record<number, number>> = {}
  for (const p of progress) {
    const cid = p.conceptId
    if (!physQty[cid]) physQty[cid] = {}
    if (!finQty[cid])  finQty[cid]  = {}
    physQty[cid][p.periodIndex] = (physQty[cid][p.periodIndex] ?? 0) + p.physicalQty
    finQty[cid][p.periodIndex]  = (finQty[cid][p.periodIndex]  ?? 0) + p.financialQty
  }

  let cumPlanned    = 0
  let cumPhysical   = 0
  let cumFinancial  = 0
  const round1 = (n: number) => Math.round(n * 10) / 10

  return periods.map((period, idx): SchedulePoint => {
    // Planned partial advance this period
    let partialPlanned = 0
    for (const c of concepts) {
      const cid = String(c.conceptId)
      const q = planned[cid]?.[idx] ?? 0
      if (c.contractedQuantity > 0) {
        partialPlanned += weight[cid] * (q / c.contractedQuantity)
      }
    }
    cumPlanned += partialPlanned

    const isPast = idx <= currentPeriodIndex

    let partialPhysical  = 0
    let partialFinancial = 0
    if (isPast) {
      for (const c of concepts) {
        const cid = String(c.conceptId)
        if (c.contractedQuantity > 0) {
          partialPhysical  += weight[cid] * ((physQty[cid]?.[idx] ?? 0) / c.contractedQuantity)
          partialFinancial += weight[cid] * ((finQty[cid]?.[idx]  ?? 0) / c.contractedQuantity)
        }
      }
      cumPhysical  += partialPhysical
      cumFinancial += partialFinancial
    }

    return {
      periodIndex: idx,
      date: new Date(period.end),
      programmedCumulativePercentage: round1(Math.min(cumPlanned,  1) * 100),
      programmedCumulativeAmount:     Math.round(Math.min(cumPlanned, 1) * totalAmount),
      actualCumulativePercentage:     isPast ? round1(Math.min(cumPhysical,  1) * 100) : null,
      actualCumulativeAmount:         isPast ? Math.round(Math.min(cumPhysical, 1) * totalAmount) : null,
      financialCumulativePercentage:  isPast ? round1(Math.min(cumFinancial, 1) * 100) : null,
      financialCumulativeAmount:      isPast ? Math.round(Math.min(cumFinancial, 1) * totalAmount) : null,
    }
  })
}

// ─── Gantt status ────────────────────────────────────────────────────────────

export type ConceptStatus = 'done' | 'ahead' | 'on_track' | 'behind' | 'future'

export interface ConceptGanttStatus {
  conceptId: string
  status: ConceptStatus
  plannedProgress: number  // 0-100 cumulative planned %
  actualProgress: number   // 0-100 cumulative actual %
  delta: number            // actual - planned
  /** Periods in which this concept has planned work (0-based indices). */
  activePeriods: number[]
}

export function computeConceptStatuses(
  entries: ConceptScheduleEntry[],
  concepts: ConceptMeta[],
  progress: PeriodProgress[],
  currentPeriodIndex: number,
): ConceptGanttStatus[] {
  const TOLERANCE = 0.5

  // Cumulative planned and actual per concept up to currentPeriodIndex
  const plannedCum: Record<string, number> = {}
  const physCum:    Record<string, number> = {}
  const activePeriods: Record<string, number[]> = {}

  for (const e of entries) {
    const cid = String(e.conceptId)
    if (!activePeriods[cid]) activePeriods[cid] = []
    if (e.plannedQuantity > 0) activePeriods[cid].push(e.periodIndex)
    if (e.periodIndex <= currentPeriodIndex) {
      plannedCum[cid] = (plannedCum[cid] ?? 0) + e.plannedQuantity
    }
  }

  for (const p of progress) {
    if (p.periodIndex <= currentPeriodIndex) {
      physCum[p.conceptId] = (physCum[p.conceptId] ?? 0) + p.physicalQty
    }
  }

  return concepts.map((c): ConceptGanttStatus => {
    const cid = String(c.conceptId)
    const cq  = c.contractedQuantity

    const plannedPct = cq > 0 ? Math.min((plannedCum[cid] ?? 0) / cq * 100, 100) : 0
    const actualPct  = cq > 0 ? Math.min((physCum[cid]    ?? 0) / cq * 100, 100) : 0
    const delta      = Math.round((actualPct - plannedPct) * 10) / 10

    const periods = (activePeriods[cid] ?? []).sort((a, b) => a - b)

    let status: ConceptStatus
    if (actualPct >= 100 - TOLERANCE) {
      status = 'done'
    } else if (periods.length === 0 || periods[0] > currentPeriodIndex) {
      status = 'future'
    } else if (delta >= TOLERANCE) {
      status = 'ahead'
    } else if (delta <= -TOLERANCE) {
      status = 'behind'
    } else {
      status = 'on_track'
    }

    return { conceptId: cid, status, plannedProgress: plannedPct, actualProgress: actualPct, delta, activePeriods: periods }
  })
}

/** Current period index (0-based) given contract start and today. */
export function currentPeriodIndex(
  periods: { start: Date; end: Date }[],
  today: Date = new Date(),
): number {
  for (let i = 0; i < periods.length; i++) {
    if (today <= periods[i].end) return i
  }
  return periods.length - 1
}