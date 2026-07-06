<!-- app/pages/contracts/[contractId]/estimates/[estimateId].vue -->
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import { estimateStatusDisplay } from '~/utils/format'
import type { UserId, FileAsset } from '~/data/models'

definePageMeta({ requiredPermission: 'estimate:view' })

const ED = S.estimateDetail

const route = useRoute()
const repos = useRepositories()
const { can, role } = usePermissions()

const contractId = computed(() => route.params.contractId as string)
const estimateId = computed(() => route.params.estimateId as string)

const { data, status, error, refresh } = await useAsyncData(
  `estimate-${estimateId.value}`,
  async () => {
    const [estimate, contract, users, files, notes] = await Promise.all([
      repos.estimates.getById(estimateId.value),
      repos.contracts.getById(contractId.value),
      repos.users.list().catch(() => []),
      repos.files.listFiles(contractId.value).catch(() => []),
      repos.logNotes.listByContract(contractId.value).catch(() => []),
    ])
    // Prior accumulated approved amount (all approved/paid estimates with lower period)
    const all = await repos.estimates.listByContract(contractId.value).catch(() => [])
    const priorAccum = all
      .filter((e) => (e.status === 'approved' || e.status === 'paid') && e.periodIndex < estimate.periodIndex)
      .reduce((s, e) => s + (e.summary?.calculations?.estimateAmount ?? 0), 0)

    const nameOf = (id: string | null | undefined) =>
      (id && users.find((u) => u.id === id)?.fullName) || id || '—'
    const fileName = (id: string) => files.find((f) => f.id === id)?.name ?? id
    const fileOf = (id: string) => files.find((f) => f.id === id) ?? null
    const logNoteLabel = (id: string) => {
      const n = notes.find((x) => x.id === id)
      return n ? `#${n.folio} ${n.title}` : id
    }
    return { estimate, contract, priorAccum, all, nameOf, fileName, fileOf, logNoteLabel }
  },
)

const estimate = computed(() => data.value?.estimate ?? null)
const st = computed(() => estimate.value?.status ?? null)
const sectionNotes = computed(() => estimate.value?.sectionNotes ?? {})

// ─── Workflow gating ──────────────────────────────────────────────────────────
const mySlot = computed(() => estimate.value?.signatures.find((s) => s.role === role.value) ?? null)
const canSign = computed(() =>
  st.value === 'submitted' && can('sign') && !!mySlot.value && mySlot.value.status === 'pending',
)
// Resident or supervisor can reject with notes — but only before THEY sign.
// Once you've signed, you've committed to approval; you can no longer reject.
const canRejectWithNotes = computed(() =>
  st.value === 'submitted' && can('estimate:rejectWithNotes') &&
  (role.value === 'resident' || role.value === 'supervisor') &&
  mySlot.value?.status !== 'signed',
)
const canPay = computed(() => st.value === 'approved' && !!estimate.value?.paymentRequest && can('estimate:pay'))
const canRequestPayment = computed(() =>
  st.value === 'approved' && !estimate.value?.paymentRequest && can('estimate:requestPayment'),
)
const canCreateNew = computed(() => st.value === 'rejected' && can('estimate:create'))
const canManageDraft = computed(() => st.value === 'draft' && can('estimate:create'))
const hasBarAction = computed(() =>
  canSign.value || canRejectWithNotes.value || canPay.value || canRequestPayment.value ||
  canCreateNew.value || canManageDraft.value,
)

// Fully signed but held at 'submitted' because an earlier period isn't approved yet
const blockingPeriod = computed(() => {
  if (!estimate.value || !data.value) return null
  if (st.value !== 'submitted') return null
  if (!estimate.value.signatures.every((s) => s.status === 'signed')) return null
  for (let p = 1; p < estimate.value.periodIndex; p++) {
    const ok = data.value.all.some((e) => e.periodIndex === p && (e.status === 'approved' || e.status === 'paid'))
    if (!ok) return p
  }
  return null
})

// ─── Actions ──────────────────────────────────────────────────────────────────
const busy = ref(false)
const actionError = ref<string | null>(null)
async function run(fn: () => Promise<unknown>) {
  busy.value = true; actionError.value = null
  try { await fn(); await refresh() }
  catch (e) { actionError.value = isRepositoryError(e) ? e.message : S.common.error }
  finally { busy.value = false }
}
const sign = () => run(() => repos.estimates.sign(estimateId.value))
const markPaid = () => run(() => repos.estimates.markPaid(estimateId.value))

// ─── Request payment ──────────────────────────────────────────────────────────
const requestPaymentOpen = ref(false)

async function deleteDraft() {
  if (!estimate.value) return
  if (!confirm(ED.actions.deleteConfirm)) return
  busy.value = true; actionError.value = null
  try {
    await repos.estimates.delete(estimate.value.id)
    await navigateTo(`/contracts/${contractId.value}/estimates`)
  } catch (e) {
    actionError.value = isRepositoryError(e) ? e.message : S.common.error
    busy.value = false
  }
}

// Reject with per-section notes (resident or supervisor) — at least one note
// required. Notes are composed inline, directly within each section of the
// document (see the note-* slots below), not in a single all-at-once modal.
const rejectNotes = ref<Record<string, string>>({})
const rejectError = ref<string | null>(null)
watch(estimate, (e) => {
  if (!e) return
  const next: Record<string, string> = { cover: '', services: '', summary: '', evidence: '' }
  for (const h of e.hojas) next[`hoja:${h.conceptId}`] = ''
  rejectNotes.value = next
}, { immediate: true })
const hasAnyRejectNote = computed(() => Object.values(rejectNotes.value).some((v) => v.trim()))
const submitReject = () => run(async () => {
  rejectError.value = null
  if (!hasAnyRejectNote.value) { rejectError.value = ED.note.atLeastOneRequired; return }
  if (!confirm(ED.note.confirmReject)) return
  const cleaned: Record<string, string> = {}
  for (const [k, v] of Object.entries(rejectNotes.value)) if (v.trim()) cleaned[k] = v.trim()
  await repos.estimates.rejectWithNotes(estimateId.value, cleaned)
})

const userName = (id: UserId | null | undefined) =>
  (id && data.value?.nameOf(id)) || (id ?? '—')

function fmtDate(d: Date | string) {
  return new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── File viewer ──────────────────────────────────────────────────────────────
const viewerOpen = ref(false)
const viewingFile = ref<FileAsset | null>(null)
function openViewer(file: FileAsset) {
  viewingFile.value = file
  viewerOpen.value = true
}
</script>

<template>
  <UDashboardPanel id="estimate-detail">
    <template #header>
      <UDashboardNavbar :title="estimate ? `${ED.titlePrefix} #${estimate.number}` : ED.titlePrefix">
        <template #leading>
          <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" :to="`/contracts/${contractId}/estimates`"
            :aria-label="S.common.back" />
        </template>
        <template #right>
          <StatusBadge v-if="estimate" :display="estimateStatusDisplay[estimate.status]" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6 pb-6">
        <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-alert-triangle" :title="S.common.error"
          :actions="[{ label: 'Reintentar', color: 'neutral', variant: 'subtle', onClick: () => refresh() }]" />

        <div v-else-if="status === 'pending'" class="space-y-4">
          <USkeleton class="h-64 w-full rounded-xl" />
          <USkeleton class="h-96 w-full rounded-xl" />
        </div>

        <div v-else-if="estimate" class="space-y-6 pb-6">
          <!-- Rejected banner -->
          <UAlert v-if="st === 'rejected'" color="error"
            variant="soft" icon="i-lucide-alert-triangle"
            :title="ED.banner.rejected"
            :description="ED.banner.notEditable" />

          <!-- Fully signed, held pending an earlier period's approval -->
          <UAlert v-if="blockingPeriod" color="warning" variant="soft" icon="i-lucide-clock"
            :description="ED.banner.pendingPriorApproval.replace('{period}', String(blockingPeriod))" />

          <!-- How to reject with notes -->
          <UAlert v-if="canRejectWithNotes" color="warning" variant="subtle" icon="i-lucide-message-square-plus"
            :description="ED.note.perSectionHint" />

          <!-- The document -->
          <EstimateDocument :estimate="estimate" :prior-accum-amount="data!.priorAccum"
            :contract-amount="data!.contract.amount" :anticipo-percentage="data!.contract.anticipoPercentage"
            :file-name="data!.fileName" :file-of="data!.fileOf" :log-note-label="data!.logNoteLabel"
            @open-file="openViewer">
            <template #note-cover>
              <UAlert v-if="sectionNotes.cover" class="mb-3" color="warning" variant="soft"
                icon="i-lucide-message-square-warning" :title="ED.note.cover" :description="sectionNotes.cover" />
              <div v-else-if="canRejectWithNotes" class="mb-3 rounded-lg border border-dashed border-warning/40 bg-warning/5 p-3">
                <p class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-warning">
                  <UIcon name="i-lucide-message-square-plus" class="size-3.5" />{{ ED.note.cover }}
                </p>
                <UTextarea v-model="rejectNotes.cover" :rows="2" size="sm" class="w-full"
                  :placeholder="ED.note.placeholder" />
              </div>
            </template>
            <template #note-services>
              <UAlert v-if="sectionNotes.services" class="mb-3" color="warning" variant="soft"
                icon="i-lucide-message-square-warning" :title="ED.note.services" :description="sectionNotes.services" />
              <div v-else-if="canRejectWithNotes" class="mb-3 rounded-lg border border-dashed border-warning/40 bg-warning/5 p-3">
                <p class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-warning">
                  <UIcon name="i-lucide-message-square-plus" class="size-3.5" />{{ ED.note.services }}
                </p>
                <UTextarea v-model="rejectNotes.services" :rows="2" size="sm" class="w-full"
                  :placeholder="ED.note.placeholder" />
              </div>
            </template>
            <template #note-summary>
              <UAlert v-if="sectionNotes.summary" class="mb-3" color="warning" variant="soft"
                icon="i-lucide-message-square-warning" :title="ED.note.summary" :description="sectionNotes.summary" />
              <div v-else-if="canRejectWithNotes" class="mb-3 rounded-lg border border-dashed border-warning/40 bg-warning/5 p-3">
                <p class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-warning">
                  <UIcon name="i-lucide-message-square-plus" class="size-3.5" />{{ ED.note.summary }}
                </p>
                <UTextarea v-model="rejectNotes.summary" :rows="2" size="sm" class="w-full"
                  :placeholder="ED.note.placeholder" />
              </div>
            </template>
            <template #note-hoja="{ hoja }">
              <UAlert v-if="sectionNotes[`hoja:${hoja.conceptId}`]" class="mb-3" color="warning" variant="soft"
                icon="i-lucide-message-square-warning" :title="`${ED.note.hoja} ${hoja.number}`"
                :description="sectionNotes[`hoja:${hoja.conceptId}`]" />
              <div v-else-if="canRejectWithNotes" class="mb-3 rounded-lg border border-dashed border-warning/40 bg-warning/5 p-3">
                <p class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-warning">
                  <UIcon name="i-lucide-message-square-plus" class="size-3.5" />{{ ED.note.hoja }} {{ hoja.number }}
                </p>
                <UTextarea v-model="rejectNotes[`hoja:${hoja.conceptId}`]" :rows="2" size="sm" class="w-full"
                  :placeholder="ED.note.placeholder" />
              </div>
            </template>
            <template #note-evidence>
              <UAlert v-if="sectionNotes.evidence" class="mb-3" color="warning" variant="soft"
                icon="i-lucide-message-square-warning" :title="ED.note.evidence" :description="sectionNotes.evidence" />
              <div v-else-if="canRejectWithNotes" class="mb-3 rounded-lg border border-dashed border-warning/40 bg-warning/5 p-3">
                <p class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-warning">
                  <UIcon name="i-lucide-message-square-plus" class="size-3.5" />{{ ED.note.evidence }}
                </p>
                <UTextarea v-model="rejectNotes.evidence" :rows="2" size="sm" class="w-full"
                  :placeholder="ED.note.placeholder" />
              </div>
            </template>
          </EstimateDocument>

          <!-- Payment request -->
          <UCard v-if="estimate.paymentRequest">
            <template #header>
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-banknote" class="size-4 text-muted" />
                {{ ED.paymentRequest.sectionTitle }}
              </div>
            </template>
            <dl class="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <div>
                <dt class="text-xs text-muted">{{ ED.paymentRequest.accountHolder }}</dt>
                <dd class="font-medium text-highlighted">{{ estimate.paymentRequest.accountHolder }}</dd>
              </div>
              <div>
                <dt class="text-xs text-muted">{{ ED.paymentRequest.bankName }}</dt>
                <dd class="text-highlighted">{{ estimate.paymentRequest.bankName }}</dd>
              </div>
              <div>
                <dt class="text-xs text-muted">{{ ED.paymentRequest.accountNumber }}</dt>
                <dd class="font-mono text-sm text-highlighted">{{ estimate.paymentRequest.accountNumber }}</dd>
              </div>
              <div>
                <dt class="text-xs text-muted">{{ ED.paymentRequest.clabe }}</dt>
                <dd class="font-mono text-sm text-highlighted">{{ estimate.paymentRequest.clabe }}</dd>
              </div>
              <div class="sm:col-span-2">
                <dt class="text-xs text-muted">{{ ED.paymentRequest.requestedBy }}</dt>
                <dd class="text-highlighted">
                  {{ data?.nameOf(estimate.paymentRequest.requestedById) }} ·
                  {{ formatDate(estimate.paymentRequest.requestedAt) }}
                </dd>
              </div>
            </dl>

            <div class="mt-4">
              <p class="mb-2 text-xs text-muted">{{ ED.paymentRequest.documents }}</p>
              <div class="flex flex-wrap gap-2">
                <button v-for="fid in estimate.paymentRequest.fileIds" :key="fid" type="button"
                  class="inline-flex items-center gap-1.5 rounded-md border border-default bg-elevated/40 px-2.5 py-1.5 text-sm text-highlighted transition-colors hover:bg-elevated/70"
                  @click="() => { const f = data?.fileOf(fid); if (f) openViewer(f) }">
                  <UIcon name="i-lucide-file" class="size-3.5 text-muted" />
                  {{ data?.fileName(fid) }}
                </button>
              </div>
            </div>
          </UCard>

          <!-- Signatures -->
          <UCard>
            <template #header>
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-pen-line" class="size-4 text-muted" />
                {{ ED.sections.signatures }}
              </div>
            </template>
            <ul class="divide-y divide-default">
              <li v-for="s in (estimate.signatures ?? [])" :key="s.id" class="flex items-center justify-between py-2.5">
                <div class="flex items-center gap-3">
                  <UIcon :name="s.status === 'signed' ? 'i-lucide-badge-check' : 'i-lucide-circle-dashed'"
                    class="size-4" :class="s.status === 'signed' ? 'text-success' : 'text-muted'" />
                  <div>
                    <div class="text-sm font-medium text-highlighted">{{ S.roles[s.role] }}</div>
                    <div class="text-xs text-muted">
                      <template v-if="s.status === 'signed'">{{ userName(s.userId) }} · {{ fmtDate(s.signedAt!)
                      }}</template>
                      <template v-else>{{ ED.signatures.unsigned }}</template>
                    </div>
                  </div>
                </div>
                <UBadge :label="s.status === 'signed' ? ED.signatures.signed : ED.signatures.pending"
                  :color="s.status === 'signed' ? 'success' : 'neutral'"
                  :variant="s.status === 'signed' ? 'soft' : 'outline'" size="sm" />
              </li>
            </ul>
          </UCard>

          <!-- History -->
          <UCard>
            <template #header>
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-history" class="size-4 text-muted" />
                {{ ED.sections.history }}
              </div>
            </template>
            <ul class="space-y-2">
              <li v-for="ev in (estimate.history ?? [])" :key="ev.id" class="flex items-center gap-3 text-sm">
                <span class="text-xs text-muted w-24 shrink-0">{{ fmtDate(ev.at) }}</span>
                <span class="text-highlighted">{{ (S.workflow as any)[ev.action] ?? ev.action }}</span>
                <span class="text-xs text-muted">· {{ userName(ev.byUserId) }}</span>
              </li>
            </ul>
          </UCard>

          <UAlert v-if="actionError" :title="actionError" color="error" variant="soft" icon="i-lucide-alert-triangle" />

          <!-- Action bar -->
          <div v-if="hasBarAction"
            class="sticky bottom-0 -mx-4 space-y-2 border-t border-default bg-default/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
            <UAlert v-if="rejectError" :title="rejectError" color="error" variant="soft"
              icon="i-lucide-alert-triangle" />
            <div class="flex flex-wrap justify-end gap-3">
            <UButton v-if="canManageDraft" color="error" variant="ghost" icon="i-lucide-trash-2" :loading="busy"
              @click="deleteDraft">
              {{ ED.actions.deleteDraft }}
            </UButton>
            <UButton v-if="canManageDraft" color="neutral" variant="soft" icon="i-lucide-pencil"
              :to="`/contracts/${contractId}/estimates/new?edit=${estimate.id}`">
              {{ ED.actions.editDraft }}
            </UButton>
            <UButton v-if="canRejectWithNotes" color="error" variant="soft" icon="i-lucide-x" :loading="busy"
              @click="submitReject">
              {{ ED.actions.rejectWithNotes }}
            </UButton>
            <UButton v-if="canSign" color="success" icon="i-lucide-pen-line" :loading="busy" @click="sign">
              {{ ED.actions.sign }}
            </UButton>
            <UButton v-if="canRequestPayment" color="success" variant="soft" icon="i-lucide-banknote" :loading="busy"
              @click="() => void (requestPaymentOpen = true)">
              {{ ED.actions.requestPayment }}
            </UButton>
            <UButton v-if="canPay" color="success" icon="i-lucide-banknote" :loading="busy" @click="markPaid">
              {{ ED.actions.markPaid }}
            </UButton>
            <UButton v-if="canCreateNew" icon="i-lucide-plus"
              :to="`/contracts/${contractId}/estimates/new?period=${estimate.periodIndex}`">
              {{ ED.actions.newForPeriod }}
            </UButton>
            </div>
          </div>
        </div><!-- end v-else-if estimate -->
      </div><!-- end outer body wrapper -->
    </template>

  </UDashboardPanel>

  <!-- Request payment modal — must live outside UDashboardPanel -->
  <RequestPaymentModal v-if="estimate" v-model:open="requestPaymentOpen" :estimate-id="estimate.id"
    :contract-id="contractId" :estimate-number="estimate.number" @requested="refresh" />

  <!-- File viewer — must live outside UDashboardPanel -->
  <FileViewerModal v-model:open="viewerOpen" :file="viewingFile" />
</template>