// app/data/models/concept.ts
import type { AgreementId, ConceptId, ConceptSectionId, ContractId, Money } from './common'

/**
 * A single concept in a contract's Concept Catalog (catálogo de conceptos).
 * Estimate line items draw from these. Scale: dozens to hundreds per contract.
 */
/**
 * A grouping of related concepts within a contract catalog.
 * Every section has its own specification number, description, and a mandatory
 * execution period. Concepts in the section must fall within that period.
 */
export interface ConceptSection {
  id: ConceptSectionId
  contractId: ContractId
  specificationNumber: string // e.g. "A", "01", "CAP-1"
  description: string         // section title, e.g. "Trabajos preliminares"
  startDate: Date             // all concepts in this section must start on or after this
  endDate: Date               // all concepts in this section must end on or before this
  order: number               // display order
}

export interface Concept {
  id: ConceptId
  contractId: ContractId
  sectionId: ConceptSectionId | null // null = no section
  specificationNumber: string // "especificación" — defined per concept in catalog
  description: string
  unit: string // e.g. m2, m3, pza, lote
  unitPrice: Money
  contractedQuantity: number // "in project" quantity
  /**
   * True for concepts added via an "amount" (de monto) modification agreement
   * — either a brand-new concept, or the extra quantity for a concept that
   * already existed originally. Kept separate from the original rather than
   * merged in, so estimates/schedule/progress can track them distinctly.
   */
  isExtra: boolean
  /** Set when this extra concept represents additional quantity of an existing one. */
  extendsConceptId: ConceptId | null
  /** The agreement that introduced this concept, for provenance/display. */
  originAgreementId: AgreementId | null
}