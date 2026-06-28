<!-- app/components/ContractFinancialWidget.vue -->
<script setup lang="ts">
import type { ContractFinancials } from '~/data/models'
import { S } from '~/constants/strings'

defineProps<{ financials: ContractFinancials }>()
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2 font-medium">
        <UIcon name="i-lucide-banknote" class="size-4 text-muted" />
        {{ S.contractDashboard.balance }}
      </div>
    </template>

    <div class="flex items-center gap-6">
      <GaugeCircle :value="financials.balancePercentage" :size="124" :sublabel="S.contractDashboard.balance" />

      <dl class="space-y-2 text-sm min-w-0">
        <div class="flex flex-col">
          <dt class="text-muted text-xs">{{ S.dashboard.executed }}</dt>
          <dd class="font-semibold tabular-nums">{{ formatMoney(financials.executedAmount) }}</dd>
        </div>
        <div class="flex flex-col">
          <dt class="text-muted text-xs">{{ S.dashboard.contracted }}</dt>
          <dd class="tabular-nums">{{ formatMoney(financials.contractedAmount) }}</dd>
        </div>
        <div class="flex flex-col pt-1">
          <dt class="text-muted text-xs">{{ S.contractDashboard.anticipo }}</dt>
          <dd class="tabular-nums">
            {{ formatPercent(financials.anticipoPercentage) }}
            <span class="text-muted">· {{ formatMoney(financials.anticipoAmount) }}</span>
          </dd>
        </div>
      </dl>
    </div>
  </UCard>
</template>
