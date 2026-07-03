<!-- app/pages/contracts/[contractId]/agreements/new.vue -->
<script setup lang="ts">
import { ref, computed, reactive, watch, watchEffect } from 'vue'
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import type { ConceptChange, NewConceptDraft, NewSectionDraft } from '~/data/models/agreements'
import type { ConceptId, FileAsset } from '~/data/models'

definePageMeta({ requiredPermission: 'agreement:create' })

const AG = S.agreement

const route = useRoute()
const repos = useRepositories()
const contractId = computed(() => route.params.contractId as string)
const editId = computed(() => (typeof route.query.edit === 'string' ? route.query.edit : null))
const isEdit = computed(() => !!editId.value)

const toInputDate = (d: Date | string | undefined) =>
  d ? new Date(d).toISOString().slice(0, 10) : ''

// ─── Data load ───────────────────────────────────────────────────────────────
const { data, status, error, refresh } = await useAsyncData(
  () => `agreement-form-${contractId.value}-${editId.value ?? 'new'}`,
  async () => {
    const [contract, sections, concepts, schedule, folders, files, editing] = await Promise.all([
      repos.contracts.getById(contractId.value),
      repos.concepts.listSectionsByContract(contractId.value),
      repos.concepts.listByContract(contractId.value),
      repos.schedule.getByContract(contractId.value).catch(() => null),
      repos.files.listFolders(contractId.value).catch(() => []),
      repos.files.listFiles(contractId.value).catch(() => []),
      editId.value ? repos.agreements.getById(editId.value).catch(() => null) : Promise.resolve(null),
    ])
    // Build a map of conceptId → schedule item for quick lookup
    const scheduleByConceptId: Record<string, (typeof schedule extends { entries: (infer I)[] } | null ? I : never)> = {}
    if (schedule) {
      for (const entry of (schedule.entries ?? [])) {
        if (entry.conceptId) scheduleByConceptId[String(entry.conceptId)] = entry
      }
    }
    return { contract, sections, concepts, groups: groupConceptsBySections(sections, concepts), scheduleByConceptId, folders, files, editing }
  },
)

// ─── Form state ──────────────────────────────────────────────────────────────
const description = ref('')
const conceptChanges = ref<(ConceptChange & {
  _newQtyRaw: string
  _newPriceRaw: string
})[]>([])
const newConcepts = ref<(NewConceptDraft & {
  _qtyRaw: string
  _priceRaw: string
})[]>([])
const newSections = ref<NewSectionDraft[]>([])
// Contract date overrides
const newContractStartRaw = ref('')
const newContractEndRaw = ref('')
const inited = ref(false)

watchEffect(() => {
  if (!data.value || inited.value) return
  const e = data.value.editing
  if (e) {
    description.value = e.description
    conceptChanges.value = e.conceptChanges.map((cc) => ({
      ...cc,
      _newQtyRaw: cc.newQuantity != null ? String(cc.newQuantity) : '',
      _newPriceRaw: cc.newUnitPrice != null ? String(cc.newUnitPrice / 100) : '',
    }))
    newConcepts.value = e.newConcepts.map((nc) => ({
      ...nc,
      _qtyRaw: String(nc.contractedQuantity),
      _priceRaw: String(nc.unitPrice / 100),
    }))
    newSections.value = (e.newSections ?? []).map((ns) => ({ ...ns }))
    if (e.newContractStartDate) newContractStartRaw.value = toInputDate(e.newContractStartDate)
    if (e.newContractEndDate) newContractEndRaw.value = toInputDate(e.newContractEndDate)
    existingAttachmentIds.value = [...(e.attachmentFileIds ?? [])]
  }
  inited.value = true
})

// ─── Concept picker ──────────────────────────────────────────────────────────
const pickerSearch = ref('')
const alreadyAdded = computed(() => new Set(conceptChanges.value.map((c) => c.conceptId)))
const pickerGroups = computed(() => {
  const q = pickerSearch.value.trim().toLowerCase()
  return (data.value?.groups ?? []).map((g) => ({
    ...g,
    concepts: g.concepts.filter(
      (c) =>
        !alreadyAdded.value.has(c.id) &&
        (!q || c.specificationNumber.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)),
    ),
  })).filter((g) => g.concepts.length > 0)
})

function addConceptChange(conceptId: ConceptId) {
  conceptChanges.value.push({
    conceptId,
    _newQtyRaw: '',
    _newPriceRaw: '',
  })
}

function removeConceptChange(idx: number) {
  conceptChanges.value.splice(idx, 1)
}

function addNewSection() {
  newSections.value.push({
    specificationNumber: '',
    description: '',
    order: (data.value?.sections.length ?? 0) + newSections.value.length,
  })
}
function removeNewSection(idx: number) {
  newSections.value.splice(idx, 1)
  // Clear sectionId on new concepts that referenced this new section by index
  newConcepts.value.forEach((nc) => {
    if ((nc.sectionId as any) === `new:${idx}`) nc.sectionId = null
    // Re-index references to sections after the removed one
    const ref = nc.sectionId as string | null
    if (ref?.startsWith('new:')) {
      const refIdx = parseInt(ref.slice(4), 10)
      if (refIdx > idx) (nc as any).sectionId = `new:${refIdx - 1}`
    }
  })
}

function addNewConcept() {
  newConcepts.value.push({
    specificationNumber: '',
    description: '',
    unit: '',
    unitPrice: 0,
    contractedQuantity: 0,
    sectionId: null,
    _qtyRaw: '',
    _priceRaw: '',
  })
}
function removeNewConcept(idx: number) {
  newConcepts.value.splice(idx, 1)
}

// ─── Attachments ─────────────────────────────────────────────────────────────
// Already-saved attachments (only populated when editing an existing draft)
const existingAttachmentIds = ref<string[]>([])
const existingAttachments = computed(() =>
  (data.value?.files ?? []).filter((f) => existingAttachmentIds.value.includes(f.id)),
)
function removeExistingAttachment(id: string) {
  existingAttachmentIds.value = existingAttachmentIds.value.filter((x) => x !== id)
}

// New files queued to upload on save
type AttachmentEntry = {
  id: string
  file: File
  status: 'queued' | 'uploading' | 'done' | 'error'
  progress: number
  uploadedFileId: string | null
  errorMsg: string | null
}
const attachmentEntries = ref<AttachmentEntry[]>([])
const isDraggingAttachment = ref(false)
let _attId = 0

function makeAttachmentEntry(f: File): AttachmentEntry {
  return { id: String(++_attId), file: f, status: 'queued', progress: 0, uploadedFileId: null, errorMsg: null }
}
function addAttachments(files: File[]) {
  attachmentEntries.value.push(...files.map(makeAttachmentEntry))
}
function removeAttachmentEntry(id: string) {
  attachmentEntries.value = attachmentEntries.value.filter((e) => e.id !== id)
}
function onAttachmentDrop(e: DragEvent) {
  isDraggingAttachment.value = false
  addAttachments(Array.from(e.dataTransfer?.files ?? []))
}
function onAttachmentInput(e: Event) {
  addAttachments(Array.from((e.target as HTMLInputElement).files ?? []))
    ; (e.target as HTMLInputElement).value = ''
}
function formatBytes(n: number) {
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1_048_576).toFixed(1)} MB`
}

// ─── Viewer ───────────────────────────────────────────────────────────────────
const viewerOpen = ref(false)
const viewingFile = ref<FileAsset | null>(null)
function openViewer(file: FileAsset) {
  viewingFile.value = file
  viewerOpen.value = true
}

// Upload all queued attachments; returns collected FileIds (existing + newly uploaded)
async function uploadAttachments(): Promise<string[]> {
  const contractFolder = (data.value?.folders ?? []).find((f) => f.kind === 'contract')
  const ids: string[] = [...existingAttachmentIds.value]
  for (const entry of attachmentEntries.value) {
    if (entry.status === 'done' && entry.uploadedFileId) {
      ids.push(entry.uploadedFileId)
      continue
    }
    if (entry.status === 'queued' || entry.status === 'error') {
      if (!contractFolder) {
        entry.status = 'error'
        entry.errorMsg = 'No se encontró la carpeta de documentos del contrato.'
        continue
      }
      entry.status = 'uploading'
      entry.progress = 0
      entry.errorMsg = null
      try {
        const asset = await repos.files.upload(
          { contractId: contractId.value, folderId: contractFolder.id, file: entry.file },
          (p) => { entry.progress = p },
        )
        entry.status = 'done'
        entry.progress = 1
        entry.uploadedFileId = asset.id
        ids.push(asset.id)
      } catch (err) {
        entry.status = 'error'
        entry.errorMsg = isRepositoryError(err) ? err.message : S.common.error
      }
    }
  }
  return ids
}

// ─── Derived payload ─────────────────────────────────────────────────────────
const resolvedChanges = computed<ConceptChange[]>(() =>
  conceptChanges.value.map((c) => {
    const qty = parseFloat(c._newQtyRaw)
    const price = parseFloat(c._newPriceRaw)
    return {
      conceptId: c.conceptId,
      newQuantity: isNaN(qty) ? undefined : qty,
      newUnitPrice: isNaN(price) ? undefined : Math.round(price * 100),
    }
  }),
)

const resolvedNewSections = computed<NewSectionDraft[]>(() =>
  newSections.value.map((ns, i) => ({
    specificationNumber: ns.specificationNumber.trim(),
    description: ns.description.trim(),
    order: (data.value?.sections.length ?? 0) + i,
  })),
)

const resolvedNewConcepts = computed<NewConceptDraft[]>(() =>
  newConcepts.value.map((nc) => ({
    specificationNumber: nc.specificationNumber.trim(),
    description: nc.description.trim(),
    unit: nc.unit.trim(),
    contractedQuantity: parseFloat(nc._qtyRaw) || 0,
    unitPrice: Math.round((parseFloat(nc._priceRaw) || 0) * 100),
    sectionId: nc.sectionId ?? null,

  })),
)

const newContractStartDate = computed(() =>
  newContractStartRaw.value ? new Date(`${newContractStartRaw.value}T12:00:00`) : null,
)
const newContractEndDate = computed(() =>
  newContractEndRaw.value ? new Date(`${newContractEndRaw.value}T12:00:00`) : null,
)

// Derived aggregate deltas shown in the summary
const derivedAmountDelta = computed(() => {
  let delta = 0
  for (const ch of resolvedChanges.value) {
    const orig = data.value?.concepts.find((c) => c.id === ch.conceptId)
    if (!orig) continue
    const oldAmt = orig.unitPrice * orig.contractedQuantity
    const newPrice = ch.unitPrice ?? orig.unitPrice
    const newQty = ch.contractedQuantity ?? orig.contractedQuantity
    delta += newPrice * newQty - oldAmt
  }
  for (const nc of resolvedNewConcepts.value) {
    delta += nc.unitPrice * nc.contractedQuantity
  }
  return delta === 0 ? null : delta
})

const derivedTimeDelta = computed(() => {
  // Time delta is now expressed via newContractEndDate only (no per-concept schedule dates)
  if (!newContractEndDate.value || !data.value?.contract?.endDate) return null
  const shift = Math.round(
    (newContractEndDate.value.getTime() - new Date(data.value.contract.endDate).getTime()) / 86_400_000,
  )
  return shift === 0 ? null : shift
})

const kind = computed(() => {
  const hasAmount = derivedAmountDelta.value != null
  const hasTime = derivedTimeDelta.value != null
  return hasAmount && hasTime ? 'mixed' : hasTime ? 'time' : hasAmount ? 'amount' : null
})

// ─── Validation ──────────────────────────────────────────────────────────────
const descError = computed(() =>
  description.value.trim() ? null : AG.validation.descriptionRequired,
)
const newConceptErrors = computed(() =>
  newConcepts.value.map((nc) => ({
    spec: nc.specificationNumber.trim() ? '' : AG.newConcepts.validation.specRequired,
    desc: nc.description.trim() ? '' : AG.newConcepts.validation.descRequired,
    unit: nc.unit.trim() ? '' : AG.newConcepts.validation.unitRequired,
    qty: parseFloat(nc._qtyRaw) > 0 ? '' : AG.newConcepts.validation.qtyRequired,
    price: parseFloat(nc._priceRaw) > 0 ? '' : AG.newConcepts.validation.priceRequired,
  })),
)
const hasChanges = computed(
  () =>
    conceptChanges.value.length > 0 ||
    newConcepts.value.length > 0 ||
    newSections.value.length > 0 ||
    !!newContractStartRaw.value ||
    !!newContractEndRaw.value,
)
const noChangesError = computed(() =>
  !hasChanges.value ? AG.validation.noChanges : null,
)
const newConceptsValid = computed(() =>
  newConceptErrors.value.every((e) => !e.spec && !e.desc && !e.unit && !e.qty && !e.price),
)
const canSave = computed(
  () => !descError.value && hasChanges.value && newConceptsValid.value,
)

// ─── Submit ──────────────────────────────────────────────────────────────────
const loading = ref(false)
const submitError = ref<string | null>(null)
const backTo = computed(() =>
  isEdit.value
    ? `/contracts/${contractId.value}/agreements/${editId.value}`
    : `/contracts/${contractId.value}/contract`,
)

async function onSave() {
  if (!canSave.value) return
  loading.value = true
  submitError.value = null
  try {
    const attachmentFileIds = await uploadAttachments()
    if (attachmentEntries.value.some((e) => e.status === 'error')) {
      submitError.value = 'Algunos archivos no pudieron subirse. Corrígelos antes de guardar.'
      return
    }
    const payload = {
      description: description.value.trim(),
      conceptChanges: resolvedChanges.value,
      newConcepts: resolvedNewConcepts.value,
      newSections: resolvedNewSections.value,
      newContractStartDate: newContractStartDate.value,
      newContractEndDate: newContractEndDate.value,
      amountDelta: derivedAmountDelta.value,
      timeDeltaDays: derivedTimeDelta.value,
      attachmentFileIds,
    }
    const result = isEdit.value && editId.value
      ? await repos.agreements.update(editId.value, payload)
      : await repos.agreements.create({ contractId: contractId.value, ...payload })
    await navigateTo(`/contracts/${contractId.value}/agreements/${result.id}`)
  } catch (e) {
    submitError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="agreement-new">
    <template #header>
      <UDashboardNavbar :title="isEdit && data?.editing
        ? `${AG.editTitlePrefix} No. ${data?.editing?.number}`
        : AG.newTitle">
        <template #leading>
          <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" :to="backTo"
            :aria-label="S.common.back" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-alert-triangle" :title="S.common.error"
        :actions="[{ label: 'Reintentar', color: 'neutral', variant: 'subtle', onClick: () => refresh() }]" />
      <div v-else-if="status === 'pending'" class="space-y-3">
        <USkeleton class="h-24 w-full rounded-lg" />
        <USkeleton class="h-48 w-full rounded-lg" />
      </div>

      <div v-else class="flex flex-col gap-6">
        <!-- Description -->
        <UCard>
          <UFormField :label="AG.fields.description" :error="descError || undefined">
            <UTextarea v-model="description" :rows="3" class="w-full" :placeholder="AG.fields.descriptionPlaceholder" />
          </UFormField>
        </UCard>

        <!-- Concept changes: picker + table -->
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-pencil-ruler" class="size-4 text-muted" />
              {{ AG.conceptChanges.title }}
            </div>
          </template>

          <!-- Grouped picker — always visible, search to filter -->
          <div class="border-b border-default px-4 py-3">
            <p class="mb-2 text-xs text-muted">{{ AG.conceptChanges.hint }}</p>
            <UInput v-model="pickerSearch" :placeholder="S.conceptCatalog.search" icon="i-lucide-search"
              class="mb-2 w-60" />
            <div class="max-h-64 overflow-y-auto rounded-lg border border-default">
              <template v-for="group in pickerGroups" :key="group.section?.id ?? 'no-section'">
                <div class="sticky top-0 flex items-center gap-2 border-b border-default bg-elevated px-3 py-1.5">
                  <span class="font-mono text-xs font-semibold text-muted">{{ group.section?.specificationNumber
                  }}</span>
                  <span class="text-xs font-semibold text-default">{{ group.section?.description ??
                    S.conceptSections.noSection }}</span>
                  <span v-if="group.section" class="ml-auto text-xs text-muted">
                    {{ formatDate(group.section.startDate) }} – {{ formatDate(group.section.endDate) }}
                  </span>
                </div>
                <div v-for="c in group.concepts" :key="c.id"
                  class="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-elevated/60 transition-colors"
                  @click="addConceptChange(c.id)">
                  <UIcon name="i-lucide-plus" class="size-3.5 shrink-0 text-primary" />
                  <span class="font-mono text-xs text-muted w-16 shrink-0">{{ c.specificationNumber }}</span>
                  <span class="min-w-0 flex-1 truncate text-sm text-highlighted">{{ c.description }}</span>
                  <span class="shrink-0 text-xs text-muted">{{ c.unit }}</span>
                  <span class="shrink-0 tabular-nums text-xs text-muted">{{ formatMoney(c.unitPrice) }}</span>
                </div>
              </template>
              <div v-if="pickerGroups.length === 0" class="px-3 py-4 text-center text-sm text-muted">
                {{ F.conceptPicker?.noMatch ?? 'Sin coincidencias' }}
              </div>
            </div>
          </div>

          <!-- Changes table -->
          <div v-if="conceptChanges.length === 0" class="px-4 py-6 text-sm text-muted">
            {{ AG.conceptChanges.empty }}
          </div>
          <div v-else class="overflow-x-auto">
            <table class="w-full min-w-[56rem] text-sm">
              <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                <tr>
                  <th class="px-3 py-2 text-left font-medium">{{ AG.conceptChanges.columns.specification }}</th>
                  <th class="px-3 py-2 text-left font-medium">{{ AG.conceptChanges.columns.description }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ AG.conceptChanges.columns.currentQty }}</th>
                  <th class="px-3 py-2 text-right font-medium text-success">{{ AG.conceptChanges.columns.newQty }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ AG.conceptChanges.columns.currentPrice }}</th>
                  <th class="px-3 py-2 text-right font-medium text-success">{{ AG.conceptChanges.columns.newPrice }}
                  </th>
                  <th class="px-3 py-2 text-center font-medium">{{ AG.conceptChanges.columns.newStart }}</th>
                  <th class="px-3 py-2 text-center font-medium">{{ AG.conceptChanges.columns.newEnd }}</th>
                  <th class="px-2 py-2" />
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-for="(cc, idx) in conceptChanges" :key="cc.conceptId">
                  <template v-if="data">
                    <td class="px-3 py-2 font-mono text-xs text-highlighted">
                      {{data.concepts.find(c => c.id === cc.conceptId)?.specificationNumber}}
                    </td>
                    <td class="min-w-[12rem] px-3 py-2 text-highlighted">
                      {{data.concepts.find(c => c.id === cc.conceptId)?.description}}
                    </td>
                    <!-- Current qty -->
                    <td class="px-3 py-2 text-right tabular-nums text-muted">
                      {{formatNumber(data.concepts.find(c => c.id === cc.conceptId)?.contractedQuantity ?? 0)}}
                    </td>
                    <!-- New qty (editable, green) -->
                    <td class="px-3 py-2">
                      <UInput v-model="cc._newQtyRaw" type="number" min="0" step="any"
                        :placeholder="String(data.concepts.find(c => c.id === cc.conceptId)?.contractedQuantity ?? '')"
                        class="w-28 [&_input]:text-right [&_input]:text-success [&_input]:font-medium" />
                    </td>
                    <!-- Current price -->
                    <td class="px-3 py-2 text-right tabular-nums text-muted">
                      {{formatMoney(data.concepts.find(c => c.id === cc.conceptId)?.unitPrice ?? 0)}}
                    </td>
                    <!-- New price (editable, green) -->
                    <td class="px-3 py-2">
                      <UInput v-model="cc._newPriceRaw" type="number" min="0" step="0.01"
                        :placeholder="String((data.concepts.find(c => c.id === cc.conceptId)?.unitPrice ?? 0) / 100)"
                        class="w-32 [&_input]:text-right [&_input]:text-success [&_input]:font-medium">
                        <template #leading><span class="pl-1 text-xs text-muted">$</span></template>
                      </UInput>
                    </td>

                  </template>
                  <td class="px-2 py-2">
                    <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost"
                      @click="removeConceptChange(idx)" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>

        <!-- New sections -->
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-layers" class="size-4 text-muted" />
                {{ S.conceptSections.addSection }}
              </div>
              <UButton size="xs" icon="i-lucide-plus" color="neutral" variant="outline" @click="addNewSection">
                {{ S.conceptSections.addSection }}
              </UButton>
            </div>
          </template>

          <div v-if="!newSections.length" class="px-4 py-4 text-sm text-muted">
            Agrega secciones nuevas que se crearán en el catálogo al aprobarse el convenio.
          </div>
          <div v-else class="divide-y divide-default">
            <div v-for="(ns, idx) in newSections" :key="idx" class="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-5">
              <UFormField :label="S.conceptSections.specificationNumber">
                <UInput v-model="ns.specificationNumber" class="w-full" placeholder="D" />
              </UFormField>
              <UFormField :label="S.conceptSections.description" class="lg:col-span-2">
                <UInput v-model="ns.description" class="w-full" placeholder="Nueva etapa" />
              </UFormField>
              <div class="flex items-end gap-2 lg:col-span-3">
                <UButton icon="i-lucide-x" size="sm" color="neutral" variant="ghost" class="mb-0.5"
                  @click="removeNewSection(idx)" />
              </div>
            </div>
          </div>
        </UCard>

        <!-- Attachments -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-paperclip" class="size-4 text-muted" />
              {{ AG.attachments.title }}
            </div>
          </template>
          <p class="mb-3 text-xs text-muted">{{ AG.attachments.hint }}</p>

          <!-- Already-saved attachments (edit mode) -->
          <ul v-if="existingAttachments.length" class="mb-3 divide-y divide-default rounded-lg border border-default">
            <li v-for="file in existingAttachments" :key="file.id" class="flex items-center gap-3 px-3 py-2.5">
              <UIcon :name="fileIcon(file.mimeType)" class="size-4 shrink-0 text-muted" />
              <button type="button" class="min-w-0 flex-1 truncate text-left text-sm text-highlighted hover:underline"
                @click="openViewer(file)">
                {{ file.name }}
              </button>
              <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" :aria-label="AG.attachments.remove"
                @click="removeExistingAttachment(file.id)" />
            </li>
          </ul>

          <!-- Drop zone -->
          <div class="mb-3 cursor-pointer rounded-xl border-2 border-dashed transition-colors"
            :class="isDraggingAttachment ? 'border-primary bg-primary/5' : 'border-default hover:border-primary/50'"
            @dragover.prevent="isDraggingAttachment = true" @dragleave.prevent="isDraggingAttachment = false"
            @drop.prevent="onAttachmentDrop" @click="($refs.attachmentInput as HTMLInputElement).click()">
            <div class="flex flex-col items-center gap-2 px-4 py-6">
              <UIcon name="i-lucide-upload-cloud" class="size-7 text-muted" />
              <p class="text-sm text-muted">
                {{ isDraggingAttachment ? AG.attachments.dropzoneActive : AG.attachments.dropzone }}
              </p>
            </div>
          </div>
          <input ref="attachmentInput" type="file" multiple class="sr-only" @change="onAttachmentInput" />

          <!-- New file queue -->
          <ul v-if="attachmentEntries.length" class="divide-y divide-default rounded-lg border border-default">
            <li v-for="entry in attachmentEntries" :key="entry.id" class="flex items-center gap-3 px-3 py-2.5">
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
                <div v-if="entry.status === 'uploading'"
                  class="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-elevated">
                  <div class="h-full rounded-full bg-primary transition-all"
                    :style="`width:${Math.round(entry.progress * 100)}%`" />
                </div>
                <p v-if="entry.errorMsg" class="text-xs text-error">{{ entry.errorMsg }}</p>
              </div>
              <UButton v-if="entry.status === 'queued' || entry.status === 'error'" icon="i-lucide-x" size="xs"
                color="neutral" variant="ghost" :aria-label="AG.attachments.remove"
                @click="removeAttachmentEntry(entry.id)" />
            </li>
          </ul>
          <p v-else-if="!existingAttachments.length" class="text-sm text-muted">{{ AG.attachments.empty }}</p>
        </UCard>

        <!-- Contract date changes -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-calendar" class="size-4 text-muted" />
              Cambio de fechas del contrato
            </div>
          </template>
          <p class="mb-4 text-xs text-muted">Deja en blanco los campos que no cambien. Las nuevas fechas reemplazan las
            del
            contrato al aprobarse.</p>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Nueva fecha de inicio">
              <UInput v-model="newContractStartRaw" type="date" class="w-full [&_input]:text-success" />
              <template v-if="data?.contract?.startDate" #hint>
                Actual: {{ formatDate(data.contract.startDate) }}
              </template>
            </UFormField>
            <UFormField label="Nueva fecha de término">
              <UInput v-model="newContractEndRaw" type="date" class="w-full [&_input]:text-success" />
              <template v-if="data?.contract?.endDate" #hint>
                Actual: {{ formatDate(data.contract.endDate) }}
              </template>
            </UFormField>
          </div>
        </UCard>

        <!-- New concepts -->
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-list-plus" class="size-4 text-muted" />
                {{ AG.newConcepts.title }}
              </div>
              <UButton size="xs" icon="i-lucide-plus" color="neutral" variant="outline" @click="addNewConcept">
                {{ AG.newConcepts.add }}
              </UButton>
            </div>
          </template>

          <div v-if="newConcepts.length === 0" class="px-4 py-6 text-sm text-muted">
            {{ AG.newConcepts.empty }}
          </div>
          <div v-else class="overflow-x-auto">
            <table class="w-full min-w-[60rem] text-sm">
              <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                <tr>
                  <th class="px-3 py-2 text-left font-medium">{{ AG.newConcepts.columns.specification }}</th>
                  <th class="px-3 py-2 text-left font-medium">{{ AG.newConcepts.columns.description }}</th>
                  <th class="px-3 py-2 text-left font-medium">{{ AG.newConcepts.columns.unit }}</th>
                  <th class="px-3 py-2 text-right font-medium text-success">{{ AG.newConcepts.columns.qty }}</th>
                  <th class="px-3 py-2 text-right font-medium text-success">{{ AG.newConcepts.columns.unitPrice }}</th>

                  <th class="px-3 py-2 text-left font-medium">Sección</th>
                  <th class="px-2 py-2" />
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-for="(nc, idx) in newConcepts" :key="idx">
                  <td class="px-3 py-2">
                    <UInput v-model="nc.specificationNumber" class="w-28"
                      :placeholder="AG.newConcepts.columns.specification"
                      :color="newConceptErrors[idx]?.spec ? 'error' : undefined" />
                  </td>
                  <td class="min-w-[14rem] px-3 py-2">
                    <UInput v-model="nc.description" class="w-full" :placeholder="AG.newConcepts.columns.description"
                      :color="newConceptErrors[idx]?.desc ? 'error' : undefined" />
                  </td>
                  <td class="px-3 py-2">
                    <UInput v-model="nc.unit" class="w-20" placeholder="m2"
                      :color="newConceptErrors[idx]?.unit ? 'error' : undefined" />
                  </td>
                  <td class="px-3 py-2">
                    <UInput v-model="nc._qtyRaw" type="number" min="0" step="any"
                      class="w-24 [&_input]:text-right [&_input]:text-success [&_input]:font-medium"
                      :color="newConceptErrors[idx]?.qty ? 'error' : undefined" />
                  </td>
                  <td class="px-3 py-2">
                    <UInput v-model="nc._priceRaw" type="number" min="0" step="0.01"
                      class="w-32 [&_input]:text-right [&_input]:text-success [&_input]:font-medium"
                      :color="newConceptErrors[idx]?.price ? 'error' : undefined">
                      <template #leading><span class="pl-1 text-xs text-muted">$</span></template>
                    </UInput>
                  </td>

                  <td class="px-3 py-2">
                    <USelect v-model="nc.sectionId" :items="[
                      { label: '— Sin sección —', value: null },
                      ...(data?.sections ?? []).map(s => ({ label: `${s.specificationNumber} ${s.description}`, value: s.id })),
                      ...newSections.map((ns, i) => ({ label: `[Nueva] ${ns.specificationNumber || i + 1} ${ns.description}`, value: `new:${i}` })),
                    ]" class="w-52" />
                  </td>
                  <td class="px-2 py-2">
                    <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost"
                      @click="removeNewConcept(idx)" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>

        <!-- Summary -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-calculator" class="size-4 text-muted" />
              {{ AG.sections.detail }}
            </div>
          </template>

          <dl class="divide-y divide-default text-sm">
            <div class="flex items-center justify-between py-2">
              <dt class="text-muted">{{ AG.summary.derivedAmountDelta }}</dt>
              <dd v-if="derivedAmountDelta != null" class="font-semibold tabular-nums"
                :class="derivedAmountDelta >= 0 ? 'text-success' : 'text-error'">
                {{ derivedAmountDelta >= 0 ? '+' : '' }}{{ formatMoney(derivedAmountDelta) }}
              </dd>
              <dd v-else class="text-muted">{{ AG.summary.noChanges }}</dd>
            </div>
            <div class="flex items-center justify-between py-2">
              <dt class="text-muted">{{ AG.summary.derivedTimeDelta }}</dt>
              <dd v-if="derivedTimeDelta != null" class="font-semibold tabular-nums"
                :class="derivedTimeDelta > 0 ? 'text-warning' : 'text-success'">
                {{ derivedTimeDelta > 0 ? '+' : '' }}{{ derivedTimeDelta }} {{ AG.summary.days }}
              </dd>
              <dd v-else class="text-muted">—</dd>
            </div>
            <div v-if="kind" class="flex items-center justify-between py-2">
              <dt class="text-muted">Tipo de convenio</dt>
              <dd>
                <UBadge :label="AG.kind[kind]" color="neutral" variant="soft" size="sm" />
              </dd>
            </div>
          </dl>

          <UAlert class="mt-3" color="neutral" variant="soft" icon="i-lucide-info" :title="AG.effectNotice" />
        </UCard>

        <UAlert v-if="noChangesError && description.trim()" color="warning" variant="soft"
          icon="i-lucide-triangle-alert" :title="noChangesError" />
        <UAlert v-if="submitError" color="error" variant="soft" icon="i-lucide-alert-triangle" :title="submitError" />

        <!-- Sticky actions -->
        <div
          class="sticky bottom-0 -mx-4 mt-2 flex justify-end gap-3 border-t border-default bg-default/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <UButton color="neutral" variant="ghost" :to="backTo">{{ S.common.cancel }}</UButton>
          <UButton :icon="isEdit ? 'i-lucide-save' : 'i-lucide-file-plus-2'" :loading="loading" :disabled="!canSave"
            @click="onSave">
            {{ isEdit ? AG.saveChanges : AG.saveDraft }}
          </UButton>
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <!-- File viewer — must live outside UDashboardPanel -->
  <FileViewerModal v-model:open="viewerOpen" :file="viewingFile" />
</template>