<!-- app/pages/contracts/[contractId]/contract.vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'
import { agreementStatusDisplay, contractStatusDisplay } from '~/utils/format'

definePageMeta({ requiredPermission: 'estimate:view' })

const CI = S.contractInfo

const route = useRoute()
const repos = useRepositories()
const { can } = usePermissions()

const contractId = computed(() => route.params.contractId as string)

const { data, status, error, refresh } = await useAsyncData(
  () => `contract-info-${contractId.value}`,
  async () => {
    const [contract, agreements, reception, finiquito, users, corporations] = await Promise.all([
      repos.contracts.getById(contractId.value),
      repos.agreements.listByContract(contractId.value),
      repos.reception.getByContract(contractId.value).catch(() => null),
      repos.finiquito.getByContract(contractId.value).catch(() => null),
      repos.users.list().catch(() => []),
      repos.corporations.list().catch(() => []),
    ])
    const nameOf = (id: string | null | undefined) =>
      users.find((u) => u.id === id)?.fullName ?? '—'
    const corpName = corporations.find(
      (c) => c.id === contract.contractorCorporationId,
    )?.name ?? '—'
    return { contract, agreements, reception, finiquito, nameOf, corpName }
  },
)

const canCreateAgreement = computed(() => can('agreement:create'))
const canInitiateReception = computed(() => can('close:initiate'))

// Latest 3 agreements for the summary card; full list links to an index.
const recentAgreements = computed(() => data.value?.agreements.slice(-3).reverse() ?? [])
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

      <template v-else-if="data">
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
              <dt class="text-xs text-muted">{{ CI.fields.contractor }}</dt>
              <dd class="font-medium text-highlighted">{{ data.corpName }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted">{{ CI.fields.resident }}</dt>
              <dd class="text-highlighted">{{ data.nameOf(data.contract.residentId) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted">{{ CI.fields.superintendent }}</dt>
              <dd class="text-highlighted">{{ data.nameOf(data.contract.superintendentId) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted">{{ CI.fields.supervisor }}</dt>
              <dd class="text-highlighted">{{ data.nameOf(data.contract.supervisorId) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted">{{ CI.fields.financial }}</dt>
              <dd class="text-highlighted">{{ data.nameOf(data.contract.financialId) }}</dd>
            </div>
          </dl>
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
                <UButton icon="i-lucide-chevron-right" color="neutral" variant="ghost" size="xs"
                  :to="`/contracts/${contractId}/agreements/${ag.id}`" />
              </div>
            </li>
          </ul>
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
      </template>
    </template>
  </UDashboardPanel>
</template>