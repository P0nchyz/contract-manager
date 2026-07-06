<!-- app/pages/contracts/[contractId]/progress.vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'
import {
  buildScheduleCurve,
  computeConceptStatuses,
  buildPeriods,
  currentPeriodIndex as getCurrentPeriodIdx,
  type ConceptMeta,
  type PeriodProgress,
  type ConceptGanttStatus,
} from '~/data/calc/schedule'
import type { GanttEntry, GanttCell } from '~/components/ScheduleGantt.client.vue'
import { groupConceptsBySections } from '~/composables/useConceptSections'

definePageMeta({ requiredPermission: 'estimate:view' })

const SP = S.progressPage

const route = useRoute()
const repos = useRepositories()
const contractId = computed(() => route.params.contractId as string)

const { data, status, error, refresh } = await useAsyncData(
  () => `progress-${contractId.value}`,
  async () => {
    const [contract, schedule, estimates, concepts, sections] = await Promise.all([
      repos.contracts.getById(contractId.value),
      repos.schedule.getByContract(contractId.value),
      repos.estimates.listByContract(contractId.value),
      repos.concepts.listByContract(contractId.value),
      repos.concepts.listSectionsByContract(contractId.value),
    ])

    const periodicity = contract.estimatePeriodicity ?? 'monthly'
    const periods = buildPeriods(new Date(contract.startDate), new Date(contract.endDate), periodicity)
    const curIdx = getCurrentPeriodIdx(periods)

    // Roll up physical (approved+paid) and financial (paid) per concept per period
    const progress: PeriodProgress[] = []
    for (const est of estimates) {
      const isPhysical = est.status === 'approved' || est.status === 'paid'
      const isFinancial = est.status === 'paid'
      if (!isPhysical) continue
      for (const li of est.lineItems) {
        progress.push({
          conceptId: String(li.conceptId),
          periodIndex: est.periodIndex - 1, // 1-based → 0-based
          physicalQty: li.inThisEstimate,
          financialQty: isFinancial ? li.inThisEstimate : 0,
        })
      }
    }

    const conceptMetas: ConceptMeta[] = concepts.map((c) => ({
      conceptId: String(c.id),
      contractedQuantity: c.contractedQuantity,
      unitPrice: c.unitPrice,
    }))

    const curve = buildScheduleCurve(periods, (schedule.entries ?? []), conceptMetas, progress, curIdx)
    const statuses = computeConceptStatuses((schedule.entries ?? []), conceptMetas, progress, curIdx)
    const statusMap = Object.fromEntries(statuses.map((s) => [s.conceptId, s]))

    // Per-concept, per-period planned and actual (physical) quantity lookups —
    // reused by both the Gantt (disconnected cells) and the read-only
    // "actual schedule per period" section below.
    const plannedByConceptPeriod: Record<string, Record<number, number>> = {}
    for (const e of schedule.entries ?? []) {
      const cid = String(e.conceptId)
      if (!plannedByConceptPeriod[cid]) plannedByConceptPeriod[cid] = {}
      plannedByConceptPeriod[cid][e.periodIndex] = (plannedByConceptPeriod[cid][e.periodIndex] ?? 0) + e.plannedQuantity
    }
    const actualByConceptPeriod: Record<string, Record<number, number>> = {}
    for (const p of progress) {
      if (!actualByConceptPeriod[p.conceptId]) actualByConceptPeriod[p.conceptId] = {}
      actualByConceptPeriod[p.conceptId][p.periodIndex] = (actualByConceptPeriod[p.conceptId][p.periodIndex] ?? 0) + p.physicalQty
    }

    // Build Gantt entries: only the periods where the concept actually has
    // planned volume become a visible cell — everything else is a gap.
    const ganttEntries: GanttEntry[] = concepts.map((c) => {
      const cid = String(c.id)
      const cells: GanttCell[] = (schedule.entries ?? [])
        .filter((e) => String(e.conceptId) === cid && e.plannedQuantity > 0)
        .map((e) => ({
          periodIndex: e.periodIndex,
          plannedQuantity: plannedByConceptPeriod[cid]?.[e.periodIndex] ?? e.plannedQuantity,
          actualQuantity: actualByConceptPeriod[cid]?.[e.periodIndex] ?? 0,
        }))
      return {
        conceptId: cid,
        label: c.description,
        cells,
      }
    })

    const groups = groupConceptsBySections(sections, concepts)

    return {
      contract, schedule, curve, ganttEntries, statuses, conceptMetas, progress,
      periodicity, periods, curIdx, groups, plannedByConceptPeriod, actualByConceptPeriod,
    }
  },
)

// --- Derived summary counts ---
const statusCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const s of data.value?.statuses ?? []) {
    counts[s.status] = (counts[s.status] ?? 0) + 1
  }
  return counts
})

// Latest curve point for "current" progress
const latestPoint = computed(() => {
  const curve = data.value?.curve ?? []
  const today = new Date()
  const past = curve.filter((p) => new Date(p.date) <= today)
  return past.length > 0 ? past[past.length - 1] : null
})

// Status badge color mapping
function statusColor(s: ConceptGanttStatus['status']): 'success' | 'error' | 'warning' | 'neutral' | 'info' {
  return s === 'done' ? 'success' :
    s === 'ahead' ? 'info' :
      s === 'behind' ? 'error' :
        s === 'overdue' ? 'error' :
          s === 'on_track' ? 'success' :
            'neutral'
}

const ganttHeight = computed(() =>
  Math.max(240, (data.value?.ganttEntries.length ?? 0) * 42 + 60),
)

// Per-concept detail table rows: gantt entry (label + cells) joined with its
// overall status, plus first/last active period for display.
const detailRows = computed(() => {
  if (!data.value) return []
  const statusMap = Object.fromEntries(data.value.statuses.map((s) => [s.conceptId, s]))
  return data.value.ganttEntries.map((entry) => {
    const periodIdxs = entry.cells.map((c) => c.periodIndex).sort((a, b) => a - b)
    return {
      ...entry,
      status: statusMap[entry.conceptId] ?? {
        conceptId: entry.conceptId, status: 'future' as const,
        plannedProgress: 0, actualProgress: 0, delta: 0, activePeriods: [],
      },
      firstPeriodLabel: periodIdxs.length ? `P${periodIdxs[0] + 1}` : '—',
      lastPeriodLabel: periodIdxs.length ? `P${periodIdxs[periodIdxs.length - 1] + 1}` : '—',
    }
  })
})

// Active period tab for the "actual schedule per period" section — defaults
// to the contract's current period once the data loads.
const activePeriodTab = ref(0)
watch(data, (d) => {
  if (d) activePeriodTab.value = Math.min(d.curIdx, Math.max(0, d.periods.length - 1))
}, { immediate: true })
</script>

<template>
  <UDashboardPanel id="progress">
    <template #header>
      <UDashboardNavbar :title="SP.title">
        <template #leading>
          <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" :to="`/contracts/${contractId}`"
            :aria-label="S.common.back" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-alert-triangle" :title="S.common.error"
        :actions="[{ label: 'Reintentar', color: 'neutral', variant: 'subtle', onClick: () => refresh() }]" />

      <div v-else-if="status === 'pending'" class="space-y-4">
        <USkeleton class="h-24 w-full rounded-lg" />
        <USkeleton class="h-64 w-full rounded-lg" />
        <USkeleton class="h-48 w-full rounded-lg" />
      </div>

      <div v-else-if="data" class="space-y-6">
        <!-- ① Progress summary cards -->
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <UCard>
            <div class="flex items-center gap-3">
              <UIcon name="i-lucide-hard-hat" class="size-5 text-primary" />
              <div>
                <div class="text-xs text-muted">{{ SP.summary.physicalProgress }}</div>
                <div class="text-xl font-semibold tabular-nums text-highlighted">
                  {{ latestPoint ? `${latestPoint.actualCumulativePercentage}%` : '—' }}
                </div>
              </div>
            </div>
          </UCard>
          <UCard>
            <div class="flex items-center gap-3">
              <UIcon name="i-lucide-banknote" class="size-5 text-success" />
              <div>
                <div class="text-xs text-muted">{{ SP.summary.financialProgress }}</div>
                <div class="text-xl font-semibold tabular-nums text-highlighted">
                  {{ latestPoint ? `${latestPoint.financialCumulativePercentage}%` : '—' }}
                </div>
              </div>
            </div>
          </UCard>
          <UCard>
            <div class="flex items-center gap-3">
              <UIcon name="i-lucide-calendar-check" class="size-5 text-muted" />
              <div>
                <div class="text-xs text-muted">{{ SP.summary.plannedProgress }}</div>
                <div class="text-xl font-semibold tabular-nums text-highlighted">
                  {{ latestPoint ? `${latestPoint.programmedCumulativePercentage}%` : '—' }}
                </div>
              </div>
            </div>
          </UCard>
          <!-- Status breakdown -->
          <UCard>
            <div class="space-y-1.5">
              <div v-for="[key, label, color] in [
                ['done', SP.statusLabel.done, 'text-success'],
                ['ahead', SP.statusLabel.ahead, 'text-info'],
                ['on_track', SP.statusLabel.on_track, 'text-success'],
                ['behind', SP.statusLabel.behind, 'text-error'],
                ['overdue', SP.statusLabel.overdue, 'text-error'],
                ['future', SP.statusLabel.future, 'text-muted'],
              ] as const" :key="key" class="flex items-center justify-between text-xs">
                <span :class="color">{{ label }}</span>
                <span class="font-semibold tabular-nums text-highlighted">{{ statusCounts[key] ?? 0 }}</span>
              </div>
            </div>
          </UCard>
        </div>

        <!-- ② Gantt chart -->
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-chart-gantt" class="size-4 text-muted" />
                {{ SP.gantt.title }}
              </div>
              <!-- Legend -->
              <div class="flex flex-wrap items-center gap-3 text-xs text-muted">
                <span class="flex items-center gap-1.5">
                  <span class="size-2.5 rounded-sm bg-[#3b82f6]" />{{ SP.gantt.legend.done }}
                </span>
                <span class="flex items-center gap-1.5">
                  <span class="size-2.5 rounded-sm bg-[#f59e0b]" />{{ SP.gantt.legend.partial }}
                </span>
                <span class="flex items-center gap-1.5">
                  <span class="size-2.5 rounded-sm bg-[#ef4444]" />{{ SP.gantt.legend.missed }}
                </span>
                <span class="flex items-center gap-1.5">
                  <span class="size-2.5 rounded-sm bg-[#6b7280] opacity-30" />{{ SP.gantt.legend.pending }}
                </span>
                <span class="flex items-center gap-1.5">
                  <span class="size-2.5 rounded-sm bg-[#6b7280] opacity-10 border border-[#6b7280]" />{{
                    SP.gantt.legend.scheduled }}
                </span>
              </div>
            </div>
          </template>

          <div class="px-4 py-4">
            <ScheduleGantt :entries="data.ganttEntries" :periods="data.periods"
              :current-period-index="data.curIdx" :height="ganttHeight" />
          </div>
        </UCard>

        <!-- ③ Programa real por periodo (read-only, mirrors the schedule-input UI) -->
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-calendar-range" class="size-4 text-muted" />
              {{ SP.actualSchedule.title }}
            </div>
          </template>

          <p class="border-b border-default px-4 py-2 text-xs text-muted">{{ SP.actualSchedule.hint }}</p>

          <!-- Period tabs -->
          <div class="flex overflow-x-auto border-b border-default bg-elevated/30">
            <button v-for="(period, pi) in data.periods" :key="pi"
              class="shrink-0 border-b-2 px-4 py-2 text-sm transition-colors" :class="activePeriodTab === pi
                ? 'border-primary font-semibold text-primary'
                : 'border-transparent text-muted hover:text-default'" @click="activePeriodTab = pi">
              <span class="font-semibold">P{{ pi + 1 }}</span>
              <span v-if="pi === data.curIdx" class="ml-1 text-amber-500">●</span>
              <span class="ml-1.5 text-[11px] font-normal opacity-70">
                {{ new Date(period.end).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) }}
              </span>
            </button>
          </div>

          <!-- Active period detail -->
          <div v-if="data.periods[activePeriodTab]" class="px-4 py-3">
            <div class="mb-3 text-xs text-muted">
              {{ new Date(data.periods[activePeriodTab].start).toLocaleDateString('es-MX', {
                day: '2-digit', month: 'long', year: 'numeric'
              }) }}
              –
              {{ new Date(data.periods[activePeriodTab].end).toLocaleDateString('es-MX', {
                day: '2-digit', month: 'long', year: 'numeric'
              }) }}
            </div>

            <div class="space-y-4">
              <div v-for="(group, gi) in data.groups" :key="gi">
                <div class="mb-1.5 flex items-center gap-2">
                  <span v-if="group.section" class="font-mono text-xs font-semibold text-muted">
                    {{ group.section.specificationNumber }}
                  </span>
                  <span class="text-sm font-semibold text-highlighted">
                    {{ group.section ? group.section.description : SP.actualSchedule.noSection }}
                  </span>
                </div>
                <div class="space-y-1">
                  <div v-for="c in group.concepts" :key="c.id" class="flex items-center gap-3">
                    <div class="min-w-0 flex-1">
                      <span class="font-mono text-xs text-muted">{{ c.specificationNumber }}</span>
                      <span class="ml-2 text-sm text-highlighted">{{ c.description }}</span>
                      <span class="ml-1 text-xs text-muted">({{ c.unit }})</span>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0 text-xs tabular-nums">
                      <template
                        v-if="(data.plannedByConceptPeriod[String(c.id)]?.[activePeriodTab] ?? 0) > 0">
                        <span class="font-medium" :class="
                          (data.actualByConceptPeriod[String(c.id)]?.[activePeriodTab] ?? 0) >=
                            (data.plannedByConceptPeriod[String(c.id)]?.[activePeriodTab] ?? 0)
                            ? 'text-success'
                            : activePeriodTab < data.curIdx ? 'text-error' : 'text-highlighted'
                        ">
                          {{ (data.actualByConceptPeriod[String(c.id)]?.[activePeriodTab] ?? 0).toLocaleString('es-MX') }}
                        </span>
                        <span class="text-muted">
                          / {{ (data.plannedByConceptPeriod[String(c.id)]?.[activePeriodTab] ?? 0).toLocaleString('es-MX') }}
                          {{ c.unit }}
                        </span>
                      </template>
                      <span v-else class="text-muted italic" :title="SP.actualSchedule.empty">—</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </UCard>

        <!-- ④ S-curve -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-trending-up" class="size-4 text-muted" />
              {{ SP.sCurve.title }}
            </div>
          </template>
          <SCurveChart v-if="data.curve.length" :points="data.curve" :height="220" />
          <p v-else class="text-sm text-muted">{{ S.common.empty }}</p>
        </UCard>

        <!-- ⑤ Per-concept detail table -->
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-table" class="size-4 text-muted" />
              {{ SP.detail.concept }}
            </div>
          </template>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[44rem] text-sm">
              <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                <tr>
                  <th class="px-4 py-2.5 text-left font-medium">{{ SP.detail.concept }}</th>
                  <th class="px-4 py-2.5 text-center font-medium">{{ SP.detail.start }}</th>
                  <th class="px-4 py-2.5 text-center font-medium">{{ SP.detail.end }}</th>
                  <th class="px-4 py-2.5 text-right font-medium">{{ SP.detail.planned }}</th>
                  <th class="px-4 py-2.5 text-right font-medium">{{ SP.detail.actual }}</th>
                  <th class="px-4 py-2.5 text-right font-medium">{{ SP.detail.delta }}</th>
                  <th class="px-4 py-2.5 text-left font-medium">{{ SP.detail.status }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-for="entry in detailRows" :key="entry.conceptId">
                  <td class="px-4 py-2.5 font-medium text-highlighted">{{ entry.label }}</td>
                  <td class="px-4 py-2.5 text-center text-muted">{{ entry.firstPeriodLabel }}</td>
                  <td class="px-4 py-2.5 text-center text-muted">{{ entry.lastPeriodLabel }}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums text-muted">
                    {{ entry.status.plannedProgress.toFixed(1) }}%
                  </td>
                  <td class="px-4 py-2.5 text-right tabular-nums font-medium text-highlighted">
                    {{ entry.status.actualProgress.toFixed(1) }}%
                  </td>
                  <td class="px-4 py-2.5 text-right tabular-nums font-semibold" :class="entry.status.delta > 0 ? 'text-info' :
                    entry.status.delta < 0 ? 'text-error' :
                      'text-muted'
                    ">
                    <template v-if="entry.status.status !== 'future' && entry.status.status !== 'done'">
                      {{ entry.status.delta > 0 ? '+' : '' }}{{ entry.status.delta.toFixed(1) }}%
                    </template>
                    <span v-else class="text-muted font-normal">—</span>
                  </td>
                  <td class="px-4 py-2.5">
                    <UBadge :label="SP.statusLabel[entry.status.status] ?? entry.status.status"
                      :color="statusColor(entry.status.status)" variant="soft" size="sm" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>