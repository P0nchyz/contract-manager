<!-- app/pages/contracts/[contractId]/estimates/new.vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import { buildLineItem, buildSummary, DEFAULT_RATES } from '~/data/calc/estimate'
import type { EstimateLineItem } from '~/data/models'

definePageMeta({ requiredPermission: 'estimate:create' })

const F = S.estimateForm

const route = useRoute()
const repos = useRepositories()
const contractId = computed(() => route.params.contractId as string)

// --- Load contract context, catalog, prior estimates (for "estimado anterior") ---
const { data, status, error, refresh } = await useAsyncData(
  () => `estimate-new-${contractId.value}`,
  async () => {
    const [contract, concepts, prior, corporations] = await Promise.all([
      repos.contracts.getById(contractId.value),
      repos.concepts.listByContract(contractId.value),
      repos.estimates.listByContract(contractId.value),
      repos.corporations.list().catch(() => []),
    ])
    // Accumulate the quantity estimated for each concept across prior estimates.
    const upToLast: Record<string, number> = {}
    for (const e of prior) {
      for (const li of e.lineItems) {
        upToLast[li.conceptId] = (upToLast[li.conceptId] ?? 0) + li.inThisEstimate
      }
    }
    const contractor = corporations.find((c) => c.id === contract.contractorCorporationId)
    return {
      contract,
      concepts,
      upToLast,
      contractorName: contractor?.name ?? '—',
      estimateNumber: prior.length + 1,
    }
  },
)

// --- Editable state: period (green) + the per-concept quantity (green) -------
const periodStart = ref('')
const periodEnd = ref('')
const qty = reactive<Record<string, number>>({})

watchEffect(() => {
  if (!data.value) return
  for (const c of data.value.concepts) {
    if (!(c.id in qty)) qty[c.id] = 0
  }
})

// --- Live computation — identical math to what the repository runs on save ----
const rates = computed(() => ({
  ...DEFAULT_RATES,
  anticipoPercentage: data.value?.contract.anticipoPercentage ?? 0,
}))

const lineItems = computed<EstimateLineItem[]>(() => {
  if (!data.value) return []
  return data.value.concepts.map((c, i) =>
    buildLineItem(c, Number(qty[c.id]) || 0, data.value!.upToLast[c.id] ?? 0, i + 1),
  )
})

const activeLines = computed(() => lineItems.value.filter((li) => li.inThisEstimate > 0))
const summary = computed(() => buildSummary(activeLines.value, rates.value))
const overRows = computed(
  () => new Set(lineItems.value.filter((li) => li.toExecute < 0).map((li) => li.conceptId)),
)

// --- Validation --------------------------------------------------------------
const periodError = computed(() => {
  if (!periodStart.value || !periodEnd.value) return F.validation.periodRequired
  if (periodEnd.value < periodStart.value) return F.validation.periodOrder
  return null
})
const hasQuantities = computed(() => activeLines.value.length > 0)
const canSubmit = computed(
  () => !periodError.value && hasQuantities.value && overRows.value.size === 0,
)

const ivaLabel = computed(() => `${F.summary.iva} (${rates.value.ivaRate}%)`)

// --- Submit (creates a draft) ------------------------------------------------
const loading = ref(false)
const submitError = ref<string | null>(null)

async function onSubmit() {
  if (!canSubmit.value || !data.value) return
  loading.value = true
  submitError.value = null
  try {
    await repos.estimates.create({
      contractId: contractId.value,
      periodStart: new Date(`${periodStart.value}T12:00:00`),
      periodEnd: new Date(`${periodEnd.value}T12:00:00`),
      lineItems: activeLines.value.map((li) => ({
        conceptId: li.conceptId,
        inThisEstimate: li.inThisEstimate,
      })),
    })
    await navigateTo(`/contracts/${contractId.value}/estimates`)
  } catch (e) {
    submitError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    loading.value = false
  }
}

const sections = [
  { id: 'sec-cover', label: F.sections.cover },
  { id: 'sec-concepts', label: F.sections.concepts },
  { id: 'sec-summary', label: F.sections.summary },
  { id: 'sec-attachments', label: F.sections.attachments },
]
</script>

<template>
  <UDashboardPanel id="estimate-new">
    <template #header>
      <UDashboardNavbar :title="F.title">
        <template #leading>
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            :to="`/contracts/${contractId}/estimates`"
            :aria-label="S.common.back"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <!-- Error / loading -->
      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        icon="i-lucide-alert-triangle"
        :title="S.common.error"
        :actions="[{ label: 'Reintentar', color: 'neutral', variant: 'subtle', onClick: () => refresh() }]"
      />

      <div v-else-if="status === 'pending'" class="space-y-4">
        <USkeleton class="h-32 w-full rounded-lg" />
        <USkeleton class="h-72 w-full rounded-lg" />
        <USkeleton class="h-48 w-full rounded-lg" />
      </div>

      <div v-else-if="data" class="flex flex-col gap-6">
        <!-- In-page section nav (single scrolling page) -->
        <nav
          class="sticky top-0 z-10 -mx-4 mb-2 flex gap-1 border-b border-default bg-default/75 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6"
        >
          <a
            v-for="s in sections"
            :key="s.id"
            :href="`#${s.id}`"
            class="rounded-md px-2.5 py-1 text-sm text-muted transition-colors hover:bg-elevated hover:text-default"
          >
            {{ s.label }}
          </a>
        </nav>

        <!-- 1 · Portada -->
        <UCard id="sec-cover" class="scroll-mt-16">
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-file-text" class="size-4 text-muted" />
              {{ F.sections.cover }}
            </div>
          </template>

          <div class="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <div class="text-xs text-muted">{{ F.cover.contract }}</div>
              <div class="font-medium text-highlighted">{{ data.contract.code }}</div>
            </div>
            <div class="sm:col-span-2">
              <div class="text-xs text-muted">{{ F.cover.object }}</div>
              <div class="font-medium text-highlighted">{{ data.contract.title }}</div>
            </div>
            <div>
              <div class="text-xs text-muted">{{ F.cover.contractor }}</div>
              <div class="font-medium text-highlighted">{{ data.contractorName }}</div>
            </div>
            <div>
              <div class="text-xs text-muted">{{ F.cover.number }}</div>
              <div class="font-medium tabular-nums text-highlighted">{{ data.estimateNumber }}</div>
            </div>
            <div>
              <div class="text-xs text-muted">{{ F.cover.anticipo }}</div>
              <div class="font-medium tabular-nums text-highlighted">
                {{ formatPercent(data.contract.anticipoPercentage, 0) }}
              </div>
            </div>

            <UFormField :label="F.cover.periodFrom" :error="periodError && !periodStart ? F.validation.periodRequired : undefined">
              <UInput v-model="periodStart" type="date" class="w-full [&_input]:text-success [&_input]:font-medium" />
            </UFormField>
            <UFormField :label="F.cover.periodTo">
              <UInput v-model="periodEnd" type="date" class="w-full [&_input]:text-success [&_input]:font-medium" />
            </UFormField>
            <p class="self-end pb-2 text-xs text-muted">{{ F.cover.periodHint }}</p>
          </div>
        </UCard>

        <!-- 2 · Conceptos -->
        <UCard id="sec-concepts" class="scroll-mt-16" :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-table" class="size-4 text-muted" />
                {{ F.sections.concepts }}
              </div>
              <!-- Cell-color legend -->
              <div class="flex items-center gap-3 text-xs text-muted">
                <span class="flex items-center gap-1.5">
                  <span class="size-2 rounded-full bg-success" /> {{ F.legend.editable }}
                </span>
                <span class="flex items-center gap-1.5">
                  <span class="size-2 rounded-full bg-error" /> {{ F.legend.calculated }}
                </span>
                <span class="flex items-center gap-1.5">
                  <span class="size-2 rounded-full bg-inverted" /> {{ F.legend.readonly }}
                </span>
              </div>
            </div>
          </template>

          <div v-if="!data.concepts.length" class="p-6 text-center text-sm text-muted">
            {{ F.validation.noConcepts }}
          </div>

          <div v-else class="overflow-x-auto">
            <table class="w-full min-w-[64rem] text-sm">
              <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                <tr>
                  <th class="px-3 py-2 text-right font-medium">{{ F.columns.number }}</th>
                  <th class="px-3 py-2 text-left font-medium">{{ F.columns.specification }}</th>
                  <th class="px-3 py-2 text-left font-medium">{{ F.columns.description }}</th>
                  <th class="px-3 py-2 text-left font-medium">{{ F.columns.unit }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ F.columns.inProject }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ F.columns.upToLast }}</th>
                  <th class="px-3 py-2 text-right font-medium text-success">{{ F.columns.inThisEstimate }}</th>
                  <th class="px-3 py-2 text-right font-medium text-error">{{ F.columns.totalEstimated }}</th>
                  <th class="px-3 py-2 text-right font-medium text-error">{{ F.columns.toExecute }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ F.columns.unitPrice }}</th>
                  <th class="px-3 py-2 text-right font-medium text-error">{{ F.columns.totalAmount }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr
                  v-for="li in lineItems"
                  :key="li.conceptId"
                  :class="overRows.has(li.conceptId) ? 'bg-error/10' : ''"
                >
                  <td class="px-3 py-2 text-right tabular-nums text-highlighted">{{ li.conceptNumber }}</td>
                  <td class="px-3 py-2 text-highlighted">{{ li.specificationNumber }}</td>
                  <td class="min-w-[16rem] px-3 py-2 text-highlighted">{{ li.description }}</td>
                  <td class="px-3 py-2 text-muted">{{ li.unit }}</td>
                  <td class="px-3 py-2 text-right tabular-nums text-highlighted">{{ formatNumber(li.inProject) }}</td>
                  <td class="px-3 py-2 text-right tabular-nums text-highlighted">{{ formatNumber(li.upToLastEstimate) }}</td>
                  <!-- green: editable -->
                  <td class="px-3 py-2">
                    <UInput
                      v-model.number="qty[li.conceptId]"
                      type="number"
                      min="0"
                      step="any"
                      :color="overRows.has(li.conceptId) ? 'error' : undefined"
                      class="w-32 [&_input]:text-right [&_input]:text-success [&_input]:font-medium"
                    >
                      <template #trailing>
                        <span class="pr-1 text-xs text-muted">{{ li.unit }}</span>
                      </template>
                    </UInput>
                  </td>
                  <!-- red: auto-calculated -->
                  <td class="px-3 py-2 text-right tabular-nums text-error">{{ formatNumber(li.totalEstimated) }}</td>
                  <td
                    class="px-3 py-2 text-right tabular-nums"
                    :class="overRows.has(li.conceptId) ? 'font-semibold text-error' : 'text-error'"
                  >
                    {{ formatNumber(li.toExecute) }}
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums text-highlighted">{{ formatMoney(li.unitPrice) }}</td>
                  <td class="px-3 py-2 text-right tabular-nums font-medium text-error">{{ formatMoney(li.totalAmount) }}</td>
                </tr>
              </tbody>
              <tfoot class="border-t border-default bg-elevated/50">
                <tr>
                  <td colspan="10" class="px-3 py-2 text-right text-xs font-medium text-muted">
                    {{ F.summary.subtotal }}
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums font-semibold text-highlighted">
                    {{ formatMoney(summary.conceptSummary.subtotal) }}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </UCard>

        <!-- 3 · Resumen (two tables) -->
        <div id="sec-summary" class="grid scroll-mt-16 gap-4 lg:grid-cols-2">
          <!-- Table 1 — concept rollup -->
          <UCard>
            <template #header>
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-list" class="size-4 text-muted" />
                {{ F.summary.conceptsTitle }}
              </div>
            </template>

            <div v-if="!activeLines.length" class="text-sm text-muted">{{ S.common.empty }}</div>
            <table v-else class="w-full text-sm">
              <thead class="border-b border-default text-xs text-muted">
                <tr>
                  <th class="py-2 pr-3 text-left font-medium">{{ F.columns.specification }}</th>
                  <th class="py-2 pr-3 text-left font-medium">{{ F.columns.description }}</th>
                  <th class="py-2 text-right font-medium">{{ F.columns.totalAmount }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-for="row in summary.conceptSummary.rows" :key="row.conceptId">
                  <td class="py-2 pr-3 text-highlighted">{{ row.specificationNumber }}</td>
                  <td class="py-2 pr-3 text-muted">{{ row.description }}</td>
                  <td class="py-2 text-right tabular-nums text-highlighted">{{ formatMoney(row.amount) }}</td>
                </tr>
              </tbody>
              <tfoot class="border-t border-default">
                <tr>
                  <td colspan="2" class="py-2 pr-3 text-right text-xs font-medium text-muted">{{ F.summary.subtotal }}</td>
                  <td class="py-2 text-right tabular-nums font-semibold text-highlighted">
                    {{ formatMoney(summary.conceptSummary.subtotal) }}
                  </td>
                </tr>
              </tfoot>
            </table>
          </UCard>

          <!-- Table 2 — calculations -->
          <UCard>
            <template #header>
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-calculator" class="size-4 text-muted" />
                {{ F.summary.calculationsTitle }}
              </div>
            </template>

            <dl class="divide-y divide-default text-sm">
              <div class="flex items-center justify-between py-2">
                <dt class="text-muted">{{ F.summary.estimateAmount }}</dt>
                <dd class="tabular-nums text-highlighted">{{ formatMoney(summary.calculations.estimateAmount) }}</dd>
              </div>
              <div class="flex items-center justify-between py-2">
                <dt class="text-muted">{{ ivaLabel }}</dt>
                <dd class="tabular-nums text-highlighted">{{ formatMoney(summary.calculations.estimateIva) }}</dd>
              </div>
              <div class="flex items-center justify-between py-2">
                <dt class="font-medium text-default">{{ F.summary.estimateTotal }}</dt>
                <dd class="tabular-nums font-medium text-highlighted">{{ formatMoney(summary.calculations.estimateTotal) }}</dd>
              </div>
              <div class="flex items-center justify-between py-2">
                <dt class="text-muted">{{ F.summary.anticipoAmortization }}</dt>
                <dd class="tabular-nums text-error">− {{ formatMoney(summary.calculations.anticipoAmortization) }}</dd>
              </div>
              <div class="flex items-center justify-between py-2">
                <dt class="text-muted">{{ F.summary.amortizationIva }}</dt>
                <dd class="tabular-nums text-error">− {{ formatMoney(summary.calculations.amortizationIva) }}</dd>
              </div>
              <div class="flex items-center justify-between py-2">
                <dt class="text-muted">{{ F.summary.retentions }}</dt>
                <dd class="tabular-nums text-error">− {{ formatMoney(summary.calculations.retentions) }}</dd>
              </div>
              <div class="flex items-center justify-between py-2">
                <dt class="text-muted">{{ F.summary.cincoAlMillar }}</dt>
                <dd class="tabular-nums text-error">− {{ formatMoney(summary.calculations.cincoAlMillarSfp) }}</dd>
              </div>
              <div class="flex items-center justify-between py-2.5">
                <dt class="font-semibold text-default">{{ F.summary.net }}</dt>
                <dd class="text-base font-semibold tabular-nums text-primary">{{ formatMoney(summary.calculations.total) }}</dd>
              </div>
            </dl>
          </UCard>
        </div>

        <!-- 4 · Anexos -->
        <UCard id="sec-attachments" class="scroll-mt-16">
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-paperclip" class="size-4 text-muted" />
              {{ F.attachments.title }}
            </div>
          </template>
          <div class="flex items-center gap-3 rounded-lg border border-dashed border-default p-4 text-sm text-muted">
            <UIcon name="i-lucide-info" class="size-4 shrink-0" />
            {{ F.attachments.note }}
          </div>
        </UCard>

        <!-- Validation + sticky actions -->
        <UAlert
          v-if="submitError"
          :title="submitError"
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
        />

        <div
          class="sticky bottom-0 -mx-4 mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-default bg-default/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
        >
          <div class="flex flex-col">
            <span class="text-xs text-muted">{{ F.summary.net }}</span>
            <span class="text-lg font-semibold tabular-nums text-primary">
              {{ formatMoney(summary.calculations.total) }}
            </span>
          </div>

          <div class="flex items-center gap-3">
            <span v-if="!canSubmit" class="hidden text-xs text-muted sm:inline">
              {{ periodError ?? (!hasQuantities ? F.validation.noQuantities : F.validation.overContracted) }}
            </span>
            <UButton color="neutral" variant="ghost" :to="`/contracts/${contractId}/estimates`">
              {{ S.common.cancel }}
            </UButton>
            <UButton
              icon="i-lucide-file-spreadsheet"
              :loading="loading"
              :disabled="!canSubmit"
              @click="onSubmit"
            >
              {{ F.saveDraft }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
