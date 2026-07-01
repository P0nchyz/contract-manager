<!-- app/pages/contracts/[contractId]/schedule.vue -->
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
import type { GanttEntry } from '~/components/ScheduleGantt.client.vue'

definePageMeta({ requiredPermission: 'estimate:view' })

const SP = S.schedulePage

const route = useRoute()
const repos = useRepositories()
const contractId = computed(() => route.params.contractId as string)

const { data, status, error, refresh } = await useAsyncData(
  () => `schedule-${contractId.value}`,
  async () => {
    const [contract, schedule, estimates, concepts] = await Promise.all([
      repos.contracts.getById(contractId.value),
      repos.schedule.getByContract(contractId.value),
      repos.estimates.listByContract(contractId.value),
      repos.concepts.listByContract(contractId.value),
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

    // Build Gantt entries: first to last active period per concept
    const ganttEntries: GanttEntry[] = concepts.map((c) => {
      const cid = String(c.id)
      const cEntries = schedule.entries.filter((e) => String(e.conceptId) === cid && e.plannedQuantity > 0)
      const first = cEntries.length > 0 ? Math.min(...cEntries.map((e) => e.periodIndex)) : -1
      const last = cEntries.length > 0 ? Math.max(...cEntries.map((e) => e.periodIndex)) : -1
      return {
        conceptId: cid,
        label: c.description,
        startDate: first >= 0 ? new Date(periods[first].start) : new Date(contract.startDate),
        endDate: last >= 0 ? new Date(periods[last].end) : new Date(contract.endDate),
        programmedAmount: c.unitPrice * c.contractedQuantity,
        status: statusMap[cid] ?? {
          conceptId: cid, status: 'future' as const,
          plannedProgress: 0, actualProgress: 0, delta: 0, activePeriods: [],
        },
      }
    })

    return { contract, schedule, curve, ganttEntries, statuses, conceptMetas, progress, periodicity, periods, curIdx }
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
</script>

<template>
  <UDashboardPanel id="schedule">
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
                  <span class="size-2.5 rounded-sm bg-[#1f2937]" />{{ SP.gantt.legend.executed }}
                </span>
                <span class="flex items-center gap-1.5">
                  <span class="size-2.5 rounded-sm bg-[#22c55e] opacity-70" />{{ SP.gantt.legend.ahead }}
                </span>
                <span class="flex items-center gap-1.5">
                  <span class="size-2.5 rounded-sm bg-[#ef4444] opacity-70" />{{ SP.gantt.legend.behind }}
                </span>
                <span class="flex items-center gap-1.5">
                  <span class="size-2.5 rounded-sm bg-[#6b7280] opacity-30 border border-[#6b7280]" />{{
                    SP.gantt.legend.remaining }}
                </span>
                <span class="flex items-center gap-1.5">
                  <span class="inline-block h-2 w-4 border-b-2 border-dashed border-amber-400" />{{ SP.gantt.today }}
                </span>
              </div>
            </div>
          </template>

          <div class="px-4 py-4">
            <ScheduleGantt :entries="data.ganttEntries" :contract-start="new Date(data.contract.startDate)"
              :contract-end="new Date(data.contract.endDate)" :periodicity="data.periodicity" :height="ganttHeight" />
          </div>
        </UCard>

        <!-- ③ S-curve -->
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

        <!-- ④ Per-concept detail table -->
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
                <tr v-for="entry in data.ganttEntries" :key="entry.conceptId">
                  <td class="px-4 py-2.5 font-medium text-highlighted">{{ entry.label }}</td>
                  <td class="px-4 py-2.5 text-center text-muted">{{ formatDate(entry.startDate) }}</td>
                  <td class="px-4 py-2.5 text-center text-muted">{{ formatDate(entry.endDate) }}</td>
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