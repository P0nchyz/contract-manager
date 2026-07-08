<!-- app/pages/contracts/new.vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import type { CreateConceptInput, CreateConceptSectionInput } from '~/data/repositories/types'

definePageMeta({ requiredPermission: 'contract:create' })

const F = S.newContract

const repos = useRepositories()
const authStore = useAuthStore()

// ─── Reference data ──────────────────────────────────────────────────────────
const { data: refs, status: refsStatus } = await useAsyncData('contract-new-refs', async () => {
  const [users, corporations] = await Promise.all([
    repos.users.list(),
    repos.corporations.list(),
  ])
  return {
    residents: users.filter((u) => u.role === 'resident' && u.active && u.entityId === authStore.user?.id),
    superintendents: users.filter((u) => u.role === 'superintendent' && u.active),
    supervisors: users.filter((u) => u.role === 'supervisor' && u.active),
    corporations,
  }
})

// ─── Two-phase state ─────────────────────────────────────────────────────────
// Phase 'form'   → fill in the contract form, submit → create the contract
// Phase 'upload' → contract exists, user uploads files then navigates away
type Phase = 'form' | 'upload'
const phase = ref<Phase>('form')
const createdContractId = ref<string | null>(null)
const contractFolderId = ref<string | null>(null) // predefined 'contract' folder

// ─── Form: section 1 — general ───────────────────────────────────────────────
const code = ref('')
const title = ref('')
const startDate = ref('')
const endDate = ref('')

// ─── Form: section 2 — rates + periodicity ───────────────────────────────────
const anticipoPct = ref<number | ''>(20)
const ivaRate = ref<number | ''>(16)
const periodicity = ref<'monthly' | 'biweekly'>('monthly')

const periodicityOptions = [
  { label: F.fields.periodicityMonthly, value: 'monthly' as const },
  { label: F.fields.periodicityBiweekly, value: 'biweekly' as const },
]

// ─── Form: section 3 — parties ───────────────────────────────────────────────
const residentId = ref<string | null>(null)
const superintendentCorpId = ref<string | null>(null)
const superintendentId = ref<string | null>(null)
const supervisorCorpId = ref<string | null>(null)
const supervisorId = ref<string | null>(null)

const superintendentsForCorp = computed(() =>
  refs.value?.superintendents.filter((u) => u.corporationId === superintendentCorpId.value) ?? [],
)
const supervisorsForCorp = computed(() =>
  refs.value?.supervisors.filter((u) => u.corporationId === supervisorCorpId.value) ?? [],
)

watch(superintendentCorpId, () => { superintendentId.value = null })
watch(supervisorCorpId, () => { supervisorId.value = null })

const contractorCorporationId = computed(() => superintendentCorpId.value)

// ─── Form: section 3.5 — catalog sections ────────────────────────────────────

type SectionDraft = { specificationNumber: string; description: string }
const catalogSections = ref<SectionDraft[]>([])

// The section that new concepts automatically attach to — updated whenever
// the user adds a section or edits one of its fields.
const lastEditedSectionIdx = ref<number | null>(null)

function addSection() {
  catalogSections.value.push({ specificationNumber: '', description: '' })
  lastEditedSectionIdx.value = catalogSections.value.length - 1
}
function touchSection(idx: number) {
  lastEditedSectionIdx.value = idx
}
function removeSection(idx: number) {
  catalogSections.value.splice(idx, 1)
  // Unassign and re-index concepts
  concepts.value.forEach((c) => {
    if (c._sectionIdx === idx) c._sectionIdx = null
    else if (c._sectionIdx != null && c._sectionIdx > idx) c._sectionIdx--
  })
  if (lastEditedSectionIdx.value === idx) lastEditedSectionIdx.value = null
  else if (lastEditedSectionIdx.value != null && lastEditedSectionIdx.value > idx) lastEditedSectionIdx.value--
}

const resolvedSections = computed<CreateConceptSectionInput[]>(() =>
  catalogSections.value.map((s, i) => ({
    specificationNumber: s.specificationNumber.trim(),
    description: s.description.trim(),
    startDate: new Date(),  // not used at creation
    endDate: new Date(),
    order: i,
  })),
)

const sectionErrors = computed(() =>
  catalogSections.value.map((s) => ({
    spec: s.specificationNumber.trim() ? '' : S.conceptSections.validation.specRequired,
    desc: s.description.trim() ? '' : S.conceptSections.validation.descRequired,
  })),
)

// ─── Form: section 4 — concepts ──────────────────────────────────────────────
type ConceptDraft = CreateConceptInput & { _qtyRaw: string; _priceRaw: string; _sectionIdx: number | null; _key: number }
const concepts = ref<ConceptDraft[]>([])
let conceptKeySeq = 0

function addConcept() {
  addConceptToSection(lastEditedSectionIdx.value)
}
function addConceptToSection(sectionIdx: number | null) {
  concepts.value.push({
    specificationNumber: '', description: '', unit: '', contractedQuantity: 0, unitPrice: 0,
    _qtyRaw: '', _priceRaw: '', _sectionIdx: sectionIdx, sectionId: null, _key: ++conceptKeySeq,
  })
  if (sectionIdx != null) lastEditedSectionIdx.value = sectionIdx
}
function removeConcept(concept: ConceptDraft) {
  const idx = concepts.value.indexOf(concept)
  if (idx === -1) return
  concepts.value.splice(idx, 1)
  scheduleGrid.value.splice(idx, 1)
  scheduleActive.value.splice(idx, 1)
}

/** Concepts sharing a section, in current display order. `null` = unsectioned. */
function conceptsInSection(sectionIdx: number | null) {
  return concepts.value.filter((c) => c._sectionIdx === sectionIdx)
}

/** Reorder a concept up/down within its own section group, keeping the
 *  parallel scheduleGrid/scheduleActive rows aligned with the new positions. */
function moveConcept(concept: ConceptDraft, direction: -1 | 1) {
  const group = conceptsInSection(concept._sectionIdx)
  const posInGroup = group.indexOf(concept)
  const swapWith = group[posInGroup + direction]
  if (!swapWith) return
  const i1 = concepts.value.indexOf(concept)
  const i2 = concepts.value.indexOf(swapWith)
    ;[concepts.value[i1], concepts.value[i2]] = [concepts.value[i2], concepts.value[i1]]
    ;[scheduleGrid.value[i1], scheduleGrid.value[i2]] = [scheduleGrid.value[i2], scheduleGrid.value[i1]]
    ;[scheduleActive.value[i1], scheduleActive.value[i2]] = [scheduleActive.value[i2], scheduleActive.value[i1]]
}

const resolvedConcepts = computed<CreateConceptInput[]>(() =>
  concepts.value.map((c) => ({
    specificationNumber: c.specificationNumber.trim(),
    description: c.description.trim(),
    unit: c.unit.trim(),
    contractedQuantity: Math.round(parseFloat(c._qtyRaw)) || 0,
    unitPrice: Math.round((parseFloat(c._priceRaw) || 0) * 100),
    // Pass _sectionIdx as a numeric string so the mock can resolve it to the
    // generated ConceptSectionId by position in initialSections.
    sectionId: c._sectionIdx != null ? String(c._sectionIdx) as any : null,
  })),
)
const totalAmount = computed(() =>
  resolvedConcepts.value.reduce((s, c) => s + c.unitPrice * c.contractedQuantity, 0),
)
const conceptErrors = computed(() =>
  concepts.value.map((c) => ({
    spec: c.specificationNumber.trim() ? '' : F.concepts.validation.specRequired,
    desc: c.description.trim() ? '' : F.concepts.validation.descRequired,
    unit: c.unit.trim() ? '' : F.concepts.validation.unitRequired,
    qty: !(parseFloat(c._qtyRaw) > 0) ? F.concepts.validation.qtyPositive
      : !Number.isInteger(parseFloat(c._qtyRaw)) ? F.concepts.validation.qtyInteger : '',
    price: parseFloat(c._priceRaw) > 0 ? '' : F.concepts.validation.pricePositive,
  })),
)
const conceptsValid = computed(() =>
  concepts.value.length > 0 &&
  conceptErrors.value.every((e) => !e.spec && !e.desc && !e.unit && !e.qty && !e.price),
)

// ─── Form: section 5 — schedule ──────────────────────────────────────────────
import { buildPeriods } from '~/data/calc/schedule'

// periods are derived from the form's start/end/periodicity
const derivedPeriods = computed(() => {
  if (!startDate.value || !endDate.value || !periodicity.value) return []
  return buildPeriods(
    new Date(`${startDate.value}T12:00:00`),
    new Date(`${endDate.value}T12:00:00`),
    periodicity.value,
  )
})

// Active period tab in the schedule section (0-based period index)
const activePeriodTab = ref(0)
watch(() => derivedPeriods.value.length, (len) => {
  if (activePeriodTab.value >= len) activePeriodTab.value = Math.max(0, len - 1)
})

// scheduleGrid[conceptIndex][periodIndex] = planned quantity (string for input)
// scheduleActive[conceptIndex][periodIndex] = whether that concept has been
// explicitly added to that period's schedule (controls what's shown, so we
// don't dump every concept into every period by default).
// Both auto-sized when concepts or periods change.
const scheduleGrid = ref<string[][]>([])
const scheduleActive = ref<boolean[][]>([])

watch(
  [() => concepts.value.length, () => derivedPeriods.value.length],
  ([cLen, pLen]) => {
    const prevGrid = scheduleGrid.value
    const prevActive = scheduleActive.value
    scheduleGrid.value = Array.from({ length: cLen }, (_, ci) =>
      Array.from({ length: pLen }, (_, pi) => prevGrid[ci]?.[pi] ?? ''),
    )
    scheduleActive.value = Array.from({ length: cLen }, (_, ci) =>
      Array.from({ length: pLen }, (_, pi) =>
        prevActive[ci]?.[pi] ?? (parseFloat(prevGrid[ci]?.[pi] ?? '') || 0) > 0,
      ),
    )
  },
  { immediate: true },
)

// ─── Add/remove concepts from the currently active period tab ───────────────
function addConceptToPeriod(conceptIdx: number) {
  if (!scheduleActive.value[conceptIdx]) return
  scheduleActive.value[conceptIdx][activePeriodTab.value] = true
}
function removeConceptFromPeriod(conceptIdx: number) {
  if (scheduleGrid.value[conceptIdx]) scheduleGrid.value[conceptIdx][activePeriodTab.value] = ''
  if (scheduleActive.value[conceptIdx]) scheduleActive.value[conceptIdx][activePeriodTab.value] = false
}

/** Concepts already added to the active period tab, restricted to one section (or unsectioned when null). */
function activeConceptsInPeriodSection(sectionIdx: number | null) {
  return concepts.value
    .map((c, ci) => ({ c, ci }))
    .filter(({ c, ci }) => c._sectionIdx === sectionIdx && scheduleActive.value[ci]?.[activePeriodTab.value])
}
const activeConceptsInPeriodCount = computed(() =>
  concepts.value.filter((_, ci) => scheduleActive.value[ci]?.[activePeriodTab.value]).length,
)

// Picker: choose from the concepts NOT yet added to the active period tab.
const pickerValue = ref<number | null>(null)
const pickerItems = computed(() =>
  concepts.value
    .map((c, ci) => ({ c, ci }))
    .filter(({ ci }) => !scheduleActive.value[ci]?.[activePeriodTab.value])
    .map(({ c, ci }) => {
      const sec = c._sectionIdx != null ? catalogSections.value[c._sectionIdx] : null
      const secPrefix = sec ? `${sec.specificationNumber || sec.description} · ` : ''
      return { label: `${secPrefix}${c.specificationNumber} ${c.description}`.trim(), value: ci }
    }),
)
watch(pickerValue, (v) => {
  if (v == null) return
  addConceptToPeriod(v)
  pickerValue.value = null
})

// Planned totals per concept (must equal contractedQuantity)
const conceptTotals = computed(() =>
  scheduleGrid.value.map((row) =>
    row.reduce((s, v) => s + (parseFloat(v) || 0), 0),
  ),
)

const scheduleErrors = computed(() =>
  concepts.value.map((c, ci) => {
    const contracted = parseFloat(c._qtyRaw) || 0
    const total = conceptTotals.value[ci] ?? 0
    const row = scheduleGrid.value[ci] ?? []
    if (row.some((v) => v.trim() !== '' && !Number.isInteger(parseFloat(v)))) {
      return F.schedule.validation.qtyInteger
    }
    if (contracted > 0 && Math.abs(total - contracted) > 0.001) return F.schedule.validation.sumMismatch
    return null
  }),
)

const scheduleValid = computed(() =>
  derivedPeriods.value.length > 0 &&
  scheduleErrors.value.every((e) => e === null) &&
  conceptTotals.value.some((t) => t > 0),
)

// Gantt: one row per concept, only the periods where it actually has planned volume
const ganttRows = computed(() =>
  concepts.value.map((c, ci) => {
    const row = scheduleGrid.value[ci] ?? []
    const periods = row
      .map((v, pi) => ((parseFloat(v) || 0) > 0 ? pi : -1))
      .filter((pi) => pi >= 0)
    const amount = Math.round((parseFloat(c._priceRaw) || 0) * 100) *
      (parseFloat(c._qtyRaw) || 0)
    return {
      label: c.description || `Concepto ${ci + 1}`,
      periods,
      amount,
    }
  }).filter((r) => r.periods.length > 0),
)

// ─── Validation ───────────────────────────────────────────────────────────────
const errors = computed(() => ({
  code: !code.value.trim() ? F.validation.codeRequired : null,
  title: !title.value.trim() ? F.validation.titleRequired : null,
  dates: (!startDate.value || !endDate.value) ? F.validation.datesRequired
    : startDate.value >= endDate.value ? F.validation.endBeforeStart : null,
  anticipo: (anticipoPct.value === '' || Number(anticipoPct.value) < 0 || Number(anticipoPct.value) > 30) ? F.validation.anticipoRange : null,
  iva: (ivaRate.value === '' || Number(ivaRate.value) < 0 || Number(ivaRate.value) > 100) ? F.validation.ivaRange : null,
  resident: !residentId.value ? F.validation.residentRequired : null,
  superintendent: !superintendentId.value ? F.validation.superintendentRequired : null,
  supervisor: !supervisorId.value ? F.validation.supervisorRequired : null,
  concepts: !conceptsValid.value ? F.validation.conceptsRequired : null,
  schedule: !scheduleValid.value ? F.validation.scheduleRequired : null,
}))
const canSubmit = computed(() => Object.values(errors.value).every((e) => e === null))

// ─── Phase 1: create contract ─────────────────────────────────────────────────
const loading = ref(false)
const submitError = ref<string | null>(null)

async function onSubmit() {
  if (!canSubmit.value) return
  loading.value = true
  submitError.value = null
  try {
    const contract = await repos.contracts.create({
      code: code.value.trim(),
      title: title.value.trim(),
      anticipoPercentage: Number(anticipoPct.value),
      ivaRate: Number(ivaRate.value),
      estimatePeriodicity: periodicity.value,
      startDate: new Date(`${startDate.value}T12:00:00`),
      endDate: new Date(`${endDate.value}T12:00:00`),
      residentId: residentId.value,
      superintendentId: superintendentId.value,
      supervisorId: supervisorId.value,
      superintendentCorporationId: superintendentCorpId.value,
      supervisorCorporationId: supervisorCorpId.value,
      contractorCorporationId: contractorCorporationId.value,
      initialSections: resolvedSections.value,
      initialConcepts: resolvedConcepts.value,
      scheduleEntries: scheduleGrid.value.flatMap((row, ci) =>
        row.flatMap((v, pi) => {
          const qty = parseFloat(v) || 0
          return qty > 0 ? [{ conceptIndex: ci, periodIndex: pi, plannedQuantity: qty }] : []
        }),
      ),
    })
    createdContractId.value = contract.id
    // Fetch the predefined 'contract' folder to upload into it
    const folders = await repos.files.listFolders(contract.id)
    const contractFolder = folders.find((f) => f.kind === 'contract')
    contractFolderId.value = contractFolder?.id ?? null
    phase.value = 'upload'
  } catch (e) {
    submitError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    loading.value = false
  }
}

// ─── Phase 2: file upload ─────────────────────────────────────────────────────
type UploadEntry = {
  id: string        // local UUID for keying
  file: File
  status: 'queued' | 'uploading' | 'done' | 'error'
  progress: number  // 0–1
  errorMsg: string | null
}
const uploadQueue = ref<UploadEntry[]>([])
const isDragging = ref(false)
let _entryId = 0

function makeEntry(file: File): UploadEntry {
  return { id: String(++_entryId), file, status: 'queued', progress: 0, errorMsg: null }
}

function onDrop(e: DragEvent) {
  isDragging.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  uploadQueue.value.push(...files.map(makeEntry))
}
function onFileInput(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? [])
  uploadQueue.value.push(...files.map(makeEntry))
    ; (e.target as HTMLInputElement).value = ''
}
function removeQueued(id: string) {
  uploadQueue.value = uploadQueue.value.filter((e) => e.id !== id)
}

const anyUploading = computed(() => uploadQueue.value.some((e) => e.status === 'uploading'))
const allDone = computed(() => uploadQueue.value.length > 0 && uploadQueue.value.every((e) => e.status === 'done'))

async function uploadAll() {
  if (!createdContractId.value || !contractFolderId.value) return
  const queued = uploadQueue.value.filter((e) => e.status === 'queued')
  await Promise.all(queued.map((entry) => uploadOne(entry)))
}

async function uploadOne(entry: UploadEntry) {
  if (!createdContractId.value || !contractFolderId.value) return
  entry.status = 'uploading'
  entry.progress = 0
  try {
    await repos.files.upload(
      { contractId: createdContractId.value, folderId: contractFolderId.value, file: entry.file },
      (fraction) => { entry.progress = fraction },
    )
    entry.status = 'done'
    entry.progress = 1
  } catch (e) {
    entry.status = 'error'
    entry.errorMsg = isRepositoryError(e) ? e.message : S.common.error
  }
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1_048_576).toFixed(1)} MB`
}

const sections = [
  { id: 'sec-general', label: F.sections.general },
  { id: 'sec-rates', label: F.sections.rates },
  { id: 'sec-parties', label: F.sections.parties },
  { id: 'sec-concepts', label: 'Partidas y conceptos' },
  { id: 'sec-schedule', label: F.sections.schedule },
]
</script>

<template>
  <UDashboardPanel id="contract-new">
    <template #header>
      <UDashboardNavbar :title="F.title">
        <template #leading>
          <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost"
            :to="phase === 'upload' && createdContractId && allDone ? `/contracts/${createdContractId}` : phase === 'upload' ? undefined : '/'"
            :disabled="phase === 'upload' && !allDone" :aria-label="S.common.back" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="refsStatus === 'pending'" class="space-y-4">
        <USkeleton class="h-32 w-full rounded-lg" />
        <USkeleton class="h-32 w-full rounded-lg" />
      </div>

      <!-- ══════════════════════════════════════════════════════════════════
           PHASE 1 — contract form
      ══════════════════════════════════════════════════════════════════════ -->
      <div v-else-if="phase === 'form'" class="space-y-6">
        <!-- Section nav -->
        <nav
          class="sticky top-0 z-10 -mx-4 mb-2 flex gap-1 overflow-x-auto border-b border-default bg-default/75 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
          <a v-for="s in sections" :key="s.id" :href="`#${s.id}`"
            class="shrink-0 rounded-md px-2.5 py-1 text-sm text-muted transition-colors hover:bg-elevated hover:text-default">
            {{ s.label }}
          </a>
        </nav>

        <!-- ① Datos generales -->
        <UCard id="sec-general" class="scroll-mt-16">
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-file-text" class="size-4 text-muted" />
              {{ F.sections.general }}
            </div>
          </template>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="F.fields.code" :error="errors.code || undefined">
              <UInput v-model="code" class="w-full" :placeholder="F.fields.codePlaceholder" />
            </UFormField>
            <div class="sm:col-span-2">
              <UFormField :label="F.fields.title" :error="errors.title || undefined">
                <UTextarea v-model="title" :rows="2" class="w-full" :placeholder="F.fields.titlePlaceholder" />
              </UFormField>
            </div>
            <UFormField :label="F.fields.startDate" :error="errors.dates || undefined">
              <UInput v-model="startDate" type="date" class="w-full" />
            </UFormField>
            <UFormField :label="F.fields.endDate">
              <UInput v-model="endDate" type="date" class="w-full" />
            </UFormField>
          </div>
        </UCard>

        <!-- ② Tasas y periodicidad -->
        <UCard id="sec-rates" class="scroll-mt-16">
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-percent" class="size-4 text-muted" />
              {{ F.sections.rates }}
            </div>
          </template>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <UFormField :label="F.fields.anticipoPercentage" :error="errors.anticipo || undefined"
              :hint="F.fields.anticipoMax">
              <UInput v-model.number="anticipoPct" type="number" min="0" max="30" step="1" class="w-full">
                <template #trailing><span class="pr-2 text-sm text-muted">%</span></template>
              </UInput>
            </UFormField>
            <UFormField :label="F.fields.ivaRate" :error="errors.iva || undefined">
              <UInput v-model.number="ivaRate" type="number" min="0" max="100" step="1" class="w-full">
                <template #trailing><span class="pr-2 text-sm text-muted">%</span></template>
              </UInput>
            </UFormField>
            <div class="flex flex-col justify-center">
              <p class="text-xs text-muted">
                <span class="font-medium">{{ F.fields.cincoAlMillar }}:</span>
                {{ F.fields.cincoAlMillarFixed }}
              </p>
            </div>
            <div class="sm:col-span-2 lg:col-span-3">
              <UFormField :label="F.fields.estimatePeriodicity">
                <div class="flex flex-wrap gap-3">
                  <label v-for="opt in periodicityOptions" :key="opt.value"
                    class="flex cursor-pointer items-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm transition-colors"
                    :class="periodicity === opt.value
                      ? 'border-primary bg-primary/5 text-primary font-medium'
                      : 'border-default bg-default text-default hover:bg-elevated'">
                    <input v-model="periodicity" type="radio" :value="opt.value" class="sr-only" />
                    <UIcon :name="opt.value === 'monthly' ? 'i-lucide-calendar' : 'i-lucide-calendar-days'"
                      class="size-4" />
                    {{ opt.label }}
                  </label>
                </div>
              </UFormField>
            </div>
          </div>
        </UCard>

        <!-- ③ Partes -->
        <UCard id="sec-parties" class="scroll-mt-16">
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-users" class="size-4 text-muted" />
              {{ F.sections.parties }}
            </div>
          </template>
          <div class="grid gap-4 sm:grid-cols-2">
            <!-- Resident (from entity pool) -->
            <UFormField :label="F.fields.resident" :error="errors.resident || undefined" class="sm:col-span-2">
              <USelect v-model="residentId"
                :items="(refs?.residents ?? []).map((u) => ({ label: u.fullName, value: u.id }))"
                :placeholder="`— ${F.fields.resident} —`" class="w-full" />
            </UFormField>

            <!-- Superintendent: pick corporation first, then user -->
            <UFormField label="Empresa contratista">
              <USelect v-model="superintendentCorpId"
                :items="(refs?.corporations ?? []).map((c) => ({ label: c.name, value: c.id }))"
                placeholder="— Empresa —" class="w-full" />
            </UFormField>
            <UFormField :label="F.fields.superintendent" :error="errors.superintendent || undefined">
              <USelect v-model="superintendentId" :disabled="!superintendentCorpId"
                :items="superintendentsForCorp.map((u) => ({ label: u.fullName, value: u.id }))"
                :placeholder="`— ${F.fields.superintendent} —`" class="w-full" />
            </UFormField>

            <!-- Supervisor: pick corporation first, then user -->
            <UFormField label="Empresa supervisora">
              <USelect v-model="supervisorCorpId"
                :items="(refs?.corporations ?? []).map((c) => ({ label: c.name, value: c.id }))"
                placeholder="— Empresa —" class="w-full" />
            </UFormField>
            <UFormField :label="F.fields.supervisor" :error="errors.supervisor || undefined">
              <USelect v-model="supervisorId" :disabled="!supervisorCorpId"
                :items="supervisorsForCorp.map((u) => ({ label: u.fullName, value: u.id }))"
                :placeholder="`— ${F.fields.supervisor} —`" class="w-full" />
            </UFormField>
          </div>
        </UCard>

        <!-- ④ Partidas y conceptos ─────────────────────────────────────── -->
        <UCard id="sec-concepts" class="scroll-mt-16" :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-list" class="size-4 text-muted" />
                Partidas y conceptos
              </div>
              <div class="flex gap-2">
                <UButton size="sm" icon="i-lucide-layers" color="neutral" variant="outline" @click="addSection">
                  Agregar partida
                </UButton>
                <UButton size="sm" icon="i-lucide-plus" color="neutral" variant="outline" @click="addConcept">
                  {{ F.concepts.add }}
                </UButton>
              </div>
            </div>
          </template>

          <p class="border-b border-default px-4 py-2 text-xs text-muted">
            {{ F.concepts.hint }} {{ F.concepts.sectionHint }}
          </p>

          <div v-if="!catalogSections.length && !concepts.length" class="px-4 py-8 text-center text-sm text-muted">
            {{ F.concepts.empty }}
          </div>

          <!-- Column header (shared visual alignment with the rows below) -->
          <div v-else
            class="hidden border-b border-default bg-elevated/50 px-4 py-2 text-xs text-muted lg:grid lg:grid-cols-[7rem_1fr_4.5rem_6rem_7rem_7rem_4.5rem_4rem] lg:gap-2">
            <span class="font-medium">{{ F.concepts.columns.specification }}</span>
            <span class="font-medium">{{ F.concepts.columns.description }}</span>
            <span class="font-medium">{{ F.concepts.columns.unit }}</span>
            <span class="text-right font-medium">{{ F.concepts.columns.qty }}</span>
            <span class="text-right font-medium">{{ F.concepts.columns.unitPrice }}</span>
            <span class="text-right font-medium">{{ F.concepts.columns.amount }}</span>
            <span />
            <span />
          </div>

          <div class="divide-y divide-default">
            <!-- One block per partida (section) — concepts created while this
                 section is active automatically attach to it. -->
            <div v-for="(sec, si) in catalogSections" :key="si" class="px-4 py-3"
              :class="lastEditedSectionIdx === si ? 'bg-primary/5' : ''">
              <div class="mb-2 flex flex-wrap items-center gap-2">
                <UInput v-model="sec.specificationNumber" class="w-24" placeholder="A"
                  :color="sectionErrors[si]?.spec ? 'error' : undefined" @focus="touchSection(si)" />
                <UInput v-model="sec.description" class="min-w-0 flex-1" placeholder="Nombre de la partida"
                  :color="sectionErrors[si]?.desc ? 'error' : undefined" @focus="touchSection(si)" />
                <UBadge v-if="lastEditedSectionIdx === si" :label="F.concepts.activeSection" color="primary"
                  variant="subtle" size="sm" />
                <UButton size="xs" icon="i-lucide-plus" color="neutral" variant="outline"
                  @click="addConceptToSection(si)">
                  {{ F.concepts.add }}
                </UButton>
                <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" @click="removeSection(si)" />
              </div>

              <div v-if="conceptsInSection(si).length" class="space-y-2 lg:space-y-0 lg:divide-y lg:divide-default/60">
                <div v-for="c in conceptsInSection(si)" :key="c._key"
                  class="grid grid-cols-1 gap-2 rounded-lg border border-default p-2.5 lg:grid-cols-[7rem_1fr_4.5rem_6rem_7rem_7rem_4.5rem_4rem] lg:items-start lg:rounded-none lg:border-0 lg:border-b-0 lg:p-0 lg:py-2">
                  <div>
                    <UInput v-model="c.specificationNumber" class="w-full" placeholder="E-101"
                      :color="conceptErrors[concepts.indexOf(c)]?.spec ? 'error' : undefined" />
                    <p v-if="conceptErrors[concepts.indexOf(c)]?.spec" class="mt-0.5 text-xs text-error">
                      {{ conceptErrors[concepts.indexOf(c)].spec }}</p>
                  </div>
                  <div>
                    <UInput v-model="c.description" class="w-full"
                      :color="conceptErrors[concepts.indexOf(c)]?.desc ? 'error' : undefined" />
                    <p v-if="conceptErrors[concepts.indexOf(c)]?.desc" class="mt-0.5 text-xs text-error">
                      {{ conceptErrors[concepts.indexOf(c)].desc }}</p>
                  </div>
                  <div>
                    <UInput v-model="c.unit" class="w-full" placeholder="m2"
                      :color="conceptErrors[concepts.indexOf(c)]?.unit ? 'error' : undefined" />
                    <p v-if="conceptErrors[concepts.indexOf(c)]?.unit" class="mt-0.5 text-xs text-error">
                      {{ conceptErrors[concepts.indexOf(c)].unit }}</p>
                  </div>
                  <div>
                    <UInput v-model="c._qtyRaw" type="number" min="0" step="1" class="w-full [&_input]:text-right"
                      :color="conceptErrors[concepts.indexOf(c)]?.qty ? 'error' : undefined" />
                    <p v-if="conceptErrors[concepts.indexOf(c)]?.qty" class="mt-0.5 text-xs text-error">
                      {{ conceptErrors[concepts.indexOf(c)].qty }}</p>
                  </div>
                  <div>
                    <UInput v-model="c._priceRaw" type="number" min="0" step="0.01" class="w-full [&_input]:text-right"
                      :color="conceptErrors[concepts.indexOf(c)]?.price ? 'error' : undefined">
                      <template #leading><span class="pl-1 text-xs text-muted">$</span></template>
                    </UInput>
                    <p v-if="conceptErrors[concepts.indexOf(c)]?.price" class="mt-0.5 text-xs text-error">
                      {{ conceptErrors[concepts.indexOf(c)].price }}</p>
                  </div>
                  <div class="pt-2 text-right text-sm tabular-nums text-muted lg:pt-1.5">
                    {{ formatMoney(Math.round((parseFloat(c._priceRaw) || 0) * 100) * (parseFloat(c._qtyRaw) || 0)) }}
                  </div>
                  <div class="flex items-center justify-end gap-0.5 pt-1">
                    <UButton icon="i-lucide-chevron-up" size="xs" color="neutral" variant="ghost"
                      :disabled="conceptsInSection(si).indexOf(c) === 0" :aria-label="F.concepts.moveUp"
                      @click="moveConcept(c, -1)" />
                    <UButton icon="i-lucide-chevron-down" size="xs" color="neutral" variant="ghost"
                      :disabled="conceptsInSection(si).indexOf(c) === conceptsInSection(si).length - 1"
                      :aria-label="F.concepts.moveDown" @click="moveConcept(c, 1)" />
                  </div>
                  <div class="flex items-center justify-end pt-1">
                    <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost"
                      :aria-label="F.concepts.columns.remove" @click="removeConcept(c)" />
                  </div>
                </div>
              </div>
              <p v-else class="pl-1 text-xs italic text-muted">{{ F.concepts.emptySection }}</p>
            </div>

            <!-- Concepts without a section (legacy / orphaned by a removed partida) -->
            <div v-if="conceptsInSection(null).length" class="px-4 py-3">
              <div class="mb-2 flex items-center justify-between">
                <span class="text-sm font-semibold text-muted">{{ F.concepts.noSection }}</span>
                <UButton v-if="!catalogSections.length" size="xs" icon="i-lucide-plus" color="neutral" variant="outline"
                  @click="addConcept">{{ F.concepts.add }}</UButton>
              </div>
              <div class="space-y-2 lg:space-y-0 lg:divide-y lg:divide-default/60">
                <div v-for="c in conceptsInSection(null)" :key="c._key"
                  class="grid grid-cols-1 gap-2 rounded-lg border border-default p-2.5 lg:grid-cols-[7rem_1fr_4.5rem_6rem_7rem_7rem_4.5rem_4rem] lg:items-start lg:rounded-none lg:border-0 lg:p-0 lg:py-2">
                  <div>
                    <UInput v-model="c.specificationNumber" class="w-full" placeholder="E-101"
                      :color="conceptErrors[concepts.indexOf(c)]?.spec ? 'error' : undefined" />
                    <p v-if="conceptErrors[concepts.indexOf(c)]?.spec" class="mt-0.5 text-xs text-error">
                      {{ conceptErrors[concepts.indexOf(c)].spec }}</p>
                  </div>
                  <div>
                    <UInput v-model="c.description" class="w-full"
                      :color="conceptErrors[concepts.indexOf(c)]?.desc ? 'error' : undefined" />
                    <p v-if="conceptErrors[concepts.indexOf(c)]?.desc" class="mt-0.5 text-xs text-error">
                      {{ conceptErrors[concepts.indexOf(c)].desc }}</p>
                  </div>
                  <div>
                    <UInput v-model="c.unit" class="w-full" placeholder="m2"
                      :color="conceptErrors[concepts.indexOf(c)]?.unit ? 'error' : undefined" />
                    <p v-if="conceptErrors[concepts.indexOf(c)]?.unit" class="mt-0.5 text-xs text-error">
                      {{ conceptErrors[concepts.indexOf(c)].unit }}</p>
                  </div>
                  <div>
                    <UInput v-model="c._qtyRaw" type="number" min="0" step="1" class="w-full [&_input]:text-right"
                      :color="conceptErrors[concepts.indexOf(c)]?.qty ? 'error' : undefined" />
                    <p v-if="conceptErrors[concepts.indexOf(c)]?.qty" class="mt-0.5 text-xs text-error">
                      {{ conceptErrors[concepts.indexOf(c)].qty }}</p>
                  </div>
                  <div>
                    <UInput v-model="c._priceRaw" type="number" min="0" step="0.01" class="w-full [&_input]:text-right"
                      :color="conceptErrors[concepts.indexOf(c)]?.price ? 'error' : undefined">
                      <template #leading><span class="pl-1 text-xs text-muted">$</span></template>
                    </UInput>
                    <p v-if="conceptErrors[concepts.indexOf(c)]?.price" class="mt-0.5 text-xs text-error">
                      {{ conceptErrors[concepts.indexOf(c)].price }}</p>
                  </div>
                  <div class="pt-2 text-right text-sm tabular-nums text-muted lg:pt-1.5">
                    {{ formatMoney(Math.round((parseFloat(c._priceRaw) || 0) * 100) * (parseFloat(c._qtyRaw) || 0)) }}
                  </div>
                  <div class="flex items-center justify-end gap-0.5 pt-1">
                    <UButton icon="i-lucide-chevron-up" size="xs" color="neutral" variant="ghost"
                      :disabled="conceptsInSection(null).indexOf(c) === 0" :aria-label="F.concepts.moveUp"
                      @click="moveConcept(c, -1)" />
                    <UButton icon="i-lucide-chevron-down" size="xs" color="neutral" variant="ghost"
                      :disabled="conceptsInSection(null).indexOf(c) === conceptsInSection(null).length - 1"
                      :aria-label="F.concepts.moveDown" @click="moveConcept(c, 1)" />
                  </div>
                  <div class="flex items-center justify-end pt-1">
                    <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost"
                      :aria-label="F.concepts.columns.remove" @click="removeConcept(c)" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="concepts.length"
            class="flex items-center justify-between border-t-2 border-default bg-elevated/50 px-4 py-2.5">
            <span class="text-xs font-medium text-muted">{{ F.concepts.total }}</span>
            <span class="text-sm font-semibold tabular-nums text-highlighted">{{ formatMoney(totalAmount) }}</span>
          </div>
        </UCard>

        <!-- ⑤ Programa de obra ────────────────────────────────────────────── -->
        <UCard v-if="concepts.length > 0 && derivedPeriods.length > 0" id="sec-schedule" class="scroll-mt-16"
          :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-chart-gantt" class="size-4 text-muted" />
              {{ F.sections.schedule }}
            </div>
          </template>

          <p class="border-b border-default px-4 py-2 text-xs text-muted">{{ F.schedule.hint }}</p>

          <!-- Period tabs ──────────────────────────────────────────────────── -->
          <div class="flex overflow-x-auto border-b border-default bg-elevated/30">
            <button v-for="(period, pi) in derivedPeriods" :key="pi"
              class="shrink-0 border-b-2 px-4 py-2 text-sm transition-colors" :class="activePeriodTab === pi
                ? 'border-primary font-semibold text-primary'
                : 'border-transparent text-muted hover:text-default'" @click="activePeriodTab = pi">
              <span class="font-semibold">P{{ pi + 1 }}</span>
              <span class="ml-1.5 text-[11px] font-normal opacity-70">
                {{ period.end.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) }}
              </span>
            </button>
          </div>

          <!-- Active period input ──────────────────────────────────────────── -->
          <div v-if="derivedPeriods[activePeriodTab]" class="px-4 py-3">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div class="text-xs text-muted">
                {{ derivedPeriods[activePeriodTab].start.toLocaleDateString('es-MX', {
                  day: '2-digit', month: 'long', year: 'numeric'
                }) }}
                –
                {{ derivedPeriods[activePeriodTab].end.toLocaleDateString('es-MX', {
                  day: '2-digit', month: 'long', year: 'numeric'
                }) }}
              </div>
              <USelect v-model="pickerValue" :items="pickerItems" :placeholder="F.schedule.addConcept"
                icon="i-lucide-plus" class="w-full sm:w-72" :disabled="!pickerItems.length" />
            </div>

            <div v-if="!activeConceptsInPeriodCount"
              class="rounded-lg border border-dashed border-default px-4 py-6 text-center text-xs text-muted">
              {{ F.schedule.emptyPeriod }}
            </div>

            <!-- Grouped by section ─────────────────────────────────────────── -->
            <div v-else class="space-y-4">
              <!-- Section groups -->
              <template v-for="(sec, si) in catalogSections" :key="si">
                <div v-if="activeConceptsInPeriodSection(si).length">
                  <div class="mb-1.5 flex items-center gap-2">
                    <span class="font-mono text-xs font-semibold text-muted">{{ sec.specificationNumber }}</span>
                    <span class="text-sm font-semibold text-highlighted">{{ sec.description }}</span>
                  </div>
                  <div class="space-y-1.5">
                    <div v-for="{ c, ci } in activeConceptsInPeriodSection(si)" :key="c._key"
                      class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-default px-3 py-2">
                      <div class="min-w-0 flex-1">
                        <span class="font-mono text-xs text-muted">{{ c.specificationNumber }}</span>
                        <span class="ml-2 text-sm text-highlighted">{{ c.description }}</span>
                      </div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <UInput v-model="scheduleGrid[ci][activePeriodTab]" type="number" min="0" step="1"
                          class="w-24 [&_input]:text-right [&_input]:text-success [&_input]:font-medium" />
                        <span class="text-xs text-muted">{{ c.unit }}</span>
                      </div>
                      <div class="shrink-0 text-xs text-muted tabular-nums">
                        {{ F.schedule.contracted }}: <span class="font-medium text-highlighted">{{ parseFloat(c._qtyRaw)
                          || 0 }}</span>
                      </div>
                      <div class="shrink-0 text-xs tabular-nums"
                        :class="scheduleErrors[ci] ? 'text-error' : 'text-muted'">
                        {{ F.schedule.scheduledTotal }}:
                        <span class="font-medium">{{ Math.round(conceptTotals[ci] ?? 0) }} / {{ parseFloat(c._qtyRaw)
                          || 0 }}</span>
                      </div>
                      <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost"
                        :aria-label="F.schedule.removeFromPeriod" @click="removeConceptFromPeriod(ci)" />
                    </div>
                  </div>
                </div>
              </template>

              <!-- Concepts without a section ──────────────────────────────── -->
              <div v-if="activeConceptsInPeriodSection(null).length">
                <div v-if="catalogSections.length" class="mb-1.5 text-sm font-semibold text-muted">
                  {{ F.concepts.noSection }}
                </div>
                <div class="space-y-1.5">
                  <div v-for="{ c, ci } in activeConceptsInPeriodSection(null)" :key="c._key"
                    class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-default px-3 py-2">
                    <div class="min-w-0 flex-1">
                      <span class="font-mono text-xs text-muted">{{ c.specificationNumber }}</span>
                      <span class="ml-2 text-sm text-highlighted">{{ c.description }}</span>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                      <UInput v-model="scheduleGrid[ci][activePeriodTab]" type="number" min="0" step="1"
                        class="w-24 [&_input]:text-right [&_input]:text-success [&_input]:font-medium" />
                      <span class="text-xs text-muted">{{ c.unit }}</span>
                    </div>
                    <div class="shrink-0 text-xs text-muted tabular-nums">
                      {{ F.schedule.contracted }}: <span class="font-medium text-highlighted">{{ parseFloat(c._qtyRaw)
                        || 0
                      }}</span>
                    </div>
                    <div class="shrink-0 text-xs tabular-nums"
                      :class="scheduleErrors[ci] ? 'text-error' : 'text-muted'">
                      {{ F.schedule.scheduledTotal }}:
                      <span class="font-medium">{{ Math.round(conceptTotals[ci] ?? 0) }} / {{ parseFloat(c._qtyRaw) ||
                        0
                      }}</span>
                    </div>
                    <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost"
                      :aria-label="F.schedule.removeFromPeriod" @click="removeConceptFromPeriod(ci)" />
                  </div>
                </div>
              </div>
            </div>

            <!-- Overall totals across every period (all concepts, not just this tab) -->
            <div class="mt-4 border-t border-default pt-3 text-xs text-muted space-y-0.5">
              <p class="mb-1 font-medium text-muted">{{ F.schedule.overallTotals }}</p>
              <div v-for="(c, ci) in concepts" :key="c._key" class="flex items-center justify-between"
                :class="scheduleErrors[ci] ? 'text-error' : ''">
                <span class="truncate">{{ c.description || `Concepto ${ci + 1}` }}</span>
                <span class="shrink-0 tabular-nums ml-4">
                  {{ Math.round(conceptTotals[ci] ?? 0) }} / {{ parseFloat(c._qtyRaw) || 0 }} {{ c.unit }}
                  <span v-if="scheduleErrors[ci]" class="ml-1 text-error">⚠</span>
                </span>
              </div>
            </div>
          </div>

          <!-- Errors and all-clear ─────────────────────────────────────────── -->
          <div v-if="scheduleErrors.some(Boolean)" class="border-t border-default px-4 py-2 space-y-0.5">
            <p v-for="(err, ci) in scheduleErrors" :key="ci" class="text-xs text-error">
              <template v-if="err">
                <span class="font-mono">{{ concepts[ci]?.specificationNumber }}</span>: {{ err }}
              </template>
            </p>
          </div>
          <p v-else-if="scheduleValid" class="border-t border-default px-4 py-2 text-xs text-success">
            ✓ {{ F.schedule.allClear }}
          </p>

          <!-- Gantt preview ───────────────────────────────────────────────── -->
          <div v-if="ganttRows.length" class="border-t border-default px-4 py-4">
            <p class="mb-3 text-sm font-medium text-default">{{ F.schedule.ganttTitle }}</p>
            <GanttChart :rows="ganttRows" :period-count="derivedPeriods.length"
              :height="Math.max(160, ganttRows.length * 36 + 60)" />
          </div>
        </UCard>

        <UAlert v-if="submitError" :title="submitError" color="error" variant="soft" icon="i-lucide-alert-triangle" />

        <!-- Sticky submit bar -->
        <div
          class="sticky bottom-0 -mx-4 mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-default bg-default/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div class="flex flex-col">
            <span class="text-xs text-muted">{{ F.concepts.total }}</span>
            <span class="text-lg font-semibold tabular-nums text-primary">{{ formatMoney(totalAmount) }}</span>
          </div>
          <div class="flex items-center gap-3">
            <span v-if="!canSubmit" class="hidden max-w-xs truncate text-xs text-muted sm:inline">
              {{ Object.values(errors).find(Boolean) }}
            </span>
            <UButton color="neutral" variant="ghost" to="/">{{ S.common.cancel }}</UButton>
            <UButton icon="i-lucide-folder-plus" :loading="loading" :disabled="!canSubmit" @click="onSubmit">
              {{ F.submit }}
            </UButton>
          </div>
        </div>
      </div>

      <!-- ══════════════════════════════════════════════════════════════════
           PHASE 2 — file upload (contract already created)
      ══════════════════════════════════════════════════════════════════════ -->
      <div v-else-if="phase === 'upload'" class="space-y-6">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-folder-open" class="size-4 text-muted" />
                {{ F.files.title }}
              </div>
              <UBadge :label="F.files.requiredBadge" color="warning" variant="subtle" size="sm" />
            </div>
          </template>

          <p class="mb-4 text-sm text-muted">{{ F.files.hint }}</p>

          <!-- Drop zone -->
          <div
            class="relative mb-4 flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors"
            :class="isDragging ? 'border-primary bg-primary/5' : 'border-default bg-elevated/40 hover:border-primary/50'"
            @dragover.prevent="isDragging = true" @dragleave.prevent="isDragging = false" @drop.prevent="onDrop"
            @click="($refs.fileInput as HTMLInputElement).click()">
            <UIcon name="i-lucide-upload-cloud" class="size-8 text-muted" />
            <p class="text-sm text-muted">
              {{ isDragging ? F.files.dropzoneActive : F.files.dropzone }}
            </p>
            <input ref="fileInput" type="file" multiple class="sr-only" @change="onFileInput" />
          </div>

          <!-- Queue -->
          <ul v-if="uploadQueue.length" class="mb-4 divide-y divide-default rounded-lg border border-default">
            <li v-for="entry in uploadQueue" :key="entry.id" class="flex items-center gap-3 px-3 py-2.5">
              <UIcon :name="entry.status === 'done' ? 'i-lucide-check-circle-2'
                : entry.status === 'error' ? 'i-lucide-alert-circle'
                  : entry.status === 'uploading' ? 'i-lucide-loader-circle'
                    : 'i-lucide-file'" class="size-4 shrink-0" :class="entry.status === 'done' ? 'text-success'
                      : entry.status === 'error' ? 'text-error'
                        : entry.status === 'uploading' ? 'text-primary animate-spin'
                          : 'text-muted'" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-sm text-highlighted">{{ entry.file.name }}</span>
                  <span class="shrink-0 text-xs text-muted">{{ formatBytes(entry.file.size) }}</span>
                </div>
                <!-- Progress bar while uploading -->
                <div v-if="entry.status === 'uploading'"
                  class="mt-1 h-1 w-full overflow-hidden rounded-full bg-elevated">
                  <div class="h-full rounded-full bg-primary transition-all"
                    :style="`width:${Math.round(entry.progress * 100)}%`" />
                </div>
                <p v-if="entry.status === 'error'" class="mt-0.5 text-xs text-error">{{ entry.errorMsg }}</p>
              </div>
              <UButton v-if="entry.status === 'queued' || entry.status === 'error'" icon="i-lucide-x" size="xs"
                color="neutral" variant="ghost" :aria-label="F.files.removeQueued" @click="removeQueued(entry.id)" />
              <UButton v-if="entry.status === 'error'" icon="i-lucide-refresh-cw" size="xs" color="neutral"
                variant="ghost" @click="uploadOne(entry)" />
            </li>
          </ul>

          <div class="flex flex-wrap items-center justify-between gap-3">
            <UButton v-if="uploadQueue.some((e) => e.status === 'queued')" icon="i-lucide-upload" color="neutral"
              variant="outline" :loading="anyUploading" @click="uploadAll">
              {{ F.files.uploadAll }}
            </UButton>
            <div v-else />

            <div class="flex flex-col items-end gap-1">
              <UButton icon="i-lucide-arrow-right" :disabled="!allDone" :to="`/contracts/${createdContractId}`">
                {{ F.files.finalize }}
              </UButton>
              <span v-if="!allDone" class="text-xs text-muted">{{ F.files.required }}</span>
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>