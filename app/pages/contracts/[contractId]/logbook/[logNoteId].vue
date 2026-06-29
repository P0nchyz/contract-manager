<!-- app/pages/contracts/[contractId]/logbook/[logNoteId].vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import type { UserId } from '~/data/models'

definePageMeta({ requiredPermission: 'estimate:view' })

const L = S.logNote

const route = useRoute()
const repos = useRepositories()
const { can, role } = usePermissions()

const contractId = computed(() => route.params.contractId as string)
const logNoteId  = computed(() => route.params.logNoteId as string)

const { data, status, error, refresh } = await useAsyncData(
  () => `lognote-${logNoteId.value}`,
  async () => {
    const [note, users] = await Promise.all([
      repos.logNotes.getById(logNoteId.value),
      repos.users.list().catch(() => []),
    ])
    const names: Record<string, string> = {}
    for (const u of users) names[u.id] = u.fullName
    return { note, names }
  },
)

const note    = computed(() => data.value?.note ?? null)
const userName = (id: UserId | null | undefined) =>
  (id && data.value?.names[id]) || (id ?? '—')

// --- Signing gating ---
// A note can be signed when: unlocked, and the current user's slot is pending.
// No separate "submit" — the note is signable immediately after creation.
const mySlot = computed(() =>
  note.value?.signatures.find((s) => s.role === role.value) ?? null,
)
const canSign = computed(
  () =>
    !note.value?.locked &&
    can('sign') &&
    !!mySlot.value &&
    mySlot.value.status === 'pending',
)

// --- Sign action ---
const busy        = ref(false)
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
</script>

<template>
  <UDashboardPanel id="lognote-detail">
    <template #header>
      <UDashboardNavbar
        :title="note ? `${L.folio} ${note.folio}` : L.title"
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
        <template #right>
          <UBadge
            v-if="note"
            :label="note.locked ? L.status.locked : L.status.unlocked"
            :color="note.locked ? 'success' : 'warning'"
            variant="soft"
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
        <USkeleton class="h-48 w-full rounded-lg" />
      </div>

      <template v-else-if="note">
        <!-- Locked notice -->
        <UAlert
          v-if="note.locked"
          color="success"
          variant="soft"
          icon="i-lucide-lock"
          :title="L.signedNotice"
        />

        <!-- Content card -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-notebook-pen" class="size-4 text-muted" />
              {{ L.sections.content }}
            </div>
          </template>

          <dl class="grid gap-x-8 gap-y-4 sm:grid-cols-3">
            <div>
              <dt class="text-xs text-muted">{{ L.folio }}</dt>
              <dd class="font-mono font-semibold text-highlighted">{{ note.folio }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted">{{ L.date }}</dt>
              <dd class="text-highlighted">{{ formatDate(note.date) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted">{{ L.author }}</dt>
              <dd class="text-highlighted">{{ userName(note.authorId) }}</dd>
            </div>
            <div class="sm:col-span-3">
              <dt class="text-xs text-muted">{{ L.fields.title }}</dt>
              <dd class="font-medium text-highlighted">{{ note.title }}</dd>
            </div>
            <div class="sm:col-span-3">
              <dt class="mb-1.5 text-xs text-muted">{{ L.body }}</dt>
              <dd class="whitespace-pre-wrap rounded-lg bg-elevated/50 px-3 py-2.5 text-sm text-highlighted">{{ note.body }}</dd>
            </div>
          </dl>

          <!-- Attachments -->
          <div v-if="note.attachmentFileIds.length" class="mt-4 border-t border-default pt-4">
            <div class="mb-2 text-xs font-medium text-muted">{{ L.attachments }}</div>
            <div class="flex flex-wrap gap-2">
              <UBadge
                v-for="id in note.attachmentFileIds"
                :key="id"
                :label="id"
                color="neutral"
                variant="soft"
                icon="i-lucide-paperclip"
                size="sm"
              />
            </div>
          </div>
        </UCard>

        <!-- Signatures -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-pen-line" class="size-4 text-muted" />
              {{ L.sections.signatures }}
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
                      {{ S.estimateDetail.signatures.signedAt }}:
                      {{ userName(s.userId) }} · {{ formatDate(s.signedAt!) }}
                    </template>
                    <template v-else>{{ S.estimateDetail.signatures.unsigned }}</template>
                  </div>
                </div>
              </div>
              <UBadge
                :label="s.status === 'signed'
                  ? S.estimateDetail.signatures.signed
                  : S.estimateDetail.signatures.pending"
                :color="s.status === 'signed' ? 'success' : 'neutral'"
                :variant="s.status === 'signed' ? 'soft' : 'outline'"
                size="sm"
              />
            </li>
          </ul>
        </UCard>

        <UAlert
          v-if="actionError"
          :title="actionError"
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
        />

        <!-- Sticky action bar — only visible when the user can sign -->
        <div
          v-if="canSign"
          class="sticky bottom-0 -mx-4 mt-2 flex justify-end border-t border-default bg-default/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
        >
          <UButton
            color="success"
            icon="i-lucide-pen-line"
            :loading="busy"
            @click="sign"
          >
            {{ L.actions.sign }}
          </UButton>
        </div>
      </template>
    </template>
  </UDashboardPanel>
</template>