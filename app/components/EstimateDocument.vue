<!-- app/components/EstimateDocument.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { S } from '~/constants/strings'
import { formatMoney, formatDate, formatNumber, formatPercent } from '~/utils/format'
import type { Estimate } from '~/data/models'

const props = defineProps<{
  estimate: Estimate
  // Prior accumulated amount (approved) for cover math
  priorAccumAmount?: number
  contractAmount?: number
  anticipoPercentage?: number
  // Resolve a file id to a display name (for hoja evidence)
  fileName?: (id: string) => string
  logNoteLabel?: (id: string) => string
}>()

const D = S.estimateDoc
const e = computed(() => props.estimate)
const calc = computed(() => e.value.summary?.calculations ?? { ivaRate: 0, estimateAmount: 0, estimateIva: 0, estimateTotal: 0, anticipoAmortization: 0, amortizationIva: 0, amortizationTotal: 0, retentions: 0, cincoAlMillarSfp: 0, total: 0 })

const now = new Date()

// Cover table 1 — sin IVA
const contractAmt = computed(() => props.contractAmount ?? 0)
const priorAccum = computed(() => props.priorAccumAmount ?? 0)
const currentAmt = computed(() => calc.value.estimateAmount)
const accumNow = computed(() => priorAccum.value + currentAmt.value)
const saldoEstimar = computed(() => contractAmt.value - accumNow.value)
const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0)

// Cover table 2 — anticipo
const anticipoPct = computed(() => props.anticipoPercentage ?? 0)
const anticipoAmt = computed(() => Math.round(contractAmt.value * anticipoPct.value / 100))
const priorAmort = computed(() => Math.round(priorAccum.value * anticipoPct.value / 100))
const currentAmort = computed(() => calc.value.anticipoAmortization)
const accumAmort = computed(() => priorAmort.value + currentAmort.value)
const saldoAmortizar = computed(() => anticipoAmt.value - accumAmort.value)
</script>

<template>
  <div class="space-y-8">
    <!-- ═══════════════ PAGE 1: COVER ═══════════════ -->
    <section class="doc-page">
      <!-- Header -->
      <header class="mb-5 border-b-2 border-default pb-4">
        <p class="text-xs uppercase tracking-wide text-muted">{{ e.cover.entityName }}</p>
        <h2 class="mt-1 text-lg font-bold text-highlighted">{{ D.coverTitle }}</h2>
        <p class="mt-0.5 text-xs text-muted">{{ D.currentDate }}: {{ formatDate(now) }}</p>

        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <div class="sm:col-span-2">
            <dt class="text-[11px] uppercase text-muted">{{ D.workDescription }}</dt>
            <dd class="text-sm font-medium text-highlighted">{{ e.cover.contractTitle }}</dd>
          </div>
          <div>
            <dt class="text-[11px] uppercase text-muted">{{ D.contractNumber }}</dt>
            <dd class="text-sm text-highlighted">{{ e.cover.contractCode }}</dd>
          </div>
          <div>
            <dt class="text-[11px] uppercase text-muted">{{ D.contractDate }}</dt>
            <dd class="text-sm text-highlighted">{{ formatDate(e.cover.contractStartDate) }}</dd>
          </div>
          <div>
            <dt class="text-[11px] uppercase text-muted">{{ D.razonSocial }}</dt>
            <dd class="text-sm text-highlighted">{{ e.cover.contractorName }}</dd>
          </div>
          <div>
            <dt class="text-[11px] uppercase text-muted">{{ D.rfc }}</dt>
            <dd class="text-sm text-highlighted">{{ e.cover.contractorRfc ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-[11px] uppercase text-muted">{{ D.number }}</dt>
            <dd class="text-sm text-highlighted">{{ e.cover.estimateNumber }}</dd>
          </div>
          <div>
            <dt class="text-[11px] uppercase text-muted">{{ D.period }}</dt>
            <dd class="text-sm text-highlighted">
              {{ formatDate(e.cover.periodStart) }} – {{ formatDate(e.cover.periodEnd) }}
            </dd>
          </div>
        </div>
      </header>

      <slot name="note-cover" />

      <!-- Table 1: Importes sin incluir IVA -->
      <table class="doc-table mb-4">
        <thead>
          <tr>
            <th class="text-left">{{ D.sinIvaTitle }}</th>
            <th class="text-right">{{ D.importe }}</th>
            <th class="text-right">{{ D.porcentaje }}</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>{{ D.importeContrato }}</td><td class="text-right">{{ formatMoney(contractAmt) }}</td><td class="text-right">100%</td></tr>
          <tr><td>{{ D.importeEstAcumAnterior }}</td><td class="text-right">{{ formatMoney(priorAccum) }}</td><td class="text-right">{{ formatPercent(pctOf(priorAccum, contractAmt)) }}</td></tr>
          <tr><td>{{ D.importeEstActual }}</td><td class="text-right">{{ formatMoney(currentAmt) }}</td><td class="text-right">{{ formatPercent(pctOf(currentAmt, contractAmt)) }}</td></tr>
          <tr><td>{{ D.importeEstAcumActual }}</td><td class="text-right">{{ formatMoney(accumNow) }}</td><td class="text-right">{{ formatPercent(pctOf(accumNow, contractAmt)) }}</td></tr>
          <tr class="font-semibold"><td>{{ D.saldoPorEstimar }}</td><td class="text-right">{{ formatMoney(saldoEstimar) }}</td><td class="text-right">{{ formatPercent(pctOf(saldoEstimar, contractAmt)) }}</td></tr>
        </tbody>
      </table>

      <!-- Table 2: Del Anticipo -->
      <table class="doc-table mb-4">
        <thead>
          <tr>
            <th class="text-left">{{ D.delAnticipoTitle }}</th>
            <th class="text-right">{{ D.importe }}</th>
            <th class="text-right">{{ D.porcentaje }}</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>{{ D.importeAnticipo }}</td><td class="text-right">{{ formatMoney(anticipoAmt) }}</td><td class="text-right">{{ formatPercent(anticipoPct, 0) }}</td></tr>
          <tr><td>{{ D.importeAmortAcumAnterior }}</td><td class="text-right">{{ formatMoney(priorAmort) }}</td><td class="text-right">{{ formatPercent(pctOf(priorAmort, anticipoAmt)) }}</td></tr>
          <tr><td>{{ D.importeAmortActual }}</td><td class="text-right">{{ formatMoney(currentAmort) }}</td><td class="text-right">{{ formatPercent(pctOf(currentAmort, anticipoAmt)) }}</td></tr>
          <tr><td>{{ D.importeAmortAcumActual }}</td><td class="text-right">{{ formatMoney(accumAmort) }}</td><td class="text-right">{{ formatPercent(pctOf(accumAmort, anticipoAmt)) }}</td></tr>
          <tr class="font-semibold"><td>{{ D.saldoPorAmortizar }}</td><td class="text-right">{{ formatMoney(saldoAmortizar) }}</td><td class="text-right">{{ formatPercent(pctOf(saldoAmortizar, anticipoAmt)) }}</td></tr>
        </tbody>
      </table>

      <!-- Table 3: Del Neto a Recibir -->
      <table class="doc-table">
        <thead>
          <tr>
            <th class="text-left">{{ D.netoTitle }}</th>
            <th class="text-right">{{ D.importe }}</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>{{ D.importeEstimacion }}</td><td class="text-right">{{ formatMoney(calc.estimateAmount) }}</td></tr>
          <tr><td>{{ D.ivaEstimacion }}</td><td class="text-right">{{ formatMoney(calc.estimateIva) }}</td></tr>
          <tr class="font-medium"><td>{{ D.totalEstimacion }}</td><td class="text-right">{{ formatMoney(calc.estimateTotal) }}</td></tr>
          <tr><td>{{ D.amortizacionAnticipo }}</td><td class="text-right">− {{ formatMoney(calc.anticipoAmortization) }}</td></tr>
          <tr><td>{{ D.ivaAmortizacion }}</td><td class="text-right">− {{ formatMoney(calc.amortizationIva) }}</td></tr>
          <tr class="font-medium"><td>{{ D.totalAmortizacion }}</td><td class="text-right">− {{ formatMoney(calc.amortizationTotal) }}</td></tr>
          <tr><td>{{ D.retenciones }}</td><td class="text-right">− {{ formatMoney(calc.retentions) }}</td></tr>
          <tr><td>{{ D.cincoAlMillar }}</td><td class="text-right">− {{ formatMoney(calc.cincoAlMillarSfp) }}</td></tr>
          <tr class="border-t-2 border-default text-base font-bold"><td>{{ D.totalNeto }}</td><td class="text-right">{{ formatMoney(calc.total) }}</td></tr>
        </tbody>
      </table>
    </section>

    <!-- ═══════════════ PAGE 2: SERVICIOS EJECUTADOS ═══════════════ -->
    <section class="doc-page">
      <header class="mb-4 border-b-2 border-default pb-3">
        <p class="text-xs uppercase tracking-wide text-muted">{{ e.cover.entityName }}</p>
        <h2 class="mt-1 text-lg font-bold text-highlighted">{{ D.servicesTitle }}</h2>
      </header>

      <slot name="note-services" />

      <div class="overflow-x-auto">
        <table class="doc-table text-xs">
          <thead>
            <tr>
              <th rowspan="2">{{ D.conceptoNum }}</th>
              <th rowspan="2">{{ D.especificacion }}</th>
              <th rowspan="2" class="text-left">{{ D.conceptoObra }}</th>
              <th :colspan="6" class="text-center">{{ D.cantidadesObra }}</th>
              <th rowspan="2" class="text-right">{{ D.precioUnitario }}</th>
              <th rowspan="2" class="text-right">{{ D.total }}</th>
            </tr>
            <tr>
              <th>{{ D.unidad }}</th>
              <th class="text-right">{{ D.segunProyecto }}</th>
              <th class="text-right">{{ D.hastaAnterior }}</th>
              <th class="text-right">{{ D.deEsta }}</th>
              <th class="text-right">{{ D.totalEstimado }}</th>
              <th class="text-right">{{ D.porEjecutar }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="li in (e.lineItems ?? [])" :key="li.conceptId">
              <td class="text-center">{{ li.conceptNumber }}</td>
              <td class="font-mono">{{ li.specificationNumber }}</td>
              <td class="min-w-48 text-left">{{ li.description }}</td>
              <td class="text-center">{{ li.unit }}</td>
              <td class="text-right tabular-nums">{{ formatNumber(li.inProject) }}</td>
              <td class="text-right tabular-nums">{{ formatNumber(li.upToLastEstimate) }}</td>
              <td class="text-right tabular-nums font-medium text-primary">{{ formatNumber(li.inThisEstimate) }}</td>
              <td class="text-right tabular-nums">{{ formatNumber(li.totalEstimated) }}</td>
              <td class="text-right tabular-nums">{{ formatNumber(li.toExecute) }}</td>
              <td class="text-right tabular-nums">{{ formatMoney(li.unitPrice) }}</td>
              <td class="text-right tabular-nums font-medium">{{ formatMoney(li.totalAmount) }}</td>
            </tr>
            <tr class="border-t-2 border-default font-bold">
              <td colspan="10" class="text-right">{{ D.total }}</td>
              <td class="text-right tabular-nums">{{ formatMoney(calc.estimateAmount) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ═══════════════ PAGE 3: RESUMEN POR PARTIDA ═══════════════ -->
    <section class="doc-page">
      <header class="mb-4 border-b-2 border-default pb-3">
        <p class="text-xs uppercase tracking-wide text-muted">{{ e.cover.entityName }}</p>
        <h2 class="mt-1 text-lg font-bold text-highlighted">{{ D.summaryTitle }}</h2>
      </header>

      <slot name="note-summary" />

      <!-- Table 1: partidas -->
      <table class="doc-table mb-6">
        <thead>
          <tr>
            <th>{{ D.numPartida }}</th>
            <th class="text-left">{{ D.descripcion }}</th>
            <th class="text-right">{{ D.importe }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in (e.summary?.partidas ?? [])" :key="p.sectionId">
            <td class="text-center font-mono">{{ p.partidaNumber }}</td>
            <td class="text-left">{{ p.description }}</td>
            <td class="text-right tabular-nums">{{ formatMoney(p.amount) }}</td>
          </tr>
          <tr class="border-t-2 border-default font-bold">
            <td colspan="2" class="text-right">{{ D.subtotal }}</td>
            <td class="text-right tabular-nums">{{ formatMoney(e.summary?.partidasSubtotal ?? 0) }}</td>
          </tr>
        </tbody>
      </table>

      <!-- Table 2: partidas (upper) + financial breakdown (lower) -->
      <table class="doc-table">
        <thead>
          <tr>
            <th>{{ D.numPartida }}</th>
            <th class="text-left">{{ D.descripcion }}</th>
            <th class="text-right">{{ D.importe }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in (e.summary?.partidas ?? [])" :key="`b-${p.sectionId}`">
            <td class="text-center font-mono">{{ p.partidaNumber }}</td>
            <td class="text-left">{{ p.description }}</td>
            <td class="text-right tabular-nums">{{ formatMoney(p.amount) }}</td>
          </tr>
          <tr class="border-t-2 border-default font-semibold">
            <td colspan="2" class="text-right">{{ D.subtotal }}</td>
            <td class="text-right tabular-nums">{{ formatMoney(e.summary?.partidasSubtotal ?? 0) }}</td>
          </tr>
          <!-- Lower financial section -->
          <tr class="border-t-2 border-default"><td colspan="2">{{ D.importeEstimacion }}</td><td class="text-right tabular-nums">{{ formatMoney(calc.estimateAmount) }}</td></tr>
          <tr><td colspan="2">{{ D.ivaEstimacion }}</td><td class="text-right tabular-nums">{{ formatMoney(calc.estimateIva) }}</td></tr>
          <tr class="font-medium"><td colspan="2">{{ D.totalEstimacion }}</td><td class="text-right tabular-nums">{{ formatMoney(calc.estimateTotal) }}</td></tr>
          <tr><td colspan="2">{{ D.amortizacionAnticipo }}</td><td class="text-right tabular-nums">{{ formatMoney(calc.anticipoAmortization) }}</td></tr>
          <tr><td colspan="2">{{ D.ivaAmortizacion }}</td><td class="text-right tabular-nums">{{ formatMoney(calc.amortizationIva) }}</td></tr>
          <tr class="font-medium"><td colspan="2">{{ D.totalAmortizacion }}</td><td class="text-right tabular-nums">{{ formatMoney(calc.amortizationTotal) }}</td></tr>
          <tr><td colspan="2">{{ D.retenciones }}</td><td class="text-right tabular-nums">{{ formatMoney(calc.retentions) }}</td></tr>
          <tr><td colspan="2">{{ D.cincoAlMillar }}</td><td class="text-right tabular-nums">{{ formatMoney(calc.cincoAlMillarSfp) }}</td></tr>
          <tr class="border-t-2 border-default text-base font-bold"><td colspan="2">{{ D.total }}</td><td class="text-right tabular-nums">{{ formatMoney(calc.total) }}</td></tr>
        </tbody>
      </table>
    </section>

    <!-- ═══════════════ HOJAS GENERADORAS ═══════════════ -->
    <section
      v-for="hoja in (e.hojas ?? [])"
      :key="hoja.id"
      class="doc-page"
    >
      <header class="mb-4 border-b-2 border-default pb-3">
        <div class="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
          <div><span class="text-muted">{{ S.estimateForm.hojas.number }}:</span> <span class="font-semibold text-highlighted">{{ hoja.number }}</span></div>
          <div><span class="text-muted">{{ S.estimateForm.hojas.estimateNo }}:</span> <span class="font-semibold text-highlighted">{{ e.cover.estimateNumber }}</span></div>
          <div><span class="text-muted">{{ S.estimateForm.hojas.period }}:</span> <span class="text-highlighted">{{ formatDate(e.cover.periodStart) }} – {{ formatDate(e.cover.periodEnd) }}</span></div>
          <div><span class="text-muted">{{ S.estimateForm.hojas.contractNo }}:</span> <span class="text-highlighted">{{ e.cover.contractCode }}</span></div>
          <div class="sm:col-span-2"><span class="text-muted">{{ S.estimateForm.hojas.workDescription }}:</span> <span class="text-highlighted">{{ e.cover.contractTitle }}</span></div>
          <div><span class="text-muted">{{ S.estimateForm.hojas.partida }}:</span> <span class="text-highlighted">{{ hoja.sectionId }}</span></div>
          <div><span class="text-muted">{{ S.estimateForm.hojas.clave }}:</span> <span class="text-highlighted">{{ hoja.specificationNumber }} — {{ hoja.description }}</span></div>
        </div>
      </header>

      <slot name="note-hoja" :hoja="hoja" />

      <div class="overflow-x-auto">
        <table class="doc-table text-xs">
          <thead>
            <tr>
              <th :colspan="3" class="text-center">{{ S.estimateForm.hojas.catalogo }}</th>
              <th :colspan="3" class="text-center">{{ S.estimateForm.hojas.ejecutado }}</th>
              <th rowspan="2">{{ S.estimateForm.hojas.rowPhoto }}</th>
            </tr>
            <tr>
              <th class="text-left">{{ S.estimateForm.hojas.documento }}</th>
              <th>{{ S.estimateForm.hojas.unidad }}</th>
              <th class="text-right">{{ S.estimateForm.hojas.cantidad }}</th>
              <th>{{ S.estimateForm.hojas.unidad }}</th>
              <th class="text-right">{{ S.estimateForm.hojas.cantidad }}</th>
              <th class="text-right">{{ S.estimateForm.hojas.total }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, ri) in hoja.rows" :key="row.id">
              <td class="text-left">{{ ri === 0 ? hoja.description : '' }}</td>
              <td class="text-center">{{ ri === 0 ? hoja.unit : '' }}</td>
              <td class="text-right tabular-nums">{{ ri === 0 ? formatNumber(hoja.contractedQuantity) : '' }}</td>
              <td class="text-center">{{ hoja.unit }}</td>
              <td class="text-right tabular-nums font-medium text-primary">{{ formatNumber(row.quantity) }}</td>
              <td class="text-right tabular-nums">{{ formatNumber(row.quantity) }}</td>
              <td class="text-center">
                <span v-if="row.photoFileId" class="inline-flex items-center gap-1 text-success">
                  <UIcon name="i-lucide-image" class="size-3.5" />
                  <span class="text-[10px]">{{ fileName ? fileName(row.photoFileId) : 'foto' }}</span>
                </span>
                <span v-else class="text-error text-[10px]">—</span>
              </td>
            </tr>
            <tr class="border-t-2 border-default font-bold">
              <td colspan="5" class="text-right">{{ S.estimateForm.hojas.hojaTotal }}</td>
              <td class="text-right tabular-nums">{{ formatNumber(hoja.rows.reduce((s, r) => s + r.quantity, 0)) }}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Evidence detail per row -->
      <div v-if="hoja.rows.some(r => r.fileIds.length || r.logNoteIds.length)" class="mt-3 space-y-1.5 text-xs text-muted">
        <template v-for="(row, ri) in hoja.rows" :key="`ev-${row.id}`">
          <div v-if="row.fileIds.length || row.logNoteIds.length" class="flex flex-wrap items-center gap-2">
            <span class="font-medium">Renglón {{ ri + 1 }}:</span>
            <span v-for="fid in row.fileIds" :key="fid" class="inline-flex items-center gap-1 rounded bg-elevated px-1.5 py-0.5">
              <UIcon name="i-lucide-paperclip" class="size-3" />{{ fileName ? fileName(fid) : fid }}
            </span>
            <span v-for="lid in row.logNoteIds" :key="lid" class="inline-flex items-center gap-1 rounded bg-elevated px-1.5 py-0.5">
              <UIcon name="i-lucide-notebook-pen" class="size-3" />{{ logNoteLabel ? logNoteLabel(lid) : lid }}
            </span>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.doc-page {
  background: var(--ui-bg, #fff);
  border: 1px solid var(--ui-border, #e5e7eb);
  border-radius: 0.75rem;
  padding: 1.5rem;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.04);
}
.doc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}
.doc-table th,
.doc-table td {
  border: 1px solid var(--ui-border, #e5e7eb);
  padding: 0.4rem 0.6rem;
}
.doc-table thead th {
  background: var(--ui-bg-elevated, #f9fafb);
  font-weight: 600;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
</style>