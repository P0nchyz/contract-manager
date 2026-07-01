<!-- app/pages/contracts/[contractId]/finiquito.vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import { agreementStatusDisplay } from '~/utils/format'
import type { UserId } from '~/data/models'

definePageMeta({ requiredPermission: 'estimate:view' })

const F = S.finiquito

const route = useRoute()
const repos = useRepositories()
const { can, role } = usePermissions()

const contractId = computed(() => route.params.contractId as string)

const { data, status, error, refresh } = await useAsyncData(
  () => `finiquito-${contractId.value}`,
  async () => {
    const [finiquito, reception, users] = await Promise.all([
      repos.finiquito.getByContract(contractId.value).catch(() => null),
      repos.reception.getByContract(contractId.value).catch(() => null),
      repos.users.list().catch(() => []),
    ])
    const names: Record<string, string> = {}
    for (const u of users) names[u.id] = u.fullName
    return { finiquito, reception, names }
  },
)

const finiquito = computed(() => data.value?.finiquito ?? null)
const receptionApproved = computed(() => data.value?.reception?.status === 'approved')
const userName = (id: UserId | null | undefined) =>
  (id && data.value?.names[id]) || (id ?? '—')

// --- Workflow gating ---
const st = computed(() => finiquito.value?.status ?? null)
const mySlot = computed(() =>
  finiquito.value?.signatures.find((s) => s.role === role.value) ?? null,
)

const canInitiate = computed(() => can('close:initiate') && receptionApproved.value && !finiquito.value)
const canSubmit = computed(() => st.value === 'draft' && can('close:initiate'))
const canSign = computed(
  () =>
    st.value === 'submitted' &&
    can('sign') &&
    !!mySlot.value &&
    mySlot.value.status === 'pending',
)
const canReturn = computed(
  () => st.value === 'submitted' && can('estimate:returnWithNotes'),
)
const canReject = computed(() => st.value === 'submitted' && can('estimate:reject'))
const showReview = computed(() => canReturn.value || canReject.value)
const hasBarAction = computed(() => canSubmit.value || canSign.value)

const latestNote = computed(() => {
  const fin = finiquito.value
  if (!fin || (fin.status !== 'with_notes' && fin.status !== 'rejected')) return null
  for (let i = fin.history.length - 1; i >= 0; i--) {
    const ev = fin.history[i]
    if (ev.action === 'returned_with_notes' || ev.action === 'rejected') return ev
  }
  return null
})

// --- Actions ---
const busy = ref(false)
const actionError = ref<string | null>(null)

async function run(fn: () => Promise<unknown>) {
  busy.value = true
  actionError.value = null
  try {
    await fn()
    await refresh()
  } catch (e) {
    actionError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    busy.value = false
  }
}

const initiate = () => run(() => repos.finiquito.initiate(contractId.value))
const submit = () => run(() => repos.finiquito.submit(finiquito.value!.id))
const sign = () => run(() => repos.finiquito.sign(finiquito.value!.id))

const reviewNote = ref('')
const reviewError = ref<string | null>(null)
function withNote(action: (id: string, note: string) => Promise<unknown>) {
  const note = reviewNote.value.trim()
  if (!note) { reviewError.value = F.note.required; return }
  reviewError.value = null
  reviewNote.value = ''
  return run(() => action(finiquito.value!.id, note))
}
const returnWithNotes = () => withNote(repos.finiquito.returnWithNotes)
const reject = () => withNote(repos.finiquito.reject)
</script>

<template>
  <UDashboardPanel id="finiquito">
    <template #header>
      <UDashboardNavbar :title="F.title">
        <template #leading>
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            :to="`/contracts/${contractId}/contract`"
            :aria-label="S.common.back"
          />
        </template>
        <template #right>
          <StatusBadge
            v-if="finiquito"
            :display="agreementStatusDisplay[finiquito.status]"
            size="md"
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
        <USkeleton class="h-40 w-full rounded-lg" />
      </div>

      <!-- Blocked: reception not yet approved -->
      <UAlert
        v-else-if="!receptionApproved && !finiquito"
        color="neutral"
        variant="soft"
        icon="i-lucide-lock"
        :title="F.blockedNotice"
        :actions="[{ label: S.reception.title, color: 'neutral', variant: 'subtle',
                     to: `/contracts/${contractId}/reception` }]"
      />

      <!-- Initiate: reception approved, no finiquito yet -->
      <div v-else-if="canInitiate" class="space-y-6">
        <div
          class="rounded-lg border border-dashed border-default py-16 text-center"
        >
          <UIcon name="i-lucide-flag" class="mx-auto mb-3 size-8 text-muted" />
          <p class="mb-4 text-sm text-muted">{{ F.title }}</p>
          <UButton icon="i-lucide-play" :loading="busy" @click="initiate">
            {{ F.initiate }}
          </UButton>
        </div>
        <UAlert
          v-if="actionError"
          :title="actionError"
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
          class="mt-4"
        />
      </div>

      <!-- Flow view -->
      <div v-else-if="finiquito" class="space-y-6">
        <!-- Banner -->
        <UAlert
          v-if="latestNote"
          :color="finiquito.status === 'rejected' ? 'error' : 'warning'"
          variant="soft"
          icon="i-lucide-message-square-warning"
          :title="finiquito.status === 'rejected' ? F.banner.rejected : F.banner.withNotes"
          :description="latestNote.note"
        />

        <!-- Inline review -->
        <UCard v-if="showReview">
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-clipboard-pen" class="size-4 text-muted" />
              {{ S.estimateDetail.review.title }}
            </div>
          </template>
          <UFormField :label="F.note.label" :error="reviewError || undefined">
            <UTextarea
              v-model="reviewNote"
              :rows="3"
              class="w-full"
              :placeholder="F.note.placeholder"
            />
          </UFormField>
          <div class="mt-3 flex flex-wrap justify-end gap-3">
            <UButton
              v-if="canReject"
              color="error"
              variant="soft"
              icon="i-lucide-x-circle"
              :disabled="busy"
              @click="reject"
            >
              {{ F.actions.reject }}
            </UButton>
            <UButton
              v-if="canReturn"
              color="warning"
              variant="soft"
              icon="i-lucide-corner-up-left"
              :disabled="busy"
              @click="returnWithNotes"
            >
              {{ F.actions.returnWithNotes }}
            </UButton>
          </div>
        </UCard>

        <!-- Signatures + History -->
        <div class="grid gap-4 lg:grid-cols-2">
          <UCard>
            <template #header>
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-pen-line" class="size-4 text-muted" />
                {{ F.sections.signatures }}
              </div>
            </template>
            <ul class="divide-y divide-default">
              <li
                v-for="s in finiquito.signatures"
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

          <UCard>
            <template #header>
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-history" class="size-4 text-muted" />
                {{ F.sections.history }}
              </div>
            </template>
            <ol class="relative space-y-4 border-s border-default ps-5">
              <li v-for="ev in [...finiquito.history].reverse()" :key="ev.id" class="relative">
                <span
                  class="absolute -start-[1.4rem] top-1 size-2.5 rounded-full bg-muted ring-4 ring-default"
                />
                <div class="text-sm font-medium text-highlighted">
                  {{ S.workflow[ev.action] }}
                </div>
                <div class="text-xs text-muted">
                  {{ userName(ev.byUserId) }} · {{ formatDate(ev.at) }}
                </div>
                <p
                  v-if="ev.note"
                  class="mt-1 rounded-md bg-elevated/60 px-2 py-1 text-xs text-default"
                >
                  {{ ev.note }}
                </p>
              </li>
            </ol>
          </UCard>
        </div>

        <UAlert
          v-if="actionError"
          :title="actionError"
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
        />

        <div
          v-if="hasBarAction"
          class="sticky bottom-0 -mx-4 mt-2 flex justify-end gap-3 border-t border-default bg-default/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
        >
          <UButton v-if="canSubmit" icon="i-lucide-send" :loading="busy" @click="submit">
            {{ F.actions.submit }}
          </UButton>
          <UButton
            v-if="canSign"
            color="success"
            icon="i-lucide-pen-line"
            :loading="busy"
            @click="sign"
          >
            {{ F.actions.sign }}
          </UButton>
        </div>
      </div>

      <!-- Non-initiating roles, nothing started -->
      <template v-else>
        <div
          class="rounded-lg border border-dashed border-default py-16 text-center text-sm text-muted"
        >
          {{ S.contractInfo.closing.notStarted }}
        </div>
      </template>
    </template>
  </UDashboardPanel>
</template>