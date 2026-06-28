<!-- app/components/ContractCard.vue -->
<script setup lang="ts">
import type { Contract, ContractFinancials } from '~/data/models'
import { S } from '~/constants/strings'

const props = defineProps<{
  contract: Contract
  financials: ContractFinancials | null
  hasAlert?: boolean
}>()

// contractStatusDisplay, formatMoney, formatPercent are auto-imported from utils/.
const status = computed(() => contractStatusDisplay[props.contract.status])
</script>

<template>
  <ULink :to="`/contracts/${contract.id}`" class="block h-full">
    <UCard class="relative h-full transition hover:ring-2 hover:ring-primary/40">
      <!-- alert dot -->
      <span
        v-if="hasAlert"
        class="absolute -top-1.5 -right-1.5 size-3 rounded-full bg-error ring-2 ring-default"
        :aria-label="S.dashboard.alerts"
        :title="S.dashboard.alerts"
      />

      <div class="flex items-start justify-between gap-2">
        <UBadge :label="contract.code" color="neutral" variant="subtle" size="sm" />
        <UBadge :label="status.label" :color="status.color" :variant="status.variant" size="sm" />
      </div>

      <h3 class="mt-3 font-medium leading-snug line-clamp-2">{{ contract.title }}</h3>

      <div v-if="financials" class="mt-4 space-y-2">
        <div class="flex items-center justify-between text-sm">
          <span class="text-muted">{{ S.dashboard.physicalProgress }}</span>
          <span class="font-medium">{{ formatPercent(financials.physicalProgress) }}</span>
        </div>
        <UProgress :model-value="financials.physicalProgress" :max="100" size="sm" />

        <div class="flex items-center justify-between text-sm pt-2">
          <span class="text-muted">{{ S.dashboard.executed }}</span>
          <span class="font-medium tabular-nums">{{ formatMoney(financials.executedAmount) }}</span>
        </div>
        <div class="flex items-center justify-between text-xs text-muted">
          <span>{{ S.dashboard.contracted }}</span>
          <span class="tabular-nums">{{ formatMoney(financials.contractedAmount) }}</span>
        </div>
      </div>
    </UCard>
  </ULink>
</template>
