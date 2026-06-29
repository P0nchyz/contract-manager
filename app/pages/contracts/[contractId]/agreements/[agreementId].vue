<!-- app/pages/contracts/[contractId]/agreements/[agreementId].vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import { agreementStatusDisplay } from '~/utils/format'
import type { UserId } from '~/data/models'

definePageMeta({ requiredPermission: 'estimate:view' })

const AG = S.agreement

const route = useRoute()
const repos = useRepositories()
const { can, role } = usePermissions()

const contractId = computed(() => route.params.contractId as string)
const agreementId = computed(() => route.params.agreementId as string)

const { data, status, error, refresh } = await useAsyncData(
  () => `agreement-${agreementId.value}`,
  async () => {
    const [agreement, users, concepts, schedule] = await Promise.all([
      repos.agreements.getById(agreementId.value),
      repos.users.list().catch(() => []),
      repos.concepts.listByContract(route.params.contractId as string).catch(() => []),
      repos.schedule.getByContract(route.params.contractId as string).catch(() => null),
    ])
    const names: Record<string, string> = {}
    for (const u of users) names[u.id] = u.fullName
    const scheduleByConceptId: Record<string, { startDate: Date; endDate: Date }> = {}
    if (schedule) {
      for (const item of schedule.items) {
        if (item.conceptId) scheduleByConceptId[item.conceptId] = item
      }
    }
    return { agreement, names, concepts, scheduleByConceptId }
  },
)

const agreement = computed(() => data.value?.agreement ?? null)
const userName = (id: UserId | null | undefined) =>
  (id && data.value?.names[id]) || (id ?? '—')
const conceptOf = (id: string) => data.value?.concepts.find((c) => c.id === id)
const scheduleOf = (id: string) => data.value?.scheduleByConceptId[id]

// --- Workflow gating (mirrors estimate logic) ---
const st = computed(() => agreement.value?.status ?? null)
const mySlot = computed(() =>
  agreement.value?.signatures.find((s) => s.role === role.value) ?? null,
)

const canEdit = computed(
  () => can('agreement:create') && (st.value === 'draft' || st.value === 'with_notes'),
)
const canSubmit = computed(() => st.value === 'draft' && can('agreement:create'))
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
const hasBarAction = computed(() => canEdit.value || canSubmit.value || canSign.value)

const latestNote = computed(() => {
  const ag = agreement.value
  if (!ag || (ag.status !== 'with_notes' && ag.status !== 'rejected')) return null
  for (let i = ag.history.length - 1; i >= 0; i--) {
    const ev = ag.history[i]
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

const submit = () => run(() => repos.agreements.submit(agreementId.value))
const sign = () => run(() => repos.agreements.sign(agreementId.value))

const reviewNote = ref('')
const reviewError = ref<string | null>(null)
function withNote(action: (id: string, note: string) => Promise<unknown>) {
  const note = reviewNote.value.trim()
  if (!note) { reviewError.value = AG.note.required; return }
  reviewError.value = null
  reviewNote.value = ''
  return run(() => action(agreementId.value, note))
}
const returnWithNotes = () => withNote(repos.agreements.returnWithNotes)
const reject = () => withNote(repos.agreements.reject)

const editLink = computed(() => ({
  path: `/contracts/${contractId.value}/agreements/new`,
  query: { edit: agreementId.value },
}))
</script>

<template>
  <UDashboardPanel id="agreement-detail">
    <template #header>
      <UDashboardNavbar
        :title="agreement ? `${AG.titlePrefix} No. ${agreement.number}` : AG.titlePrefix"
      >
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
            v-if="agreement"
            :display="agreementStatusDisplay[agreement.status]"
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
        <USkeleton class="h-28 w-full rounded-lg" />
        <USkeleton class="h-40 w-full rounded-lg" />
      </div>

      <template v-else-if="agreement">
        <!-- Banner for returned / rejected -->
        <UAlert
          v-if="latestNote"
          :color="agreement.status === 'rejected' ? 'error' : 'warning'"
          variant="soft"
          icon="i-lucide-message-square-warning"
          :title="agreement.status === 'rejected' ? AG.banner.rejected : AG.banner.withNotes"
          :description="latestNote.note"
        />

        <!-- Detail card -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-file-plus-2" class="size-4 text-muted" />
              {{ AG.sections.detail }}
            </div>
          </template>
          <!-- Description + kind + aggregate deltas -->
          <dl class="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <div class="sm:col-span-2 lg:col-span-4">
              <dt class="text-xs text-muted">{{ AG.fields.description }}</dt>
              <dd class="text-highlighted">{{ agreement.description }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted">Tipo</dt>
              <dd><UBadge :label="AG.kind[agreement.kind]" color="neutral" variant="soft" size="sm" /></dd>
            </div>
            <div v-if="agreement.amountDelta != null">
              <dt class="text-xs text-muted">{{ AG.fields.amountDelta }}</dt>
              <dd class="font-semibold tabular-nums" :class="agreement.amountDelta >= 0 ? 'text-success' : 'text-error'">
                {{ agreement.amountDelta >= 0 ? '+' : '' }}{{ formatMoney(agreement.amountDelta) }}
              </dd>
            </div>
            <div v-if="agreement.timeDeltaDays != null">
              <dt class="text-xs text-muted">{{ AG.fields.timeDeltaDays }}</dt>
              <dd class="font-semibold tabular-nums" :class="agreement.timeDeltaDays >= 0 ? 'text-success' : 'text-error'">
                {{ agreement.timeDeltaDays >= 0 ? '+' : '' }}{{ agreement.timeDeltaDays }} días
              </dd>
            </div>
          </dl>

          <!-- Concept changes -->
          <div v-if="agreement.conceptChanges.length" class="mt-5">
            <div class="mb-2 text-sm font-medium text-default">{{ AG.conceptChanges.title }}</div>
            <div class="overflow-x-auto rounded-lg border border-default">
              <table class="w-full min-w-[40rem] text-sm">
                <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                  <tr>
                    <th class="px-3 py-2 text-left font-medium">{{ AG.conceptChanges.columns.specification }}</th>
                    <th class="px-3 py-2 text-left font-medium">{{ AG.conceptChanges.columns.description }}</th>
                    <th class="px-3 py-2 text-right font-medium">{{ AG.conceptChanges.columns.currentQty }}</th>
                    <th class="px-3 py-2 text-right font-medium text-success">{{ AG.conceptChanges.columns.newQty }}</th>
                    <th class="px-3 py-2 text-right font-medium">{{ AG.conceptChanges.columns.currentPrice }}</th>
                    <th class="px-3 py-2 text-right font-medium text-success">{{ AG.conceptChanges.columns.newPrice }}</th>
                    <th class="px-3 py-2 text-center font-medium text-success">{{ AG.conceptChanges.columns.newStart }}</th>
                    <th class="px-3 py-2 text-center font-medium text-success">{{ AG.conceptChanges.columns.newEnd }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-default">
                  <tr v-for="cc in agreement.conceptChanges" :key="cc.conceptId">
                    <td class="px-3 py-2 font-mono text-xs text-highlighted">{{ conceptOf(cc.conceptId)?.specificationNumber }}</td>
                    <td class="min-w-[10rem] px-3 py-2 text-highlighted">{{ conceptOf(cc.conceptId)?.description }}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-muted">{{ formatNumber(conceptOf(cc.conceptId)?.contractedQuantity ?? 0) }}</td>
                    <td class="px-3 py-2 text-right tabular-nums" :class="cc.contractedQuantity != null ? 'font-medium text-success' : 'text-muted'">
                      {{ cc.contractedQuantity != null ? formatNumber(cc.contractedQuantity) : '—' }}
                    </td>
                    <td class="px-3 py-2 text-right tabular-nums text-muted">{{ formatMoney(conceptOf(cc.conceptId)?.unitPrice ?? 0) }}</td>
                    <td class="px-3 py-2 text-right tabular-nums" :class="cc.unitPrice != null ? 'font-medium text-success' : 'text-muted'">
                      {{ cc.unitPrice != null ? formatMoney(cc.unitPrice) : '—' }}
                    </td>
                    <td class="px-3 py-2 text-center" :class="cc.startDate ? 'text-success font-medium' : 'text-muted'">
                      {{ cc.startDate ? formatDate(cc.startDate) : (scheduleOf(cc.conceptId)?.startDate ? formatDate(scheduleOf(cc.conceptId)!.startDate) : '—') }}
                    </td>
                    <td class="px-3 py-2 text-center" :class="cc.endDate ? 'text-success font-medium' : 'text-muted'">
                      {{ cc.endDate ? formatDate(cc.endDate) : (scheduleOf(cc.conceptId)?.endDate ? formatDate(scheduleOf(cc.conceptId)!.endDate) : '—') }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- New concepts -->
          <div v-if="agreement.newConcepts.length" class="mt-5">
            <div class="mb-2 text-sm font-medium text-default">{{ AG.newConcepts.title }}</div>
            <div class="overflow-x-auto rounded-lg border border-default">
              <table class="w-full min-w-[36rem] text-sm">
                <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                  <tr>
                    <th class="px-3 py-2 text-left font-medium">{{ AG.newConcepts.columns.specification }}</th>
                    <th class="px-3 py-2 text-left font-medium">{{ AG.newConcepts.columns.description }}</th>
                    <th class="px-3 py-2 text-left font-medium">{{ AG.newConcepts.columns.unit }}</th>
                    <th class="px-3 py-2 text-right font-medium">{{ AG.newConcepts.columns.qty }}</th>
                    <th class="px-3 py-2 text-right font-medium">{{ AG.newConcepts.columns.unitPrice }}</th>
                    <th class="px-3 py-2 text-center font-medium">{{ AG.newConcepts.columns.scheduleStart }}</th>
                    <th class="px-3 py-2 text-center font-medium">{{ AG.newConcepts.columns.scheduleEnd }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-default">
                  <tr v-for="nc in agreement.newConcepts" :key="nc.specificationNumber">
                    <td class="px-3 py-2 font-mono text-xs text-highlighted">{{ nc.specificationNumber }}</td>
                    <td class="min-w-[10rem] px-3 py-2 text-highlighted">{{ nc.description }}</td>
                    <td class="px-3 py-2 text-muted">{{ nc.unit }}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-highlighted">{{ formatNumber(nc.contractedQuantity) }}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-highlighted">{{ formatMoney(nc.unitPrice) }}</td>
                    <td class="px-3 py-2 text-center text-muted">
                      {{ (nc as typeof nc & { startDate?: Date }).startDate ? formatDate((nc as typeof nc & { startDate?: Date }).startDate!) : '—' }}
                    </td>
                    <td class="px-3 py-2 text-center text-muted">
                      {{ (nc as typeof nc & { endDate?: Date }).endDate ? formatDate((nc as typeof nc & { endDate?: Date }).endDate!) : '—' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <UAlert
            v-if="agreement.status !== 'approved'"
            class="mt-4"
            color="neutral"
            variant="soft"
            icon="i-lucide-info"
            :title="AG.effectNotice"
          />
        </UCard>

        <!-- Inline review (supervisor returns / resident rejects) -->
        <UCard v-if="showReview">
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-clipboard-pen" class="size-4 text-muted" />
              {{ S.estimateDetail.review.title }}
            </div>
          </template>
          <UFormField :label="AG.note.label" :error="reviewError || undefined">
            <UTextarea
              v-model="reviewNote"
              :rows="3"
              class="w-full"
              :placeholder="AG.note.placeholder"
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
              {{ AG.actions.reject }}
            </UButton>
            <UButton
              v-if="canReturn"
              color="warning"
              variant="soft"
              icon="i-lucide-corner-up-left"
              :disabled="busy"
              @click="returnWithNotes"
            >
              {{ AG.actions.returnWithNotes }}
            </UButton>
          </div>
        </UCard>

        <!-- Signatures + History -->
        <div class="grid gap-4 lg:grid-cols-2">
          <UCard>
            <template #header>
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-pen-line" class="size-4 text-muted" />
                {{ AG.sections.signatures }}
              </div>
            </template>
            <ul class="divide-y divide-default">
              <li
                v-for="s in agreement.signatures"
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
                {{ AG.sections.history }}
              </div>
            </template>
            <ol class="relative space-y-4 border-s border-default ps-5">
              <li v-for="ev in [...agreement.history].reverse()" :key="ev.id" class="relative">
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

        <!-- Sticky action bar -->
        <div
          v-if="hasBarAction"
          class="sticky bottom-0 -mx-4 mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-default bg-default/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
        >
          <UButton
            v-if="canEdit"
            color="neutral"
            variant="outline"
            icon="i-lucide-pencil"
            :to="editLink"
          >
            {{ AG.actions.edit }}
          </UButton>
          <div v-else />

          <div class="flex gap-3">
            <UButton v-if="canSubmit" icon="i-lucide-send" :loading="busy" @click="submit">
              {{ AG.actions.submit }}
            </UButton>
            <UButton
              v-if="canSign"
              color="success"
              icon="i-lucide-pen-line"
              :loading="busy"
              @click="sign"
            >
              {{ AG.actions.sign }}
            </UButton>
          </div>
        </div>
      </template>
    </template>
  </UDashboardPanel>
</template>