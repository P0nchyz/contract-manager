<!-- app/components/GanttChart.client.vue -->
<script setup lang="ts">
import { Bar } from 'vue-chartjs'
import type { ChartData, ChartOptions } from 'chart.js'

export interface GanttRow {
  label: string
  startDate: Date | null
  endDate: Date | null
  amount: number // Money (cents) — for tooltip
}

const props = withDefaults(
  defineProps<{
    rows: GanttRow[]
    contractStart: Date | null
    contractEnd: Date | null
    height?: number
  }>(),
  { height: 220 },
)

const colors = useChartColors()

// Convert a Date to a numeric value for Chart.js (days since epoch, so bars are proportional)
const toDays = (d: Date) => Math.floor(d.getTime() / 86_400_000)

// Build evenly-spaced month labels across the contract range
const xLabels = computed<string[]>(() => {
  if (!props.contractStart || !props.contractEnd) return []
  const labels: string[] = []
  const cur = new Date(props.contractStart)
  cur.setDate(1)
  while (cur <= props.contractEnd) {
    labels.push(
      cur.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }),
    )
    cur.setMonth(cur.getMonth() + 1)
  }
  return labels
})

// Map a date to a label index (fractional OK for floating bars)
const toIdx = (d: Date): number => {
  if (!props.contractStart) return 0
  const origin = new Date(props.contractStart)
  origin.setDate(1)
  const diffMs = d.getTime() - origin.getTime()
  const daysInMonth = 30.44 // average
  return diffMs / (daysInMonth * 86_400_000)
}

const chartData = computed<ChartData<'bar'>>(() => ({
  labels: xLabels.value,
  datasets: [
    {
      label: 'Programa',
      data: props.rows.map((r) => {
        if (!r.startDate || !r.endDate) return null
        return [toIdx(r.startDate), toIdx(r.endDate)] as [number, number]
      }),
      backgroundColor: props.rows.map((r) => {
        if (!r.startDate || !r.endDate) return 'transparent'
        // Highlight rows with dates outside contract range
        const outOfRange =
          (props.contractStart && r.startDate < props.contractStart) ||
          (props.contractEnd && r.endDate > props.contractEnd)
        return outOfRange ? colors.error + 'cc' : colors.primary + 'cc'
      }),
      borderRadius: 3,
      borderSkipped: false,
    },
  ],
}))

const options = computed<ChartOptions<'bar'>>(() => ({
  indexAxis: 'y',
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: {
      min: 0,
      max: xLabels.value.length,
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
        title: (items) => props.rows[items[0].dataIndex]?.label ?? '',
        label: (ctx) => {
          const row = props.rows[ctx.dataIndex]
          if (!row?.startDate || !row?.endDate) return 'Sin fechas'
          const fmt = (d: Date) => d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
          return [
            `${fmt(row.startDate)} → ${fmt(row.endDate)}`,
            `Importe: ${(row.amount / 100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}`,
          ]
        },
      },
    },
  },
}))
</script>

<template>
  <div :style="`height:${height}px`">
    <Bar :data="chartData" :options="options" />
  </div>
</template>