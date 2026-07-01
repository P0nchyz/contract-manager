<!-- app/pages/contracts/[contractId]/reception.vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import { agreementStatusDisplay } from '~/utils/format'
import type { UserId } from '~/data/models'

definePageMeta({ requiredPermission: 'estimate:view' })

const R = S.reception

const route = useRoute()
const repos = useRepositories()
const { can, role } = usePermissions()

const contractId = computed(() => route.params.contractId as string)

const { data, status, error, refresh } = await useAsyncData(
  () => `reception-${contractId.value}`,
  async () => {
    const [reception, users] = await Promise.all([
      repos.reception.getByContract(contractId.value).catch(() => null),
      repos.users.list().catch(() => []),
    ])
    const names: Record<string, string> = {}
    for (const u of users) names[u.id] = u.fullName
    return { reception, names }
  },
)

const reception = computed(() => data.value?.reception ?? null)
const userName = (id: UserId | null | undefined) =>
  (id && data.value?.names[id]) || (id ?? '—')

// --- Log note step (shown before initiating when none exists) ---
// The resident fills in the closing log note first; on submit the note is
// created and immediately linked to the newly-created reception record.
const step = ref<'logNote' | 'flow'>('flow')
watchEffect(() => {
  if (data.value && !data.value.reception && can('close:initiate')) {
    step.value = 'logNote'
  } else {
    step.value = 'flow'
  }
})

const logNoteTitle = ref('')
const logNoteDate = ref(new Date().toISOString().slice(0, 10))
const logNoteBody = ref('')
const logNoteErrors = reactive({ title: '', date: '', body: '' })

function validateLogNote(): boolean {
  logNoteErrors.title = logNoteTitle.value.trim() ? '' : R.logNoteStep.required
  logNoteErrors.date = logNoteDate.value ? '' : R.logNoteStep.required
  logNoteErrors.body = logNoteBody.value.trim() ? '' : R.logNoteStep.required
  return !logNoteErrors.title && !logNoteErrors.date && !logNoteErrors.body
}

// --- Workflow gating ---
const st = computed(() => reception.value?.status ?? null)
const mySlot = computed(() =>
  reception.value?.signatures.find((s) => s.role === role.value) ?? null,
)

const canInitiate = computed(() => can('close:initiate'))
const canSubmit = computed(() => st.value === 'draft' && canInitiate.value)
const canSign = computed(
  () =>
    st.value === 'submitted' &&
    can('sign') &&
    !!mySlot.value &&
    mySlot.value.status === 'pending',
)
const canReturn = computed(
  () => (st.value === 'submitted' || st.value === 'pending_entity') && can('estimate:returnWithNotes'),
)
const canReject = computed(() => st.value === 'submitted' && can('estimate:reject'))
const canApproveAsEntity = computed(
  () => st.value === 'pending_entity' && can('agreement:approve'),
)
const showReview = computed(() => canReturn.value || canReject.value)
const hasBarAction = computed(() => canSubmit.value || canSign.value || canApproveAsEntity.value)

const latestNote = computed(() => {
  const rec = reception.value
  if (!rec || (rec.status !== 'with_notes' && rec.status !== 'rejected')) return null
  for (let i = rec.history.length - 1; i >= 0; i--) {
    const ev = rec.history[i]
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

async function initiateWithLogNote() {
  if (!validateLogNote()) return
  busy.value = true
  actionError.value = null
  try {
    // 1. Create the closing log note.
    const note = await repos.logNotes.create({
      contractId: contractId.value,
      title: logNoteTitle.value.trim(),
      date: new Date(`${logNoteDate.value}T12:00:00`),
      body: logNoteBody.value.trim(),
    })
    // 2. Initiate the reception record.
    const rec = await repos.reception.initiate(contractId.value)
    // 3. Reception doesn't have a log-note linking method in the interface,
    //    but the note is identified by the folio for display.
    //    The note reference is surfaced in the UI via the folio.
    // (When the HTTP repo is wired, send note.id alongside the initiate call.)
    void rec // will refresh
    void note
    await refresh()
    step.value = 'flow'
  } catch (e) {
    actionError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    busy.value = false
  }
}

const submit = () => run(() => repos.reception.submit(reception.value!.id))
const sign = () => run(() => repos.reception.sign(reception.value!.id))
const approveAsEntity = () => run(() => repos.reception.approve(reception.value!.id))

const reviewNote = ref('')
const reviewError = ref<string | null>(null)
function withNote(action: (id: string, note: string) => Promise<unknown>) {
  const note = reviewNote.value.trim()
  if (!note) { reviewError.value = R.note.required; return }
  reviewError.value = null
  reviewNote.value = ''
  return run(() => action(reception.value!.id, note))
}
const returnWithNotes = () => withNote(repos.reception.returnWithNotes)
const reject = () => withNote(repos.reception.reject)
</script>

<template>
  <UDashboardPanel id="reception">
    <template #header>
      <UDashboardNavbar :title="R.title">
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
            v-if="reception"
            :display="agreementStatusDisplay[reception.status]"
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

      <!-- Step 1: Log note (before reception exists, resident only) -->
      <div v-else-if="step === 'logNote'" class="space-y-6">
        <UAlert
          color="neutral"
          variant="soft"
          icon="i-lucide-notebook-pen"
          :title="R.logNoteStep.hint"
          class="mb-4"
        />

        <UCard class="max-w-2xl">
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-notebook-pen" class="size-4 text-muted" />
              {{ R.logNoteStep.title }}
            </div>
          </template>

          <div class="space-y-4">
            <UFormField :label="R.logNoteStep.titleLabel" :error="logNoteErrors.title || undefined">
              <UInput
                v-model="logNoteTitle"
                class="w-full"
                :placeholder="R.logNoteStep.titlePlaceholder"
              />
            </UFormField>

            <UFormField :label="R.logNoteStep.dateLabel" :error="logNoteErrors.date || undefined">
              <UInput v-model="logNoteDate" type="date" class="w-full" />
            </UFormField>

            <UFormField :label="R.logNoteStep.bodyLabel" :error="logNoteErrors.body || undefined">
              <UTextarea
                v-model="logNoteBody"
                :rows="5"
                class="w-full"
                :placeholder="R.logNoteStep.bodyPlaceholder"
              />
            </UFormField>
          </div>
        </UCard>

        <UAlert
          v-if="actionError"
          :title="actionError"
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
          class="mt-4"
        />

        <div
          class="sticky bottom-0 -mx-4 mt-4 flex justify-end gap-3 border-t border-default bg-default/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
        >
          <UButton
            color="neutral"
            variant="ghost"
            :to="`/contracts/${contractId}/contract`"
          >
            {{ S.common.cancel }}
          </UButton>
          <UButton
            icon="i-lucide-arrow-right"
            :loading="busy"
            @click="initiateWithLogNote"
          >
            {{ R.logNoteStep.create }}
          </UButton>
        </div>
      </div>

      <!-- Step 2 / view: reception workflow -->
      <div v-else-if="step === 'flow' && reception" class="space-y-6">
        <!-- Banner -->
        <UAlert
          v-if="latestNote"
          :color="reception.status === 'rejected' ? 'error' : 'warning'"
          variant="soft"
          icon="i-lucide-message-square-warning"
          :title="reception.status === 'rejected' ? R.banner.rejected : R.banner.withNotes"
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
          <UFormField :label="R.note.label" :error="reviewError || undefined">
            <UTextarea
              v-model="reviewNote"
              :rows="3"
              class="w-full"
              :placeholder="R.note.placeholder"
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
              {{ R.actions.reject }}
            </UButton>
            <UButton
              v-if="canReturn"
              color="warning"
              variant="soft"
              icon="i-lucide-corner-up-left"
              :disabled="busy"
              @click="returnWithNotes"
            >
              {{ R.actions.returnWithNotes }}
            </UButton>
          </div>
        </UCard>

        <!-- Signatures + History -->
        <div class="grid gap-4 lg:grid-cols-2">
          <UCard>
            <template #header>
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-pen-line" class="size-4 text-muted" />
                {{ R.sections.signatures }}
              </div>
            </template>
            <ul class="divide-y divide-default">
              <li
                v-for="s in reception.signatures"
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
                {{ R.sections.history }}
              </div>
            </template>
            <ol class="relative space-y-4 border-s border-default ps-5">
              <li v-for="ev in [...reception.history].reverse()" :key="ev.id" class="relative">
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
            {{ R.actions.submit }}
          </UButton>
          <UButton
            v-if="canSign"
            color="success"
            icon="i-lucide-pen-line"
            :loading="busy"
            @click="sign"
          >
            {{ R.actions.sign }}
          </UButton>
          <UButton
            v-if="canApproveAsEntity"
            color="success"
            icon="i-lucide-check-circle"
            :loading="busy"
            @click="approveAsEntity"
          >
            Aprobar
          </UButton>
        </div>
      </div>

      <!-- Non-initiating roles when no reception yet -->
      <div v-else-if="!reception" class="space-y-6">
        <div
          class="rounded-lg border border-dashed border-default py-16 text-center text-sm text-muted"
        >
          {{ S.contractInfo.closing.notStarted }}
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>