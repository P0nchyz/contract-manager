<!-- app/pages/contracts/[contractId]/logbook/[logNoteId].vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import type { UserId } from '~/data/models'

definePageMeta({ requiredPermission: 'logNote:create' })

const L = S.logNote

const route = useRoute()
const repos = useRepositories()
const { can, role } = usePermissions()

const contractId = computed(() => route.params.contractId as string)
const logNoteId  = computed(() => route.params.logNoteId  as string)

const { data, status, error, refresh } = await useAsyncData(
  () => `lognote-${logNoteId.value}`,
  async () => {
    const [note, users] = await Promise.all([
      repos.logNotes.getById(logNoteId.value),
      repos.users.list().catch(() => []),
    ])
    const names: Record<string, string> = {}
    for (const u of users) names[u.id] = u.fullName
    return { note: { ...note, createdAt: new Date(note.createdAt) }, names }
  },
)

const note = computed(() => data.value?.note ?? null)
const userName = (id: UserId | null | undefined) =>
  (id && data.value?.names[id]) || (id ?? '—')

function fmt(d: Date | string) {
  return new Date(d).toLocaleString('es-MX', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const mySlot = computed(() =>
  note.value?.signatures.find((s) => s.role === role.value) ?? null,
)
const canSign = computed(() =>
  !note.value?.locked && can('sign') && !!mySlot.value && mySlot.value.status === 'pending',
)

const busy        = ref(false)
const actionError = ref<string | null>(null)

async function sign() {
  busy.value = true; actionError.value = null
  try {
    await repos.logNotes.sign(logNoteId.value)
    await refresh()
  } catch (e) {
    actionError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally { busy.value = false }
}
</script>

<template>
  <UDashboardPanel id="lognote-detail">
    <template #header>
      <UDashboardNavbar :title="note ? `Folio ${note.folio} — ${note.title}` : L.title">
        <template #leading>
          <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost"
            :to="`/contracts/${contractId}/logbook`" :aria-label="S.common.back" />
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
      <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-alert-triangle" :title="S.common.error"
        :actions="[{ label: 'Reintentar', color: 'neutral', variant: 'subtle', onClick: () => refresh() }]" />

      <div v-else-if="status === 'pending'" class="space-y-4">
        <USkeleton class="h-36 w-full rounded-lg" />
        <USkeleton class="h-48 w-full rounded-lg" />
      </div>

      <div v-else-if="note" class="space-y-6">
        <!-- Signed notice -->
        <UAlert v-if="note.locked" color="success" variant="soft" icon="i-lucide-lock" :title="L.signedNotice" />

        <!-- Main content card -->
        <UCard>
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-3">
                <span class="font-mono text-sm font-bold text-highlighted">#{{ note.folio }}</span>
                <span class="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  {{ L.categories[note.category] }}
                </span>
                <span v-if="note.isOpeningNote" class="rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
                  Nota de apertura
                </span>
              </div>
              <span class="text-xs text-muted">{{ fmt(note.createdAt) }}</span>
            </div>
          </template>

          <dl class="space-y-4">
            <div>
              <dt class="text-xs text-muted">{{ L.fields.title }}</dt>
              <dd class="font-semibold text-highlighted">{{ note.title }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted">{{ L.author }}</dt>
              <dd class="text-highlighted">{{ userName(note.authorId) }}</dd>
            </div>

            <!-- Fixed body (opening note) -->
            <div v-if="note.fixedBody">
              <dt class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{{ L.sections.fixedBody }}</dt>
              <dd class="whitespace-pre-wrap rounded-lg bg-elevated/50 px-4 py-3 text-sm text-highlighted border border-default">
                {{ note.fixedBody }}
              </dd>
            </div>

            <!-- Custom body -->
            <div v-if="note.customBody">
              <dt class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                {{ note.fixedBody ? L.sections.customBody : 'Nota' }}
              </dt>
              <dd class="whitespace-pre-wrap rounded-lg bg-elevated/50 px-4 py-3 text-sm text-highlighted">
                {{ note.customBody }}
              </dd>
            </div>

            <div v-if="!note.fixedBody && !note.customBody" class="text-sm text-muted italic">Sin contenido.</div>
          </dl>
        </UCard>

        <!-- Signatures card -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-pen-line" class="size-4 text-muted" />
              {{ L.sections.signatures }}
            </div>
          </template>

          <ul class="divide-y divide-default">
            <li v-for="s in note.signatures" :key="s.id" class="flex items-center justify-between py-3">
              <div class="flex items-center gap-3">
                <UIcon
                  :name="s.status === 'signed' ? 'i-lucide-badge-check' : 'i-lucide-circle-dashed'"
                  class="size-5 shrink-0"
                  :class="s.status === 'signed' ? 'text-success' : 'text-muted'"
                />
                <div>
                  <div class="text-sm font-medium text-highlighted">{{ S.roles[s.role] }}</div>
                  <div class="text-xs text-muted">
                    <template v-if="s.status === 'signed'">
                      {{ userName(s.userId) }} · {{ fmt(s.signedAt!) }}
                    </template>
                    <template v-else>{{ S.estimateDetail.signatures.unsigned }}</template>
                  </div>
                </div>
              </div>
              <UBadge
                :label="s.status === 'signed' ? S.estimateDetail.signatures.signed : S.estimateDetail.signatures.pending"
                :color="s.status === 'signed' ? 'success' : 'neutral'"
                :variant="s.status === 'signed' ? 'soft' : 'outline'"
                size="sm"
              />
            </li>
          </ul>
        </UCard>

        <UAlert v-if="actionError" :title="actionError" color="error" variant="soft" icon="i-lucide-alert-triangle" />

        <!-- Sign bar -->
        <div
          v-if="canSign"
          class="sticky bottom-0 -mx-4 mt-2 flex justify-end border-t border-default bg-default/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
        >
          <UButton color="success" icon="i-lucide-pen-line" :loading="busy" @click="sign">
            {{ L.actions.sign }}
          </UButton>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>