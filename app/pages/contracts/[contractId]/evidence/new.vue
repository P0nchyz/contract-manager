<!-- app/pages/contracts/[contractId]/evidence/new.vue -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'

definePageMeta({ requiredPermission: 'evidence:create' })

const EV = S.evidence

const route = useRoute()
const repos = useRepositories()

const contractId = computed(() => route.params.contractId as string)

// ─── Form state ───────────────────────────────────────────────────────────────
const title = ref('')
const date  = ref(new Date().toISOString().slice(0, 10))
const body  = ref('')

const titleError = computed(() => title.value.trim() ? '' : EV.validation.titleRequired)
const dateError  = computed(() => date.value        ? '' : EV.validation.dateRequired)
const bodyError  = computed(() => body.value.trim() ? '' : EV.validation.bodyRequired)
const canSave    = computed(() => !titleError.value && !dateError.value && !bodyError.value)

// ─── File upload queue ────────────────────────────────────────────────────────
type FileEntry = {
  id: string
  file: File
  status: 'queued' | 'uploading' | 'done' | 'error'
  progress: number
  uploadedFileId: string | null
  errorMsg: string | null
}

const fileEntries = ref<FileEntry[]>([])
const isDragging  = ref(false)
let _uid = 0

function makeEntry(f: File): FileEntry {
  return { id: String(++_uid), file: f, status: 'queued', progress: 0, uploadedFileId: null, errorMsg: null }
}

function addFiles(files: File[]) {
  fileEntries.value.push(...files.map(makeEntry))
}

function removeEntry(id: string) {
  fileEntries.value = fileEntries.value.filter((e) => e.id !== id)
}

function onDrop(e: DragEvent) {
  isDragging.value = false
  addFiles(Array.from(e.dataTransfer?.files ?? []))
}
function onInput(e: Event) {
  addFiles(Array.from((e.target as HTMLInputElement).files ?? []))
  ;(e.target as HTMLInputElement).value = ''
}

function formatBytes(n: number) {
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1_048_576).toFixed(1)} MB`
}

// Upload all queued files; returns collected FileIds
async function uploadAll(): Promise<string[]> {
  const folders = await repos.files.listFolders(contractId.value)
  const evidenceFolder = folders.find((f) => f.kind === 'evidence')
  if (!evidenceFolder) throw new Error('No se encontró la carpeta de evidencias.')

  const ids: string[] = []
  for (const entry of fileEntries.value) {
    if (entry.status === 'done' && entry.uploadedFileId) {
      ids.push(entry.uploadedFileId)
      continue
    }
    if (entry.status === 'queued' || entry.status === 'error') {
      entry.status = 'uploading'
      entry.progress = 0
      entry.errorMsg = null
      try {
        const asset = await repos.files.upload(
          { contractId: contractId.value, folderId: evidenceFolder.id, file: entry.file },
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

// ─── Submit ───────────────────────────────────────────────────────────────────
const saving    = ref(false)
const saveError = ref<string | null>(null)

async function onSave() {
  if (!canSave.value) return
  saving.value = true
  saveError.value = null
  try {
    const fileIds = await uploadAll()
    // Block if any file failed
    if (fileEntries.value.some((e) => e.status === 'error')) {
      saveError.value = 'Algunos archivos no pudieron subirse. Corrígelos antes de guardar.'
      return
    }
    const note = await repos.evidence.create({
      contractId: contractId.value,
      title: title.value.trim(),
      body:  body.value.trim(),
      date:  new Date(`${date.value}T12:00:00`),
      fileIds,
    })
    await navigateTo(`/contracts/${contractId.value}/evidence/${note.id}`)
  } catch (err) {
    saveError.value = isRepositoryError(err) ? err.message : S.common.error
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="evidence-new">
    <template #header>
      <UDashboardNavbar :title="EV.new">
        <template #leading>
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            :to="`/contracts/${contractId}/evidence`"
            :aria-label="S.common.back"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="max-w-2xl space-y-4">
        <UCard>
          <div class="space-y-4">
            <!-- Title -->
            <UFormField :label="EV.fields.title" :error="saving && titleError || undefined">
              <UInput
                v-model="title"
                class="w-full"
                :placeholder="EV.fields.titlePlaceholder"
              />
            </UFormField>

            <!-- Date -->
            <UFormField :label="EV.fields.date" :error="saving && dateError || undefined">
              <UInput v-model="date" type="date" class="w-full" />
            </UFormField>

            <!-- Body -->
            <UFormField :label="EV.fields.body" :error="saving && bodyError || undefined">
              <UTextarea
                v-model="body"
                :rows="5"
                class="w-full"
                :placeholder="EV.fields.bodyPlaceholder"
              />
            </UFormField>
          </div>
        </UCard>

        <!-- Files -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-paperclip" class="size-4 text-muted" />
              {{ EV.fields.files }}
            </div>
          </template>

          <!-- Drop zone -->
          <div
            class="mb-3 cursor-pointer rounded-xl border-2 border-dashed transition-colors"
            :class="isDragging
              ? 'border-primary bg-primary/5'
              : 'border-default hover:border-primary/50'"
            @dragover.prevent="isDragging = true"
            @dragleave.prevent="isDragging = false"
            @drop.prevent="onDrop"
            @click="($refs.fileInput as HTMLInputElement).click()"
          >
            <div class="flex flex-col items-center gap-2 px-4 py-6">
              <UIcon name="i-lucide-upload-cloud" class="size-7 text-muted" />
              <p class="text-sm text-muted">
                {{ isDragging ? EV.upload.dropzoneActive : EV.upload.dropzone }}
              </p>
            </div>
          </div>
          <input ref="fileInput" type="file" multiple class="sr-only" @change="onInput" />

          <!-- File list -->
          <ul v-if="fileEntries.length" class="divide-y divide-default rounded-lg border border-default">
            <li
              v-for="entry in fileEntries"
              :key="entry.id"
              class="flex items-center gap-3 px-3 py-2.5"
            >
              <UIcon
                :name="entry.status === 'done'       ? 'i-lucide-check-circle-2'
                      : entry.status === 'error'     ? 'i-lucide-alert-circle'
                      : entry.status === 'uploading' ? 'i-lucide-loader-circle'
                      : 'i-lucide-file'"
                class="size-4 shrink-0"
                :class="entry.status === 'done'      ? 'text-success'
                      : entry.status === 'error'     ? 'text-error'
                      : entry.status === 'uploading' ? 'text-primary animate-spin'
                      : 'text-muted'"
              />
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-sm text-highlighted">{{ entry.file.name }}</span>
                  <span class="shrink-0 text-xs text-muted">{{ formatBytes(entry.file.size) }}</span>
                </div>
                <div v-if="entry.status === 'uploading'" class="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-elevated">
                  <div class="h-full rounded-full bg-primary transition-all" :style="`width:${Math.round(entry.progress * 100)}%`" />
                </div>
                <p v-if="entry.errorMsg" class="text-xs text-error">{{ entry.errorMsg }}</p>
              </div>
              <UButton
                v-if="entry.status === 'queued' || entry.status === 'error'"
                icon="i-lucide-x"
                size="xs"
                color="neutral"
                variant="ghost"
                :aria-label="EV.upload.remove"
                @click="removeEntry(entry.id)"
              />
            </li>
          </ul>
        </UCard>

        <UAlert
          v-if="saveError"
          :title="saveError"
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
        />

        <!-- Actions -->
        <div class="flex justify-end gap-3">
          <UButton
            color="neutral"
            variant="ghost"
            :to="`/contracts/${contractId}/evidence`"
          >
            {{ S.common.cancel }}
          </UButton>
          <UButton
            icon="i-lucide-save"
            :loading="saving"
            :disabled="!canSave"
            @click="onSave"
          >
            {{ EV.save }}
          </UButton>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>