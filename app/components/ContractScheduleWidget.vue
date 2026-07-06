<!-- app/components/ContractScheduleWidget.vue -->
<script setup lang="ts">
import type { ContractFinancials, SchedulePoint } from '~/data/models'
import { S } from '~/constants/strings'

defineProps<{
  points: SchedulePoint[]
  financials?: ContractFinancials | null
  contractId?: string
}>()
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 font-medium">
          <UIcon name="i-lucide-chart-gantt" class="size-4 text-muted" />
          {{ S.contractDashboard.overSchedule }}
        </div>
        <UButton
          v-if="contractId"
          :to="`/contracts/${contractId}/progress`"
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-right"
          :label="S.contractDashboard.viewAll"
        />
      </div>
    </template>

    <SCurveChart v-if="points.length" :points="points" :height="180" />
    <p v-else class="text-sm text-muted">{{ S.common.empty }}</p>

    <div v-if="financials" class="mt-4 grid grid-cols-2 gap-4">
      <div>
        <div class="flex items-center justify-between text-xs">
          <span class="text-muted">{{ S.contractDashboard.physical }}</span>
          <span class="font-medium">{{ formatPercent(financials.physicalProgress) }}</span>
        </div>
        <UProgress :model-value="financials.physicalProgress" :max="100" size="sm" class="mt-1" />
      </div>
      <div>
        <div class="flex items-center justify-between text-xs">
          <span class="text-muted">{{ S.contractDashboard.financial }}</span>
          <span class="font-medium">{{ formatPercent(financials.financialProgress) }}</span>
        </div>
        <UProgress :model-value="financials.financialProgress" :max="100" size="sm" class="mt-1" />
      </div>
    </div>
  </UCard>
</template>