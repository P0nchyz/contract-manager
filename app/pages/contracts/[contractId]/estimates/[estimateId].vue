<!-- app/pages/contracts/[contractId]/estimates/[estimateId].vue -->
<script setup lang="ts">
import { ref, computed } from 'vue'
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
    return { estimate, contract, priorAccum, nameOf, fileName, fileOf, logNoteLabel }
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
const canReturn = computed(() => st.value === 'submitted' && can('estimate:returnWithNotes'))
const canReject = computed(() => st.value === 'submitted' && can('estimate:reject'))
const canPay = computed(() => st.value === 'approved' && can('estimate:pay'))
const canCreateNew = computed(() =>
  (st.value === 'with_notes' || st.value === 'rejected') && can('estimate:create'),
)
const hasBarAction = computed(() => canSign.value || canReturn.value || canReject.value || canPay.value || canCreateNew.value)

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

// Reject (single reason)
const showReject = ref(false)
const rejectNote = ref('')
const reject = () => run(async () => {
  await repos.estimates.reject(estimateId.value, rejectNote.value.trim())
  showReject.value = false; rejectNote.value = ''
})

// Return with per-section notes
const showReturn = ref(false)
const returnNotes = ref<Record<string, string>>({})
function openReturn() {
  returnNotes.value = { cover: '', services: '', summary: '' }
  for (const h of estimate.value?.hojas ?? []) returnNotes.value[`hoja:${h.conceptId}`] = ''
  showReturn.value = true
}
const submitReturn = () => run(async () => {
  const cleaned: Record<string, string> = {}
  for (const [k, v] of Object.entries(returnNotes.value)) if (v.trim()) cleaned[k] = v.trim()
  await repos.estimates.returnWithNotes(estimateId.value, cleaned)
  showReturn.value = false
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
          <!-- Returned/rejected banner -->
          <UAlert v-if="st === 'with_notes' || st === 'rejected'" :color="st === 'rejected' ? 'error' : 'warning'"
            variant="soft" icon="i-lucide-alert-triangle"
            :title="st === 'rejected' ? ED.banner.rejected : ED.banner.withNotes"
            :description="ED.banner.notEditable" />

          <!-- The document -->
          <EstimateDocument :estimate="estimate" :prior-accum-amount="data!.priorAccum"
            :contract-amount="data!.contract.amount" :anticipo-percentage="data!.contract.anticipoPercentage"
            :file-name="data!.fileName" :file-of="data!.fileOf" :log-note-label="data!.logNoteLabel"
            @open-file="openViewer">
            <template #note-cover>
              <UAlert v-if="sectionNotes.cover" class="mb-3" color="warning" variant="soft"
                icon="i-lucide-message-square-warning" :title="ED.note.cover" :description="sectionNotes.cover" />
            </template>
            <template #note-services>
              <UAlert v-if="sectionNotes.services" class="mb-3" color="warning" variant="soft"
                icon="i-lucide-message-square-warning" :title="ED.note.services" :description="sectionNotes.services" />
            </template>
            <template #note-summary>
              <UAlert v-if="sectionNotes.summary" class="mb-3" color="warning" variant="soft"
                icon="i-lucide-message-square-warning" :title="ED.note.summary" :description="sectionNotes.summary" />
            </template>
            <template #note-hoja="{ hoja }">
              <UAlert v-if="sectionNotes[`hoja:${hoja.conceptId}`]" class="mb-3" color="warning" variant="soft"
                icon="i-lucide-message-square-warning" :title="`${ED.note.hoja} ${hoja.number}`"
                :description="sectionNotes[`hoja:${hoja.conceptId}`]" />
            </template>
          </EstimateDocument>

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
            class="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-3 border-t border-default bg-default/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
            <UButton v-if="canReject" color="error" variant="soft" icon="i-lucide-x" :loading="busy"
              @click="() => void (showReject = true)">
              {{ ED.actions.reject }}
            </UButton>
            <UButton v-if="canReturn" color="warning" variant="soft" icon="i-lucide-corner-up-left" :loading="busy"
              @click="openReturn">
              {{ ED.actions.returnWithNotes }}
            </UButton>
            <UButton v-if="canSign" color="success" icon="i-lucide-pen-line" :loading="busy" @click="sign">
              {{ ED.actions.sign }}
            </UButton>
            <UButton v-if="canPay" color="success" icon="i-lucide-banknote" :loading="busy" @click="markPaid">
              {{ ED.actions.markPaid }}
            </UButton>
            <UButton v-if="canCreateNew" icon="i-lucide-plus"
              :to="`/contracts/${contractId}/estimates/new?period=${estimate.periodIndex}`">
              {{ ED.actions.newForPeriod }}
            </UButton>
          </div>
        </div><!-- end v-else-if estimate -->
      </div><!-- end outer body wrapper -->
    </template>

  </UDashboardPanel>

  <!-- Reject modal — must live outside UDashboardPanel -->
  <UModal v-model:open="showReject" :title="ED.note.rejectTitle">
    <template #body>
      <UFormField :label="ED.note.label">
        <UTextarea v-model="rejectNote" :rows="4" class="w-full" :placeholder="ED.note.placeholder" />
      </UFormField>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-3">
        <UButton color="neutral" variant="ghost" @click="() => void (showReject = false)">{{ S.common.cancel }}
        </UButton>
        <UButton color="error" :disabled="!rejectNote.trim()" :loading="busy" @click="reject">{{ ED.actions.reject }}
        </UButton>
      </div>
    </template>
  </UModal>

  <!-- Return with per-section notes modal — must live outside UDashboardPanel -->
  <UModal v-model:open="showReturn" :title="ED.note.returnTitle">
    <template #body>
      <div class="space-y-4">
        <p class="text-xs text-muted">{{ ED.note.perSectionHint }}</p>
        <UFormField :label="ED.note.cover">
          <UTextarea v-model="returnNotes.cover" :rows="2" class="w-full" :placeholder="ED.note.placeholder" />
        </UFormField>
        <UFormField :label="ED.note.services">
          <UTextarea v-model="returnNotes.services" :rows="2" class="w-full" :placeholder="ED.note.placeholder" />
        </UFormField>
        <UFormField :label="ED.note.summary">
          <UTextarea v-model="returnNotes.summary" :rows="2" class="w-full" :placeholder="ED.note.placeholder" />
        </UFormField>
        <UFormField v-for="h in (estimate?.hojas ?? [])" :key="h.id"
          :label="`${ED.note.hoja} ${h.number} — ${h.specificationNumber}`">
          <UTextarea v-model="returnNotes[`hoja:${h.conceptId}`]" :rows="2" class="w-full"
            :placeholder="ED.note.placeholder" />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-3">
        <UButton color="neutral" variant="ghost" @click="() => void (showReturn = false)">{{ S.common.cancel }}
        </UButton>
        <UButton color="warning" :loading="busy" @click="submitReturn">{{ ED.actions.returnWithNotes }}</UButton>
      </div>
    </template>
  </UModal>

  <!-- File viewer — must live outside UDashboardPanel -->
  <FileViewerModal v-model:open="viewerOpen" :file="viewingFile" />
</template>