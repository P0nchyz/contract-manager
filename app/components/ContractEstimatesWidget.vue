<!-- app/components/ContractEstimatesWidget.vue -->
<script setup lang="ts">
import type { Estimate, EstimateStatus } from '~/data/models'
import { S } from '~/constants/strings'

const props = defineProps<{ estimates: Estimate[]; contractId: string }>()

// Legend reflects the agreed status colors.
const legend = (['draft', 'submitted', 'rejected', 'approved', 'paid'] as EstimateStatus[])
  .map((s) => estimateStatusDisplay[s])
</script>

<template>
  <UCard :ui="{ body: 'p-0 sm:p-0' }">
    <template #header>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 font-medium">
          <UIcon name="i-lucide-file-spreadsheet" class="size-4 text-muted" />
          {{ S.contractDashboard.recentEstimates }}
        </div>
        <ULink :to="`/contracts/${props.contractId}/estimates`" class="text-sm text-primary">
          {{ S.contractDashboard.viewAll }}
        </ULink>
      </div>
    </template>

    <p v-if="!estimates.length" class="text-sm text-muted p-4">{{ S.contractDashboard.noEstimates }}</p>

    <ul v-else class="divide-y divide-default">
      <li v-for="est in estimates" :key="est.id">
        <ULink
          :to="`/contracts/${props.contractId}/estimates/${est.id}`"
          class="flex items-center justify-between gap-3 px-4 py-3 hover:bg-elevated/50 transition"
        >
          <div class="min-w-0">
            <p class="font-medium truncate">Estimación #{{ est.number }}</p>
            <p class="text-xs text-muted">
              {{ formatDate(est.periodStart) }} – {{ formatDate(est.periodEnd) }}
            </p>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <span class="text-sm font-medium tabular-nums">{{ formatMoney(est.summary.calculations.total) }}</span>
            <StatusBadge :display="estimateStatusDisplay[est.status]" />
          </div>
        </ULink>
      </li>
    </ul>

    <template #footer>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span class="text-xs text-muted">{{ S.contractDashboard.legend }}:</span>
        <StatusBadge v-for="d in legend" :key="d.label" :display="d" />
      </div>
    </template>
  </UCard>
</template>