<!-- app/components/FinancialBreakdownChart.client.vue -->
<script setup lang="ts">
import { Doughnut } from 'vue-chartjs'
import type { ChartData, ChartOptions } from 'chart.js'

export interface BreakdownSlice {
  label: string
  amount: number  // Money (cents)
  color: string
}

const props = withDefaults(
  defineProps<{ slices: BreakdownSlice[]; height?: number }>(),
  { height: 260 },
)

const colors = useChartColors()

const chartData = computed<ChartData<'doughnut'>>(() => ({
  labels: props.slices.map((s) => s.label),
  datasets: [
    {
      data: props.slices.map((s) => s.amount),
      backgroundColor: props.slices.map((s) => s.color),
      borderColor: 'transparent',
      borderWidth: 0,
      hoverOffset: 6,
    },
  ],
}))

const options = computed<ChartOptions<'doughnut'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  cutout: '62%',
  plugins: {
    legend: {
      display: false, // custom legend rendered below
    },
    tooltip: {
      callbacks: {
        label: (ctx) => {
          const val = ctx.parsed
          const total = (ctx.dataset.data as number[]).reduce((s, v) => s + v, 0)
          const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0'
          const mxn = (val / 100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
          return ` ${mxn}  (${pct}%)`
        },
      },
    },
  },
}))
</script>

<template>
  <div>
    <div :style="`height:${height}px`">
      <Doughnut :data="chartData" :options="options" />
    </div>
    <!-- Custom legend -->
    <ul class="mt-4 space-y-1.5">
      <li
        v-for="slice in slices"
        :key="slice.label"
        class="flex items-center justify-between gap-3 text-sm"
      >
        <div class="flex items-center gap-2 min-w-0">
          <span class="size-3 shrink-0 rounded-sm" :style="`background:${slice.color}`" />
          <span class="truncate text-muted">{{ slice.label }}</span>
        </div>
        <span class="shrink-0 tabular-nums font-medium text-highlighted">
          {{ (slice.amount / 100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) }}
        </span>
      </li>
    </ul>
  </div>
</template>