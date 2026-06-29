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

// Edit mode is driven by ?edit=<estimateId>. Absent → create flow.
const editId = computed(() => (typeof route.query.edit === 'string' ? route.query.edit : null))
const isEdit = computed(() => !!editId.value)

const toInputDate = (d: Date | string) => new Date(d).toISOString().slice(0, 10)

// --- Load context, catalog, prior estimates, linkable files & log notes ------
const { data, status, error, refresh } = await useAsyncData(
  () => `estimate-form-${contractId.value}-${editId.value ?? 'new'}`,
  async () => {
    const [contract, sections, concepts, allEstimates, corporations, logNotes, files] = await Promise.all([
      repos.contracts.getById(contractId.value),
      repos.concepts.listSectionsByContract(contractId.value),
      repos.concepts.listByContract(contractId.value),
      repos.estimates.listByContract(contractId.value),
      repos.corporations.list().catch(() => []),
      repos.logNotes.listByContract(contractId.value).catch(() => []),
      repos.files.listFiles(contractId.value).catch(() => []),
    ])
    const editing = editId.value
      ? await repos.estimates.getById(editId.value).catch(() => null)
      : null

    // "Estimado anterior" accumulates every OTHER estimate (exclude the one we edit).
    const prior = allEstimates.filter((e) => e.id !== editId.value)
    const upToLast: Record<string, number> = {}
    for (const e of prior) {
      for (const li of e.lineItems) {
        upToLast[li.conceptId] = (upToLast[li.conceptId] ?? 0) + li.inThisEstimate
      }
    }
    const contractor = corporations.find((c) => c.id === contract.contractorCorporationId)
    return {
      contract,
      sections,
      concepts,
      groups: groupConceptsBySections(sections, concepts),
      upToLast,
      logNotes,
      files,
      contractorName: contractor?.name ?? '—',
      estimateNumber: editing ? editing.number : prior.length + 1,
      editing,
    }
  },
)

// --- Editable state ----------------------------------------------------------
const periodStart = ref('')
const periodEnd = ref('')
const qty = reactive<Record<string, number>>({})
const selectedConceptIds = ref<string[]>([]) // concepts chosen by the user
const selectedFiles = ref<string[]>([])
const selectedLogNotes = ref<string[]>([])
const inited = ref(false)
const conceptSearch = ref('')

watchEffect(() => {
  if (!data.value || inited.value) return
  const editing = data.value.editing
  for (const c of data.value.concepts) {
    qty[c.id] = editing?.lineItems.find((li) => li.conceptId === c.id)?.inThisEstimate ?? 0
  }
  if (editing) {
    periodStart.value = toInputDate(editing.periodStart)
    periodEnd.value = toInputDate(editing.periodEnd)
    selectedFiles.value = [...editing.evidenceFileIds]
    selectedLogNotes.value = [...editing.linkedLogNoteIds]
    // Pre-select concepts that had a non-zero quantity in the saved draft.
    selectedConceptIds.value = editing.lineItems
      .filter((li) => li.inThisEstimate > 0)
      .map((li) => li.conceptId)
  }
  inited.value = true
})

// Surface the return/reject reason when editing a returned estimate.
const editNote = computed(() => {
  const e = data.value?.editing
  if (!e || (e.status !== 'with_notes' && e.status !== 'rejected')) return null
  for (let i = e.history.length - 1; i >= 0; i--) {
    const ev = e.history[i]
    if (ev.action === 'returned_with_notes' || ev.action === 'rejected') {
      return { rejected: e.status === 'rejected', note: ev.note }
    }
  }
  return null
})

// --- Concept picker helpers --------------------------------------------------
// Grouped catalog for picker (section headers + concepts)
const filteredGroups = computed(() => {
  const q = conceptSearch.value.trim().toLowerCase()
  const groups = data.value?.groups ?? []
  if (!q) return groups
  return groups
    .map((g) => ({
      ...g,
      concepts: g.concepts.filter(
        (c) =>
          c.specificationNumber.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q),
      ),
    }))
    .filter((g) => g.concepts.length > 0)
})

function toggleConcept(id: string) {
  const i = selectedConceptIds.value.indexOf(id)
  if (i >= 0) {
    selectedConceptIds.value.splice(i, 1)
    qty[id] = 0 // clear quantity when deselecting
  } else {
    selectedConceptIds.value.push(id)
  }
}

function addAllConcepts() {
  selectedConceptIds.value = data.value?.concepts.map((c) => c.id) ?? []
}
function clearAllConcepts() {
  selectedConceptIds.value = []
  data.value?.concepts.forEach((c) => { qty[c.id] = 0 })
}

// --- Live computation (identical math to the repository) ----------------------
const rates = computed(() => ({
  ivaRate: data.value?.contract.ivaRate ?? 16,
  retentionPercentage: data.value?.contract.retentionPercentage ?? 5,
  cincoAlMillarRate: 0.5,
  anticipoPercentage: data.value?.contract.anticipoPercentage ?? 0,
}))

// Selected concepts, preserving section order for the grid
const selectedConcepts = computed(() => {
  const ids = new Set(selectedConceptIds.value)
  const ordered: NonNullable<typeof data.value>['concepts'] = []
  for (const g of (data.value?.groups ?? [])) {
    for (const c of g.concepts) {
      if (ids.has(c.id)) ordered.push(c)
    }
  }
  return ordered
})

// Groups of selected concepts — drives section headers in the editable grid
const selectedGroups = computed(() => {
  const ids = new Set(selectedConceptIds.value)
  return (data.value?.groups ?? [])
    .map((g) => ({ ...g, concepts: g.concepts.filter((c) => ids.has(c.id)) }))
    .filter((g) => g.concepts.length > 0)
})

const lineItems = computed<EstimateLineItem[]>(() => {
  if (!data.value) return []
  return selectedConcepts.value.map((c, i) =>
    buildLineItem(c, Number(qty[c.id]) || 0, data.value!.upToLast[c.id] ?? 0, i + 1),
  )
})

const activeLines = computed(() => lineItems.value.filter((li) => li.inThisEstimate > 0))
const summary = computed(() => buildSummary(activeLines.value, rates.value))
const overRows = computed(
  () => new Set(lineItems.value.filter((li) => li.toExecute < 0).map((li) => li.conceptId)),
)

function toggle(list: string[], id: string) {
  const i = list.indexOf(id)
  if (i >= 0) list.splice(i, 1)
  else list.push(id)
}

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

// --- Submit (create OR update draft) -----------------------------------------
const loading = ref(false)
const submitError = ref<string | null>(null)
const backTo = computed(() =>
  isEdit.value
    ? `/contracts/${contractId.value}/estimates/${editId.value}`
    : `/contracts/${contractId.value}/estimates`,
)

async function onSubmit() {
  if (!canSubmit.value || !data.value) return
  loading.value = true
  submitError.value = null
  try {
    const payload = {
      periodStart: new Date(`${periodStart.value}T12:00:00`),
      periodEnd: new Date(`${periodEnd.value}T12:00:00`),
      lineItems: activeLines.value.map((li) => ({
        conceptId: li.conceptId,
        inThisEstimate: li.inThisEstimate,
      })),
      evidenceFileIds: [...selectedFiles.value],
      linkedLogNoteIds: [...selectedLogNotes.value],
    }
    const result =
      isEdit.value && editId.value
        ? await repos.estimates.updateDraft(editId.value, payload)
        : await repos.estimates.create({ contractId: contractId.value, ...payload })
    await navigateTo(`/contracts/${contractId.value}/estimates/${result.id}`)
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
      <UDashboardNavbar
        :title="isEdit && data ? `${F.editTitlePrefix} No. ${data.estimateNumber}` : F.title"
      >
        <template #leading>
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            :to="backTo"
            :aria-label="S.common.back"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
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
        <!-- Returned/rejected reason when editing -->
        <UAlert
          v-if="editNote"
          :color="editNote.rejected ? 'error' : 'warning'"
          variant="soft"
          icon="i-lucide-message-square-warning"
          :title="editNote.rejected ? S.estimateDetail.banner.rejected : S.estimateDetail.banner.withNotes"
          :description="editNote.note"
        />

        <!-- Section nav -->
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
        <!-- 2a · Picker: choose which catalog concepts to include -->
        <UCard id="sec-concepts" class="scroll-mt-16">
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-list-checks" class="size-4 text-muted" />
                {{ F.sections.concepts }}
              </div>
              <span class="text-xs text-muted">
                {{ selectedConceptIds.length }} {{ F.conceptPicker.selected }}
              </span>
            </div>
          </template>

          <p class="mb-3 text-xs text-muted">{{ F.conceptPicker.hint }}</p>

          <!-- Search + bulk actions -->
          <div class="mb-3 flex flex-wrap items-center gap-2">
            <UInput
              v-model="conceptSearch"
              :placeholder="S.conceptCatalog.search"
              icon="i-lucide-search"
              class="w-56"
            />
            <UButton size="xs" color="neutral" variant="ghost" @click="addAllConcepts">
              {{ F.conceptPicker.addAll }}
            </UButton>
            <UButton size="xs" color="neutral" variant="ghost" @click="clearAllConcepts">
              {{ F.conceptPicker.clearAll }}
            </UButton>
          </div>

          <div v-if="!data.concepts.length" class="text-sm text-muted">
            {{ F.validation.noConcepts }}
          </div>
          <!-- Grouped picker: section headers + concept rows -->
          <div v-else class="max-h-72 overflow-y-auto rounded-lg border border-default">
            <template v-for="group in filteredGroups" :key="group.section?.id ?? 'no-section'">
              <!-- Section header -->
              <div class="sticky top-0 flex items-center gap-2 border-b border-default bg-elevated px-3 py-1.5">
                <span class="font-mono text-xs font-semibold text-muted">{{ group.section?.specificationNumber }}</span>
                <span class="text-xs font-semibold text-default">{{ group.section?.description ?? S.conceptSections.noSection }}</span>
                <span v-if="group.section" class="ml-auto text-xs text-muted">
                  {{ formatDate(group.section.startDate) }} – {{ formatDate(group.section.endDate) }}
                </span>
              </div>
              <!-- Concepts in this section -->
              <div
                v-for="c in group.concepts"
                :key="c.id"
                class="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-elevated/60 transition-colors"
                :class="selectedConceptIds.includes(c.id) ? 'bg-primary/5' : ''"
                @click="toggleConcept(c.id)"
              >
                <UCheckbox
                  :model-value="selectedConceptIds.includes(c.id)"
                  class="shrink-0 pointer-events-none"
                />
                <span class="font-mono text-xs text-muted w-16 shrink-0">{{ c.specificationNumber }}</span>
                <span class="min-w-0 flex-1 text-sm text-highlighted truncate">{{ c.description }}</span>
                <span class="shrink-0 text-xs text-muted">{{ c.unit }}</span>
                <span class="shrink-0 tabular-nums text-xs text-muted">{{ formatMoney(c.unitPrice) }}</span>
              </div>
            </template>
            <div v-if="filteredGroups.length === 0" class="py-4 text-center text-sm text-muted">
              {{ F.conceptPicker.noMatch }}
            </div>
          </div>
        </UCard>

        <!-- 2b · Grid: only selected concepts, quantities editable -->
        <UCard v-if="selectedConceptIds.length > 0" :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-table" class="size-4 text-muted" />
                {{ F.conceptPicker.label }}
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

          <div class="overflow-x-auto">
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
                  <th class="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                <template v-for="group in selectedGroups" :key="group.section?.id ?? 'no-section'">
                  <!-- Section header row in grid -->
                  <tr class="bg-elevated border-t-2 border-default">
                    <td colspan="12" class="px-3 py-1.5">
                      <span class="font-mono text-xs font-semibold text-muted mr-2">{{ group.section?.specificationNumber }}</span>
                      <span class="text-xs font-semibold text-default">{{ group.section?.description ?? S.conceptSections.noSection }}</span>
                      <span v-if="group.section" class="ml-3 text-xs text-muted">
                        {{ formatDate(group.section.startDate) }} – {{ formatDate(group.section.endDate) }}
                      </span>
                    </td>
                  </tr>
                  <!-- Concept rows for this section (from lineItems, filtered by group) -->
                  <tr
                    v-for="li in lineItems.filter(li => group.concepts.some(c => c.id === li.conceptId))"
                    :key="li.conceptId"
                    class="border-t border-default/50"
                    :class="overRows.has(li.conceptId) ? 'bg-error/10' : ''"
                  >
                    <td class="px-3 py-2 text-right tabular-nums text-highlighted">{{ li.conceptNumber }}</td>
                    <td class="px-3 py-2 font-mono text-xs text-highlighted">{{ li.specificationNumber }}</td>
                    <td class="min-w-[14rem] px-3 py-2 text-highlighted">{{ li.description }}</td>
                    <td class="px-3 py-2 text-muted">{{ li.unit }}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-highlighted">{{ formatNumber(li.inProject) }}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-highlighted">{{ formatNumber(li.upToLastEstimate) }}</td>
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
                    <td class="px-3 py-2 text-right tabular-nums text-error">{{ formatNumber(li.totalEstimated) }}</td>
                    <td class="px-3 py-2 text-right tabular-nums" :class="overRows.has(li.conceptId) ? 'font-semibold text-error' : 'text-error'">
                      {{ formatNumber(li.toExecute) }}
                    </td>
                    <td class="px-3 py-2 text-right tabular-nums text-highlighted">{{ formatMoney(li.unitPrice) }}</td>
                    <td class="px-3 py-2 text-right tabular-nums font-medium text-error">{{ formatMoney(li.totalAmount) }}</td>
                    <td class="px-2 py-2">
                      <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" :aria-label="`Quitar ${li.specificationNumber}`" @click="toggleConcept(li.conceptId)" />
                    </td>
                  </tr>
                  <!-- Section subtotal -->
                  <tr class="border-t border-default bg-elevated/30">
                    <td colspan="10" class="px-3 py-1 text-right text-xs text-muted">{{ S.conceptSections.subtotal }}</td>
                    <td class="px-3 py-1 text-right tabular-nums text-xs font-semibold text-highlighted">
                      {{ formatMoney(lineItems.filter(li => group.concepts.some(c => c.id === li.conceptId)).reduce((s, li) => s + li.totalAmount, 0)) }}
                    </td>
                    <td />
                  </tr>
                </template>
              </tbody>
              <tfoot class="border-t border-default bg-elevated/50">
                <tr>
                  <td colspan="10" class="px-3 py-2 text-right text-xs font-medium text-muted">
                    {{ F.summary.subtotal }}
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums font-semibold text-highlighted">
                    {{ formatMoney(summary.conceptSummary.subtotal) }}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </UCard>
        <!-- 3 · Resumen -->
        <div id="sec-summary" class="grid scroll-mt-16 gap-4 lg:grid-cols-2">
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

        <!-- 4 · Anexos (link files + log notes) -->
        <UCard id="sec-attachments" class="scroll-mt-16">
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-paperclip" class="size-4 text-muted" />
              {{ F.attachments.title }}
            </div>
          </template>

          <p class="mb-4 text-xs text-muted">{{ F.attachments.linkHint }}</p>

          <div class="grid gap-6 lg:grid-cols-2">
            <!-- Log notes -->
            <div>
              <div class="mb-2 text-sm font-medium text-default">{{ F.attachments.logNotes }}</div>
              <div v-if="!data.logNotes.length" class="text-sm text-muted">{{ F.attachments.logNotesEmpty }}</div>
              <div v-else class="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-default p-2">
                <UCheckbox
                  v-for="n in data.logNotes"
                  :key="n.id"
                  :model-value="selectedLogNotes.includes(n.id)"
                  :label="`#${n.folio} · ${n.title}`"
                  :description="formatDate(n.date)"
                  class="rounded-md px-2 py-1.5 hover:bg-elevated"
                  @update:model-value="() => toggle(selectedLogNotes, n.id)"
                />
              </div>
            </div>

            <!-- Files -->
            <div>
              <div class="mb-2 text-sm font-medium text-default">{{ F.attachments.files }}</div>
              <div v-if="!data.files.length" class="text-sm text-muted">{{ F.attachments.filesEmpty }}</div>
              <div v-else class="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-default p-2">
                <UCheckbox
                  v-for="f in data.files"
                  :key="f.id"
                  :model-value="selectedFiles.includes(f.id)"
                  :label="f.name"
                  class="rounded-md px-2 py-1.5 hover:bg-elevated"
                  @update:model-value="() => toggle(selectedFiles, f.id)"
                />
              </div>
            </div>
          </div>
        </UCard>

        <UAlert
          v-if="submitError"
          :title="submitError"
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
        />

        <!-- Sticky actions -->
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
            <UButton color="neutral" variant="ghost" :to="backTo">
              {{ S.common.cancel }}
            </UButton>
            <UButton
              :icon="isEdit ? 'i-lucide-save' : 'i-lucide-file-spreadsheet'"
              :loading="loading"
              :disabled="!canSubmit"
              @click="onSubmit"
            >
              {{ isEdit ? F.saveChanges : F.saveDraft }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>