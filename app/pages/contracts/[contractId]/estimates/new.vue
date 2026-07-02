<!-- app/pages/contracts/[contractId]/estimates/new.vue -->
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import { formatDate, formatNumber, formatMoney } from '~/utils/format'
import { buildPeriods } from '~/data/calc/schedule'
import type { Estimate, ConceptId } from '~/data/models'

definePageMeta({ requiredPermission: 'estimate:create' })

const F = S.estimateForm

const route = useRoute()
const router = useRouter()
const repos = useRepositories()

const contractId = computed(() => route.params.contractId as string)
const editId = computed(() => (route.query.edit as string) || null)
const presetPeriod = computed(() => {
  const p = route.query.period ? Number(route.query.period) : null
  return p && Number.isFinite(p) ? p : null
})

// ─── Data load ────────────────────────────────────────────────────────────────
const { data, status, error, refresh } = await useAsyncData(
  `estimate-new-${contractId.value}-${editId.value ?? 'new'}`,
  async () => {
    const [contract, concepts, sections, schedule, estimates, folders, files, notes, editing] = await Promise.all([
      repos.contracts.getById(contractId.value),
      repos.concepts.listByContract(contractId.value),
      repos.concepts.listSectionsByContract(contractId.value),
      repos.schedule.getByContract(contractId.value).catch(() => null),
      repos.estimates.listByContract(contractId.value).catch(() => []),
      repos.files.listFolders(contractId.value).catch(() => []),
      repos.files.listFiles(contractId.value).catch(() => []),
      repos.logNotes.listByContract(contractId.value).catch(() => []),
      editId.value ? repos.estimates.getById(editId.value).catch(() => null) : Promise.resolve(null),
    ])
    const periods = buildPeriods(new Date(contract.startDate), new Date(contract.endDate), contract.estimatePeriodicity ?? 'monthly')
    // Periods already claimed by an APPROVED/paid estimate
    const claimedPeriods = new Set(
      estimates.filter((e) => e.status === 'approved' || e.status === 'paid').map((e) => e.periodIndex),
    )
    const scheduleEntries = schedule?.entries ?? []
    return { contract, concepts, sections, scheduleEntries, periods, claimedPeriods, folders, files, notes, editing }
  },
)

const contract = computed(() => data.value?.contract ?? null)

// ─── Wizard state ─────────────────────────────────────────────────────────────
const step = ref<1 | 2 | 3>(1)
const currentEstimate = ref<Estimate | null>(data.value?.editing ?? null)
const selectedPeriodIndex = ref<number | undefined>(
  data.value?.editing?.periodIndex ?? presetPeriod.value ?? undefined,
)

// If editing, jump to step 2
watch(currentEstimate, (e) => { if (e && step.value === 1) step.value = 2 }, { immediate: true })

// ─── Period options ───────────────────────────────────────────────────────────
const periodOptions = computed(() => {
  if (!data.value) return []
  return data.value.periods.map((p, i) => ({
    label: `Período ${i + 1} — ${formatDate(p.start)} a ${formatDate(p.end)}`,
    value: i + 1,
    disabled: data.value!.claimedPeriods.has(i + 1),
  }))
})
const selectedPeriodDates = computed(() => {
  if (!selectedPeriodIndex.value || !data.value) return null
  return data.value.periods[selectedPeriodIndex.value - 1] ?? null
})

// ─── Concepts scheduled for the selected period ───────────────────────────────
const conceptsForPeriod = computed(() => {
  if (!selectedPeriodIndex.value || !data.value) return []
  const periodIdx0 = selectedPeriodIndex.value - 1
  const scheduledIds = new Set(
    data.value.scheduleEntries
      .filter((en) => en.periodIndex === periodIdx0 && en.plannedQuantity > 0)
      .map((en) => String(en.conceptId)),
  )
  return data.value.concepts.filter((c) => scheduledIds.has(String(c.id)) && c.sectionId)
})

// ─── Hojas working state ──────────────────────────────────────────────────────
interface WRow { id: string; quantity: string; photoFileId: string | null; fileIds: string[]; logNoteIds: string[] }
interface WHoja { id: string; conceptId: string; rows: WRow[] }
const hojas = ref<WHoja[]>([])

// Hydrate hojas from an existing draft. A hoja is limited to a single row —
// if older data somehow has more (e.g. a legacy draft), only the first is kept.
function hydrateFromEstimate(e: Estimate) {
  hojas.value = e.hojas.map((h) => ({
    id: h.id,
    conceptId: String(h.conceptId),
    rows: h.rows.slice(0, 1).map((r) => ({
      id: r.id,
      quantity: String(r.quantity),
      photoFileId: r.photoFileId,
      fileIds: [...r.fileIds],
      logNoteIds: [...r.logNoteIds],
    })),
  }))
}
watch(currentEstimate, (e) => { if (e) hydrateFromEstimate(e) }, { immediate: true })

const usedConceptIds = computed(() => new Set(hojas.value.map((h) => h.conceptId)))
const availableConcepts = computed(() =>
  conceptsForPeriod.value.filter((c) => !usedConceptIds.value.has(String(c.id))),
)

const pickConceptId = ref<string | undefined>(undefined)
function addHoja() {
  if (!pickConceptId.value) return
  hojas.value.push({
    id: `tmp-${Date.now()}`,
    conceptId: pickConceptId.value,
    rows: [{ id: `r-${Date.now()}`, quantity: '', photoFileId: null, fileIds: [], logNoteIds: [] }],
  })
  pickConceptId.value = undefined
}
function removeHoja(idx: number) { hojas.value.splice(idx, 1) }

function conceptOf(id: string) { return data.value?.concepts.find((c) => String(c.id) === String(id)) ?? null }
function sectionOf(id: string | null | undefined) {
  return id ? (data.value?.sections.find((s) => String(s.id) === String(id)) ?? null) : null
}
function hojaTotal(h: WHoja) { return h.rows.reduce((s, r) => s + (parseFloat(r.quantity) || 0), 0) }

/** Scheduled quantity for a concept in the currently selected period. */
function scheduledQuantityForConcept(id: string): number {
  if (selectedPeriodIndex.value == null || !data.value) return 0
  const periodIdx0 = selectedPeriodIndex.value - 1
  return data.value.scheduleEntries
    .filter((en) => String(en.conceptId) === String(id) && en.periodIndex === periodIdx0)
    .reduce((s, en) => s + en.plannedQuantity, 0)
}
/** Estimated amount (Money, cents) for a concept in this period — scheduled quantity × unit price. */
function estimatedAmountForConcept(id: string): number {
  const concept = conceptOf(id)
  if (!concept) return 0
  return Math.round(scheduledQuantityForConcept(id) * concept.unitPrice)
}

// ─── Photo picker ─────────────────────────────────────────────────────────────
const photoModalOpen = ref(false)
const photoTarget = ref<{ h: WHoja; r: WRow } | null>(null)
const uploadFolderId = ref<string | undefined>(undefined)
const uploading = ref(false)

function openPhotoPicker(h: WHoja, r: WRow) {
  photoTarget.value = { h, r }
  // default to hoja-generadora folder
  uploadFolderId.value = data.value?.folders.find((f) => f.kind === 'hoja_generadora')?.id
    ?? data.value?.folders.find((f) => f.kind === 'evidence')?.id
    ?? data.value?.folders[0]?.id ?? undefined
  photoModalOpen.value = true
}
function pickExistingPhoto(fileId: string) {
  if (photoTarget.value) photoTarget.value.r.photoFileId = fileId
  photoModalOpen.value = false
}
async function onUploadPhoto(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !uploadFolderId.value) return
  uploading.value = true
  try {
    const asset = await repos.files.upload({ contractId: contractId.value, folderId: uploadFolderId.value as any, file })
    if (photoTarget.value) photoTarget.value.r.photoFileId = asset.id
    await refresh()
    photoModalOpen.value = false
  } catch (e) {
    saveError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally { uploading.value = false }
}
function fileName(id: string | null) { return id ? (data.value?.files.find((f) => f.id === id)?.name ?? id) : '' }

// ─── Save / submit ────────────────────────────────────────────────────────────
const saving = ref(false)
const saveError = ref<string | null>(null)

function buildHojaInput() {
  // Spread reactive arrays into plain JS arrays so structuredClone in the mock can copy them.
  return hojas.value.map((h) => ({
    id: h.id.startsWith('tmp-') ? undefined : h.id,
    conceptId: h.conceptId as ConceptId,
    rows: h.rows.map((r) => ({
      id: r.id.startsWith('r-') ? undefined : r.id,
      quantity: parseFloat(r.quantity) || 0,
      photoFileId: r.photoFileId ?? null,
      fileIds: [...r.fileIds],
      logNoteIds: [...r.logNoteIds],
    })),
  }))
}

async function ensureDraft(): Promise<Estimate> {
  if (currentEstimate.value) return currentEstimate.value
  const created = await repos.estimates.create({
    contractId: contractId.value,
    periodIndex: selectedPeriodIndex.value!,
  })
  currentEstimate.value = created
  return created
}

async function saveDraft() {
  saving.value = true; saveError.value = null
  try {
    const e = await ensureDraft()
    const updated = await repos.estimates.updateDraft(e.id, { hojas: buildHojaInput() })
    currentEstimate.value = updated
    if (step.value === 1) step.value = 2
  } catch (e) {
    saveError.value = isRepositoryError(e) ? e.message : (e instanceof Error ? e.message : S.common.error)
  } finally { saving.value = false }
}

async function goToReview() {
  await saveDraft()
  if (!saveError.value) step.value = 3
}

async function submit() {
  saving.value = true; saveError.value = null
  try {
    const e = await ensureDraft()
    await repos.estimates.updateDraft(e.id, { hojas: buildHojaInput() })
    await repos.estimates.submit(e.id)
    await navigateTo(`/contracts/${contractId.value}/estimates/${e.id}`)
  } catch (e) {
    saveError.value = isRepositoryError(e) ? e.message : (e instanceof Error ? e.message : S.common.error)
  } finally { saving.value = false }
}

async function deleteDraft() {
  if (!currentEstimate.value) { router.back(); return }
  if (!confirm(F.deleteConfirm)) return
  saving.value = true
  try {
    await repos.estimates.delete(currentEstimate.value.id)
    await navigateTo(`/contracts/${contractId.value}/estimates`)
  } catch (e) {
    saveError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally { saving.value = false }
}

// Review needs a live-computed estimate — reuse currentEstimate after save
const reviewEstimate = computed(() => currentEstimate.value)
</script>

<template>
  <UDashboardPanel id="estimate-new">
    <template #header>
      <UDashboardNavbar :title="editId ? F.editTitle : F.title">
        <template #leading>
          <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" :to="`/contracts/${contractId}/estimates`"
            :aria-label="S.common.back" />
        </template>
        <template #right>
          <UButton v-if="currentEstimate" color="error" variant="ghost" icon="i-lucide-trash-2" size="sm"
            :loading="saving" @click="deleteDraft">
            {{ F.deleteDraft }}
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6 pb-6">
        <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-alert-triangle" :title="S.common.error" />
        <USkeleton v-else-if="status === 'pending'" class="h-96 w-full rounded-xl" />

        <template v-else-if="data">
          <!-- Step indicator -->
          <div class="flex items-center gap-2 text-sm">
            <span :class="step >= 1 ? 'text-primary font-semibold' : 'text-muted'">1. {{ F.steps.period }}</span>
            <UIcon name="i-lucide-chevron-right" class="size-4 text-muted" />
            <span :class="step >= 2 ? 'text-primary font-semibold' : 'text-muted'">2. {{ F.steps.hojas }}</span>
            <UIcon name="i-lucide-chevron-right" class="size-4 text-muted" />
            <span :class="step >= 3 ? 'text-primary font-semibold' : 'text-muted'">3. {{ F.steps.review }}</span>
          </div>

          <!-- ═══ STEP 1: PERIOD ═══ -->
          <UCard v-if="step === 1">
            <template #header>
              <div class="font-medium">{{ F.period.title }}</div>
            </template>
            <div class="space-y-4 max-w-lg">
              <UFormField :label="F.period.selector">
                <USelect v-model="selectedPeriodIndex" :items="periodOptions" :placeholder="F.period.selector"
                  class="w-full" />
              </UFormField>
              <p v-if="selectedPeriodDates" class="text-sm text-muted">
                {{ F.period.dates }}: {{ formatDate(selectedPeriodDates.start) }} – {{
                  formatDate(selectedPeriodDates.end) }}
              </p>
              <p class="text-xs text-muted">{{ F.period.helper }}</p>
              <UAlert v-if="saveError" :title="saveError" color="error" variant="soft" icon="i-lucide-alert-triangle" />
            </div>
            <template #footer>
              <div class="flex justify-end">
                <UButton :disabled="!selectedPeriodIndex" :loading="saving" icon="i-lucide-arrow-right"
                  @click="saveDraft">
                  {{ F.saveDraft }}
                </UButton>
              </div>
            </template>
          </UCard>

          <!-- ═══ STEP 2: HOJAS ═══ -->
          <template v-if="step === 2">
            <UCard>
              <template #header>
                <div class="flex items-center justify-between">
                  <div class="font-medium">{{ F.hojas.title }}</div>
                  <span class="text-xs text-muted">
                    {{ F.hojas.period }}: {{ selectedPeriodDates ? `${formatDate(selectedPeriodDates.start)} –
                    ${formatDate(selectedPeriodDates.end)}` : '—' }}
                  </span>
                </div>
              </template>

              <!-- Add Hoja -->
              <div class="mb-4 flex flex-wrap items-end gap-3">
                <UFormField :label="F.hojas.pickConcept" class="flex-1 min-w-[16rem]">
                  <USelect v-model="pickConceptId"
                    :items="availableConcepts.map((c) => ({ label: `${c.specificationNumber} — ${c.description} · ${F.hojas.estimatedAmount}: ${formatMoney(estimatedAmountForConcept(String(c.id)))}`, value: String(c.id) }))"
                    :placeholder="availableConcepts.length ? F.hojas.pickConcept : F.hojas.noConceptsForPeriod"
                    :disabled="!availableConcepts.length" class="w-full" />
                </UFormField>
                <UButton icon="i-lucide-plus" :disabled="!pickConceptId" @click="addHoja">{{ F.hojas.add }}</UButton>
              </div>

              <p v-if="!hojas.length"
                class="rounded-lg border border-dashed border-default py-10 text-center text-sm text-muted">
                {{ F.hojas.empty }}
              </p>

              <!-- Hoja cards -->
              <div v-else class="space-y-5">
                <div v-for="(h, hi) in hojas" :key="h.id" class="rounded-xl border border-default overflow-hidden">
                  <!-- Hoja header -->
                  <div class="flex items-start justify-between gap-3 border-b border-default bg-elevated/30 px-4 py-3">
                    <div class="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                      <div><span class="text-muted">{{ F.hojas.number }}:</span> <span class="font-semibold">{{ hi + 1
                      }}</span></div>
                      <div><span class="text-muted">{{ F.hojas.partida }}:</span> <span class="font-medium">{{
                        sectionOf(conceptOf(h.conceptId)?.sectionId)?.specificationNumber ?? '—' }}</span></div>
                      <div class="sm:col-span-2"><span class="text-muted">{{ F.hojas.clave }}:</span> <span
                          class="font-medium">{{
                            conceptOf(h.conceptId)?.specificationNumber }} — {{ conceptOf(h.conceptId)?.description
                          }}</span></div>
                      <div><span class="text-muted">{{ F.hojas.estimatedAmount }}:</span> <span class="font-medium">{{
                        formatMoney(estimatedAmountForConcept(h.conceptId)) }}</span></div>
                    </div>
                    <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" @click="removeHoja(hi)" />
                  </div>

                  <!-- Row (single row per hoja) -->
                  <div class="overflow-x-auto">
                    <table class="w-full text-xs">
                      <thead class="border-b border-default bg-elevated/20 text-muted">
                        <tr>
                          <th class="px-2 py-1.5 text-left">{{ F.hojas.documento }}</th>
                          <th class="px-2 py-1.5">{{ F.hojas.unidad }}</th>
                          <th class="px-2 py-1.5 text-right">{{ F.hojas.cantidad }} ({{ F.hojas.catalogo }})</th>
                          <th class="px-2 py-1.5 text-right">{{ F.hojas.cantidad }} ({{ F.hojas.ejecutado }})</th>
                          <th class="px-2 py-1.5">{{ F.hojas.rowPhoto }}</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-default">
                        <tr v-for="r in h.rows" :key="r.id">
                          <td class="px-2 py-1.5">{{ conceptOf(h.conceptId)?.description }}</td>
                          <td class="px-2 py-1.5 text-center">{{ conceptOf(h.conceptId)?.unit }}</td>
                          <td class="px-2 py-1.5 text-right tabular-nums text-muted">
                            {{ formatNumber(conceptOf(h.conceptId)?.contractedQuantity ?? 0) }}</td>
                          <td class="px-2 py-1.5">
                            <UInput v-model="r.quantity" type="number" size="xs" class="w-24" :placeholder="'0'" />
                          </td>
                          <td class="px-2 py-1.5">
                            <div class="flex items-center gap-1.5">
                              <UButton :icon="r.photoFileId ? 'i-lucide-image' : 'i-lucide-image-plus'"
                                :color="r.photoFileId ? 'success' : 'neutral'" variant="soft" size="xs"
                                @click="openPhotoPicker(h, r)">
                                {{ r.photoFileId ? fileName(r.photoFileId).slice(0, 14) : F.hojas.rowPhoto }}
                              </UButton>
                            </div>
                          </td>
                        </tr>
                        <tr class="bg-elevated/20 font-semibold">
                          <td colspan="3" class="px-2 py-1.5 text-right">{{ F.hojas.hojaTotal }}</td>
                          <td colspan="2" class="px-2 py-1.5 tabular-nums">{{ formatNumber(hojaTotal(h)) }} {{
                            conceptOf(h.conceptId)?.unit }}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <UAlert v-if="saveError" class="mt-4" :title="saveError" color="error" variant="soft"
                icon="i-lucide-alert-triangle" />

              <template #footer>
                <div class="flex justify-between">
                  <UButton color="neutral" variant="ghost" :loading="saving" @click="saveDraft">{{ F.saveDraft }}
                  </UButton>
                  <UButton icon="i-lucide-arrow-right" :disabled="!hojas.length" :loading="saving" @click="goToReview">
                    {{ F.steps.review }}
                  </UButton>
                </div>
              </template>
            </UCard>
          </template>

          <!-- ═══ STEP 3: REVIEW ═══ -->
          <template v-if="step === 3 && reviewEstimate">
            <UAlert color="primary" variant="soft" icon="i-lucide-info" :title="F.review.hint" />
            <EstimateDocument :estimate="reviewEstimate" :contract-amount="contract?.amount ?? undefined"
              :anticipo-percentage="contract?.anticipoPercentage ?? undefined" :file-name="fileName" />
            <UAlert v-if="saveError" :title="saveError" color="error" variant="soft" icon="i-lucide-alert-triangle" />
            <div
              class="sticky bottom-0 -mx-4 flex justify-between gap-3 border-t border-default bg-default/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
              <UButton color="neutral" variant="ghost" icon="i-lucide-arrow-left" @click="() => void (step = 2)">{{
                F.steps.hojas }}</UButton>
              <UButton color="success" icon="i-lucide-send" :loading="saving" @click="submit">{{ F.submit }}</UButton>
            </div>
          </template>
        </template><!-- end v-else-if data -->
      </div><!-- end outer body wrapper -->
    </template>

  </UDashboardPanel>

  <!-- Photo picker modal — must live outside UDashboardPanel -->
  <UModal v-model:open="photoModalOpen" title="Fotografía de evidencia">
    <template #body>
      <div class="space-y-4">
        <div class="rounded-lg border border-default p-3">
          <p class="mb-2 text-sm font-medium">{{ F.hojas.uploadPhoto }}</p>
          <UFormField label="Carpeta destino" class="mb-2">
            <USelect v-model="uploadFolderId"
              :items="(data?.folders ?? []).map((f) => ({ label: f.name, value: String(f.id) }))" class="w-full" />
          </UFormField>
          <input type="file" accept="image/*" :disabled="uploading" @change="onUploadPhoto" />
        </div>
        <div>
          <p class="mb-2 text-sm font-medium">{{ F.hojas.pickPhoto }}</p>
          <div class="max-h-64 space-y-1 overflow-y-auto">
            <button v-for="f in (data?.files ?? [])" :key="f.id"
              class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-elevated"
              @click="() => pickExistingPhoto(String(f.id))">
              <UIcon name="i-lucide-file" class="size-4 text-muted shrink-0" />
              <span class="truncate">{{ f.name }}</span>
            </button>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>