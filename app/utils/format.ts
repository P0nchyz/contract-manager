// app/utils/format.ts
/**
 * Formatting helpers for es-MX. Auto-imported by Nuxt (utils/). Money is stored
 * as integer cents everywhere; these are the only place that converts to pesos
 * for display.
 */
import type { AgreementStatus, ContractStatus, Estimate, EstimateStatus, Money, Role } from '~/data/models'
import { S } from '~/constants/strings'

const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const dateFmt = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
const numberFmt = new Intl.NumberFormat('es-MX')

/** Integer cents -> "$1,234,567.89". */
export const formatMoney = (cents: Money): string => mxn.format(cents / 100)

export const formatDate = (value: Date | string): string => dateFmt.format(new Date(value))

const monthFmt = new Intl.DateTimeFormat('es-MX', { month: 'short', year: '2-digit' })
/** Short month label for chart axes, e.g. "feb 24". */
export const formatMonth = (value: Date | string): string => monthFmt.format(new Date(value))

export const formatPercent = (value: number, fractionDigits = 1): string =>
  `${value.toLocaleString('es-MX', { maximumFractionDigits: fractionDigits })}%`

export const formatNumber = (value: number): string => numberFmt.format(value)

export const roleLabel = (role: Role | null | undefined): string =>
  role ? S.roles[role] : ''

// --- Status display (label + UBadge props) --------------------------------
// Colors follow the agreed legend: draft dotted, submitted empty, with_notes
// black, rejected red, approved green, paid blue.
type BadgeColor = 'neutral' | 'error' | 'success' | 'info' | 'primary' | 'warning'
type BadgeVariant = 'solid' | 'soft' | 'outline' | 'subtle'

export interface StatusDisplay {
  label: string
  color: BadgeColor
  variant: BadgeVariant
  dashed?: boolean // draft: dotted border
}

export const estimateStatusDisplay: Record<EstimateStatus, StatusDisplay> = {
  draft: { label: S.estimateStatus.draft, color: 'neutral', variant: 'outline', dashed: true },
  submitted: { label: S.estimateStatus.submitted, color: 'neutral', variant: 'soft' },
  rejected: { label: S.estimateStatus.rejected, color: 'error', variant: 'solid' },
  approved: { label: S.estimateStatus.approved, color: 'success', variant: 'solid' },
  paid: { label: S.estimateStatus.paid, color: 'info', variant: 'solid' },
}

// Display order for estimate lists: higher period first, then within the same
// period — approved/paid, then submitted (sent), then draft, then rejected.
const ESTIMATE_STATUS_SORT_RANK: Record<EstimateStatus, number> = {
  approved: 0,
  paid: 0,
  submitted: 1,
  draft: 2,
  rejected: 3,
}
export function compareEstimatesForDisplay(a: Estimate, b: Estimate): number {
  if (a.periodIndex !== b.periodIndex) return b.periodIndex - a.periodIndex
  return ESTIMATE_STATUS_SORT_RANK[a.status] - ESTIMATE_STATUS_SORT_RANK[b.status]
}

export const agreementStatusDisplay: Record<AgreementStatus, StatusDisplay> = {
  draft: { label: S.agreementStatus.draft, color: 'neutral', variant: 'outline', dashed: true },
  submitted: { label: S.agreementStatus.submitted, color: 'neutral', variant: 'soft' },
  with_notes: { label: S.agreementStatus.with_notes, color: 'neutral', variant: 'solid' },
  rejected: { label: S.agreementStatus.rejected, color: 'error', variant: 'solid' },
  pending_entity: { label: S.agreementStatus.pending_entity, color: 'warning', variant: 'soft' },
  approved: { label: S.agreementStatus.approved, color: 'success', variant: 'solid' },
}

export const contractStatusDisplay: Record<ContractStatus, StatusDisplay> = {
  active: { label: S.contractStatus.active, color: 'success', variant: 'subtle' },
  closing: { label: S.contractStatus.closing, color: 'warning', variant: 'subtle' },
  closed: { label: S.contractStatus.closed, color: 'neutral', variant: 'subtle' },
}