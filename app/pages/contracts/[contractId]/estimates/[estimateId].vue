<!-- app/pages/contracts/[contractId]/estimates/[estimateId].vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import { estimateStatusDisplay } from '~/utils/format'
import type { UserId } from '~/data/models'

definePageMeta({ requiredPermission: 'estimate:view' })

const D = S.estimateDetail

const route = useRoute()
const repos = useRepositories()
const { can, role } = usePermissions()

const contractId = computed(() => route.params.contractId as string)
const estimateId = computed(() => route.params.estimateId as string)

const { data, status, error, refresh } = await useAsyncData(
  () => `estimate-${estimateId.value}`,
  async () => {
    const estimate = await repos.estimates.getById(estimateId.value)
    // Best-effort directory to resolve actor names for signatures/history.
    const users = await repos.users.list().catch(() => [])
    const names: Record<string, string> = {}
    for (const u of users) names[u.id] = u.fullName
    return { estimate, names }
  },
)

const estimate = computed(() => data.value?.estimate ?? null)
const userName = (id: UserId | null | undefined): string =>
  (id && data.value?.names[id]) || (id ?? '—')

// --- Workflow gating ---------------------------------------------------------
const st = computed(() => estimate.value?.status ?? null)
const mySlot = computed(() => estimate.value?.signatures.find((s) => s.role === role.value) ?? null)

const canSubmit = computed(() => st.value === 'draft' && can('estimate:create'))
const canApprove = computed(() => st.value === 'submitted' && can('estimate:approve'))
const canReturn = computed(() => st.value === 'submitted' && can('estimate:approve'))
const canReject = computed(() => st.value === 'submitted' && can('estimate:reject'))
const canPay = computed(() => st.value === 'approved' && can('estimate:pay'))
const canSign = computed(
  () =>
    can('sign') &&
    !!mySlot.value &&
    mySlot.value.status === 'pending' &&
    ['submitted', 'with_notes', 'approved'].includes(st.value ?? ''),
)
const hasAnyAction = computed(
  () =>
    canSubmit.value ||
    canApprove.value ||
    canReturn.value ||
    canReject.value ||
    canPay.value ||
    canSign.value,
)

// Latest returned/rejected note, surfaced as a banner.
const latestNote = computed(() => {
  const e = estimate.value
  if (!e || (e.status !== 'with_notes' && e.status !== 'rejected')) return null
  for (let i = e.history.length - 1; i >= 0; i--) {
    const ev = e.history[i]
    if (ev.action === 'returned_with_notes' || ev.action === 'rejected') return ev
  }
  return null
})

// --- Action runners ----------------------------------------------------------
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

const submit = () => run(() => repos.estimates.submit(estimateId.value))
const approve = () => run(() => repos.estimates.approve(estimateId.value))
const markPaid = () => run(() => repos.estimates.markPaid(estimateId.value))
const sign = () => run(() => repos.estimates.sign(estimateId.value))

// Note modal (return / reject share one dialog)
const noteModal = reactive({ open: false, kind: null as 'return' | 'reject' | null, text: '', error: '' })
function openNote(kind: 'return' | 'reject') {
  noteModal.kind = kind
  noteModal.text = ''
  noteModal.error = ''
  noteModal.open = true
}
async function confirmNote() {
  if (!noteModal.text.trim()) {
    noteModal.error = D.note.required
    return
  }
  const kind = noteModal.kind
  const note = noteModal.text.trim()
  noteModal.open = false
  await run(() =>
    kind === 'reject'
      ? repos.estimates.reject(estimateId.value, note)
      : repos.estimates.returnWithNotes(estimateId.value, note),
  )
}
</script>

<template>
  <UDashboardPanel id="estimate-detail">
    <template #header>
      <UDashboardNavbar :title="estimate ? `${D.titlePrefix} No. ${estimate.number}` : D.titlePrefix">
        <template #leading>
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            :to="`/contracts/${contractId}/estimates`"
            :aria-label="S.common.back"
          />
        </template>
        <template #right>
          <StatusBadge v-if="estimate" :display="estimateStatusDisplay[estimate.status]" size="md" />
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
        <USkeleton class="h-28 w-full rounded-lg" />
        <USkeleton class="h-72 w-full rounded-lg" />
        <USkeleton class="h-48 w-full rounded-lg" />
      </div>

      <div v-else-if="estimate" class="flex flex-col gap-6">
        <!-- Returned / rejected banner -->
        <UAlert
          v-if="latestNote"
          :color="estimate.status === 'rejected' ? 'error' : 'warning'"
          variant="soft"
          icon="i-lucide-message-square-warning"
          :title="estimate.status === 'rejected' ? D.banner.rejected : D.banner.withNotes"
          :description="latestNote.note"
        />

        <!-- Cover -->
        <UCard>
          <div class="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <div class="lg:col-span-2">
              <div class="text-xs text-muted">{{ S.estimateForm.cover.object }}</div>
              <div class="font-medium text-highlighted">{{ estimate.cover.contractTitle }}</div>
            </div>
            <div>
              <div class="text-xs text-muted">{{ S.estimateForm.cover.contract }}</div>
              <div class="font-medium text-highlighted">{{ estimate.cover.contractCode }}</div>
            </div>
            <div>
              <div class="text-xs text-muted">{{ S.estimateForm.cover.contractor }}</div>
              <div class="font-medium text-highlighted">{{ estimate.cover.contractorName || '—' }}</div>
            </div>
            <div>
              <div class="text-xs text-muted">{{ D.period }}</div>
              <div class="font-medium text-highlighted">
                {{ formatDate(estimate.periodStart) }} – {{ formatDate(estimate.periodEnd) }}
              </div>
            </div>
            <div>
              <div class="text-xs text-muted">{{ S.estimateForm.summary.net }}</div>
              <div class="font-semibold tabular-nums text-primary">
                {{ formatMoney(estimate.summary.calculations.total) }}
              </div>
            </div>
          </div>
        </UCard>

        <!-- Concepts (read-only grid, same color code) -->
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-table" class="size-4 text-muted" />
              {{ D.sections.concepts }}
            </div>
          </template>

          <div class="overflow-x-auto">
            <table class="w-full min-w-[64rem] text-sm">
              <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                <tr>
                  <th class="px-3 py-2 text-right font-medium">{{ S.estimateForm.columns.number }}</th>
                  <th class="px-3 py-2 text-left font-medium">{{ S.estimateForm.columns.specification }}</th>
                  <th class="px-3 py-2 text-left font-medium">{{ S.estimateForm.columns.description }}</th>
                  <th class="px-3 py-2 text-left font-medium">{{ S.estimateForm.columns.unit }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ S.estimateForm.columns.inProject }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ S.estimateForm.columns.upToLast }}</th>
                  <th class="px-3 py-2 text-right font-medium text-success">{{ S.estimateForm.columns.inThisEstimate }}</th>
                  <th class="px-3 py-2 text-right font-medium text-error">{{ S.estimateForm.columns.totalEstimated }}</th>
                  <th class="px-3 py-2 text-right font-medium text-error">{{ S.estimateForm.columns.toExecute }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ S.estimateForm.columns.unitPrice }}</th>
                  <th class="px-3 py-2 text-right font-medium text-error">{{ S.estimateForm.columns.totalAmount }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-for="li in estimate.lineItems" :key="li.conceptId">
                  <td class="px-3 py-2 text-right tabular-nums text-highlighted">{{ li.conceptNumber }}</td>
                  <td class="px-3 py-2 text-highlighted">{{ li.specificationNumber }}</td>
                  <td class="min-w-[16rem] px-3 py-2 text-highlighted">{{ li.description }}</td>
                  <td class="px-3 py-2 text-muted">{{ li.unit }}</td>
                  <td class="px-3 py-2 text-right tabular-nums text-highlighted">{{ formatNumber(li.inProject) }}</td>
                  <td class="px-3 py-2 text-right tabular-nums text-highlighted">{{ formatNumber(li.upToLastEstimate) }}</td>
                  <td class="px-3 py-2 text-right tabular-nums font-medium text-success">{{ formatNumber(li.inThisEstimate) }}</td>
                  <td class="px-3 py-2 text-right tabular-nums text-error">{{ formatNumber(li.totalEstimated) }}</td>
                  <td class="px-3 py-2 text-right tabular-nums text-error">{{ formatNumber(li.toExecute) }}</td>
                  <td class="px-3 py-2 text-right tabular-nums text-highlighted">{{ formatMoney(li.unitPrice) }}</td>
                  <td class="px-3 py-2 text-right tabular-nums font-medium text-error">{{ formatMoney(li.totalAmount) }}</td>
                </tr>
              </tbody>
              <tfoot class="border-t border-default bg-elevated/50">
                <tr>
                  <td colspan="10" class="px-3 py-2 text-right text-xs font-medium text-muted">
                    {{ S.estimateForm.summary.subtotal }}
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums font-semibold text-highlighted">
                    {{ formatMoney(estimate.summary.conceptSummary.subtotal) }}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </UCard>

        <!-- Summary calculations -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-calculator" class="size-4 text-muted" />
              {{ S.estimateForm.summary.calculationsTitle }}
            </div>
          </template>
          <dl class="mx-auto max-w-md divide-y divide-default text-sm">
            <div class="flex items-center justify-between py-2">
              <dt class="text-muted">{{ S.estimateForm.summary.estimateAmount }}</dt>
              <dd class="tabular-nums text-highlighted">{{ formatMoney(estimate.summary.calculations.estimateAmount) }}</dd>
            </div>
            <div class="flex items-center justify-between py-2">
              <dt class="text-muted">{{ S.estimateForm.summary.iva }} ({{ estimate.summary.calculations.ivaRate }}%)</dt>
              <dd class="tabular-nums text-highlighted">{{ formatMoney(estimate.summary.calculations.estimateIva) }}</dd>
            </div>
            <div class="flex items-center justify-between py-2">
              <dt class="font-medium text-default">{{ S.estimateForm.summary.estimateTotal }}</dt>
              <dd class="tabular-nums font-medium text-highlighted">{{ formatMoney(estimate.summary.calculations.estimateTotal) }}</dd>
            </div>
            <div class="flex items-center justify-between py-2">
              <dt class="text-muted">{{ S.estimateForm.summary.anticipoAmortization }}</dt>
              <dd class="tabular-nums text-error">− {{ formatMoney(estimate.summary.calculations.anticipoAmortization) }}</dd>
            </div>
            <div class="flex items-center justify-between py-2">
              <dt class="text-muted">{{ S.estimateForm.summary.amortizationIva }}</dt>
              <dd class="tabular-nums text-error">− {{ formatMoney(estimate.summary.calculations.amortizationIva) }}</dd>
            </div>
            <div class="flex items-center justify-between py-2">
              <dt class="text-muted">{{ S.estimateForm.summary.retentions }}</dt>
              <dd class="tabular-nums text-error">− {{ formatMoney(estimate.summary.calculations.retentions) }}</dd>
            </div>
            <div class="flex items-center justify-between py-2">
              <dt class="text-muted">{{ S.estimateForm.summary.cincoAlMillar }}</dt>
              <dd class="tabular-nums text-error">− {{ formatMoney(estimate.summary.calculations.cincoAlMillarSfp) }}</dd>
            </div>
            <div class="flex items-center justify-between py-2.5">
              <dt class="font-semibold text-default">{{ S.estimateForm.summary.net }}</dt>
              <dd class="text-base font-semibold tabular-nums text-primary">{{ formatMoney(estimate.summary.calculations.total) }}</dd>
            </div>
          </dl>
        </UCard>

        <!-- Signatures + History -->
        <div class="grid gap-4 lg:grid-cols-2">
          <UCard>
            <template #header>
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-pen-line" class="size-4 text-muted" />
                {{ D.sections.signatures }}
              </div>
            </template>
            <ul class="divide-y divide-default">
              <li v-for="s in estimate.signatures" :key="s.id" class="flex items-center justify-between py-2.5">
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

          <UCard>
            <template #header>
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-history" class="size-4 text-muted" />
                {{ D.sections.history }}
              </div>
            </template>
            <ol class="relative space-y-4 border-s border-default ps-5">
              <li v-for="ev in [...estimate.history].reverse()" :key="ev.id" class="relative">
                <span class="absolute -start-[1.4rem] top-1 size-2.5 rounded-full bg-muted ring-4 ring-default" />
                <div class="text-sm font-medium text-highlighted">{{ S.workflow[ev.action] }}</div>
                <div class="text-xs text-muted">{{ userName(ev.byUserId) }} · {{ formatDate(ev.at) }}</div>
                <p v-if="ev.note" class="mt-1 rounded-md bg-elevated/60 px-2 py-1 text-xs text-default">{{ ev.note }}</p>
              </li>
            </ol>
          </UCard>
        </div>

        <!-- Attachments -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-paperclip" class="size-4 text-muted" />
              {{ D.sections.attachments }}
            </div>
          </template>
          <div
            v-if="!estimate.evidenceFileIds.length && !estimate.linkedLogNoteIds.length"
            class="text-sm text-muted"
          >
            {{ D.attachmentsEmpty }}
          </div>
          <div v-else class="space-y-3 text-sm">
            <div v-if="estimate.linkedLogNoteIds.length">
              <div class="mb-1 text-xs font-medium text-muted">{{ D.linkedLogNotes }}</div>
              <div class="flex flex-wrap gap-2">
                <UBadge
                  v-for="id in estimate.linkedLogNoteIds"
                  :key="id"
                  :label="id"
                  color="neutral"
                  variant="soft"
                  size="sm"
                />
              </div>
            </div>
            <div v-if="estimate.evidenceFileIds.length">
              <div class="mb-1 text-xs font-medium text-muted">{{ D.evidence }}</div>
              <div class="flex flex-wrap gap-2">
                <UBadge
                  v-for="id in estimate.evidenceFileIds"
                  :key="id"
                  :label="id"
                  color="neutral"
                  variant="soft"
                  size="sm"
                  icon="i-lucide-file"
                />
              </div>
            </div>
          </div>
        </UCard>

        <UAlert
          v-if="actionError"
          :title="actionError"
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
        />

        <!-- Sticky workflow action bar -->
        <div
          v-if="hasAnyAction"
          class="sticky bottom-0 -mx-4 mt-2 flex flex-wrap items-center justify-end gap-3 border-t border-default bg-default/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
        >
          <UButton
            v-if="canReject"
            color="error"
            variant="soft"
            icon="i-lucide-x-circle"
            :disabled="busy"
            @click="openNote('reject')"
          >
            {{ D.actions.reject }}
          </UButton>
          <UButton
            v-if="canReturn"
            color="warning"
            variant="soft"
            icon="i-lucide-corner-up-left"
            :disabled="busy"
            @click="openNote('return')"
          >
            {{ D.actions.returnWithNotes }}
          </UButton>
          <UButton
            v-if="canSign"
            color="primary"
            variant="outline"
            icon="i-lucide-pen-line"
            :loading="busy"
            @click="sign"
          >
            {{ D.actions.sign }}
          </UButton>
          <UButton v-if="canSubmit" icon="i-lucide-send" :loading="busy" @click="submit">
            {{ D.actions.submit }}
          </UButton>
          <UButton v-if="canApprove" color="success" icon="i-lucide-check" :loading="busy" @click="approve">
            {{ D.actions.approve }}
          </UButton>
          <UButton v-if="canPay" color="info" icon="i-lucide-banknote" :loading="busy" @click="markPaid">
            {{ D.actions.markPaid }}
          </UButton>
        </div>

        <!-- Note modal (return / reject) -->
        <UModal
          v-model:open="noteModal.open"
          :title="noteModal.kind === 'reject' ? D.note.rejectTitle : D.note.returnTitle"
        >
          <template #body>
            <UFormField :label="D.note.label" :error="noteModal.error || undefined">
              <UTextarea
                v-model="noteModal.text"
                :rows="4"
                class="w-full"
                :placeholder="D.note.placeholder"
                autofocus
              />
            </UFormField>
          </template>
          <template #footer>
            <div class="flex w-full justify-end gap-3">
              <UButton color="neutral" variant="ghost" @click="noteModal.open = false">
                {{ S.common.cancel }}
              </UButton>
              <UButton
                :color="noteModal.kind === 'reject' ? 'error' : 'warning'"
                icon="i-lucide-check"
                @click="confirmNote"
              >
                {{ S.common.confirm }}
              </UButton>
            </div>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
