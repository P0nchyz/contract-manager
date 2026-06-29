<!-- app/components/ScheduleGantt.client.vue -->
<script setup lang="ts">
import { Bar } from 'vue-chartjs'
import type { ChartData, ChartOptions } from 'chart.js'
import type { ConceptGanttStatus } from '~/data/calc/schedule'

export interface GanttEntry {
  conceptId: string
  label: string
  startDate: Date
  endDate: Date
  programmedAmount: number
  status: ConceptGanttStatus
}

const props = withDefaults(
  defineProps<{
    entries: GanttEntry[]
    contractStart: Date
    contractEnd: Date
    periodicity: 'monthly' | 'biweekly'
    height?: number
  }>(),
  { height: 320 },
)

const colors = useChartColors()

// Status → bar color
const STATUS_COLORS: Record<string, string> = {
  done:        '#22c55e',  // green — fully complete
  ahead:       '#3b82f6',  // blue — ahead of plan
  on_track:    '#3b82f6',  // blue — on track
  behind:      '#ef4444',  // red — behind plan (completed portion)
  overdue:     '#ef4444',
  future:      '#6b7280',  // muted — not started yet
  not_started: '#6b7280',
}

// Map a Date to a fractional month index from contractStart
const origin = computed(() => {
  const d = new Date(props.contractStart)
  d.setDate(1)
  return d
})

function toIdx(d: Date): number {
  const o = origin.value
  const diffMs = d.getTime() - o.getTime()
  return diffMs / (30.44 * 86_400_000)
}

const todayIdx = computed(() => toIdx(new Date()))

// Month labels across the contract period
const xLabels = computed<string[]>(() => {
  const labels: string[] = []
  const cur = new Date(origin.value)
  while (cur <= props.contractEnd) {
    labels.push(cur.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }))
    cur.setMonth(cur.getMonth() + 1)
  }
  return labels
})

const chartData = computed<ChartData<'bar'>>(() => {
  const entries = props.entries

  // Dataset 0: completed portion of each bar
  const completedData = entries.map((e) => {
    const totalDuration = toIdx(e.endDate) - toIdx(e.startDate)
    if (totalDuration <= 0) return null
    const completedFraction = (e.status.actualProgress / 100)
    const completedDuration = totalDuration * completedFraction
    return [toIdx(e.startDate), toIdx(e.startDate) + completedDuration] as [number, number]
  })

  // Dataset 1: remaining / planned portion
  const remainingData = entries.map((e) => {
    const totalDuration = toIdx(e.endDate) - toIdx(e.startDate)
    if (totalDuration <= 0) return null
    const completedFraction = (e.status.actualProgress / 100)
    const completedDuration = totalDuration * completedFraction
    const startOfRemaining = toIdx(e.startDate) + completedDuration
    return [startOfRemaining, toIdx(e.endDate)] as [number, number]
  })

  return {
    labels: entries.map((e) => e.label),
    datasets: [
      {
        label: 'Completado',
        data: completedData,
        backgroundColor: entries.map((e) => STATUS_COLORS[e.status.status] ?? '#6b7280'),
        borderRadius: { topLeft: 3, bottomLeft: 3, topRight: 0, bottomRight: 0 },
        borderSkipped: false,
        barPercentage: 0.6,
        categoryPercentage: 0.8,
      },
      {
        label: 'Por ejecutar',
        data: remainingData,
        backgroundColor: entries.map((e) =>
          e.status.status === 'done' ? 'transparent' : '#6b728033',
        ),
        borderColor: entries.map((e) =>
          e.status.status === 'done' ? 'transparent' : '#6b728066',
        ),
        borderWidth: 1,
        borderRadius: { topLeft: 0, bottomLeft: 0, topRight: 3, bottomRight: 3 },
        borderSkipped: false,
        barPercentage: 0.6,
        categoryPercentage: 0.8,
      },
    ],
  }
})

const options = computed<ChartOptions<'bar'>>(() => ({
  indexAxis: 'y',
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: {
      min: 0,
      max: xLabels.value.length,
      stacked: false,
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
      stacked: false,
      ticks: {
        font: { size: 11 },
        callback: (_, idx) => {
          const label = props.entries[idx]?.label ?? ''
          return label.length > 22 ? label.slice(0, 20) + '…' : label
        },
      },
      grid: { display: false },
    },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        title: (items) => props.entries[items[0].dataIndex]?.label ?? '',
        label: (ctx) => {
          const entry = props.entries[ctx.dataIndex]
          if (!entry) return ''
          const s = entry.status
          const statusLabel =
            s.status === 'done'      ? 'Completado ✓' :
            s.status === 'ahead'     ? `Adelantado (+${Math.abs(s.delta).toFixed(1)}%)` :
            s.status === 'behind'    ? `Retrasado (${s.delta.toFixed(1)}%)` :
            s.status === 'overdue'   ? `Vencido (${s.delta.toFixed(1)}%)` :
            s.status === 'on_track'  ? 'Al día' :
            'Sin iniciar'
          return [
            `Real: ${s.actualProgress.toFixed(1)}%  Planeado: ${s.plannedProgress.toFixed(1)}%`,
            statusLabel,
          ]
        },
      },
    },
    annotation: undefined as any, // today line drawn via afterDraw plugin below
  },
  // Draw today vertical line via afterDraw
  animation: false,
}))

// Chart.js plugin to draw the "today" vertical line
const todayLinePlugin = {
  id: 'todayLine',
  afterDraw(chart: any) {
    const { ctx, chartArea, scales } = chart
    const xScale = scales.x
    if (!xScale) return
    const todayX = xScale.getPixelForValue(todayIdx.value)
    if (todayX < chartArea.left || todayX > chartArea.right) return
    ctx.save()
    ctx.beginPath()
    ctx.setLineDash([5, 4])
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#f59e0b' // amber — distinct from all bar colors
    ctx.moveTo(todayX, chartArea.top)
    ctx.lineTo(todayX, chartArea.bottom)
    ctx.stroke()
    ctx.fillStyle = '#f59e0b'
    ctx.font = '10px system-ui'
    ctx.fillText('Hoy', todayX + 4, chartArea.top + 12)
    ctx.restore()
  },
}
</script>

<template>
  <div :style="`height:${height}px`">
    <Bar :data="chartData" :options="options" :plugins="[todayLinePlugin]" />
  </div>
</template>