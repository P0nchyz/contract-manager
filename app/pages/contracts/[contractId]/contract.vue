<!-- app/pages/contracts/[contractId]/contract.vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import { agreementStatusDisplay, contractStatusDisplay, formatNumber } from '~/utils/format'
import { buildPeriods } from '~/data/calc/schedule'
import { groupConceptsBySections } from '~/composables/useConceptSections'
import { fileIcon } from '~/utils/fileIcon'
import type { FileAsset } from '~/data/models'

definePageMeta({ requiredPermission: 'estimate:view' })

const CI = S.contractInfo
const C = S.conceptCatalog
const SM = S.scheduleMatrix

const route = useRoute()
const router = useRouter()
const repos = useRepositories()
const { can } = usePermissions()

const contractId = computed(() => route.params.contractId as string)

const { data, status, error, refresh } = await useAsyncData(
  () => `contract-info-${contractId.value}`,
  async () => {
    const [contract, agreements, reception, finiquito, users, corporations, sections, concepts, schedule, folders] = await Promise.all([
      repos.contracts.getById(contractId.value),
      repos.agreements.listByContract(contractId.value),
      repos.reception.getByContract(contractId.value).catch(() => null),
      repos.finiquito.getByContract(contractId.value).catch(() => null),
      repos.users.list().catch(() => []),
      repos.corporations.list().catch(() => []),
      repos.concepts.listSectionsByContract(contractId.value).catch(() => []),
      repos.concepts.listByContract(contractId.value).catch(() => []),
      repos.schedule.getByContract(contractId.value).catch(() => null),
      repos.files.listFolders(contractId.value).catch(() => []),
    ])
    // Documents uploaded at contract creation live in the predefined 'contract' folder.
    const contractFolder = folders.find((f) => f.kind === 'contract')
    const contractDocuments = contractFolder
      ? await repos.files.listFiles(contractId.value, contractFolder.id).catch(() => [])
      : []
    const nameOf = (id: string | null | undefined) =>
      users.find((u) => u.id === id)?.fullName ?? '—'
    const corpName = corporations.find(
      (c) => c.id === contract.contractorCorporationId,
    )?.name ?? '—'
    const supCorpName = corporations.find(
      (c) => c.id === contract.supervisorCorporationId,
    )?.name ?? '—'
    const groups = groupConceptsBySections(sections, concepts)
    const periods = buildPeriods(
      new Date(contract.startDate), new Date(contract.endDate), contract.estimatePeriodicity ?? 'monthly',
    )
    return {
      contract, agreements, reception, finiquito, nameOf, corpName, supCorpName,
      sections, concepts, groups, periods, scheduleEntries: schedule?.entries ?? [],
      contractDocuments,
    }
  },
)

const canCreateAgreement = computed(() => can('agreement:create'))
const canInitiateReception = computed(() => can('close:initiate'))

// ─── Contract documents viewer ─────────────────────────────────────────────────
const viewerOpen = ref(false)
const viewingFile = ref<FileAsset | null>(null)
function openViewer(file: FileAsset) {
  viewingFile.value = file
  viewerOpen.value = true
}
function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1_048_576).toFixed(1)} MB`
}

// Latest 3 agreements for the summary card; full list links to an index.
const recentAgreements = computed(() => data.value?.agreements.slice(-3).reverse() ?? [])

// ─── Delete draft agreement ───────────────────────────────────────────────────
const deletingAgreementId = ref<string | null>(null)
const deleteAgreementError = ref<string | null>(null)
async function deleteAgreementDraft(id: string) {
  if (!confirm('¿Eliminar este borrador de convenio? Esta acción no se puede deshacer.')) return
  deletingAgreementId.value = id
  deleteAgreementError.value = null
  try {
    await repos.agreements.delete(id)
    await refresh()
  } catch (e) {
    deleteAgreementError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    deletingAgreementId.value = null
  }
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
const tabItems = [
  { label: CI.tabs.general, icon: 'i-lucide-file-text', value: 'general', slot: 'general' as const },
  { label: CI.tabs.concepts, icon: 'i-lucide-list', value: 'concepts', slot: 'concepts' as const },
  { label: CI.tabs.schedule, icon: 'i-lucide-table', value: 'schedule', slot: 'schedule' as const },
]
const activeTab = computed({
  get: () => (route.query.tab as string) || 'general',
  set: (tab: string) => router.replace({ query: { ...route.query, tab } }),
})

// ─── Concepts tab ─────────────────────────────────────────────────────────────
const conceptSearch = ref('')
const filteredGroups = computed(() => {
  const q = conceptSearch.value.trim().toLowerCase()
  if (!q || !data.value) return data.value?.groups ?? []
  return data.value.groups
    .map((g) => ({
      ...g,
      concepts: g.concepts.filter(
        (c) =>
          c.specificationNumber.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.unit.toLowerCase().includes(q),
      ),
    }))
    .filter((g) => g.concepts.length > 0)
})
const totalContracted = computed(() =>
  data.value?.concepts.reduce((s, c) => s + c.unitPrice * c.contractedQuantity, 0) ?? 0,
)
</script>

<template>
  <UDashboardPanel id="contract-info">
    <template #header>
      <UDashboardNavbar :title="CI.title">
        <template #leading>
          <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" :to="`/contracts/${contractId}`"
            :aria-label="S.common.back" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-alert-triangle" :title="S.common.error"
        :actions="[{ label: 'Reintentar', color: 'neutral', variant: 'subtle', onClick: () => refresh() }]" />

      <div v-else-if="status === 'pending'" class="space-y-4">
        <USkeleton class="h-40 w-full rounded-lg" />
        <USkeleton class="h-32 w-full rounded-lg" />
        <USkeleton class="h-32 w-full rounded-lg" />
      </div>

      <div v-else-if="data" class="space-y-6">
        <UTabs v-model="activeTab" :items="tabItems" class="w-full">
          <template #general>
            <div class="mt-4 space-y-6">
              <!-- General data -->
              <UCard>
                <template #header>
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 font-medium">
                      <UIcon name="i-lucide-file-text" class="size-4 text-muted" />
                      {{ CI.sections.general }}
                    </div>
                    <StatusBadge :display="contractStatusDisplay[data.contract.status]" />
                  </div>
                </template>
                <dl class="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div class="sm:col-span-2 lg:col-span-3">
                    <dt class="text-xs text-muted">{{ CI.fields.title }}</dt>
                    <dd class="font-medium text-highlighted">{{ data.contract.title }}</dd>
                  </div>
                  <div>
                    <dt class="text-xs text-muted">{{ CI.fields.code }}</dt>
                    <dd class="font-mono text-sm text-highlighted">{{ data.contract.code }}</dd>
                  </div>
                  <div>
                    <dt class="text-xs text-muted">{{ CI.fields.amount }}</dt>
                    <dd class="font-semibold tabular-nums text-highlighted">
                      {{ formatMoney(data.contract.amount) }}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-xs text-muted">{{ CI.fields.anticipo }}</dt>
                    <dd class="tabular-nums text-highlighted">
                      {{ formatPercent(data.contract.anticipoPercentage, 0) }}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-xs text-muted">{{ CI.fields.startDate }}</dt>
                    <dd class="text-highlighted">{{ formatDate(data.contract.startDate) }}</dd>
                  </div>
                  <div>
                    <dt class="text-xs text-muted">{{ CI.fields.endDate }}</dt>
                    <dd class="text-highlighted">{{ formatDate(data.contract.endDate) }}</dd>
                  </div>
                </dl>
              </UCard>

              <!-- Parties -->
              <UCard>
                <template #header>
                  <div class="flex items-center gap-2 font-medium">
                    <UIcon name="i-lucide-users" class="size-4 text-muted" />
                    {{ CI.sections.parties }}
                  </div>
                </template>
                <dl class="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <dt class="text-xs text-muted">{{ CI.fields.entity }}</dt>
                    <dd class="font-medium text-highlighted">{{ data.nameOf(data.contract.entityId) }}</dd>
                  </div>
                  <div>
                    <dt class="text-xs text-muted">{{ CI.fields.resident }}</dt>
                    <dd class="text-highlighted">{{ data.nameOf(data.contract.residentId) }}</dd>
                  </div>
                  <div>
                    <dt class="text-xs text-muted">{{ CI.fields.contractor }}</dt>
                    <dd class="font-medium text-highlighted">{{ data.corpName }}</dd>
                  </div>
                  <div>
                    <dt class="text-xs text-muted">{{ CI.fields.superintendent }}</dt>
                    <dd class="text-highlighted">{{ data.nameOf(data.contract.superintendentId) }}</dd>
                  </div>
                  <div>
                    <dt class="text-xs text-muted">{{ CI.fields.supervisorCorporation }}</dt>
                    <dd class="text-highlighted">{{ data.supCorpName }}</dd>
                  </div>
                  <div>
                    <dt class="text-xs text-muted">{{ CI.fields.supervisor }}</dt>
                    <dd class="text-highlighted">{{ data.nameOf(data.contract.supervisorId) }}</dd>
                  </div>
                </dl>
              </UCard>

              <!-- Contract documents -->
              <UCard>
                <template #header>
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 font-medium">
                      <UIcon name="i-lucide-paperclip" class="size-4 text-muted" />
                      {{ CI.sections.documents }}
                    </div>
                    <UButton icon="i-lucide-folder-open" size="sm" color="neutral" variant="ghost"
                      :to="`/contracts/${contractId}/files`">
                      {{ CI.documents.viewInFiles }}
                    </UButton>
                  </div>
                </template>

                <div v-if="!data.contractDocuments.length" class="text-sm text-muted">
                  {{ CI.documents.empty }}
                </div>
                <ul v-else class="divide-y divide-default">
                  <li v-for="file in data.contractDocuments" :key="file.id"
                    class="flex items-center gap-3 py-2.5">
                    <UIcon :name="fileIcon(file.mimeType)" class="size-4 shrink-0 text-muted" />
                    <button type="button"
                      class="min-w-0 flex-1 truncate text-left text-sm text-highlighted hover:underline"
                      @click="openViewer(file)">
                      {{ file.name }}
                    </button>
                    <span class="shrink-0 text-xs text-muted">{{ formatBytes(file.sizeBytes) }}</span>
                  </li>
                </ul>
              </UCard>

              <!-- Modification agreements -->
              <UCard>
                <template #header>
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 font-medium">
                      <UIcon name="i-lucide-file-plus-2" class="size-4 text-muted" />
                      {{ CI.sections.agreements }}
                    </div>
                    <UButton v-if="canCreateAgreement" icon="i-lucide-plus" size="sm" color="neutral" variant="outline"
                      :to="`/contracts/${contractId}/agreements/new`">
                      {{ CI.agreements.new }}
                    </UButton>
                  </div>
                </template>

                <div v-if="!data.agreements.length" class="text-sm text-muted">
                  {{ CI.agreements.empty }}
                </div>
                <ul v-else class="divide-y divide-default">
                  <li v-for="ag in recentAgreements" :key="ag.id" class="flex items-center justify-between gap-3 py-3">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="text-xs font-medium text-muted">
                          {{ CI.agreements.number }}{{ ag.number }}
                        </span>
                        <UBadge :label="CI.agreements.kindLabel[ag.kind]" color="neutral" variant="soft" size="xs" />
                      </div>
                      <p class="truncate text-sm text-highlighted">{{ ag.description }}</p>
                      <p class="text-xs text-muted">{{ formatDate(ag.updatedAt) }}</p>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                      <StatusBadge :display="agreementStatusDisplay[ag.status]" />
                      <template v-if="ag.status === 'draft' && canCreateAgreement">
                        <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs"
                          :loading="deletingAgreementId === ag.id" @click="deleteAgreementDraft(ag.id)" />
                        <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" size="xs"
                          :to="`/contracts/${contractId}/agreements/new?edit=${ag.id}`" />
                      </template>
                      <UButton icon="i-lucide-chevron-right" color="neutral" variant="ghost" size="xs"
                        :to="`/contracts/${contractId}/agreements/${ag.id}`" />
                    </div>
                  </li>
                </ul>
                <UAlert v-if="deleteAgreementError" class="mt-2" color="error" variant="soft"
                  icon="i-lucide-alert-triangle" :title="deleteAgreementError" />
                <div v-if="data.agreements.length > 3" class="mt-2 text-right">
                  <UButton color="neutral" variant="ghost" size="xs" :to="`/contracts/${contractId}/agreements`">
                    {{ S.contractDashboard.viewAll }}
                  </UButton>
                </div>
              </UCard>

              <!-- Closing flows -->
              <UCard>
                <template #header>
                  <div class="flex items-center gap-2 font-medium">
                    <UIcon name="i-lucide-flag" class="size-4 text-muted" />
                    {{ CI.sections.closing }}
                  </div>
                </template>

                <div class="grid gap-4 sm:grid-cols-2">
                  <!-- Reception -->
                  <div class="rounded-lg border border-default p-4">
                    <div class="mb-3 flex items-center justify-between gap-2">
                      <span class="font-medium text-highlighted">{{ CI.closing.reception }}</span>
                      <StatusBadge v-if="data.reception" :display="agreementStatusDisplay[data.reception.status]" />
                      <span v-else class="text-xs text-muted">{{ CI.closing.notStarted }}</span>
                    </div>
                    <div v-if="data.reception">
                      <p class="mb-3 text-xs text-muted">
                        {{ formatDate(data.reception.createdAt) }}
                      </p>
                      <SignatureChips :signatures="data.reception.signatures" />
                      <UButton class="mt-3" size="sm" color="neutral" variant="outline" icon="i-lucide-arrow-right"
                        :to="`/contracts/${contractId}/reception`">
                        {{ CI.closing.view }}
                      </UButton>
                    </div>
                    <UButton v-else-if="canInitiateReception" size="sm" icon="i-lucide-play"
                      :to="`/contracts/${contractId}/reception`">
                      {{ CI.closing.initiate }}
                    </UButton>
                  </div>

                  <!-- Finiquito -->
                  <div class="rounded-lg border border-default p-4">
                    <div class="mb-3 flex items-center justify-between gap-2">
                      <span class="font-medium text-highlighted">{{ CI.closing.finiquito }}</span>
                      <StatusBadge v-if="data.finiquito" :display="agreementStatusDisplay[data.finiquito.status]" />
                      <span v-else class="text-xs text-muted">{{ CI.closing.notStarted }}</span>
                    </div>
                    <div v-if="data.finiquito">
                      <p class="mb-3 text-xs text-muted">
                        {{ formatDate(data.finiquito.createdAt) }}
                      </p>
                      <SignatureChips :signatures="data.finiquito.signatures" />
                      <UButton class="mt-3" size="sm" color="neutral" variant="outline" icon="i-lucide-arrow-right"
                        :to="`/contracts/${contractId}/finiquito`">
                        {{ CI.closing.view }}
                      </UButton>
                    </div>
                    <template v-else-if="canInitiateReception">
                      <p v-if="data.reception?.status !== 'approved'" class="text-xs text-muted">
                        {{ CI.closing.finiquitoBlocked }}
                      </p>
                      <UButton v-else size="sm" icon="i-lucide-play" :to="`/contracts/${contractId}/finiquito`">
                        {{ CI.closing.initiate }}
                      </UButton>
                    </template>
                  </div>
                </div>
              </UCard>
            </div>
          </template>

          <template #concepts>
            <div class="mt-4 space-y-4">
              <UAlert color="neutral" variant="soft" icon="i-lucide-lock" :title="C.readonlyNotice"
                :actions="canCreateAgreement ? [{ label: S.contractInfo.agreements.new, color: 'neutral', variant: 'subtle', to: `/contracts/${contractId}/agreements/new` }] : undefined" />

              <div class="flex items-center gap-3">
                <UInput v-model="conceptSearch" :placeholder="C.search" icon="i-lucide-search" class="max-w-xs" />
                <span class="text-sm text-muted">{{ data.concepts.length }} conceptos · {{ data.sections.length }}
                  secciones</span>
              </div>

              <div v-if="!data.concepts.length"
                class="rounded-lg border border-dashed border-default py-16 text-center text-sm text-muted">
                {{ C.empty }}
              </div>

              <UCard v-else :ui="{ body: 'p-0 sm:p-0' }">
                <div class="overflow-x-auto">
                  <table class="w-full min-w-[44rem] text-sm">
                    <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                      <tr>
                        <th class="px-4 py-2.5 text-left font-medium">{{ C.columns.specification }}</th>
                        <th class="px-4 py-2.5 text-left font-medium">{{ C.columns.description }}</th>
                        <th class="px-4 py-2.5 text-left font-medium">{{ C.columns.unit }}</th>
                        <th class="px-4 py-2.5 text-right font-medium">{{ C.columns.unitPrice }}</th>
                        <th class="px-4 py-2.5 text-right font-medium">{{ C.columns.contractedQty }}</th>
                        <th class="px-4 py-2.5 text-right font-medium">{{ C.columns.contractedAmount }}</th>
                      </tr>
                    </thead>

                    <tbody>
                      <template v-for="group in filteredGroups" :key="group.section?.id ?? 'no-section'">
                        <tr class="bg-elevated border-t-2 border-default">
                          <td colspan="6" class="px-4 py-2">
                            <div class="flex items-center justify-between gap-4">
                              <div class="flex items-center gap-3">
                                <span class="font-mono text-xs font-semibold text-muted">
                                  {{ group.section?.specificationNumber ?? '' }}
                                </span>
                                <span class="font-semibold text-highlighted">
                                  {{ group.section?.description ?? S.conceptSections.noSection }}
                                </span>
                                <span v-if="group.section" class="text-xs text-muted">
                                  {{ formatDate(group.section.startDate) }} – {{ formatDate(group.section.endDate) }}
                                </span>
                              </div>
                              <span class="text-xs font-medium text-muted">
                                {{ S.conceptSections.subtotal }}: {{ formatMoney(group.contractedAmount) }}
                              </span>
                            </div>
                          </td>
                        </tr>

                        <tr v-for="c in group.concepts" :key="c.id"
                          class="border-t border-default/50 hover:bg-elevated/40 transition-colors">
                          <td class="px-4 py-2.5 pl-8 font-mono text-xs text-highlighted">{{ c.specificationNumber }}</td>
                          <td class="min-w-[18rem] px-4 py-2.5 text-highlighted">
                            {{ c.description }}
                            <UBadge v-if="c.isExtra" :label="C.extraBadge" color="warning" variant="subtle" size="xs"
                              class="ml-1.5" />
                          </td>
                          <td class="px-4 py-2.5 text-muted">{{ c.unit }}</td>
                          <td class="px-4 py-2.5 text-right tabular-nums text-highlighted">{{ formatMoney(c.unitPrice) }}
                          </td>
                          <td class="px-4 py-2.5 text-right tabular-nums text-highlighted">{{
                            formatNumber(c.contractedQuantity) }}</td>
                          <td class="px-4 py-2.5 text-right tabular-nums font-medium text-highlighted">{{
                            formatMoney(c.unitPrice * c.contractedQuantity) }}</td>
                        </tr>

                        <tr class="border-t border-default bg-elevated/30">
                          <td colspan="5" class="px-4 py-1.5 pl-8 text-right text-xs text-muted">
                            {{ S.conceptSections.subtotal }}
                          </td>
                          <td class="px-4 py-1.5 text-right tabular-nums text-xs font-semibold text-highlighted">
                            {{ formatMoney(group.contractedAmount) }}
                          </td>
                        </tr>
                      </template>
                    </tbody>

                    <tfoot class="border-t-2 border-default bg-elevated/50 text-sm">
                      <tr>
                        <td colspan="4" class="px-4 py-2.5" />
                        <td class="px-4 py-2.5 text-right text-xs font-medium text-muted">{{ C.total }}</td>
                        <td class="px-4 py-2.5 text-right tabular-nums font-semibold text-highlighted">
                          {{ formatMoney(totalContracted) }}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </UCard>
            </div>
          </template>

          <template #schedule>
            <div class="mt-4 space-y-4">
              <UAlert color="neutral" variant="soft" icon="i-lucide-lock" :title="SM.hint" />
              <ScheduleMatrixTable :groups="data.groups" :periods="data.periods" :entries="data.scheduleEntries" />
            </div>
          </template>
        </UTabs>
      </div>
    </template>
  </UDashboardPanel>

  <FileViewerModal v-model:open="viewerOpen" :file="viewingFile" />
</template>