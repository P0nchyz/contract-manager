<!-- app/components/RequestPaymentModal.vue -->
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'

const props = defineProps<{
  open: boolean
  estimateId: string
  contractId: string
  estimateNumber: number
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  requested: []
}>()

const PR = S.estimateDetail.paymentRequest
const repos = useRepositories()

// ─── Form state ───────────────────────────────────────────────────────────────
const accountHolder = ref('')
const bankName = ref('')
const accountNumber = ref('')
const clabe = ref('')

// ─── Documents (multi-upload, reusing the same pattern as other attach flows) ─
type DocEntry = {
  id: string
  file: File
  status: 'queued' | 'uploading' | 'done' | 'error'
  progress: number
  uploadedFileId: string | null
  errorMsg: string | null
}
const docs = ref<DocEntry[]>([])
const isDragging = ref(false)
let _docId = 0

function addDocs(files: File[]) {
  docs.value.push(...files.map((f) => ({
    id: String(++_docId), file: f, status: 'queued' as const, progress: 0, uploadedFileId: null, errorMsg: null,
  })))
}
function onDrop(e: DragEvent) {
  isDragging.value = false
  addDocs(Array.from(e.dataTransfer?.files ?? []))
}
function onInput(e: Event) {
  addDocs(Array.from((e.target as HTMLInputElement).files ?? []))
  ;(e.target as HTMLInputElement).value = ''
}
function removeDoc(id: string) {
  docs.value = docs.value.filter((d) => d.id !== id)
}
function formatBytes(n: number) {
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1_048_576).toFixed(1)} MB`
}

async function uploadAllDocs(): Promise<string[]> {
  const folders = await repos.files.listFolders(props.contractId)
  const folder = folders.find((f) => f.kind === 'payments') ?? folders.find((f) => f.kind === 'contract')
  const ids: string[] = []
  for (const d of docs.value) {
    if (d.status === 'done' && d.uploadedFileId) { ids.push(d.uploadedFileId); continue }
    if (!folder) { d.status = 'error'; d.errorMsg = 'No se encontró una carpeta destino.'; continue }
    d.status = 'uploading'; d.progress = 0; d.errorMsg = null
    try {
      const asset = await repos.files.upload(
        { contractId: props.contractId, folderId: folder.id, file: d.file },
        (p) => { d.progress = p },
      )
      d.status = 'done'; d.progress = 1; d.uploadedFileId = asset.id
      ids.push(asset.id)
    } catch (err) {
      d.status = 'error'
      d.errorMsg = isRepositoryError(err) ? err.message : S.common.error
    }
  }
  return ids
}

// ─── Reset on open ────────────────────────────────────────────────────────────
watch(() => props.open, (open) => {
  if (open) {
    accountHolder.value = ''
    bankName.value = ''
    accountNumber.value = ''
    clabe.value = ''
    docs.value = []
    isDragging.value = false
    submitError.value = null
  }
})

// ─── Submit ───────────────────────────────────────────────────────────────────
const submitting = ref(false)
const submitError = ref<string | null>(null)

async function submit() {
  submitError.value = null
  if (!accountHolder.value.trim() || !bankName.value.trim() || !accountNumber.value.trim() || !clabe.value.trim()) {
    submitError.value = PR.validation.accountRequired
    return
  }
  if (!docs.value.length) {
    submitError.value = PR.validation.documentsRequired
    return
  }
  submitting.value = true
  try {
    const fileIds = await uploadAllDocs()
    if (docs.value.some((d) => d.status === 'error')) {
      submitError.value = S.common.error
      return
    }
    await repos.estimates.requestPayment(props.estimateId, {
      accountHolder: accountHolder.value.trim(),
      bankName: bankName.value.trim(),
      accountNumber: accountNumber.value.trim(),
      clabe: clabe.value.trim(),
      fileIds,
    })
    emit('update:open', false)
    emit('requested')
  } catch (err) {
    submitError.value = isRepositoryError(err) ? err.message : S.common.error
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal :open="open" :title="`${PR.modalTitle} — Estimación No. ${estimateNumber}`"
    :ui="{ content: 'sm:max-w-xl' }" @update:open="emit('update:open', $event)">
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-muted">{{ PR.hint }}</p>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="PR.accountHolder">
            <UInput v-model="accountHolder" class="w-full" />
          </UFormField>
          <UFormField :label="PR.bankName">
            <UInput v-model="bankName" class="w-full" />
          </UFormField>
          <UFormField :label="PR.accountNumber">
            <UInput v-model="accountNumber" class="w-full" />
          </UFormField>
          <UFormField :label="PR.clabe">
            <UInput v-model="clabe" class="w-full" />
          </UFormField>
        </div>

        <div>
          <p class="mb-2 text-sm font-medium text-highlighted">{{ PR.documents }}</p>

          <div class="mb-3 cursor-pointer rounded-xl border-2 border-dashed transition-colors"
            :class="isDragging ? 'border-primary bg-primary/5' : 'border-default hover:border-primary/50'"
            @dragover.prevent="isDragging = true" @dragleave.prevent="isDragging = false" @drop.prevent="onDrop"
            @click="($refs.docInput as HTMLInputElement).click()">
            <div class="flex flex-col items-center gap-2 px-4 py-6">
              <UIcon name="i-lucide-upload-cloud" class="size-6 text-muted" />
              <p class="text-xs text-muted">{{ PR.uploadNew }}</p>
            </div>
          </div>
          <input ref="docInput" type="file" multiple class="sr-only" @change="onInput" />

          <p v-if="!docs.length" class="text-xs text-muted">{{ PR.noDocuments }}</p>
          <ul v-else class="divide-y divide-default rounded-lg border border-default">
            <li v-for="d in docs" :key="d.id" class="flex items-center gap-3 px-3 py-2.5">
              <UIcon
                :name="d.status === 'done' ? 'i-lucide-check-circle-2' : d.status === 'error' ? 'i-lucide-alert-circle' : d.status === 'uploading' ? 'i-lucide-loader-circle' : 'i-lucide-file'"
                class="size-4 shrink-0"
                :class="d.status === 'done' ? 'text-success' : d.status === 'error' ? 'text-error' : d.status === 'uploading' ? 'text-primary animate-spin' : 'text-muted'" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-sm text-highlighted">{{ d.file.name }}</span>
                  <span class="shrink-0 text-xs text-muted">{{ formatBytes(d.file.size) }}</span>
                </div>
                <div v-if="d.status === 'uploading'" class="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-elevated">
                  <div class="h-full rounded-full bg-primary transition-all" :style="`width:${Math.round(d.progress * 100)}%`" />
                </div>
                <p v-if="d.errorMsg" class="text-xs text-error">{{ d.errorMsg }}</p>
              </div>
              <UButton v-if="d.status !== 'uploading'" icon="i-lucide-x" size="xs" color="neutral" variant="ghost"
                @click="removeDoc(d.id)" />
            </li>
          </ul>
        </div>

        <UAlert v-if="submitError" :title="submitError" color="error" variant="soft" icon="i-lucide-alert-triangle" />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-3">
        <UButton color="neutral" variant="ghost" :disabled="submitting" @click="emit('update:open', false)">
          {{ S.common.cancel }}
        </UButton>
        <UButton color="success" icon="i-lucide-send" :loading="submitting" @click="submit">
          {{ PR.submit }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>