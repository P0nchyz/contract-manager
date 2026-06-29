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

// Map a Date to a fractional month index from contractStart (origin = day 1 of start month)
const origin = computed(() => {
  const d = new Date(props.contractStart)
  d.setDate(1)
  return d
})

function toIdx(d: Date): number {
  return (d.getTime() - origin.value.getTime()) / (30.44 * 86_400_000)
}

const todayIdx = computed(() => toIdx(new Date()))

// X-axis month labels
const xLabels = computed<string[]>(() => {
  const labels: string[] = []
  const cur = new Date(origin.value)
  while (cur <= props.contractEnd) {
    labels.push(cur.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }))
    cur.setMonth(cur.getMonth() + 1)
  }
  return labels
})

// ─── Bar segment computation ─────────────────────────────────────────────────
// Four floating-bar datasets layered on the same y-axis position:
//
//  Dataset 0 — EXECUTED (black)
//    [start → start + actualFraction × duration]
//    Full bar in blue if status === 'done'.
//
//  Dataset 1 — BEHIND DELTA (red)
//    [actualEnd → plannedEnd]   only when actualProgress < plannedProgress
//
//  Dataset 2 — AHEAD DELTA (blue)
//    [plannedEnd → actualEnd]   only when actualProgress > plannedProgress
//
//  Dataset 3 — REMAINDER (translucent grey)
//    [max(actualEnd, plannedEnd) → end]   what's genuinely left to do

const NONE = null as unknown as [number, number] // Chart.js skips null data points

const chartData = computed<ChartData<'bar'>>(() => {
  const entries = props.entries

  const executedSegs:    ([number, number] | null)[] = []
  const behindSegs:      ([number, number] | null)[] = []
  const aheadSegs:       ([number, number] | null)[] = []
  const remainderSegs:   ([number, number] | null)[] = []
  const executedColors:  string[] = []

  for (const e of entries) {
    const s  = toIdx(e.startDate)
    const en = toIdx(e.endDate)
    const dur = en - s
    if (dur <= 0) {
      executedSegs.push(NONE)
      behindSegs.push(NONE)
      aheadSegs.push(NONE)
      remainderSegs.push(NONE)
      executedColors.push('transparent')
      continue
    }

    const st = e.status

    if (st.status === 'done' || st.status === 'future') {
      // Done → solid blue full bar. Future → grey full bar.
      const col = st.status === 'done' ? '#3b82f6' : '#6b728044'
      executedSegs.push([s, en])
      behindSegs.push(NONE)
      aheadSegs.push(NONE)
      remainderSegs.push(NONE)
      executedColors.push(col)
      continue
    }

    const actualFrac   = st.actualProgress   / 100
    const plannedFrac  = st.plannedProgress  / 100

    const actualEnd   = s + actualFrac  * dur
    const plannedEnd  = s + plannedFrac * dur

    // Executed portion (black)
    if (actualFrac > 0) {
      executedSegs.push([s, actualEnd])
    } else {
      executedSegs.push(NONE)
    }
    executedColors.push('#1f2937') // near-black

    if (st.status === 'behind' || st.status === 'overdue') {
      // Behind: red gap from actual end to where plan says we should be
      behindSegs.push(actualEnd < plannedEnd ? [actualEnd, plannedEnd] : NONE)
      aheadSegs.push(NONE)
      remainderSegs.push(plannedEnd < en ? [plannedEnd, en] : NONE)
    } else if (st.status === 'ahead') {
      // Ahead: blue excess from planned end to actual end
      behindSegs.push(NONE)
      aheadSegs.push(plannedEnd < actualEnd ? [plannedEnd, actualEnd] : NONE)
      remainderSegs.push(actualEnd < en ? [actualEnd, en] : NONE)
    } else {
      // on_track: no delta segment, just remainder
      behindSegs.push(NONE)
      aheadSegs.push(NONE)
      remainderSegs.push(actualEnd < en ? [actualEnd, en] : NONE)
    }
  }

  const sharedBarProps = {
    barPercentage: 0.55,
    categoryPercentage: 0.85,
    borderSkipped: false,
  } as const

  return {
    labels: entries.map((e) => e.label),
    datasets: [
      {
        label: 'Ejecutado',
        data: executedSegs,
        backgroundColor: executedColors,
        borderRadius: 2,
        ...sharedBarProps,
      },
      {
        label: 'Retraso',
        data: behindSegs,
        backgroundColor: '#ef444499', // red semi-transparent
        borderRadius: 0,
        ...sharedBarProps,
      },
      {
        label: 'Adelanto',
        data: aheadSegs,
        backgroundColor: '#22c55e99', // green semi-transparent
        borderRadius: 0,
        ...sharedBarProps,
      },
      {
        label: 'Por ejecutar',
        data: remainderSegs,
        backgroundColor: '#6b728022',
        borderColor: '#6b728055',
        borderWidth: 1,
        borderRadius: 2,
        ...sharedBarProps,
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
            s.status === 'done'     ? 'Completado ✓' :
            s.status === 'ahead'    ? `Adelantado (+${s.delta.toFixed(1)}%)` :
            s.status === 'behind'   ? `Retrasado (${s.delta.toFixed(1)}%)` :
            s.status === 'overdue'  ? `Vencido (${s.delta.toFixed(1)}%)` :
            s.status === 'on_track' ? 'Al día' :
            'Sin iniciar'
          return [
            `Real: ${s.actualProgress.toFixed(1)}%  Planeado: ${s.plannedProgress.toFixed(1)}%`,
            statusLabel,
          ]
        },
      },
    },
  },
  animation: false,
}))

// Draw the "today" vertical line after the chart renders
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
    ctx.strokeStyle = '#f59e0b'
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