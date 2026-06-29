<!-- app/pages/contracts/[contractId]/schedule.vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'
import {
  buildScheduleCurve,
  computeConceptStatuses,
  periodEnds,
  formatPeriodLabel,
  type ConceptProgress,
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

    // Roll up physical and financial progress per concept from estimates.
    // Physical  = approved + paid (work is done)
    // Financial = paid only (money disbursed)
    const physQty: Record<string, number>  = {}
    const finQty:  Record<string, number>  = {}

    for (const est of estimates) {
      const isPhysical  = est.status === 'approved' || est.status === 'paid'
      const isFinancial = est.status === 'paid'
      for (const li of est.lineItems) {
        if (isPhysical)  physQty[li.conceptId]  = (physQty[li.conceptId]  ?? 0) + li.inThisEstimate
        if (isFinancial) finQty[li.conceptId]   = (finQty[li.conceptId]   ?? 0) + li.inThisEstimate
      }
    }

    const conceptMap: Record<string, { contractedQuantity: number }> = {}
    for (const c of concepts) conceptMap[c.id] = { contractedQuantity: c.contractedQuantity }

    const conceptProgress: ConceptProgress[] = schedule.items
      .filter((i) => i.conceptId)
      .map((i) => {
        const cid = i.conceptId!
        const contracted = conceptMap[cid]?.contractedQuantity ?? 0
        const phys = contracted > 0 ? Math.min((physQty[cid] ?? 0) / contracted * 100, 100) : 0
        const fin  = contracted > 0 ? Math.min((finQty[cid]  ?? 0) / contracted * 100, 100) : 0
        return { conceptId: cid, physicalProgress: phys, financialProgress: fin }
      })

    const periodicity = contract.estimatePeriodicity ?? 'monthly'

    const curve     = buildScheduleCurve(schedule.items, periodicity, conceptProgress)
    const statuses  = computeConceptStatuses(schedule.items, conceptProgress, periodicity)
    const statusMap = Object.fromEntries(statuses.map((s) => [s.conceptId, s]))

    // Build Gantt entries
    const ganttEntries: GanttEntry[] = schedule.items.map((item) => ({
      conceptId: item.conceptId ?? '',
      label:     item.label,
      startDate: new Date(item.startDate),
      endDate:   new Date(item.endDate),
      programmedAmount: item.programmedAmount,
      status: statusMap[item.conceptId ?? ''] ?? {
        conceptId: item.conceptId ?? '',
        status: 'future' as const,
        plannedProgress: 0,
        actualProgress: 0,
        delta: 0,
      },
    }))

    // Period table data: planned vs actual per period
    const today = new Date()
    const schedStart = new Date(Math.min(...schedule.items.map((i) => +new Date(i.startDate))))
    const schedEnd   = new Date(Math.max(...schedule.items.map((i) => +new Date(i.endDate))))
    const periods = periodEnds(schedStart, schedEnd, periodicity)

    return {
      contract,
      schedule,
      curve,
      ganttEntries,
      statuses,
      conceptProgress,
      periodicity,
      periods,
      schedStart,
      schedEnd,
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
  return s === 'done'      ? 'success' :
         s === 'ahead'     ? 'info'    :
         s === 'behind'    ? 'error'   :
         s === 'overdue'   ? 'error'   :
         s === 'on_track'  ? 'success' :
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
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            :to="`/contracts/${contractId}`"
            :aria-label="S.common.back"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        icon="i-lucide-alert-triangle"
        :title="S.common.error"
        :actions="[{ label: 'Reintentar', color: 'neutral', variant: 'subtle', onClick: () => refresh() }]"
      />

      <div v-else-if="status === 'pending'" class="space-y-4">
        <USkeleton class="h-24 w-full rounded-lg" />
        <USkeleton class="h-64 w-full rounded-lg" />
        <USkeleton class="h-48 w-full rounded-lg" />
      </div>

      <div v-else-if="data" class="flex flex-col gap-6">
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
                ['done',    SP.statusLabel.done,    'text-success'],
                ['ahead',   SP.statusLabel.ahead,   'text-info'],
                ['on_track',SP.statusLabel.on_track,'text-success'],
                ['behind',  SP.statusLabel.behind,  'text-error'],
                ['overdue', SP.statusLabel.overdue, 'text-error'],
                ['future',  SP.statusLabel.future,  'text-muted'],
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
                  <span class="size-2.5 rounded-sm bg-[#22c55e]" />{{ SP.gantt.legend.done }}
                </span>
                <span class="flex items-center gap-1.5">
                  <span class="size-2.5 rounded-sm bg-[#3b82f6]" />{{ SP.gantt.legend.ahead }}
                </span>
                <span class="flex items-center gap-1.5">
                  <span class="size-2.5 rounded-sm bg-[#ef4444]" />{{ SP.gantt.legend.behind }}
                </span>
                <span class="flex items-center gap-1.5">
                  <span class="size-2.5 rounded-sm bg-[#6b7280] opacity-30 border border-[#6b7280]" />{{ SP.gantt.legend.remaining }}
                </span>
                <span class="flex items-center gap-1.5">
                  <span class="inline-block h-2 w-4 border-b-2 border-dashed border-amber-400" />{{ SP.gantt.today }}
                </span>
              </div>
            </div>
          </template>

          <div class="px-4 py-4">
            <ScheduleGantt
              :entries="data.ganttEntries"
              :contract-start="new Date(data.contract.startDate)"
              :contract-end="new Date(data.contract.endDate)"
              :periodicity="data.periodicity"
              :height="ganttHeight"
            />
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
                  <td
                    class="px-4 py-2.5 text-right tabular-nums font-semibold"
                    :class="
                      entry.status.delta > 0 ? 'text-info' :
                      entry.status.delta < 0 ? 'text-error' :
                      'text-muted'
                    "
                  >
                    <template v-if="entry.status.status !== 'future' && entry.status.status !== 'done'">
                      {{ entry.status.delta > 0 ? '+' : '' }}{{ entry.status.delta.toFixed(1) }}%
                    </template>
                    <span v-else class="text-muted font-normal">—</span>
                  </td>
                  <td class="px-4 py-2.5">
                    <UBadge
                      :label="SP.statusLabel[entry.status.status] ?? entry.status.status"
                      :color="statusColor(entry.status.status)"
                      variant="soft"
                      size="sm"
                    />
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