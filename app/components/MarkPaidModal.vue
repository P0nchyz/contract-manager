<!-- app/components/MarkPaidModal.vue -->
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
  paid: []         // emitted after successful markPaid
}>()

const PM = S.financial.payModal
const repos = useRepositories()

// ─── State ───────────────────────────────────────────────────────────────────
type UploadState = 'idle' | 'uploading' | 'done' | 'error'

const file         = ref<File | null>(null)
const uploadState  = ref<UploadState>('idle')
const uploadedId   = ref<string | null>(null)
const uploadProgress = ref(0)
const uploadError  = ref<string | null>(null)
const isDragging   = ref(false)
const confirming   = ref(false)
const confirmError = ref<string | null>(null)

// Reset when modal opens
watch(() => props.open, (open) => {
  if (open) {
    file.value        = null
    uploadState.value = 'idle'
    uploadedId.value  = null
    uploadProgress.value = 0
    uploadError.value = null
    confirming.value  = false
    confirmError.value = null
    isDragging.value  = false
  }
})

// ─── File picking ─────────────────────────────────────────────────────────────
function onDrop(e: DragEvent) {
  isDragging.value = false
  const picked = e.dataTransfer?.files?.[0]
  if (picked) selectFile(picked)
}

function onInput(e: Event) {
  const picked = (e.target as HTMLInputElement).files?.[0]
  if (picked) selectFile(picked)
  ;(e.target as HTMLInputElement).value = ''
}

async function selectFile(f: File) {
  file.value        = f
  uploadState.value = 'uploading'
  uploadProgress.value = 0
  uploadError.value = null
  uploadedId.value  = null

  try {
    // Find the payments folder for this contract
    const folders = await repos.files.listFolders(props.contractId)
    const payFolder = folders.find((fd) => fd.kind === 'payments')
    if (!payFolder) throw new Error('No se encontró la carpeta de comprobantes de pago.')

    const asset = await repos.files.upload(
      { contractId: props.contractId, folderId: payFolder.id, file: f },
      (p) => { uploadProgress.value = p },
    )
    uploadedId.value  = asset.id
    uploadState.value = 'done'
  } catch (err) {
    uploadState.value = 'error'
    uploadError.value = isRepositoryError(err) ? err.message : S.common.error
  }
}

// ─── Confirm ─────────────────────────────────────────────────────────────────
async function confirm(withFile: boolean) {
  confirming.value  = true
  confirmError.value = null
  try {
    await repos.estimates.markPaid(
      props.estimateId,
      withFile && uploadedId.value ? uploadedId.value : undefined,
    )
    emit('update:open', false)
    emit('paid')
  } catch (err) {
    confirmError.value = isRepositoryError(err) ? err.message : S.common.error
  } finally {
    confirming.value = false
  }
}

function formatBytes(n: number) {
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1_048_576).toFixed(1)} MB`
}
</script>

<template>
  <UModal
    :open="open"
    :title="`${PM.title} — Estimación No. ${estimateNumber}`"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <p class="mb-4 text-sm text-muted">{{ PM.hint }}</p>

      <!-- Drop zone / file picker -->
      <div
        class="relative rounded-xl border-2 transition-colors"
        :class="isDragging
          ? 'border-primary bg-primary/5 border-dashed'
          : uploadState === 'done'
            ? 'border-success bg-success/5'
            : 'border-default border-dashed hover:border-primary/50'"
        @dragover.prevent="isDragging = true"
        @dragleave.prevent="isDragging = false"
        @drop.prevent="onDrop"
      >
        <input type="file" class="sr-only" ref="fileInputRef" @change="onInput" />

        <!-- Idle / drag state -->
        <div
          v-if="uploadState === 'idle'"
          class="flex cursor-pointer flex-col items-center justify-center gap-2 px-4 py-8"
          @click="($refs.fileInputRef as HTMLInputElement).click()"
        >
          <UIcon name="i-lucide-upload-cloud" class="size-8 text-muted" />
          <p class="text-sm text-muted">
            {{ isDragging ? PM.dropzoneActive : PM.dropzone }}
          </p>
        </div>

        <!-- Uploading -->
        <div v-else-if="uploadState === 'uploading'" class="px-4 py-6">
          <div class="mb-2 flex items-center gap-2 text-sm text-primary">
            <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
            {{ PM.uploading }}
          </div>
          <div class="h-1.5 w-full overflow-hidden rounded-full bg-elevated">
            <div
              class="h-full rounded-full bg-primary transition-all"
              :style="`width:${Math.round(uploadProgress * 100)}%`"
            />
          </div>
        </div>

        <!-- Done -->
        <div v-else-if="uploadState === 'done'" class="px-4 py-5">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2 min-w-0">
              <UIcon name="i-lucide-check-circle-2" class="size-5 shrink-0 text-success" />
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-highlighted">{{ file?.name }}</p>
                <p class="text-xs text-muted">{{ file ? formatBytes(file.size) : '' }}</p>
              </div>
            </div>
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              @click="($refs.fileInputRef as HTMLInputElement).click()"
            >
              {{ PM.change }}
            </UButton>
          </div>
        </div>

        <!-- Error -->
        <div v-else-if="uploadState === 'error'" class="px-4 py-5">
          <div class="flex items-center gap-2 text-sm text-error">
            <UIcon name="i-lucide-alert-circle" class="size-4 shrink-0" />
            {{ uploadError }}
          </div>
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            class="mt-2"
            @click="($refs.fileInputRef as HTMLInputElement).click()"
          >
            Reintentar
          </UButton>
        </div>
      </div>

      <UAlert
        v-if="confirmError"
        :title="confirmError"
        color="error"
        variant="soft"
        icon="i-lucide-alert-triangle"
        class="mt-4"
      />
    </template>

    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-between gap-3">
        <!-- Skip link — left side -->
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          :loading="confirming && !uploadedId"
          :disabled="confirming"
          @click="confirm(false)"
        >
          {{ PM.skip }}
        </UButton>

        <!-- Cancel + Confirm — right side -->
        <div class="flex gap-3">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="confirming"
            @click="emit('update:open', false)"
          >
            {{ S.common.cancel }}
          </UButton>
          <UButton
            color="success"
            icon="i-lucide-banknote"
            :loading="confirming && !!uploadedId"
            :disabled="confirming || uploadState === 'uploading' || uploadState === 'error'"
            @click="confirm(true)"
          >
            {{ PM.confirm }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>