<!-- app/components/GanttChart.client.vue -->
<script setup lang="ts">
import { Bar } from 'vue-chartjs'
import type { ChartData, ChartOptions } from 'chart.js'

export interface GanttRow {
  label: string
  /** 0-based period indices where this concept actually has planned volume. */
  periods: number[]
  amount: number // Money (cents) — for tooltip
}

const props = withDefaults(
  defineProps<{
    rows: GanttRow[]
    periodCount: number
    height?: number
  }>(),
  { height: 220 },
)

const colors = useChartColors()

const xLabels = computed<string[]>(() =>
  Array.from({ length: props.periodCount }, (_, idx) => `P${idx + 1}`),
)

const NONE = null as unknown as [number, number]

// One dataset per period column, same approach as ScheduleGantt — a row's
// bar only appears in the periods it's actually scheduled for, so gaps
// between non-consecutive periods are disconnected rather than bridged.
const chartData = computed<ChartData<'bar'>>(() => {
  const datasets = Array.from({ length: props.periodCount }, (_, periodIdx) => ({
    label: `P${periodIdx + 1}`,
    data: props.rows.map((r) =>
      r.periods.includes(periodIdx) ? [periodIdx + 0.05, periodIdx + 0.95] as [number, number] : NONE,
    ),
    backgroundColor: colors.primary + 'cc',
    borderRadius: 3,
    borderSkipped: false,
    barPercentage: 0.85,
    categoryPercentage: 0.85,
  }))

  return {
    labels: props.rows.map((r) => r.label),
    datasets,
  }
})

const options = computed<ChartOptions<'bar'>>(() => ({
  indexAxis: 'y',
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: {
      min: 0,
      max: props.periodCount,
      ticks: {
        stepSize: 1,
        callback: (v) => {
          const idx = Math.round(Number(v))
          return xLabels.value[idx] ?? ''
        },
      },
      grid: { color: colors.border },
    },
    y: {
      ticks: {
        font: { size: 11 },
        // Truncate long labels
        callback: (_, idx) => {
          const label = props.rows[idx]?.label ?? ''
          return label.length > 20 ? label.slice(0, 18) + '…' : label
        },
      },
      grid: { display: false },
    },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        title: (items) => {
          const row = props.rows[items[0].dataIndex]
          const periodIdx = items[0].datasetIndex
          return `${row?.label ?? ''} — P${periodIdx + 1}`
        },
        label: (ctx) => {
          const row = props.rows[ctx.dataIndex]
          if (!row) return ''
          return `Importe: ${formatMoney(row.amount)}`
        },
      },
      filter: (ctx) => ctx.raw != null,
    },
  },
}))
</script>

<template>
  <div :style="`height:${height}px`">
    <Bar :data="chartData" :options="options" />
  </div>
</template>