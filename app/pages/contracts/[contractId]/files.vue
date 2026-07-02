<!-- app/pages/contracts/[contractId]/files.vue -->
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import type { Folder, FileAsset } from '~/data/models'

definePageMeta({ requiredPermission: 'estimate:view' })

const F = S.files

const route = useRoute()
const repos = useRepositories()
const authStore = useAuthStore()
const { can } = usePermissions()

const contractId = computed(() => route.params.contractId as string)
const currentUserId = computed(() => authStore.user?.id ?? '')
const canUpload = computed(() => can('file:upload'))

// ─── Folder tree ─────────────────────────────────────────────────────────────
const { data: folderData, refresh: refreshFolders } = await useAsyncData(
  () => `files-folders-${contractId.value}`,
  () => repos.files.listFolders(contractId.value),
  { default: () => [] as Folder[] },
)

const allFolders = computed(() => folderData.value ?? [])

// Build a folder map for O(1) lookup
const folderMap = computed(() => {
  const m: Record<string, Folder> = {}
  for (const f of allFolders.value) m[f.id] = f
  return m
})

// Root folders (parentId === null), ordered: predefined first then custom
const rootFolders = computed(() =>
  allFolders.value
    .filter((f) => f.parentId === null)
    .sort((a, b) => {
      if (a.predefined !== b.predefined) return a.predefined ? -1 : 1
      return a.name.localeCompare(b.name, 'es')
    }),
)

// Children of a given folder id
function childFolders(parentId: string): Folder[] {
  return allFolders.value
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

// ─── Navigation ──────────────────────────────────────────────────────────────
// Stack of folder ids representing current path. Empty = root view.
const pathStack = ref<string[]>([])

const currentFolderId = computed(() =>
  pathStack.value.length > 0 ? pathStack.value[pathStack.value.length - 1] : null,
)

const currentFolder = computed(() =>
  currentFolderId.value ? folderMap.value[currentFolderId.value] ?? null : null,
)

// Breadcrumb items
const breadcrumbs = computed(() => {
  const crumbs: { id: string | null; name: string }[] = [{ id: null, name: F.title }]
  for (const id of pathStack.value) {
    const f = folderMap.value[id]
    if (f) crumbs.push({ id, name: f.name })
  }
  return crumbs
})

function navigateTo(folderId: string | null) {
  if (folderId === null) {
    pathStack.value = []
  } else {
    const idx = pathStack.value.indexOf(folderId)
    if (idx >= 0) {
      pathStack.value = pathStack.value.slice(0, idx + 1)
    } else {
      pathStack.value = [...pathStack.value, folderId]
    }
  }
}

// ─── Files in current folder ─────────────────────────────────────────────────
const filesLoading = ref(false)
const currentFiles = ref<FileAsset[]>([])

async function loadFiles() {
  filesLoading.value = true
  try {
    currentFiles.value = await repos.files.listFiles(
      contractId.value,
      currentFolderId.value ?? undefined,
    )
  } finally {
    filesLoading.value = false
  }
}

watch(currentFolderId, loadFiles, { immediate: true })

// ─── Folder kind icon ─────────────────────────────────────────────────────────
function folderIcon(f: Folder): string {
  if (f.kind === 'contract') return 'i-lucide-file-text'
  if (f.kind === 'evidence') return 'i-lucide-camera'
  if (f.kind === 'payments') return 'i-lucide-banknote'
  return 'i-lucide-folder'
}

// ─── Subfolder + file display ─────────────────────────────────────────────────
const visibleSubfolders = computed(() =>
  currentFolderId.value ? childFolders(currentFolderId.value) : rootFolders.value,
)

// ─── New folder ──────────────────────────────────────────────────────────────
const newFolderMode = ref(false)
const newFolderName = ref('')
const newFolderError = ref('')
const newFolderLoading = ref(false)

function startNewFolder() {
  newFolderName.value = ''
  newFolderError.value = ''
  newFolderMode.value = true
}

async function confirmNewFolder() {
  const name = newFolderName.value.trim()
  if (!name) { newFolderError.value = 'El nombre es requerido.'; return }
  newFolderLoading.value = true
  try {
    await repos.files.createFolder({
      contractId: contractId.value,
      name,
      parentId: currentFolderId.value,
    })
    newFolderMode.value = false
    await refreshFolders()
  } catch (e) {
    newFolderError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    newFolderLoading.value = false
  }
}

// ─── Rename folder ───────────────────────────────────────────────────────────
const renaming = ref<Folder | null>(null)
const renameValue = ref('')
const renameError = ref('')
const renameLoading = ref(false)

function startRename(folder: Folder) {
  renaming.value = folder
  renameValue.value = folder.name
  renameError.value = ''
}

async function confirmRename() {
  const name = renameValue.value.trim()
  if (!name || !renaming.value) { renameError.value = 'El nombre es requerido.'; return }
  renameLoading.value = true
  try {
    await repos.files.renameFolder(renaming.value.id, name)
    renaming.value = null
    await refreshFolders()
  } catch (e) {
    renameError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    renameLoading.value = false
  }
}

// ─── Delete folder ────────────────────────────────────────────────────────────
const deletingFolder = ref<Folder | null>(null)
const deleteFolderLoading = ref(false)
const deleteFolderError = ref('')

async function confirmDeleteFolder() {
  if (!deletingFolder.value) return
  deleteFolderLoading.value = true
  deleteFolderError.value = ''
  try {
    await repos.files.deleteFolder(deletingFolder.value.id)
    deletingFolder.value = null
    await refreshFolders()
    await loadFiles()
  } catch (e) {
    deleteFolderError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    deleteFolderLoading.value = false
  }
}

// ─── Delete file ──────────────────────────────────────────────────────────────
const deletingFile = ref<FileAsset | null>(null)
const deleteFileLoading = ref(false)
const deleteFileError = ref('')

async function confirmDeleteFile() {
  if (!deletingFile.value) return
  deleteFileLoading.value = true
  deleteFileError.value = ''
  try {
    await repos.files.remove(deletingFile.value.id)
    deletingFile.value = null
    await loadFiles()
  } catch (e) {
    deleteFileError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    deleteFileLoading.value = false
  }
}

// ─── Download ─────────────────────────────────────────────────────────────────
const downloadingId = ref<string | null>(null)

async function downloadFile(file: FileAsset) {
  downloadingId.value = file.id
  try {
    const url = await repos.files.getDownloadUrl(file.id)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // Revoke object URL after a tick to allow download to start
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } finally {
    downloadingId.value = null
  }
}

// ─── Upload ───────────────────────────────────────────────────────────────────
type UploadEntry = {
  id: string
  file: File
  status: 'queued' | 'uploading' | 'done' | 'error'
  progress: number
  errorMsg: string | null
  targetFolderId: string | null // null = current folder
}

const uploadQueue = ref<UploadEntry[]>([])
const isDragging = ref(false)
const dragOverFolderId = ref<string | null>(null) // folder being dragged over
let _uid = 0
const makeEntry = (file: File, folderId: string | null): UploadEntry => ({
  id: String(++_uid), file, status: 'queued', progress: 0, errorMsg: null, targetFolderId: folderId,
})

// Resolve which folder to upload into: dragged-to folder or current folder
// Falls back to first root folder if at root with no target
function resolveUploadFolderId(targetFolderId: string | null): string | null {
  return targetFolderId ?? currentFolderId.value ?? allFolders.value[0]?.id ?? null
}

function enqueueFiles(files: File[], folderId: string | null) {
  uploadQueue.value.push(...files.map((f) => makeEntry(f, folderId)))
  processQueue()
}

let _uploading = false
async function processQueue() {
  if (_uploading) return
  _uploading = true
  while (true) {
    const next = uploadQueue.value.find((e) => e.status === 'queued')
    if (!next) break
    next.status = 'uploading'
    const folderId = resolveUploadFolderId(next.targetFolderId)
    if (!folderId) {
      next.status = 'error'
      next.errorMsg = 'Sin carpeta destino'
      continue
    }
    try {
      await repos.files.upload(
        { contractId: contractId.value, folderId, file: next.file },
        (p) => { next.progress = p },
      )
      next.status = 'done'
      next.progress = 1
      await loadFiles()
    } catch (e) {
      next.status = 'error'
      next.errorMsg = isRepositoryError(e) ? e.message : S.common.error
    }
  }
  _uploading = false
}

function onDrop(e: DragEvent, targetFolderId: string | null) {
  isDragging.value = false
  dragOverFolderId.value = null
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length) enqueueFiles(files, targetFolderId)
}

function onFileInput(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? [])
  if (files.length) enqueueFiles(files, null)
    ; (e.target as HTMLInputElement).value = ''
}

const pendingUploads = computed(() => uploadQueue.value.filter((e) => e.status !== 'done' && e.status !== 'error'))
const recentUploads = computed(() => uploadQueue.value.filter((e) => e.status === 'done' || e.status === 'error'))

function dismissUploads() {
  uploadQueue.value = uploadQueue.value.filter((e) => e.status === 'queued' || e.status === 'uploading')
}

// ─── Modal open state (v-model needs an assignable expression) ───────────────
const showDeleteFolder = computed({
  get: () => !!deletingFolder.value,
  set: (v) => { if (!v) deletingFolder.value = null },
})
const showDeleteFile = computed({
  get: () => !!deletingFile.value,
  set: (v) => { if (!v) deletingFile.value = null },
})

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1_048_576).toFixed(1)} MB`
}

function fileIcon(mime: string): string {
  if (mime.startsWith('image/')) return 'i-lucide-image'
  if (mime === 'application/pdf') return 'i-lucide-file-text'
  if (mime.includes('spreadsheet') || mime.includes('excel')) return 'i-lucide-table'
  if (mime.includes('word') || mime.includes('document')) return 'i-lucide-file-text'
  if (mime.startsWith('video/')) return 'i-lucide-video'
  return 'i-lucide-file'
}
</script>

<template>
  <UDashboardPanel id="files">
    <template #header>
      <UDashboardNavbar :title="F.title">
        <template #leading>
          <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" :to="`/contracts/${contractId}`"
            :aria-label="S.common.back" />
        </template>
        <template #right>
          <div class="flex items-center gap-2">
            <UButton v-if="canUpload" icon="i-lucide-upload" size="sm" color="neutral" variant="outline"
              @click="($refs.fileInput as HTMLInputElement).click()">
              {{ F.actions.upload }}
            </UButton>
            <UButton v-if="canUpload" icon="i-lucide-folder-plus" size="sm" color="neutral" variant="outline"
              @click="startNewFolder">
              {{ F.actions.newFolder }}
            </UButton>
          </div>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <!-- Hidden file input -->
      <input ref="fileInput" type="file" multiple class="sr-only" @change="onFileInput" />

      <!-- Breadcrumbs -->
      <nav class="mb-3 flex flex-wrap items-center gap-1 text-sm">
        <template v-for="(crumb, idx) in breadcrumbs" :key="crumb.id ?? 'root'">
          <span v-if="idx > 0" class="text-muted">/</span>
          <button class="rounded px-1.5 py-0.5 transition-colors hover:bg-elevated"
            :class="idx === breadcrumbs.length - 1 ? 'font-medium text-highlighted' : 'text-muted'"
            @click="navigateTo(crumb.id)">
            {{ crumb.name }}
          </button>
        </template>
      </nav>

      <!-- Upload progress panel -->
      <div v-if="uploadQueue.length" class="mb-3 rounded-lg border border-default bg-elevated/50 p-3">
        <div class="mb-2 flex items-center justify-between text-xs font-medium text-muted">
          <span>Subidas</span>
          <UButton v-if="recentUploads.length" size="xs" color="neutral" variant="ghost" @click="dismissUploads">
            Limpiar
          </UButton>
        </div>
        <ul class="space-y-1.5">
          <li v-for="entry in uploadQueue" :key="entry.id" class="flex items-center gap-2.5 text-sm">
            <UIcon :name="entry.status === 'done' ? 'i-lucide-check-circle-2'
              : entry.status === 'error' ? 'i-lucide-alert-circle'
                : entry.status === 'uploading' ? 'i-lucide-loader-circle'
                  : 'i-lucide-file'" class="size-4 shrink-0" :class="entry.status === 'done' ? 'text-success'
                      : entry.status === 'error' ? 'text-error'
                        : entry.status === 'uploading' ? 'text-primary animate-spin'
                          : 'text-muted'" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-highlighted">{{ entry.file.name }}</span>
                <span class="shrink-0 text-xs text-muted">{{ formatBytes(entry.file.size) }}</span>
              </div>
              <div v-if="entry.status === 'uploading'"
                class="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-default">
                <div class="h-full rounded-full bg-primary transition-all"
                  :style="`width:${Math.round(entry.progress * 100)}%`" />
              </div>
              <p v-if="entry.errorMsg" class="text-xs text-error">{{ entry.errorMsg }}</p>
            </div>
          </li>
        </ul>
      </div>

      <!-- Main drop zone (uploads to current folder when dropped on empty space) -->
      <div class="relative min-h-[calc(100vh-16rem)] rounded-xl border-2 transition-colors" :class="isDragging && !dragOverFolderId
        ? 'border-primary bg-primary/5 border-dashed'
        : 'border-transparent'" @dragover.prevent="isDragging = true; dragOverFolderId = null"
        @dragleave.prevent="isDragging = false" @drop.prevent="onDrop($event, null)">
        <!-- Drop overlay label -->
        <div v-if="isDragging && !dragOverFolderId"
          class="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl">
          <div class="flex flex-col items-center gap-2 text-primary">
            <UIcon name="i-lucide-upload-cloud" class="size-10" />
            <span class="font-medium">{{ F.upload.dropActive }}</span>
          </div>
        </div>

        <!-- New folder input row -->
        <div v-if="newFolderMode" class="mb-3 flex items-center gap-2">
          <UIcon name="i-lucide-folder-plus" class="size-4 shrink-0 text-muted" />
          <UInput v-model="newFolderName" :placeholder="F.newFolderPlaceholder" autofocus class="w-56"
            :color="newFolderError ? 'error' : undefined" @keydown.enter="confirmNewFolder"
            @keydown.escape="newFolderMode = false" />
          <UButton size="xs" :loading="newFolderLoading" @click="confirmNewFolder">
            {{ F.actions.confirm }}
          </UButton>
          <UButton size="xs" color="neutral" variant="ghost" @click="newFolderMode = false">
            {{ F.actions.cancel }}
          </UButton>
          <span v-if="newFolderError" class="text-xs text-error">{{ newFolderError }}</span>
        </div>

        <!-- Subfolder grid -->
        <div v-if="visibleSubfolders.length" class="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <div v-for="folder in visibleSubfolders" :key="folder.id"
            class="group relative rounded-lg border border-default bg-default transition-colors hover:bg-elevated"
            :class="dragOverFolderId === folder.id ? 'border-primary bg-primary/5' : ''"
            @dragover.prevent.stop="dragOverFolderId = folder.id; isDragging = false"
            @dragleave.prevent.stop="dragOverFolderId = null" @drop.prevent.stop="onDrop($event, folder.id)">
            <!-- Click to navigate -->
            <button class="flex w-full items-center gap-3 px-3 py-3 text-left" @click="navigateTo(folder.id)">
              <UIcon :name="folderIcon(folder)" class="size-5 shrink-0"
                :class="dragOverFolderId === folder.id ? 'text-primary' : 'text-warning'" />
              <div class="min-w-0 flex-1">
                <!-- Rename input -->
                <div v-if="renaming?.id === folder.id" class="flex items-center gap-1.5" @click.stop>
                  <UInput v-model="renameValue" size="xs" autofocus class="w-32" @keydown.enter="confirmRename"
                    @keydown.escape="renaming = null" />
                  <UButton size="xs" :loading="renameLoading" @click.stop="confirmRename">✓</UButton>
                  <span v-if="renameError" class="text-xs text-error">{{ renameError }}</span>
                </div>
                <span v-else class="truncate text-sm font-medium text-highlighted">{{ folder.name }}</span>
                <span v-if="folder.predefined" class="block text-xs text-muted">Predefinida</span>
                <span v-else class="block text-xs text-muted">
                  {{ childFolders(folder.id).length }} subcarpetas
                </span>
              </div>
            </button>

            <!-- Folder actions (non-predefined only) -->
            <div v-if="!folder.predefined && canUpload"
              class="absolute right-2 top-2 hidden items-center gap-1 group-hover:flex">
              <UButton icon="i-lucide-pencil" size="xs" color="neutral" variant="ghost" :aria-label="F.actions.rename"
                @click.stop="startRename(folder)" />
              <UButton icon="i-lucide-trash-2" size="xs" color="error" variant="ghost" :aria-label="F.actions.delete"
                @click.stop="deletingFolder = folder" />
            </div>
          </div>
        </div>

        <!-- Files table -->
        <div v-if="filesLoading" class="space-y-2">
          <USkeleton v-for="i in 3" :key="i" class="h-10 w-full rounded" />
        </div>

        <template v-else-if="currentFiles.length">
          <div class="overflow-x-auto rounded-lg border border-default">
            <table class="w-full text-sm">
              <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                <tr>
                  <th class="px-3 py-2 text-left font-medium">{{ F.columns.name }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ F.columns.size }}</th>
                  <th class="px-3 py-2 text-left font-medium">{{ F.columns.uploadedBy }}</th>
                  <th class="px-3 py-2 text-left font-medium">{{ F.columns.uploadedAt }}</th>
                  <th class="px-3 py-2" />
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-for="file in currentFiles" :key="file.id" class="group transition-colors hover:bg-elevated/40">
                  <td class="px-3 py-2">
                    <div class="flex items-center gap-2">
                      <UIcon :name="fileIcon(file.mimeType)" class="size-4 shrink-0 text-muted" />
                      <span class="truncate text-highlighted">{{ file.name }}</span>
                    </div>
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums text-muted">
                    {{ formatBytes(file.sizeBytes) }}
                  </td>
                  <td class="px-3 py-2 text-muted">{{ file.uploadedById }}</td>
                  <td class="px-3 py-2 text-muted">{{ formatDate(file.uploadedAt) }}</td>
                  <td class="px-3 py-2">
                    <div
                      class="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <UButton icon="i-lucide-download" size="xs" color="neutral" variant="ghost"
                        :loading="downloadingId === file.id" :aria-label="F.actions.download"
                        @click="downloadFile(file)" />
                      <UButton v-if="file.uploadedById === currentUserId" icon="i-lucide-trash-2" size="xs"
                        color="error" variant="ghost" :aria-label="F.actions.delete" @click="deletingFile = file" />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <!-- Empty state (no subfolders and no files) -->
        <div v-else-if="!visibleSubfolders.length" class="flex flex-col items-center justify-center py-20 text-center"
          @click="canUpload && ($refs.fileInput as HTMLInputElement).click()"
          :class="canUpload ? 'cursor-pointer' : ''">
          <UIcon name="i-lucide-folder-open" class="mb-3 size-10 text-muted" />
          <p class="text-sm text-muted">{{ F.empty }}</p>
          <p v-if="canUpload" class="mt-1 text-xs text-muted">{{ F.upload.dropHere }}</p>
        </div>

        <!-- Empty folder but subfolders visible -->
        <div v-else-if="!filesLoading && !currentFiles.length && currentFolderId"
          class="mt-2 py-6 text-center text-sm text-muted">
          {{ F.empty }}
          <span v-if="canUpload"> — {{ F.upload.dropHere }}</span>
        </div>
      </div>

      <!-- Delete folder confirmation modal -->

      <!-- Delete file confirmation modal -->

    </template>
  </UDashboardPanel>


  <UModal v-model:open="showDeleteFolder" :title="F.actions.delete">
    <template #body>
      <p class="text-sm text-default">{{ F.deleteFolderConfirm }}</p>
      <p class="mt-1 font-medium text-highlighted">{{ deletingFolder?.name }}</p>
      <p v-if="deleteFolderError" class="mt-2 text-xs text-error">{{ deleteFolderError }}</p>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-3">
        <UButton color="neutral" variant="ghost" @click="deletingFolder = null">
          {{ F.actions.cancel }}
        </UButton>
        <UButton color="error" :loading="deleteFolderLoading" @click="confirmDeleteFolder">
          {{ F.actions.delete }}
        </UButton>
      </div>
    </template>
  </UModal>

  <UModal v-model:open="showDeleteFile" :title="F.actions.delete">
    <template #body>
      <p class="text-sm text-default">{{ F.deleteFileConfirm }}</p>
      <p class="mt-1 font-medium text-highlighted">{{ deletingFile?.name }}</p>
      <p v-if="deleteFileError" class="mt-2 text-xs text-error">{{ deleteFileError }}</p>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-3">
        <UButton color="neutral" variant="ghost" @click="deletingFile = null">
          {{ F.actions.cancel }}
        </UButton>
        <UButton color="error" :loading="deleteFileLoading" @click="confirmDeleteFile">
          {{ F.actions.delete }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>