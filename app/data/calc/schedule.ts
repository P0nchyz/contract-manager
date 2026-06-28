// app/data/calc/schedule.ts
/**
 * Builds the cumulative S-curve (programmed vs actual) from the Gantt schedule
 * items. We own this computation (the backend stores only the Gantt items).
 *
 * This is a linear-ramp approximation suitable for the dashboard overview; the
 * dedicated Schedule view can refine the distribution if needed. Money is in
 * integer cents throughout.
 */
import type { Money, SchedulePoint, ScheduleItem } from '../models'

const round = (n: number): number => Math.round(n)
const round1 = (n: number): number => Math.round(n * 10) / 10

/** Fraction (0..1) of [start,end] elapsed at `at`. Degenerate windows -> 0. */
function fraction(start: Date, end: Date, at: Date): number {
  const s = +start
  const e = +end
  const a = +at
  if (e <= s) return 0
  if (a <= s) return 0
  if (a >= e) return 1
  return (a - s) / (e - s)
}

/** Month-end dates from the first month of `start` through the month of `end`. */
function monthEnds(start: Date, end: Date): Date[] {
  const result: Date[] = []
  let y = start.getFullYear()
  let m = start.getMonth()
  const endKey = end.getFullYear() * 12 + end.getMonth()
  while (y * 12 + m <= endKey) {
    result.push(new Date(y, m + 1, 0)) // day 0 of next month = last day of this month
    m += 1
    if (m > 11) {
      m = 0
      y += 1
    }
  }
  return result
}

export function buildScheduleCurve(items: ScheduleItem[], asOf?: Date): SchedulePoint[] {
  if (items.length === 0) return []

  const start = new Date(Math.min(...items.map((i) => +i.startDate)))
  const end = new Date(Math.max(...items.map((i) => +i.endDate)))
  const totalProgrammed: Money = items.reduce((s, i) => s + i.programmedAmount, 0)

  // "Now" for the actual series: the furthest point any item has actually
  // reached. Beyond this, actual is unknown (null).
  const effectiveAsOf =
    asOf ??
    new Date(
      Math.max(
        start.getTime(),
        ...items
          .filter((i) => i.actualPercentage != null)
          .map((i) => +i.startDate + (+i.endDate - +i.startDate) * ((i.actualPercentage ?? 0) / 100)),
      ),
    )

  return monthEnds(start, end).map((date): SchedulePoint => {
    const programmedAmount = round(
      items.reduce((s, i) => s + i.programmedAmount * fraction(i.startDate, i.endDate, date), 0),
    )

    const isPast = +date <= +effectiveAsOf
    const actualAmount = isPast
      ? round(
          items.reduce((s, i) => {
            const cappedEnd = new Date(Math.min(+i.endDate, +effectiveAsOf))
            return s + (i.actualAmount ?? 0) * fraction(i.startDate, cappedEnd, date)
          }, 0),
        )
      : null

    return {
      date,
      programmedCumulativeAmount: programmedAmount,
      actualCumulativeAmount: actualAmount,
      programmedCumulativePercentage: totalProgrammed ? round1((programmedAmount / totalProgrammed) * 100) : 0,
      actualCumulativePercentage:
        actualAmount == null ? null : totalProgrammed ? round1((actualAmount / totalProgrammed) * 100) : 0,
    }
  })
}
