<!-- app/pages/contracts/[contractId]/evidence/index.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { S } from '~/constants/strings'
import type { FileAsset } from '~/data/models'

definePageMeta({ requiredPermission: 'estimate:view' })

const EV = S.evidence

const route = useRoute()
const repos = useRepositories()
const { can } = usePermissions()

const contractId = computed(() => route.params.contractId as string)
const canCreate = computed(() => can('evidence:create'))

const { data, status, error, refresh } = await useAsyncData(
  () => `evidence-${contractId.value}`,
  async () => {
    const [notes, users, files] = await Promise.all([
      repos.evidence.listByContract(contractId.value),
      repos.users.list().catch(() => []),
      repos.files.listFiles(contractId.value).catch(() => []),
    ])
    const nameOf = (id: string) => users.find((u) => u.id === id)?.fullName ?? id
    const filesOf = (fileIds: string[]) => files.filter((f) => fileIds.includes(f.id))
    // Ensure date fields are Date objects (useAsyncData serialization can turn them into strings)
    const parsedNotes = notes.map((n) => ({
      ...n,
      date: n.date ? new Date(n.date) : null,
      createdAt: n.createdAt ? new Date(n.createdAt) : null,
    }))
    return { notes: parsedNotes, nameOf, filesOf }
  },
)

// ─── Viewer ───────────────────────────────────────────────────────────────────
const viewerOpen = ref(false)
const viewingFile = ref<FileAsset | null>(null)
function openViewer(file: FileAsset) {
  viewingFile.value = file
  viewerOpen.value = true
}
</script>

<template>
  <UDashboardPanel id="evidence">
    <template #header>
      <UDashboardNavbar :title="EV.title">
        <template #right>
          <UButton v-if="canCreate" icon="i-lucide-plus" size="sm" :to="`/contracts/${contractId}/evidence/new`">
            {{ EV.new }}
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-alert-triangle" :title="S.common.error"
        :actions="[{ label: 'Reintentar', color: 'neutral', variant: 'subtle', onClick: () => refresh() }]" />

      <div v-else-if="status === 'pending'" class="space-y-3">
        <USkeleton v-for="i in 4" :key="i" class="h-14 w-full rounded-lg" />
      </div>

      <div v-else-if="data" class="space-y-6">
        <div v-if="!data.notes.length" class="rounded-lg border border-dashed border-default py-16 text-center">
          <UIcon name="i-lucide-camera" class="mx-auto mb-3 size-8 text-muted" />
          <p class="text-sm text-muted">{{ EV.empty }}</p>
          <UButton v-if="canCreate" icon="i-lucide-plus" size="sm" color="neutral" variant="outline" class="mt-3"
            :to="`/contracts/${contractId}/evidence/new`">
            {{ EV.new }}
          </UButton>
        </div>

        <UCard v-else :ui="{ body: 'p-0 sm:p-0' }">
          <table class="w-full text-sm">
            <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
              <tr>
                <th class="px-4 py-2.5 text-left font-medium">{{ EV.columns.title }}</th>
                <th class="px-4 py-2.5 text-left font-medium">{{ EV.columns.date }}</th>
                <th class="px-4 py-2.5 text-left font-medium">{{ EV.columns.author }}</th>
                <th class="px-4 py-2.5 text-left font-medium">{{ EV.columns.files }}</th>
                <th class="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <tr v-for="note in data.notes" :key="note.id"
                class="cursor-pointer transition-colors hover:bg-elevated/40"
                @click="navigateTo(`/contracts/${contractId}/evidence/${note.id}`)">
                <td class="px-4 py-3 font-medium text-highlighted">{{ note.title }}</td>
                <td class="px-4 py-3 text-muted">{{ note.date ? formatDate(note.date) : '—' }}</td>
                <td class="px-4 py-3 text-muted">{{ data.nameOf(note.authorId) }}</td>
                <td class="px-4 py-3">
                  <div v-if="note.fileIds.length" class="flex flex-wrap items-center gap-1">
                    <button v-for="file in data.filesOf(note.fileIds).slice(0, 3)" :key="file.id" type="button"
                      class="inline-flex max-w-[9rem] items-center gap-1 rounded bg-elevated px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-elevated/70 hover:text-highlighted"
                      @click.stop="openViewer(file)">
                      <UIcon :name="fileIcon(file.mimeType)" class="size-3 shrink-0" />
                      <span class="truncate">{{ file.name }}</span>
                    </button>
                    <span v-if="note.fileIds.length > 3" class="text-xs text-muted">
                      +{{ note.fileIds.length - 3 }}
                    </span>
                  </div>
                  <span v-else class="text-xs text-muted">—</span>
                </td>
                <td class="px-4 py-3">
                  <UButton icon="i-lucide-chevron-right" color="neutral" variant="ghost" size="xs"
                    :to="`/contracts/${contractId}/evidence/${note.id}`" @click.stop />
                </td>
              </tr>
            </tbody>
          </table>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <!-- File viewer — must live outside UDashboardPanel -->
  <FileViewerModal v-model:open="viewerOpen" :file="viewingFile" />
</template>