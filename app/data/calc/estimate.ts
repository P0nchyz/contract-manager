// app/data/calc/estimate.ts
/**
 * Estimate calculations — the single source of truth for the "red" auto-derived
 * cells and the summary tables. Used by the mock repository now and by the live
 * estimate grid later, so the math lives in exactly one place.
 *
 * All Money is integer cents; rate math is rounded to whole cents.
 */
import type {
  Concept,
  ConceptId,
  EstimateCalculations,
  EstimateConceptSummaryRow,
  EstimateLineItem,
  EstimateSummary,
  Money,
  Percentage,
} from '../models'

export interface EstimateRates {
  ivaRate: Percentage // e.g. 16
  anticipoPercentage: Percentage // from the contract
  retentionPercentage: Percentage // retenciones / fondo de garantía
  cincoAlMillarRate: Percentage // 5 al millar SFP (0.5)
}

// anticipoPercentage is supplied per-contract; the rest default.
export const DEFAULT_RATES = {
  ivaRate: 16,
  retentionPercentage: 5,
  cincoAlMillarRate: 0.5,
} satisfies Omit<EstimateRates, 'anticipoPercentage'>

export interface EstimateLineInput {
  conceptId: ConceptId
  inThisEstimate: number // the editable (green) quantity
}

const pct = (amount: Money, rate: Percentage): Money => Math.round((amount * rate) / 100)

/** Build a full grid row from a catalog concept + the editable quantity. */
export function buildLineItem(
  concept: Concept,
  inThisEstimate: number,
  upToLastEstimate: number,
  conceptNumber: number,
): EstimateLineItem {
  const totalEstimated = upToLastEstimate + inThisEstimate
  return {
    conceptId: concept.id,
    conceptNumber,
    specificationNumber: concept.specificationNumber,
    description: concept.description,
    unit: concept.unit,
    inProject: concept.contractedQuantity,
    upToLastEstimate,
    inThisEstimate,
    totalEstimated, // red
    toExecute: concept.contractedQuantity - totalEstimated, // red
    unitPrice: concept.unitPrice,
    totalAmount: Math.round(concept.unitPrice * inThisEstimate), // red
  }
}

/** Build both summary tables (concept rollup + financial calculations). */
export function buildSummary(
  lineItems: EstimateLineItem[],
  rates: EstimateRates,
): EstimateSummary {
  const rows: EstimateConceptSummaryRow[] = lineItems.map((li) => ({
    conceptId: li.conceptId,
    specificationNumber: li.specificationNumber,
    description: li.description,
    amount: li.totalAmount,
  }))
  const subtotal = rows.reduce((s, r) => s + r.amount, 0)

  const estimateAmount = subtotal
  const estimateIva = pct(estimateAmount, rates.ivaRate)
  const anticipoAmortization = pct(estimateAmount, rates.anticipoPercentage)
  const amortizationIva = pct(anticipoAmortization, rates.ivaRate)
  const retentions = pct(estimateAmount, rates.retentionPercentage)
  const cincoAlMillarSfp = pct(estimateAmount, rates.cincoAlMillarRate)
  const estimateTotal = estimateAmount + estimateIva
  const amortizationTotal = anticipoAmortization + amortizationIva

  const calculations: EstimateCalculations = {
    rows,
    ivaRate: rates.ivaRate,
    estimateAmount,
    estimateIva,
    estimateTotal,
    anticipoAmortization,
    amortizationIva,
    amortizationTotal,
    retentions,
    cincoAlMillarSfp,
    total: estimateTotal - amortizationTotal - retentions - cincoAlMillarSfp,
  }

  return { conceptSummary: { rows, subtotal }, calculations }
}
