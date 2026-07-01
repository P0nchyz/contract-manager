<!-- app/components/SCurveChart.client.vue -->
<script setup lang="ts">
import { Line } from 'vue-chartjs'
import type { ChartData, ChartOptions } from 'chart.js'
import type { SchedulePoint } from '~/data/models'
import { S } from '~/constants/strings'

const props = withDefaults(defineProps<{ points: SchedulePoint[]; height?: number }>(), {
  height: 180,
})

const colors = useChartColors()

const chartData = computed<ChartData<'line'>>(() => ({
  labels: props.points.map((p) => `P${p.periodIndex + 1}`),
  datasets: [
    {
      label: S.contractDashboard.programmed,
      data: props.points.map((p) => p.programmedCumulativePercentage),
      borderColor: colors.muted,
      borderDash: [6, 4],
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.3,
      fill: false,
    },
    {
      label: S.contractDashboard.physical ?? 'Avance físico',
      data: props.points.map((p) => p.actualCumulativePercentage),
      borderColor: colors.primary,
      borderWidth: 2.5,
      pointRadius: 0,
      tension: 0.3,
      spanGaps: false,
      fill: false,
    },
    {
      label: S.contractDashboard.financial ?? 'Avance financiero',
      data: props.points.map((p) => p.financialCumulativePercentage),
      borderColor: colors.success,
      borderWidth: 2,
      borderDash: [3, 3],
      pointRadius: 0,
      tension: 0.3,
      spanGaps: false,
      fill: false,
    },
  ],
}))

const options = computed<ChartOptions<'line'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  scales: {
    y: {
      min: 0,
      max: 100,
      ticks: { callback: (v) => `${v}%` },
      grid: { color: colors.border },
    },
    x: { grid: { display: false } },
  },
  plugins: {
    legend: {
      display: true,
      position: 'bottom',
      labels: { boxWidth: 12, usePointStyle: true },
    },
    tooltip: {
      callbacks: {
        label: (ctx) => {
          const v = ctx.parsed.y
          return `${ctx.dataset.label}: ${v == null ? '—' : `${v}%`}`
        },
      },
    },
  },
}))
</script>

<template>
  <div :style="{ height: `${height}px` }">
    <Line :data="chartData" :options="options" />
  </div>
</template>