<!-- app/components/ScheduleGantt.client.vue -->
<script setup lang="ts">
import { Bar } from 'vue-chartjs'
import type { ChartData, ChartOptions } from 'chart.js'

/** One period cell for a concept — only emitted for periods where the concept is actually planned. */
export interface GanttCell {
  periodIndex: number
  plannedQuantity: number
  actualQuantity: number // physical (approved + paid) executed in this period
}

export interface GanttEntry {
  conceptId: string
  label: string
  /** Only cells for periods where plannedQuantity > 0 — i.e. the concept is actually scheduled in that period. */
  cells: GanttCell[]
}

const props = withDefaults(
  defineProps<{
    entries: GanttEntry[]
    periods: { start: Date; end: Date }[]
    currentPeriodIndex: number
    height?: number
  }>(),
  { height: 320 },
)

const colors = useChartColors()

type CellStatus = 'done' | 'partial' | 'missed' | 'pending' | 'future'

const CELL_COLOR: Record<CellStatus, string> = {
  done: '#3b82f6',      // blue — period reached and fully executed
  partial: '#f59e0b',   // amber — period reached, partially executed
  missed: '#ef4444',    // red — period already past, nothing executed
  pending: '#6b728055', // grey — current period, not yet executed
  future: '#6b728022',  // faint grey — scheduled, period not reached yet
}

function cellStatus(cell: GanttCell): CellStatus {
  const ratio = cell.plannedQuantity > 0 ? cell.actualQuantity / cell.plannedQuantity : 0
  if (cell.periodIndex < props.currentPeriodIndex) {
    if (ratio >= 0.999) return 'done'
    if (ratio > 0) return 'partial'
    return 'missed'
  }
  if (cell.periodIndex === props.currentPeriodIndex) {
    if (ratio >= 0.999) return 'done'
    if (ratio > 0) return 'partial'
    return 'pending'
  }
  return 'future'
}

// X-axis: one column per period (not calendar month), so gaps between
// non-consecutive active periods are visually explicit.
const periodCount = computed(() => props.periods.length)

const xLabels = computed<string[]>(() =>
  props.periods.map((_, idx) => `P${idx + 1}`),
)

const NONE = null as unknown as [number, number]

// One dataset per period column. Each dataset draws a bar segment only for
// rows (concepts) that have an active cell in that period — everything else
// is null, so the row's bar is visually disconnected across gaps.
const chartData = computed<ChartData<'bar'>>(() => {
  const datasets = props.periods.map((_, periodIdx) => {
    const data: ([number, number] | null)[] = []
    const backgroundColor: string[] = []
    const borderColor: string[] = []

    for (const entry of props.entries) {
      const cell = entry.cells.find((c) => c.periodIndex === periodIdx)
      if (!cell) {
        data.push(NONE)
        backgroundColor.push('transparent')
        borderColor.push('transparent')
        continue
      }
      data.push([periodIdx + 0.05, periodIdx + 0.95])
      const status = cellStatus(cell)
      backgroundColor.push(CELL_COLOR[status])
      borderColor.push(periodIdx === props.currentPeriodIndex ? '#f59e0b' : 'transparent')
    }

    return {
      label: `P${periodIdx + 1}`,
      data,
      backgroundColor,
      borderColor,
      borderWidth: 1,
      borderRadius: 2,
      borderSkipped: false,
      barPercentage: 0.85,
      categoryPercentage: 0.85,
    }
  })

  return {
    labels: props.entries.map((e) => e.label),
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
      max: periodCount.value,
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
        title: (items) => {
          const entry = props.entries[items[0].dataIndex]
          const periodIdx = items[0].datasetIndex
          return `${entry?.label ?? ''} — P${periodIdx + 1}`
        },
        label: (ctx) => {
          const entry = props.entries[ctx.dataIndex]
          const cell = entry?.cells.find((c) => c.periodIndex === ctx.datasetIndex)
          if (!cell) return ''
          const status = cellStatus(cell)
          const statusLabel =
            status === 'done' ? 'Completado ✓' :
              status === 'partial' ? 'Parcial' :
                status === 'missed' ? 'Vencido, sin ejecutar' :
                  status === 'pending' ? 'Pendiente (periodo en curso)' :
                    'Programado'
          return [
            `Planeado: ${cell.plannedQuantity.toLocaleString('es-MX')}`,
            `Ejecutado: ${cell.actualQuantity.toLocaleString('es-MX')}`,
            statusLabel,
          ]
        },
      },
      filter: (ctx) => ctx.raw != null,
    },
  },
  animation: false,
}))
</script>

<template>
  <div :style="`height:${height}px`">
    <Bar :data="chartData" :options="options" />
  </div>
</template>