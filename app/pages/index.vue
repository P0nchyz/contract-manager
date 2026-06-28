<!-- app/pages/index.vue -->
<script setup lang="ts">
import type { Contract, ContractFinancials } from '~/data/models'
import { S } from '~/constants/strings'

const repos = useRepositories()
const { can } = usePermissions()
const auth = useAuthStore()

// Admin has no contract access — send them to user management.
if (auth.user?.role === 'admin') {
  await navigateTo('/admin/users')
}

interface ContractCardData {
  contract: Contract
  financials: ContractFinancials | null
  hasAlert: boolean
}

const { data: items, status, error, refresh } = await useAsyncData<ContractCardData[]>(
  'main-dashboard',
  async () => {
    const [contracts, alerts] = await Promise.all([
      repos.contracts.listMine(),
      repos.alerts.listMine(),
    ])
    const financials = await Promise.all(
      contracts.map((c) => repos.contracts.getFinancials(c.id).catch(() => null)),
    )
    const alertedContractIds = new Set(
      alerts.filter((a) => !a.read && a.contractId).map((a) => a.contractId),
    )
    return contracts.map((c, i) => ({
      contract: c,
      financials: financials[i] ?? null,
      hasAlert: alertedContractIds.has(c.id),
    }))
  },
  { default: () => [] },
)

const canCreate = computed(() => can('contract:create'))
</script>

<template>
  <UDashboardPanel id="main-dashboard">
    <template #header>
      <UDashboardNavbar :title="S.dashboard.title">
        <template #right>
          <UButton
            v-if="canCreate"
            to="/contracts/new"
            icon="i-lucide-plus"
            :label="S.dashboard.newContract"
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

      <div v-else-if="status === 'pending'" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <USkeleton v-for="n in 3" :key="n" class="h-44 w-full rounded-lg" />
      </div>

      <div v-else class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <ContractCard
          v-for="item in items"
          :key="item.contract.id"
          :contract="item.contract"
          :financials="item.financials"
          :has-alert="item.hasAlert"
        />

        <!-- create-contract card (resident only) -->
        <ULink
          v-if="canCreate"
          to="/contracts/new"
          class="flex min-h-44 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-default text-muted transition hover:border-primary hover:text-primary"
        >
          <UIcon name="i-lucide-plus" class="size-7" />
          <span class="text-sm font-medium">{{ S.dashboard.newContract }}</span>
        </ULink>

        <p v-if="!items.length && !canCreate" class="col-span-full text-sm text-muted">
          {{ S.dashboard.empty }}
        </p>
      </div>
    </template>
  </UDashboardPanel>
</template>
