<!-- app/pages/contracts/[contractId]/logbook/[logNoteId].vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import type { UserId } from '~/data/models'

definePageMeta({ requiredPermission: 'logNote:create' })

const D = S.logbookDetail

const route = useRoute()
const repos = useRepositories()
const { can, role } = usePermissions()

const contractId = computed(() => route.params.contractId as string)
const logNoteId = computed(() => route.params.logNoteId as string)

const { data, status, error, refresh } = await useAsyncData(
  () => `lognote-${logNoteId.value}`,
  async () => {
    const note = await repos.logNotes.getById(logNoteId.value)
    const users = await repos.users.list().catch(() => [])
    const names: Record<string, string> = {}
    for (const u of users) names[u.id] = u.fullName
    // Resolve attachment file metadata best-effort (may be empty list)
    const allFiles = await repos.files.listFiles(contractId.value).catch(() => [])
    return { note, names, allFiles }
  },
)

const note = computed(() => data.value?.note ?? null)
const userName = (id: UserId | null | undefined): string =>
  (id && data.value?.names[id]) || (id ?? '—')

const attachments = computed(() => {
  if (!note.value || !data.value) return []
  return data.value.allFiles.filter((f) => note.value!.attachmentFileIds.includes(f.id))
})

// --- Sign action -----------------------------------------------------------
const mySlot = computed(() =>
  note.value?.signatures.find((s) => s.role === role.value) ?? null,
)

const canSign = computed(
  () =>
    can('sign') &&
    !!mySlot.value &&
    mySlot.value.status === 'pending' &&
    !note.value?.locked,
)

const busy = ref(false)
const actionError = ref<string | null>(null)

async function sign() {
  busy.value = true
  actionError.value = null
  try {
    await repos.logNotes.sign(logNoteId.value)
    await refresh()
  } catch (e) {
    actionError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    busy.value = false
  }
}

// --- File size helper ------------------------------------------------------
function formatSize(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(0)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

function fileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'i-lucide-image'
  if (mimeType === 'application/pdf') return 'i-lucide-file-text'
  return 'i-lucide-file'
}
</script>

<template>
  <UDashboardPanel id="lognote-detail">
    <template #header>
      <UDashboardNavbar
        :title="note ? `${D.titlePrefix} ${note.folio} — ${note.title}` : S.nav.logbook"
      >
        <template #leading>
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            :to="`/contracts/${contractId}/logbook`"
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
        class="mb-4"
      />

      <!-- Loading skeleton -->
      <div v-else-if="status === 'pending'" class="space-y-4">
        <USkeleton class="h-24 rounded-lg" />
        <USkeleton class="h-40 rounded-lg" />
        <div class="grid gap-4 lg:grid-cols-2">
          <USkeleton class="h-48 rounded-lg" />
          <USkeleton class="h-48 rounded-lg" />
        </div>
      </div>

      <div v-else-if="note" class="space-y-4">

        <!-- Header meta card -->
        <UCard>
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span class="text-xl font-semibold tabular-nums">Folio {{ note.folio }}</span>
                <UBadge
                  :label="note.locked ? D.locked : D.unlocked"
                  :color="note.locked ? 'success' : 'warning'"
                  :variant="note.locked ? 'soft' : 'subtle'"
                  :icon="note.locked ? 'i-lucide-lock' : 'i-lucide-lock-open'"
                  size="sm"
                />
              </div>
              <p class="text-sm text-muted">{{ note.title }}</p>
            </div>
            <dl class="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <dt class="text-muted">{{ D.date }}</dt>
              <dd class="font-medium tabular-nums">{{ formatDate(note.date) }}</dd>
              <dt class="text-muted">{{ D.author }}</dt>
              <dd class="font-medium">{{ userName(note.authorId) }}</dd>
            </dl>
          </div>
        </UCard>

        <!-- Body / Descripción -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-notebook-text" class="size-4 text-muted" />
              {{ D.sections.body }}
            </div>
          </template>
          <p class="whitespace-pre-wrap text-sm leading-relaxed">{{ note.body }}</p>
        </UCard>

        <!-- Signatures + Attachments row -->
        <div class="grid gap-4 lg:grid-cols-2">

          <!-- Signatures -->
          <UCard>
            <template #header>
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-pen-line" class="size-4 text-muted" />
                {{ D.sections.signatures }}
              </div>
            </template>
            <ul class="divide-y divide-default">
              <li
                v-for="s in note.signatures"
                :key="s.id"
                class="flex items-center justify-between py-2.5"
              >
                <div class="flex items-center gap-3">
                  <UIcon
                    :name="s.status === 'signed' ? 'i-lucide-badge-check' : 'i-lucide-circle-dashed'"
                    class="size-4"
                    :class="s.status === 'signed' ? 'text-success' : 'text-muted'"
                  />
                  <div>
                    <div class="text-sm font-medium text-highlighted">{{ S.roles[s.role] }}</div>
                    <div class="text-xs text-muted">
                      <template v-if="s.status === 'signed'">
                        {{ D.signatures.signedAt }}: {{ userName(s.userId) }} · {{ formatDate(s.signedAt!) }}
                      </template>
                      <template v-else>{{ D.signatures.unsigned }}</template>
                    </div>
                  </div>
                </div>
                <UBadge
                  :label="s.status === 'signed' ? D.signatures.signed : D.signatures.pending"
                  :color="s.status === 'signed' ? 'success' : 'neutral'"
                  :variant="s.status === 'signed' ? 'soft' : 'outline'"
                  size="sm"
                />
              </li>
            </ul>
          </UCard>

          <!-- Attachments -->
          <UCard>
            <template #header>
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-paperclip" class="size-4 text-muted" />
                {{ D.sections.attachments }}
              </div>
            </template>

            <p v-if="!attachments.length" class="text-sm text-muted">
              {{ D.attachmentsEmpty }}
            </p>

            <ul v-else class="divide-y divide-default">
              <li
                v-for="file in attachments"
                :key="file.id"
                class="flex items-center gap-3 py-2.5"
              >
                <UIcon
                  :name="fileIcon(file.mimeType)"
                  class="size-4 shrink-0 text-muted"
                />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">{{ file.name }}</p>
                  <p class="text-xs text-muted">{{ formatSize(file.sizeBytes) }}</p>
                </div>
                <UButton
                  :href="file.downloadUrl"
                  target="_blank"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-download"
                  size="xs"
                  :aria-label="`Descargar ${file.name}`"
                />
              </li>
            </ul>

            <!-- IDs fallback if file metadata not available -->
            <div
              v-if="note.attachmentFileIds.length && !attachments.length"
              class="flex flex-wrap gap-2 pt-2"
            >
              <UBadge
                v-for="id in note.attachmentFileIds"
                :key="id"
                :label="id"
                color="neutral"
                variant="soft"
                size="sm"
                icon="i-lucide-file"
              />
            </div>
          </UCard>
        </div>

        <!-- Action error -->
        <UAlert
          v-if="actionError"
          :title="actionError"
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
        />

        <!-- Sticky sign bar -->
        <div
          v-if="canSign"
          class="sticky bottom-0 -mx-4 mt-2 flex items-center justify-end gap-3 border-t border-default bg-default/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
        >
          <UButton
            icon="i-lucide-pen-line"
            color="primary"
            variant="outline"
            :loading="busy"
            @click="sign"
          >
            {{ D.actions.sign }}
          </UButton>
        </div>

      </div>
    </template>
  </UDashboardPanel>
</template>
