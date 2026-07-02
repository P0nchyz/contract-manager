// app/data/calc/estimate.ts
/**
 * Estimate calculations — the single source of truth for the derived line items
 * and summary tables. Quantities come exclusively from Hojas Generadoras; this
 * module rolls them up into line items, partida summary, and financial totals.
 *
 * All Money is integer cents; rate math is rounded to whole cents.
 */
import type {
  Concept,
  ConceptId,
  ConceptSection,
  ConceptSectionId,
  EstimateCalculations,
  EstimateLineItem,
  EstimatePartidaRow,
  EstimateSummary,
  HojaGeneradora,
  Money,
  Percentage,
} from '../models'

export interface EstimateRates {
  ivaRate: Percentage
  anticipoPercentage: Percentage
  retentionPercentage: Percentage
  cincoAlMillarRate: Percentage // 0.5
}

export const DEFAULT_RATES = {
  ivaRate: 16,
  retentionPercentage: 5,
  cincoAlMillarRate: 0.5,
} satisfies Omit<EstimateRates, 'anticipoPercentage'>

const pct = (amount: Money, rate: Percentage): Money => Math.round((amount * rate) / 100)

/** Sum of a Hoja's row quantities. */
export function hojaTotal(hoja: HojaGeneradora): number {
  return hoja.rows.reduce((s, r) => s + (Number.isFinite(r.quantity) ? r.quantity : 0), 0)
}

/**
 * Build the derived line items (one per Hoja/concept) for the
 * "Estimación de Servicios Ejecutados" table.
 *
 * @param hojas             the estimate's Hojas
 * @param concepts          catalog concepts (for contracted qty / unit price)
 * @param upToLastByConcept map conceptId -> accumulated qty across prior APPROVED estimates
 */
export function buildLineItems(
  hojas: HojaGeneradora[],
  concepts: Concept[],
  upToLastByConcept: Record<string, number>,
): EstimateLineItem[] {
  return hojas.map((hoja, i) => {
    const concept = concepts.find((c) => String(c.id) === String(hoja.conceptId))
    const inProject = concept?.contractedQuantity ?? hoja.contractedQuantity
    const unitPrice = concept?.unitPrice ?? hoja.unitPrice
    const inThisEstimate = hojaTotal(hoja)
    const upToLastEstimate = upToLastByConcept[String(hoja.conceptId)] ?? 0
    const totalEstimated = upToLastEstimate + inThisEstimate
    return {
      conceptId: hoja.conceptId,
      conceptNumber: i + 1,
      specificationNumber: hoja.specificationNumber,
      description: hoja.description,
      unit: hoja.unit,
      inProject,
      upToLastEstimate,
      inThisEstimate,
      totalEstimated,
      toExecute: inProject - totalEstimated,
      unitPrice,
      totalAmount: Math.round(unitPrice * inThisEstimate),
    }
  })
}

/**
 * Build the estimate summary (Resumen por Partida) + financial calculations.
 * Only sections referenced by the Hojas appear.
 */
export function buildSummary(
  lineItems: EstimateLineItem[],
  hojas: HojaGeneradora[],
  sections: ConceptSection[],
  rates: EstimateRates,
): EstimateSummary {
  // Group concept amounts by section
  const amountByConcept: Record<string, Money> = {}
  for (const li of lineItems) amountByConcept[String(li.conceptId)] = li.totalAmount

  const sectionAmount: Record<string, Money> = {}
  for (const hoja of hojas) {
    const key = String(hoja.sectionId)
    sectionAmount[key] = (sectionAmount[key] ?? 0) + (amountByConcept[String(hoja.conceptId)] ?? 0)
  }

  const referencedSectionIds = Object.keys(sectionAmount)
  const partidas: EstimatePartidaRow[] = referencedSectionIds.map((sid) => {
    const section = sections.find((s) => String(s.id) === sid)
    return {
      sectionId: sid as ConceptSectionId,
      partidaNumber: section?.specificationNumber ?? '—',
      description: section?.description ?? '—',
      amount: sectionAmount[sid] ?? 0,
    }
  }).sort((a, b) => a.partidaNumber.localeCompare(b.partidaNumber, 'es'))

  const partidasSubtotal = partidas.reduce((s, p) => s + p.amount, 0)

  const estimateAmount = partidasSubtotal
  const estimateIva = pct(estimateAmount, rates.ivaRate)
  const anticipoAmortization = pct(estimateAmount, rates.anticipoPercentage)
  const amortizationIva = pct(anticipoAmortization, rates.ivaRate)
  const retentions = pct(estimateAmount, rates.retentionPercentage)
  const cincoAlMillarSfp = pct(estimateAmount, rates.cincoAlMillarRate)
  const estimateTotal = estimateAmount + estimateIva
  const amortizationTotal = anticipoAmortization + amortizationIva

  const calculations: EstimateCalculations = {
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

  return { partidas, partidasSubtotal, calculations }
}