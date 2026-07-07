<!-- app/components/ScheduleMatrixTable.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { S } from '~/constants/strings'
import { formatNumber } from '~/utils/format'
import type { SectionGroup } from '~/composables/useConceptSections'
import type { ConceptScheduleEntry } from '~/data/models'

const props = defineProps<{
  groups: SectionGroup[]
  periods: { start: Date; end: Date }[]
  entries: ConceptScheduleEntry[]
}>()

const SM = S.scheduleMatrix

// conceptId -> periodIndex(0-based) -> planned quantity
const plannedByConceptPeriod = computed(() => {
  const map: Record<string, Record<number, number>> = {}
  for (const e of props.entries) {
    const cid = String(e.conceptId)
    if (!map[cid]) map[cid] = {}
    map[cid][e.periodIndex] = (map[cid][e.periodIndex] ?? 0) + e.plannedQuantity
  }
  return map
})

function plannedFor(conceptId: string, periodIdx0: number): number {
  return plannedByConceptPeriod.value[conceptId]?.[periodIdx0] ?? 0
}
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-default">
    <table class="border-collapse text-sm">
      <thead>
        <tr class="bg-elevated text-xs text-muted">
          <th
            class="sticky left-0 z-20 w-72 min-w-[18rem] border-r border-default bg-elevated px-4 py-2.5 text-left font-medium">
            {{ SM.concept }}
          </th>
          <th
            class="sticky left-72 z-20 w-36 min-w-[9rem] border-r-2 border-default bg-elevated px-4 py-2.5 text-right font-medium">
            {{ SM.totalContracted }}
          </th>
          <th v-for="(p, pi) in periods" :key="pi"
            class="min-w-[5.5rem] whitespace-nowrap px-3 py-2.5 text-right font-medium">
            P{{ pi + 1 }}
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(group, gi) in groups" :key="group.section?.id ?? `none-${gi}`">
          <!-- Section header row -->
          <tr class="border-t-2 border-default">
            <td class="sticky left-0 z-10 border-r border-default bg-elevated px-4 py-2" colspan="2">
              <div class="flex items-center gap-2">
                <span v-if="group.section" class="font-mono text-xs font-semibold text-muted">
                  {{ group.section.specificationNumber }}
                </span>
                <span class="text-sm font-semibold text-highlighted">
                  {{ group.section ? group.section.description : SM.noSection }}
                </span>
              </div>
            </td>
            <td class="bg-elevated" :colspan="periods.length" />
          </tr>

          <!-- Concept rows -->
          <tr v-for="c in group.concepts" :key="c.id" class="group border-t border-default/60 hover:bg-elevated/30">
            <td
              class="sticky left-0 z-10 w-72 min-w-[18rem] border-r border-default bg-default px-4 py-2.5 group-hover:bg-elevated">
              <div class="font-mono text-xs text-muted">{{ c.specificationNumber }}</div>
              <div class="text-highlighted">{{ c.description }}</div>
              <div class="text-xs text-muted">{{ c.unit }}</div>
            </td>
            <td
              class="sticky left-72 z-10 w-36 min-w-[9rem] border-r-2 border-default bg-default px-4 py-2.5 text-right font-medium tabular-nums text-highlighted group-hover:bg-elevated">
              {{ formatNumber(c.contractedQuantity) }}
            </td>
            <td v-for="(p, pi) in periods" :key="pi" class="px-3 py-2.5 text-right tabular-nums"
              :class="plannedFor(String(c.id), pi) > 0 ? 'text-highlighted' : 'text-muted/40'">
              {{ plannedFor(String(c.id), pi) > 0 ? formatNumber(plannedFor(String(c.id), pi)) : '—' }}
            </td>
          </tr>
        </template>

        <tr v-if="!groups.length">
          <td :colspan="2 + periods.length" class="px-4 py-10 text-center text-sm text-muted">
            {{ SM.empty }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>