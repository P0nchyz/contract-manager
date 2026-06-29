<!-- app/pages/contracts/[contractId]/evidence/[evidenceId].vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'

definePageMeta({ requiredPermission: 'estimate:view' })

const EV = S.evidence

const route = useRoute()
const repos = useRepositories()

const contractId = computed(() => route.params.contractId as string)
const evidenceId = computed(() => route.params.evidenceId as string)

const { data, status, error, refresh } = await useAsyncData(
  () => `evidence-detail-${evidenceId.value}`,
  async () => {
    const [note, users] = await Promise.all([
      repos.evidence.getById(evidenceId.value),
      repos.users.list().catch(() => []),
    ])
    // Resolve attached file metadata
    const allFiles = note.fileIds.length
      ? await repos.files.listFiles(contractId.value).catch(() => [])
      : []
    const attachedFiles = allFiles.filter((f) => note.fileIds.includes(f.id))
    const authorName = users.find((u) => u.id === note.authorId)?.fullName ?? note.authorId
    // Re-hydrate date fields in case useAsyncData serialized them to strings
    const hydratedNote = {
      ...note,
      date:      note.date      ? new Date(note.date)      : null,
      createdAt: note.createdAt ? new Date(note.createdAt) : null,
    }
    return { note: hydratedNote, attachedFiles, authorName }
  },
)

// ─── Download ─────────────────────────────────────────────────────────────────
const downloadingId = ref<string | null>(null)
const downloadError = ref<string | null>(null)

async function downloadFile(fileId: string, fileName: string) {
  downloadingId.value = fileId
  downloadError.value = null
  try {
    const url = await repos.files.getDownloadUrl(fileId)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (err) {
    downloadError.value = isRepositoryError(err) ? err.message : S.common.error
  } finally {
    downloadingId.value = null
  }
}

function formatBytes(n: number) {
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1_048_576).toFixed(1)} MB`
}

function fileIcon(mime: string): string {
  if (mime.startsWith('image/'))     return 'i-lucide-image'
  if (mime === 'application/pdf')    return 'i-lucide-file-text'
  if (mime.includes('spreadsheet') || mime.includes('excel')) return 'i-lucide-table'
  if (mime.includes('word') || mime.includes('document'))     return 'i-lucide-file-text'
  if (mime.startsWith('video/'))     return 'i-lucide-video'
  return 'i-lucide-file'
}
</script>

<template>
  <UDashboardPanel id="evidence-detail">
    <template #header>
      <UDashboardNavbar :title="data?.note.title ?? EV.title">
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
      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        icon="i-lucide-alert-triangle"
        :title="S.common.error"
        :actions="[{ label: 'Reintentar', color: 'neutral', variant: 'subtle', onClick: () => refresh() }]"
      />

      <div v-else-if="status === 'pending'" class="space-y-4">
        <USkeleton class="h-36 w-full rounded-lg" />
        <USkeleton class="h-24 w-full rounded-lg" />
      </div>

      <template v-else-if="data">
        <!-- Content -->
        <UCard>
          <dl class="grid gap-x-8 gap-y-4 sm:grid-cols-3">
            <div class="sm:col-span-2">
              <dt class="text-xs text-muted">{{ EV.fields.title }}</dt>
              <dd class="font-semibold text-highlighted">{{ data.note.title }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted">{{ EV.fields.date }}</dt>
              <dd class="text-highlighted">{{ data.note.date ? formatDate(data.note.date) : '—' }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted">{{ EV.columns.author }}</dt>
              <dd class="text-highlighted">{{ data.authorName }}</dd>
            </div>
            <div class="sm:col-span-3">
              <dt class="mb-1.5 text-xs text-muted">{{ EV.fields.body }}</dt>
              <dd class="whitespace-pre-wrap rounded-lg bg-elevated/50 px-3 py-2.5 text-sm text-highlighted">
                {{ data.note.body }}
              </dd>
            </div>
          </dl>
        </UCard>

        <!-- Attached files -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-paperclip" class="size-4 text-muted" />
              {{ EV.detail.files }}
              <UBadge
                v-if="data.attachedFiles.length"
                :label="String(data.attachedFiles.length)"
                color="neutral"
                variant="soft"
                size="sm"
              />
            </div>
          </template>

          <p v-if="!data.attachedFiles.length" class="text-sm text-muted">
            {{ EV.detail.noFiles }}
          </p>

          <ul v-else class="divide-y divide-default">
            <li
              v-for="file in data.attachedFiles"
              :key="file.id"
              class="flex items-center gap-3 py-2.5"
            >
              <UIcon
                :name="fileIcon(file.mimeType)"
                class="size-4 shrink-0 text-muted"
              />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-highlighted">{{ file.name }}</p>
                <p class="text-xs text-muted">{{ formatBytes(file.sizeBytes) }}</p>
              </div>
              <UButton
                icon="i-lucide-download"
                size="xs"
                color="neutral"
                variant="ghost"
                :loading="downloadingId === file.id"
                :aria-label="EV.detail.download"
                @click="downloadFile(file.id, file.name)"
              />
            </li>
          </ul>

          <UAlert
            v-if="downloadError"
            :title="downloadError"
            color="error"
            variant="soft"
            icon="i-lucide-alert-triangle"
            class="mt-3"
          />
        </UCard>
      </template>
    </template>
  </UDashboardPanel>
</template>