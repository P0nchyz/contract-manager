<!-- app/pages/contracts/new.vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import type { CreateConceptInput } from '~/data/repositories/types'

definePageMeta({ requiredPermission: 'contract:create' })

const F = S.newContract

const repos = useRepositories()

// ─── Reference data ──────────────────────────────────────────────────────────
const { data: refs, status: refsStatus } = await useAsyncData('contract-new-refs', async () => {
  const [users, corporations] = await Promise.all([
    repos.users.list(),
    repos.corporations.list(),
  ])
  return {
    superintendents: users.filter((u) => u.role === 'superintendent' && u.active),
    supervisors:     users.filter((u) => u.role === 'supervisor'     && u.active),
    financials:      users.filter((u) => u.role === 'financial'      && u.active),
    corporations,
  }
})

// ─── Two-phase state ─────────────────────────────────────────────────────────
// Phase 'form'   → fill in the contract form, submit → create the contract
// Phase 'upload' → contract exists, user uploads files then navigates away
type Phase = 'form' | 'upload'
const phase = ref<Phase>('form')
const createdContractId = ref<string | null>(null)
const contractFolderId  = ref<string | null>(null) // predefined 'contract' folder

// ─── Form: section 1 — general ───────────────────────────────────────────────
const code      = ref('')
const title     = ref('')
const startDate = ref('')
const endDate   = ref('')

// ─── Form: section 2 — rates + periodicity ───────────────────────────────────
const anticipoPct  = ref<number | ''>(20)
const ivaRate      = ref<number | ''>(16)
const retentionPct = ref<number | ''>(5)
const periodicity  = ref<'monthly' | 'biweekly'>('monthly')

const periodicityOptions = [
  { label: F.fields.periodicityMonthly,   value: 'monthly'   as const },
  { label: F.fields.periodicityBiweekly,  value: 'biweekly'  as const },
]

// ─── Form: section 3 — parties ───────────────────────────────────────────────
const superintendentId = ref<string | null>(null)
const supervisorId     = ref<string | null>(null)
const financialId      = ref<string | null>(null)

const selectedSup = computed(() =>
  refs.value?.superintendents.find((u) => u.id === superintendentId.value) ?? null,
)
const corpName = computed(() =>
  selectedSup.value?.corporationId
    ? (refs.value?.corporations.find((c) => c.id === selectedSup.value!.corporationId)?.name ?? null)
    : null,
)
const contractorCorporationId = computed(() => selectedSup.value?.corporationId ?? null)

// ─── Form: section 3.5 — catalog sections ────────────────────────────────────
import type { CreateConceptSectionInput } from '~/data/repositories/types'

type SectionDraft = CreateConceptSectionInput & { _startRaw: string; _endRaw: string }
const catalogSections = ref<SectionDraft[]>([])

function addSection() {
  catalogSections.value.push({
    specificationNumber: '',
    description: '',
    startDate: new Date(),
    endDate: new Date(),
    order: catalogSections.value.length,
    _startRaw: '',
    _endRaw: '',
  })
}
function removeSection(idx: number) {
  const removed = catalogSections.value[idx]
  catalogSections.value.splice(idx, 1)
  // Re-order
  catalogSections.value.forEach((s, i) => { s.order = i })
  // Unassign concepts that were in this section
  concepts.value.forEach((c) => { if ((c as any)._sectionIdx === idx) (c as any)._sectionIdx = null })
}

const resolvedSections = computed<CreateConceptSectionInput[]>(() =>
  catalogSections.value.map((s, i) => ({
    specificationNumber: s.specificationNumber.trim(),
    description: s.description.trim(),
    startDate: s._startRaw ? new Date(`${s._startRaw}T12:00:00`) : new Date(),
    endDate:   s._endRaw   ? new Date(`${s._endRaw}T12:00:00`)   : new Date(),
    order: i,
  })),
)

const sectionErrors = computed(() =>
  catalogSections.value.map((s) => {
    const spec  = s.specificationNumber.trim() ? '' : S.conceptSections.validation.specRequired
    const desc  = s.description.trim()         ? '' : S.conceptSections.validation.descRequired
    let dates = ''
    if (!s._startRaw || !s._endRaw) {
      dates = S.conceptSections.validation.datesRequired
    } else if (s._startRaw >= s._endRaw) {
      dates = S.conceptSections.validation.endBeforeStart
    } else if (startDate.value && s._startRaw < startDate.value) {
      dates = S.conceptSections.validation.startBeforeContract
    } else if (endDate.value && s._endRaw > endDate.value) {
      dates = S.conceptSections.validation.endAfterContract
    }
    return { spec, desc, dates }
  }),
)

// ─── Form: section 4 — concepts ──────────────────────────────────────────────
type ConceptDraft = CreateConceptInput & { _qtyRaw: string; _priceRaw: string; _sectionIdx: number | null }
const concepts = ref<ConceptDraft[]>([])

function addConcept() {
  concepts.value.push({ specificationNumber: '', description: '', unit: '', contractedQuantity: 0, unitPrice: 0, _qtyRaw: '', _priceRaw: '', _sectionIdx: null, sectionId: null })
}
function removeConcept(idx: number) {
  concepts.value.splice(idx, 1)
  scheduleItems.value = scheduleItems.value
    .filter((s) => s.conceptIndex !== idx)
    .map((s) => ({ ...s, conceptIndex: s.conceptIndex > idx ? s.conceptIndex - 1 : s.conceptIndex }))
}

const resolvedConcepts = computed<CreateConceptInput[]>(() =>
  concepts.value.map((c) => ({
    specificationNumber: c.specificationNumber.trim(),
    description:         c.description.trim(),
    unit:                c.unit.trim(),
    contractedQuantity:  parseFloat(c._qtyRaw) || 0,
    unitPrice:           Math.round((parseFloat(c._priceRaw) || 0) * 100),
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
    spec:  c.specificationNumber.trim() ? '' : F.concepts.validation.specRequired,
    desc:  c.description.trim()         ? '' : F.concepts.validation.descRequired,
    unit:  c.unit.trim()                ? '' : F.concepts.validation.unitRequired,
    qty:   parseFloat(c._qtyRaw)  > 0  ? '' : F.concepts.validation.qtyPositive,
    price: parseFloat(c._priceRaw) > 0 ? '' : F.concepts.validation.pricePositive,
  })),
)
const conceptsValid = computed(() =>
  concepts.value.length > 0 &&
  conceptErrors.value.every((e) => !e.spec && !e.desc && !e.unit && !e.qty && !e.price),
)

// ─── Form: section 5 — schedule ──────────────────────────────────────────────
type ScheduleDraft = { conceptIndex: number; startRaw: string; endRaw: string }
const scheduleItems = ref<ScheduleDraft[]>([])

watch(() => concepts.value.length, (newLen, oldLen) => {
  if (newLen > oldLen) scheduleItems.value.push({ conceptIndex: newLen - 1, startRaw: '', endRaw: '' })
})

const contractStartDate = computed(() => startDate.value ? new Date(`${startDate.value}T12:00:00`) : null)
const contractEndDate   = computed(() => endDate.value   ? new Date(`${endDate.value}T12:00:00`)   : null)

const scheduleErrors = computed(() =>
  scheduleItems.value.map((s) => {
    const start = s.startRaw ? new Date(`${s.startRaw}T12:00:00`) : null
    const end   = s.endRaw   ? new Date(`${s.endRaw}T12:00:00`)   : null
    if (!start) return F.schedule.validation.startRequired
    if (!end)   return F.schedule.validation.endRequired
    if (start > end) return F.schedule.validation.startAfterEnd
    if (contractStartDate.value && start < contractStartDate.value) return F.schedule.validation.startAfterContract
    if (contractEndDate.value   && end   > contractEndDate.value)   return F.schedule.validation.endBeforeContract
    // Bug 2: validate against the concept's assigned section period
    const concept = concepts.value[s.conceptIndex]
    const sectionIdx = concept?._sectionIdx
    if (sectionIdx != null) {
      const sec = catalogSections.value[sectionIdx]
      if (sec?._startRaw && s.startRaw && s.startRaw < sec._startRaw)
        return S.conceptSections.validation.startBeforeSection
      if (sec?._endRaw && s.endRaw && s.endRaw > sec._endRaw)
        return S.conceptSections.validation.endAfterSection
    }
    return null
  }),
)

const ganttRows = computed(() =>
  scheduleItems.value.map((s) => ({
    label:     concepts.value[s.conceptIndex]?.description || `Concepto ${s.conceptIndex + 1}`,
    startDate: s.startRaw ? new Date(`${s.startRaw}T12:00:00`) : null,
    endDate:   s.endRaw   ? new Date(`${s.endRaw}T12:00:00`)   : null,
    amount:    resolvedConcepts.value[s.conceptIndex]
                 ? resolvedConcepts.value[s.conceptIndex].unitPrice * resolvedConcepts.value[s.conceptIndex].contractedQuantity
                 : 0,
  })),
)

// ─── Validation ───────────────────────────────────────────────────────────────
const errors = computed(() => ({
  code:          !code.value.trim()  ? F.validation.codeRequired  : null,
  title:         !title.value.trim() ? F.validation.titleRequired : null,
  dates:         (!startDate.value || !endDate.value) ? F.validation.datesRequired
                 : startDate.value >= endDate.value ? F.validation.endBeforeStart : null,
  anticipo:      (anticipoPct.value === '' || Number(anticipoPct.value) < 0 || Number(anticipoPct.value) > 100) ? F.validation.anticipoRange  : null,
  iva:           (ivaRate.value     === '' || Number(ivaRate.value)     < 0 || Number(ivaRate.value)     > 100) ? F.validation.ivaRange        : null,
  retention:     (retentionPct.value === '' || Number(retentionPct.value) < 0 || Number(retentionPct.value) > 100) ? F.validation.retentionRange : null,
  superintendent: !superintendentId.value ? F.validation.superintendentRequired : null,
  supervisor:     !supervisorId.value     ? F.validation.supervisorRequired     : null,
  concepts:       !conceptsValid.value    ? F.validation.conceptsRequired       : null,
  schedule:       scheduleErrors.value.some(Boolean)
                    ? (scheduleErrors.value.some((e) => e?.includes('fuera') || e?.includes('≥') || e?.includes('≤'))
                        ? F.validation.scheduleOutOfRange
                        : F.validation.scheduleRequired)
                    : null,
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
      code:  code.value.trim(),
      title: title.value.trim(),
      anticipoPercentage:  Number(anticipoPct.value),
      ivaRate:             Number(ivaRate.value),
      retentionPercentage: Number(retentionPct.value),
      estimatePeriodicity: periodicity.value,
      startDate: new Date(`${startDate.value}T12:00:00`),
      endDate:   new Date(`${endDate.value}T12:00:00`),
      superintendentId: superintendentId.value as string,
      supervisorId:     supervisorId.value     as string,
      financialId:      financialId.value,
      contractorCorporationId: contractorCorporationId.value,
      initialSections: resolvedSections.value,
      initialConcepts: resolvedConcepts.value,
      scheduleItems: scheduleItems.value.map((s) => ({
        conceptIndex: s.conceptIndex,
        startDate: new Date(`${s.startRaw}T12:00:00`),
        endDate:   new Date(`${s.endRaw}T12:00:00`),
      })),
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
const isDragging  = ref(false)
let   _entryId = 0

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
  ;(e.target as HTMLInputElement).value = ''
}
function removeQueued(id: string) {
  uploadQueue.value = uploadQueue.value.filter((e) => e.id !== id)
}

const anyUploading = computed(() => uploadQueue.value.some((e) => e.status === 'uploading'))
const allDone      = computed(() => uploadQueue.value.length > 0 && uploadQueue.value.every((e) => e.status === 'done'))

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
  if (n < 1024)        return `${n} B`
  if (n < 1_048_576)   return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1_048_576).toFixed(1)} MB`
}

const sections = [
  { id: 'sec-general',   label: F.sections.general },
  { id: 'sec-rates',     label: F.sections.rates },
  { id: 'sec-parties',   label: F.sections.parties },
  { id: 'sec-cat-secs',  label: 'Secciones' },
  { id: 'sec-concepts',  label: F.sections.concepts },
  { id: 'sec-schedule',  label: F.sections.schedule },
]
</script>

<template>
  <UDashboardPanel id="contract-new">
    <template #header>
      <UDashboardNavbar :title="F.title">
        <template #leading>
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            :to="phase === 'upload' && createdContractId ? `/contracts/${createdContractId}` : '/'"
            :aria-label="S.common.back"
          />
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
      <div v-else-if="phase === 'form'" class="flex flex-col gap-6">
        <!-- Section nav -->
        <nav class="sticky top-0 z-10 -mx-4 mb-2 flex gap-1 overflow-x-auto border-b border-default bg-default/75 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
          <a
            v-for="s in sections"
            :key="s.id"
            :href="`#${s.id}`"
            class="shrink-0 rounded-md px-2.5 py-1 text-sm text-muted transition-colors hover:bg-elevated hover:text-default"
          >
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

        <!-- ② Tasas, retenciones y periodicidad -->
        <UCard id="sec-rates" class="scroll-mt-16">
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-percent" class="size-4 text-muted" />
              {{ F.sections.rates }}
            </div>
          </template>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <UFormField :label="F.fields.anticipoPercentage" :error="errors.anticipo || undefined">
              <UInput v-model.number="anticipoPct" type="number" min="0" max="100" step="1" class="w-full">
                <template #trailing><span class="pr-2 text-sm text-muted">%</span></template>
              </UInput>
            </UFormField>
            <UFormField :label="F.fields.ivaRate" :error="errors.iva || undefined">
              <UInput v-model.number="ivaRate" type="number" min="0" max="100" step="1" class="w-full">
                <template #trailing><span class="pr-2 text-sm text-muted">%</span></template>
              </UInput>
            </UFormField>
            <UFormField :label="F.fields.retentionPercentage" :error="errors.retention || undefined">
              <UInput v-model.number="retentionPct" type="number" min="0" max="100" step="0.1" class="w-full">
                <template #trailing><span class="pr-2 text-sm text-muted">%</span></template>
              </UInput>
            </UFormField>
            <div class="flex flex-col justify-center">
              <p class="text-xs text-muted">
                <span class="font-medium">{{ F.fields.cincoAlMillar }}:</span>
                {{ F.fields.cincoAlMillarFixed }}
              </p>
            </div>
            <div class="sm:col-span-2 lg:col-span-4">
              <UFormField :label="F.fields.estimatePeriodicity">
                <div class="flex flex-wrap gap-3">
                  <label
                    v-for="opt in periodicityOptions"
                    :key="opt.value"
                    class="flex cursor-pointer items-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm transition-colors"
                    :class="periodicity === opt.value
                      ? 'border-primary bg-primary/5 text-primary font-medium'
                      : 'border-default bg-default text-default hover:bg-elevated'"
                  >
                    <input
                      v-model="periodicity"
                      type="radio"
                      :value="opt.value"
                      class="sr-only"
                    />
                    <UIcon
                      :name="opt.value === 'monthly' ? 'i-lucide-calendar' : 'i-lucide-calendar-days'"
                      class="size-4"
                    />
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
            <UFormField :label="F.fields.superintendent" :error="errors.superintendent || undefined">
              <USelect
                v-model="superintendentId"
                :items="(refs?.superintendents ?? []).map((u) => ({ label: u.fullName, value: u.id }))"
                :placeholder="`— ${F.fields.superintendent} —`"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="F.fields.contractor" :hint="F.fields.contractorDerived">
              <UInput :model-value="corpName ?? ''" disabled class="w-full" :placeholder="F.fields.contractorDerived" />
            </UFormField>
            <UFormField :label="F.fields.supervisor" :error="errors.supervisor || undefined">
              <USelect
                v-model="supervisorId"
                :items="(refs?.supervisors ?? []).map((u) => ({ label: u.fullName, value: u.id }))"
                :placeholder="`— ${F.fields.supervisor} —`"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="F.fields.financial">
              <USelect
                v-model="financialId"
                :items="(refs?.financials ?? []).map((u) => ({ label: u.fullName, value: u.id }))"
                :placeholder="`— ${F.fields.financial} —`"
                class="w-full"
              />
            </UFormField>
          </div>
        </UCard>

        <!-- ③.5 Secciones del catálogo -->
        <UCard id="sec-cat-secs" class="scroll-mt-16" :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-layers" class="size-4 text-muted" />
                {{ S.conceptSections.addSection }} ({{ catalogSections.length }})
              </div>
              <UButton size="sm" icon="i-lucide-plus" color="neutral" variant="outline" @click="addSection">
                {{ S.conceptSections.addSection }}
              </UButton>
            </div>
          </template>
          <div v-if="!catalogSections.length" class="px-4 py-6 text-sm text-muted">
            Las secciones son opcionales. Si las agregas, los conceptos quedarán agrupados.
          </div>
          <div v-else class="divide-y divide-default">
            <div v-for="(sec, idx) in catalogSections" :key="idx" class="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-5">
              <UFormField :label="S.conceptSections.specificationNumber" :error="sectionErrors[idx]?.spec || undefined">
                <UInput v-model="sec.specificationNumber" class="w-full" placeholder="A" />
              </UFormField>
              <UFormField :label="S.conceptSections.description" :error="sectionErrors[idx]?.desc || undefined" class="lg:col-span-2">
                <UInput v-model="sec.description" class="w-full" placeholder="Trabajos preliminares" />
              </UFormField>
              <UFormField :label="S.conceptSections.from" :error="sectionErrors[idx]?.dates || undefined">
                <UInput v-model="sec._startRaw" type="date" :min="startDate" :max="endDate" class="w-full" />
              </UFormField>
              <div class="flex items-end gap-2">
                <UFormField :label="S.conceptSections.to" class="flex-1">
                  <UInput v-model="sec._endRaw" type="date" :min="sec._startRaw || startDate" :max="endDate" class="w-full" />
                </UFormField>
                <UButton icon="i-lucide-x" size="sm" color="neutral" variant="ghost" class="mb-0.5" @click="removeSection(idx)" />
              </div>
            </div>
          </div>
        </UCard>

        <!-- ④ Catálogo de conceptos -->
        <UCard id="sec-concepts" class="scroll-mt-16" :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-list" class="size-4 text-muted" />
                {{ F.sections.concepts }}
              </div>
              <UButton size="sm" icon="i-lucide-plus" color="neutral" variant="outline" @click="addConcept">
                {{ F.concepts.add }}
              </UButton>
            </div>
          </template>
          <p class="border-b border-default px-4 py-2 text-xs text-muted">{{ F.concepts.hint }}</p>
          <div v-if="!concepts.length" class="px-4 py-8 text-center text-sm text-muted">
            {{ F.concepts.empty }}
          </div>
          <div v-else class="overflow-x-auto">
            <table class="w-full min-w-[52rem] text-sm">
              <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                <tr>
                  <th class="px-3 py-2 text-left font-medium">{{ F.concepts.columns.specification }}</th>
                  <th class="px-3 py-2 text-left font-medium">{{ F.concepts.columns.description }}</th>
                  <th class="px-3 py-2 text-left font-medium">{{ F.concepts.columns.unit }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ F.concepts.columns.qty }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ F.concepts.columns.unitPrice }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ F.concepts.columns.amount }}</th>
                  <th v-if="catalogSections.length" class="px-3 py-2 text-left font-medium">Sección</th>
                  <th class="px-2 py-2" />
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-for="(c, idx) in concepts" :key="idx" class="align-top">
                  <td class="px-3 py-2">
                    <UInput v-model="c.specificationNumber" class="w-28" placeholder="E-101" :color="conceptErrors[idx]?.spec ? 'error' : undefined" />
                    <p v-if="conceptErrors[idx]?.spec" class="mt-0.5 text-xs text-error">{{ conceptErrors[idx].spec }}</p>
                  </td>
                  <td class="min-w-[14rem] px-3 py-2">
                    <UInput v-model="c.description" class="w-full" :color="conceptErrors[idx]?.desc ? 'error' : undefined" />
                    <p v-if="conceptErrors[idx]?.desc" class="mt-0.5 text-xs text-error">{{ conceptErrors[idx].desc }}</p>
                  </td>
                  <td class="px-3 py-2">
                    <UInput v-model="c.unit" class="w-20" placeholder="m2" :color="conceptErrors[idx]?.unit ? 'error' : undefined" />
                    <p v-if="conceptErrors[idx]?.unit" class="mt-0.5 text-xs text-error">{{ conceptErrors[idx].unit }}</p>
                  </td>
                  <td class="px-3 py-2">
                    <UInput v-model="c._qtyRaw" type="number" min="0" step="any" class="w-24 [&_input]:text-right" :color="conceptErrors[idx]?.qty ? 'error' : undefined" />
                    <p v-if="conceptErrors[idx]?.qty" class="mt-0.5 text-xs text-error">{{ conceptErrors[idx].qty }}</p>
                  </td>
                  <td class="px-3 py-2">
                    <UInput v-model="c._priceRaw" type="number" min="0" step="0.01" class="w-32 [&_input]:text-right" :color="conceptErrors[idx]?.price ? 'error' : undefined">
                      <template #leading><span class="pl-1 text-xs text-muted">$</span></template>
                    </UInput>
                    <p v-if="conceptErrors[idx]?.price" class="mt-0.5 text-xs text-error">{{ conceptErrors[idx].price }}</p>
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums text-muted">
                    {{ formatMoney(Math.round((parseFloat(c._priceRaw) || 0) * 100) * (parseFloat(c._qtyRaw) || 0)) }}
                  </td>
                  <td v-if="catalogSections.length" class="px-3 py-2">
                    <USelect
                      v-model="c._sectionIdx"
                      :items="[
                        { label: '— Sin sección —', value: null },
                        ...catalogSections.map((s, i) => ({ label: `${s.specificationNumber || i+1} ${s.description}`, value: i }))
                      ]"
                      class="w-40"
                    />
                  </td>
                  <td class="px-2 py-2">
                    <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" @click="removeConcept(idx)" />
                  </td>
                </tr>
              </tbody>
              <tfoot class="border-t-2 border-default bg-elevated/50">
                <tr>
                  <td colspan="5" class="px-3 py-2 text-right text-xs font-medium text-muted">{{ F.concepts.total }}</td>
                  <td class="px-3 py-2 text-right tabular-nums font-semibold text-highlighted">{{ formatMoney(totalAmount) }}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </UCard>

        <!-- ⑤ Programa de obra -->
        <UCard v-if="concepts.length > 0" id="sec-schedule" class="scroll-mt-16" :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-chart-gantt" class="size-4 text-muted" />
              {{ F.sections.schedule }}
            </div>
          </template>
          <p class="border-b border-default px-4 py-2 text-xs text-muted">{{ F.schedule.hint }}</p>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[42rem] text-sm">
              <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                <tr>
                  <th class="px-3 py-2 text-left font-medium">{{ F.schedule.columns.concept }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ F.schedule.columns.amount }}</th>
                  <th class="px-3 py-2 text-center font-medium text-success">{{ F.schedule.columns.start }}</th>
                  <th class="px-3 py-2 text-center font-medium text-success">{{ F.schedule.columns.end }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ F.schedule.columns.duration }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-for="(s, idx) in scheduleItems" :key="s.conceptIndex" class="align-top" :class="scheduleErrors[idx] ? 'bg-error/5' : ''">
                  <td class="min-w-[12rem] px-3 py-2.5">
                    <div class="font-medium text-highlighted">{{ concepts[s.conceptIndex]?.description || `Concepto ${s.conceptIndex + 1}` }}</div>
                    <div class="font-mono text-xs text-muted">{{ concepts[s.conceptIndex]?.specificationNumber }}</div>
                  </td>
                  <td class="px-3 py-2.5 text-right tabular-nums text-muted">
                    {{ formatMoney((resolvedConcepts[s.conceptIndex]?.unitPrice ?? 0) * (resolvedConcepts[s.conceptIndex]?.contractedQuantity ?? 0)) }}
                  </td>
                  <td class="px-3 py-2.5">
                    <UInput v-model="s.startRaw" type="date" :min="startDate" :max="endDate" class="w-36 [&_input]:text-success" />
                  </td>
                  <td class="px-3 py-2.5">
                    <UInput v-model="s.endRaw" type="date" :min="s.startRaw || startDate" :max="endDate" class="w-36 [&_input]:text-success" />
                  </td>
                  <td class="px-3 py-2.5 text-right tabular-nums text-muted">
                    <template v-if="s.startRaw && s.endRaw">
                      {{ Math.round((new Date(`${s.endRaw}T12:00:00`).getTime() - new Date(`${s.startRaw}T12:00:00`).getTime()) / 86_400_000) }}
                    </template>
                    <span v-else>—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Per-row errors -->
          <div v-if="scheduleErrors.some(Boolean)" class="border-t border-default px-4 py-2 space-y-0.5">
            <p v-for="(err, idx) in scheduleErrors" :key="idx" class="text-xs text-error">
              <template v-if="err">
                <span class="font-mono">{{ concepts[scheduleItems[idx]?.conceptIndex]?.specificationNumber }}</span>: {{ err }}
              </template>
            </p>
          </div>
          <p v-else-if="scheduleItems.length && scheduleItems.every((s) => s.startRaw && s.endRaw)" class="border-t border-default px-4 py-2 text-xs text-success">
            ✓ {{ F.schedule.allClear }}
          </p>

          <!-- Gantt live preview -->
          <div v-if="ganttRows.some((r) => r.startDate)" class="border-t border-default px-4 py-4">
            <p class="mb-3 text-sm font-medium text-default">{{ F.schedule.ganttTitle }}</p>
            <GanttChart
              :rows="ganttRows"
              :contract-start="contractStartDate"
              :contract-end="contractEndDate"
              :height="Math.max(160, ganttRows.length * 36 + 60)"
            />
          </div>
        </UCard>

        <UAlert v-if="submitError" :title="submitError" color="error" variant="soft" icon="i-lucide-alert-triangle" />

        <!-- Sticky submit bar -->
        <div class="sticky bottom-0 -mx-4 mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-default bg-default/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
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
      <template v-else-if="phase === 'upload'">
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-folder-open" class="size-4 text-muted" />
              {{ F.files.title }}
            </div>
          </template>

          <p class="mb-4 text-sm text-muted">{{ F.files.hint }}</p>

          <!-- Drop zone -->
          <div
            class="relative mb-4 flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors"
            :class="isDragging ? 'border-primary bg-primary/5' : 'border-default bg-elevated/40 hover:border-primary/50'"
            @dragover.prevent="isDragging = true"
            @dragleave.prevent="isDragging = false"
            @drop.prevent="onDrop"
            @click="($refs.fileInput as HTMLInputElement).click()"
          >
            <UIcon name="i-lucide-upload-cloud" class="size-8 text-muted" />
            <p class="text-sm text-muted">
              {{ isDragging ? F.files.dropzoneActive : F.files.dropzone }}
            </p>
            <input
              ref="fileInput"
              type="file"
              multiple
              class="sr-only"
              @change="onFileInput"
            />
          </div>

          <!-- Queue -->
          <ul v-if="uploadQueue.length" class="mb-4 divide-y divide-default rounded-lg border border-default">
            <li
              v-for="entry in uploadQueue"
              :key="entry.id"
              class="flex items-center gap-3 px-3 py-2.5"
            >
              <UIcon
                :name="entry.status === 'done'      ? 'i-lucide-check-circle-2'
                       : entry.status === 'error'   ? 'i-lucide-alert-circle'
                       : entry.status === 'uploading' ? 'i-lucide-loader-circle'
                       : 'i-lucide-file'"
                class="size-4 shrink-0"
                :class="entry.status === 'done'  ? 'text-success'
                       : entry.status === 'error' ? 'text-error'
                       : entry.status === 'uploading' ? 'text-primary animate-spin'
                       : 'text-muted'"
              />
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-sm text-highlighted">{{ entry.file.name }}</span>
                  <span class="shrink-0 text-xs text-muted">{{ formatBytes(entry.file.size) }}</span>
                </div>
                <!-- Progress bar while uploading -->
                <div v-if="entry.status === 'uploading'" class="mt-1 h-1 w-full overflow-hidden rounded-full bg-elevated">
                  <div
                    class="h-full rounded-full bg-primary transition-all"
                    :style="`width:${Math.round(entry.progress * 100)}%`"
                  />
                </div>
                <p v-if="entry.status === 'error'" class="mt-0.5 text-xs text-error">{{ entry.errorMsg }}</p>
              </div>
              <UButton
                v-if="entry.status === 'queued' || entry.status === 'error'"
                icon="i-lucide-x"
                size="xs"
                color="neutral"
                variant="ghost"
                :aria-label="F.files.removeQueued"
                @click="removeQueued(entry.id)"
              />
              <UButton
                v-if="entry.status === 'error'"
                icon="i-lucide-refresh-cw"
                size="xs"
                color="neutral"
                variant="ghost"
                @click="uploadOne(entry)"
              />
            </li>
          </ul>

          <div class="flex flex-wrap items-center justify-between gap-3">
            <UButton
              v-if="uploadQueue.some((e) => e.status === 'queued')"
              icon="i-lucide-upload"
              color="neutral"
              variant="outline"
              :loading="anyUploading"
              @click="uploadAll"
            >
              {{ F.files.uploadAll }}
            </UButton>
            <div v-else />

            <div class="flex gap-3">
              <UButton
                v-if="!allDone"
                color="neutral"
                variant="ghost"
                :to="`/contracts/${createdContractId}`"
              >
                {{ F.files.skip }}
              </UButton>
              <UButton
                icon="i-lucide-arrow-right"
                :to="`/contracts/${createdContractId}`"
              >
                {{ F.files.finalize }}
              </UButton>
            </div>
          </div>
        </UCard>
      </template>
    </template>
  </UDashboardPanel>
</template>