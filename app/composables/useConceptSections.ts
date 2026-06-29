// app/composables/useConceptSections.ts
/**
 * Loads sections + concepts for a contract and returns them in a grouped
 * structure.  Used by every view that displays the concept catalog.
 */
import type { Concept, ConceptSection } from '~/data/models'

export interface SectionGroup {
  section: ConceptSection | null // null = the "no section" group
  concepts: Concept[]
  contractedAmount: number // sum of unitPrice × contractedQuantity for the section
}

/**
 * Given a flat list of sections and concepts, build the ordered grouped view.
 * Sections are sorted by `order`; concepts with no sectionId go into a trailing
 * "Sin sección" group (only shown when at least one unsectioned concept exists).
 */
export function groupConceptsBySections(
  sections: ConceptSection[],
  concepts: Concept[],
): SectionGroup[] {
  const sorted = [...sections].sort((a, b) => a.order - b.order)
  const groups: SectionGroup[] = sorted.map((sec) => {
    const cs = concepts.filter((c) => c.sectionId === sec.id)
    return {
      section: sec,
      concepts: cs,
      contractedAmount: cs.reduce((s, c) => s + c.unitPrice * c.contractedQuantity, 0),
    }
  })

  // Concepts that belong to no section
  const unsectioned = concepts.filter((c) => !c.sectionId)
  if (unsectioned.length > 0) {
    groups.push({
      section: null,
      concepts: unsectioned,
      contractedAmount: unsectioned.reduce((s, c) => s + c.unitPrice * c.contractedQuantity, 0),
    })
  }

  return groups
}

/**
 * Reactive async helper — loads sections and concepts together for a given
 * contractId and returns the grouped structure plus the raw lists.
 */
export function useConceptSections(contractId: Ref<string>) {
  const repos = useRepositories()

  return useAsyncData(
    () => `concept-sections-${contractId.value}`,
    async () => {
      const [sections, concepts] = await Promise.all([
        repos.concepts.listSectionsByContract(contractId.value),
        repos.concepts.listByContract(contractId.value),
      ])
      return {
        sections,
        concepts,
        groups: groupConceptsBySections(sections, concepts),
      }
    },
  )
}