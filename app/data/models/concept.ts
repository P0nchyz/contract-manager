// app/data/models/concept.ts
import type { ConceptId, ContractId, Money } from './common'

/**
 * A single concept in a contract's Concept Catalog (catálogo de conceptos).
 * Estimate line items draw from these. Scale: dozens to hundreds per contract.
 */
export interface Concept {
  id: ConceptId
  contractId: ContractId
  specificationNumber: string // "especificación" — defined per concept in catalog
  description: string
  unit: string // e.g. m2, m3, pza, lote
  unitPrice: Money
  contractedQuantity: number // "in project" quantity
}
