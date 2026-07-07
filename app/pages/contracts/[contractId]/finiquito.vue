<!-- app/pages/contracts/[contractId]/finiquito.vue -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import { agreementStatusDisplay } from '~/utils/format'
import type { UserId, FileAsset } from '~/data/models'

definePageMeta({ requiredPermission: 'estimate:view' })

const F = S.finiquito

const route = useRoute()
const repos = useRepositories()
const { can, role } = usePermissions()

const contractId = computed(() => route.params.contractId as string)

const { data, status, error, refresh } = await useAsyncData(
  () => `finiquito-${contractId.value}`,
  async () => {
    const [finiquito, reception, users, financials, concepts, estimates, logNotes, files] = await Promise.all([
      repos.finiquito.getByContract(contractId.value).catch(() => null),
      repos.reception.getByContract(contractId.value).catch(() => null),
      repos.users.list().catch(() => []),
      repos.contracts.getFinancials(contractId.value).catch(() => null),
      repos.concepts.listByContract(contractId.value).catch(() => []),
      repos.estimates.listByContract(contractId.value).catch(() => []),
      repos.logNotes.listByContract(contractId.value).catch(() => []),
      repos.files.listFiles(contractId.value).catch(() => []),
    ])
    const names: Record<string, string> = {}
    for (const u of users) names[u.id] = u.fullName

    // Concept progress — simple summary (counts, not a full per-concept table)
    const executedQty: Record<string, number> = {}
    for (const est of estimates) {
      if (est.status === 'draft' || est.status === 'rejected') continue
      for (const li of est.lineItems) {
        executedQty[li.conceptId] = (executedQty[li.conceptId] ?? 0) + li.inThisEstimate
      }
    }
    let doneConcepts = 0, inProgressConcepts = 0, notStartedConcepts = 0
    for (const c of concepts) {
      const executed = executedQty[c.id] ?? 0
      if (executed <= 0) notStartedConcepts++
      else if (executed >= c.contractedQuantity) doneConcepts++
      else inProgressConcepts++
    }

    const fileOf = (id: string) => files.find((f) => f.id === id) ?? null
    const logNoteOf = (id: string) => logNotes.find((n) => n.id === id) ?? null

    return {
      finiquito, reception, names, financials, concepts, logNotes, files, fileOf, logNoteOf,
      conceptProgress: {
        total: concepts.length,
        done: doneConcepts,
        inProgress: inProgressConcepts,
        notStarted: notStartedConcepts,
      },
    }
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
  () => (st.value === 'submitted' || st.value === 'pending_entity') && can('closeFlow:returnWithNotes'),
)
const canReject = computed(() => st.value === 'submitted' && can('closeFlow:reject'))
const canApproveAsEntity = computed(
  () => st.value === 'pending_entity' && can('agreement:approve'),
)
const showReview = computed(() => canReturn.value || canReject.value)
const hasBarAction = computed(() => canSubmit.value || canSign.value || canApproveAsEntity.value)

// Attachments (linked log notes + files) can only be edited while in draft,
// by whoever can act on the draft (same gate as submit).
const canEditAttachments = computed(() => st.value === 'draft' && can('close:initiate'))

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
const approveAsEntity = () => run(() => repos.finiquito.approve(finiquito.value!.id))

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

// ─── File viewer ──────────────────────────────────────────────────────────────
const viewerOpen = ref(false)
const viewingFile = ref<FileAsset | null>(null)
function openViewer(file: FileAsset) {
  viewingFile.value = file
  viewerOpen.value = true
}

// ─── Linked log notes ─────────────────────────────────────────────────────────
const logNotesModalOpen = ref(false)
async function saveAttachments(fileIds: string[], logNoteIds: string[]) {
  if (!finiquito.value) return
  busy.value = true; actionError.value = null
  try {
    await repos.finiquito.updateAttachments(finiquito.value.id, { fileIds, logNoteIds })
    await refresh()
  } catch (e) {
    actionError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    busy.value = false
  }
}
function toggleLogNote(id: string) {
  if (!finiquito.value) return
  const current = finiquito.value.linkedLogNoteIds.map(String)
  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
  saveAttachments(finiquito.value.attachmentFileIds.map(String), next)
}

// ─── Linked files ─────────────────────────────────────────────────────────────
const filesModalOpen = ref(false)
const filesUploadFolderId = ref<string | undefined>(undefined)
const filesUploading = ref(false)
function openFilesPicker() {
  filesModalOpen.value = true
}
async function addExistingFile(fileId: string) {
  if (!finiquito.value) return
  const current = finiquito.value.attachmentFileIds.map(String)
  if (current.includes(fileId)) return
  await saveAttachments([...current, fileId], finiquito.value.linkedLogNoteIds.map(String))
}
function removeFile(fileId: string) {
  if (!finiquito.value) return
  const current = finiquito.value.attachmentFileIds.map(String)
  saveAttachments(current.filter((x) => x !== fileId), finiquito.value.linkedLogNoteIds.map(String))
}
async function onUploadFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !finiquito.value) return
  filesUploading.value = true
  try {
    const folders = await repos.files.listFolders(contractId.value)
    const folder = folders.find((f) => f.kind === 'contract') ?? folders[0]
    if (!folder) throw new Error('No se encontró una carpeta destino.')
    const asset = await repos.files.upload({ contractId: contractId.value, folderId: folder.id, file })
    await addExistingFile(asset.id)
  } catch (e) {
    actionError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    filesUploading.value = false
    input.value = ''
  }
}
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

        <!-- Financial state -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-bar-chart-3" class="size-4 text-muted" />
              {{ F.sections.financial }}
            </div>
          </template>
          <div v-if="data?.financials" class="grid gap-6 sm:grid-cols-3">
            <div>
              <div class="mb-1 text-xs text-muted">{{ F.financial.contracted }}</div>
              <div class="text-xl font-bold tabular-nums text-highlighted">
                {{ formatMoney(data.financials.contractedAmount) }}
              </div>
            </div>
            <div>
              <div class="mb-1 text-xs text-muted">{{ F.financial.executed }}</div>
              <div class="text-xl font-bold tabular-nums text-primary">
                {{ formatMoney(data.financials.executedAmount) }}
              </div>
              <div class="mt-1 text-xs text-muted">{{ formatPercent(data.financials.balancePercentage) }}</div>
            </div>
            <div>
              <div class="mb-1 text-xs text-muted">{{ F.financial.paid }}</div>
              <div class="text-xl font-bold tabular-nums text-success">
                {{ formatMoney(data.financials.paidAmount) }}
              </div>
              <div class="mt-1 text-xs text-muted">{{ formatPercent(data.financials.financialProgress) }}</div>
            </div>
          </div>
          <div v-if="data?.financials" class="mt-5 grid gap-4 border-t border-default pt-4 sm:grid-cols-2">
            <div>
              <div class="text-xs text-muted">{{ F.financial.anticipoGranted }}</div>
              <div class="mt-0.5 font-semibold tabular-nums text-highlighted">
                {{ formatMoney(data.financials.anticipoAmount) }}
              </div>
            </div>
            <div>
              <div class="text-xs text-muted">{{ F.financial.anticipoRemaining }}</div>
              <div class="mt-0.5 font-semibold tabular-nums text-highlighted">
                {{ formatMoney(Math.max(0, data.financials.anticipoAmount - data.financials.paidAmount)) }}
              </div>
            </div>
          </div>
        </UCard>

        <!-- Concept progress (simple summary) -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-list-checks" class="size-4 text-muted" />
              {{ F.sections.conceptProgress }}
            </div>
          </template>
          <div v-if="data?.conceptProgress" class="grid gap-4 sm:grid-cols-4">
            <div>
              <div class="text-xs text-muted">{{ F.conceptProgress.totalConcepts }}</div>
              <div class="mt-0.5 text-xl font-bold tabular-nums text-highlighted">{{ data.conceptProgress.total }}</div>
            </div>
            <div>
              <div class="text-xs text-muted">{{ F.conceptProgress.done }}</div>
              <div class="mt-0.5 text-xl font-bold tabular-nums text-success">{{ data.conceptProgress.done }}</div>
            </div>
            <div>
              <div class="text-xs text-muted">{{ F.conceptProgress.inProgress }}</div>
              <div class="mt-0.5 text-xl font-bold tabular-nums text-warning">{{ data.conceptProgress.inProgress }}</div>
            </div>
            <div>
              <div class="text-xs text-muted">{{ F.conceptProgress.notStarted }}</div>
              <div class="mt-0.5 text-xl font-bold tabular-nums text-muted">{{ data.conceptProgress.notStarted }}</div>
            </div>
          </div>
          <div v-if="data?.conceptProgress && data.conceptProgress.total > 0" class="mt-4">
            <div class="mb-1 flex items-center justify-between text-xs text-muted">
              <span>{{ F.conceptProgress.overallProgress }}</span>
              <span>{{ Math.round((data.conceptProgress.done / data.conceptProgress.total) * 100) }}%</span>
            </div>
            <div class="h-2 w-full overflow-hidden rounded-full bg-elevated">
              <div class="h-full rounded-full bg-success transition-all"
                :style="`width:${Math.round((data.conceptProgress.done / data.conceptProgress.total) * 100)}%`" />
            </div>
          </div>
        </UCard>

        <!-- Linked notes and files -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-paperclip" class="size-4 text-muted" />
              {{ F.sections.attachments }}
            </div>
          </template>
          <p class="mb-4 text-xs text-muted">
            {{ canEditAttachments ? F.attachments.hint : F.attachments.readonlyNotice }}
          </p>

          <div class="grid gap-6 sm:grid-cols-2">
            <!-- Linked log notes -->
            <div>
              <div class="mb-2 flex items-center justify-between">
                <span class="text-sm font-medium text-highlighted">{{ F.attachments.notesTitle }}</span>
                <UButton v-if="canEditAttachments" size="xs" icon="i-lucide-notebook-pen" color="neutral"
                  variant="outline" @click="() => void (logNotesModalOpen = true)">
                  {{ F.attachments.linkNote }}
                </UButton>
              </div>
              <p v-if="!finiquito.linkedLogNoteIds.length" class="text-xs text-muted">
                {{ F.attachments.noNotesLinked }}
              </p>
              <ul v-else class="space-y-1.5">
                <li v-for="lid in finiquito.linkedLogNoteIds" :key="lid"
                  class="flex items-center justify-between gap-2 rounded-md border border-default px-2.5 py-1.5 text-sm">
                  <NuxtLink :to="`/contracts/${contractId}/logbook/${lid}`" class="min-w-0 truncate text-highlighted hover:underline">
                    <UIcon name="i-lucide-notebook-pen" class="mr-1 size-3.5 text-muted" />
                    <template v-if="data?.logNoteOf(lid)">#{{ data.logNoteOf(lid)!.folio }} {{ data.logNoteOf(lid)!.title }}</template>
                    <template v-else>{{ lid }}</template>
                  </NuxtLink>
                  <UButton v-if="canEditAttachments" icon="i-lucide-x" size="xs" color="neutral" variant="ghost"
                    @click="toggleLogNote(lid)" />
                </li>
              </ul>
            </div>

            <!-- Linked files -->
            <div>
              <div class="mb-2 flex items-center justify-between">
                <span class="text-sm font-medium text-highlighted">{{ F.attachments.filesTitle }}</span>
                <UButton v-if="canEditAttachments" size="xs" icon="i-lucide-paperclip" color="neutral"
                  variant="outline" @click="openFilesPicker">
                  {{ F.attachments.addFile }}
                </UButton>
              </div>
              <p v-if="!finiquito.attachmentFileIds.length" class="text-xs text-muted">
                {{ F.attachments.noFilesLinked }}
              </p>
              <ul v-else class="space-y-1.5">
                <li v-for="fid in finiquito.attachmentFileIds" :key="fid"
                  class="flex items-center justify-between gap-2 rounded-md border border-default px-2.5 py-1.5 text-sm">
                  <button type="button" class="min-w-0 flex-1 truncate text-left text-highlighted hover:underline"
                    @click="() => { const f = data?.fileOf(fid); if (f) openViewer(f) }">
                    <UIcon name="i-lucide-file" class="mr-1 size-3.5 text-muted" />{{ data?.fileOf(fid)?.name ?? fid }}
                  </button>
                  <UButton v-if="canEditAttachments" icon="i-lucide-x" size="xs" color="neutral" variant="ghost"
                    @click="removeFile(fid)" />
                </li>
              </ul>
            </div>
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

  <!-- Log-note linker — must live outside UDashboardPanel -->
  <UModal v-model:open="logNotesModalOpen" :title="F.attachments.pickNoteModalTitle">
    <template #body>
      <div v-if="!(data?.logNotes ?? []).length" class="text-sm text-muted">
        {{ F.attachments.noNotesAvailable }}
      </div>
      <div v-else class="max-h-80 space-y-1 overflow-y-auto">
        <button v-for="n in (data?.logNotes ?? [])" :key="n.id"
          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-elevated"
          :class="(finiquito?.linkedLogNoteIds ?? []).map(String).includes(String(n.id)) ? 'bg-elevated/60' : ''"
          @click="toggleLogNote(String(n.id))">
          <UIcon name="i-lucide-notebook-pen" class="size-4 shrink-0 text-muted" />
          <span class="truncate">#{{ n.folio }} {{ n.title }}</span>
          <UIcon v-if="(finiquito?.linkedLogNoteIds ?? []).map(String).includes(String(n.id))"
            name="i-lucide-check" class="ml-auto size-4 text-success" />
        </button>
      </div>
    </template>
  </UModal>

  <!-- File picker/upload — must live outside UDashboardPanel -->
  <UModal v-model:open="filesModalOpen" :title="F.attachments.addFile">
    <template #body>
      <div class="space-y-4">
        <div class="rounded-lg border border-default p-3">
          <p class="mb-2 text-sm font-medium">{{ F.attachments.uploadNew }}</p>
          <input type="file" :disabled="filesUploading" @change="onUploadFile" />
        </div>
        <div>
          <p class="mb-2 text-sm font-medium">{{ F.attachments.pickExisting }}</p>
          <div v-if="!(data?.files ?? []).length" class="text-sm text-muted">{{ F.attachments.noOtherFiles }}</div>
          <div v-else class="max-h-64 space-y-1 overflow-y-auto">
            <button v-for="f in (data?.files ?? [])" :key="f.id"
              class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-elevated"
              :class="(finiquito?.attachmentFileIds ?? []).map(String).includes(String(f.id)) ? 'bg-elevated/60' : ''"
              @click="() => addExistingFile(String(f.id))">
              <UIcon name="i-lucide-file" class="size-4 shrink-0 text-muted" />
              <span class="truncate">{{ f.name }}</span>
              <UIcon v-if="(finiquito?.attachmentFileIds ?? []).map(String).includes(String(f.id))"
                name="i-lucide-check" class="ml-auto size-4 text-success" />
            </button>
          </div>
        </div>
      </div>
    </template>
  </UModal>

  <!-- File viewer — must live outside UDashboardPanel -->
  <FileViewerModal v-model:open="viewerOpen" :file="viewingFile" />
</template>