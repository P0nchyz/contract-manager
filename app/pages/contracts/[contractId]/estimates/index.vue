<!-- app/pages/contracts/[contractId]/estimates/index.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import { estimateStatusDisplay } from '~/utils/format'

const route = useRoute()
const repos = useRepositories()
const { can } = usePermissions()
const contractId = computed(() => route.params.contractId as string)

const { data: estimates, status, error, refresh } = await useAsyncData(
  `contract-estimates-${contractId.value}`,
  () => repos.estimates.listByContract(contractId.value),
  { default: () => [] }
)

const canCreate = computed(() => can('estimate:create'))

// ─── Delete draft ─────────────────────────────────────────────────────────────
const deletingId = ref<string | null>(null)
const deleteError = ref<string | null>(null)
async function deleteDraft(id: string) {
  if (!confirm(S.estimateDetail.actions.deleteConfirm)) return
  deletingId.value = id
  deleteError.value = null
  try {
    await repos.estimates.delete(id)
    await refresh()
  } catch (e) {
    deleteError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    deletingId.value = null
  }
}

// Nuxt UI v3 / TanStack Table column definitions
const columns = [
  { accessorKey: 'number', header: 'No.' },
  { id: 'period', header: 'Periodo' },
  { accessorKey: 'amount', header: 'Monto Total' },
  { accessorKey: 'status', header: 'Estado' },
  { accessorKey: 'signatures', header: 'Firmas' },
  { id: 'actions', header: 'Acciones' }
]
</script>

<template>
  <UDashboardPanel id="contract-estimates">
    <template #header>
      <UDashboardNavbar :title="S.nav.estimates">
        <template #leading>
          <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" :to="`/contracts/${contractId}`"
            :aria-label="S.common.back" />
        </template>
        <template #right>
          <UButton v-if="canCreate" :to="`/contracts/${contractId}/estimates/new`" icon="i-lucide-plus"
            label="Nueva estimación" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-alert-triangle" :title="S.common.error"
        :actions="[{ label: 'Reintentar', color: 'neutral', variant: 'subtle', onClick: () => refresh() }]"
        class="mb-4" />
      <UAlert v-if="deleteError" color="error" variant="soft" icon="i-lucide-alert-triangle" :title="deleteError"
        class="mb-4" />

      <!-- Changed from :rows to :data -->
      <UTable :data="estimates" :columns="columns" :loading="status === 'pending'"
        :empty-state="{ icon: 'i-lucide-inbox', label: S.contractDashboard.noEstimates }" class="w-full">
        <!-- Slot names use -cell and data is inside row.original -->
        <template #number-cell="{ row }">
          <span class="font-medium tabular-nums">{{ row.original.number }}</span>
        </template>

        <template #period-cell="{ row }">
          <span class="text-sm">
            {{ formatDate(row.original.periodStart) }} – {{ formatDate(row.original.periodEnd) }}
          </span>
        </template>

        <template #amount-cell="{ row }">
          <span class="font-medium tabular-nums">
            {{ formatMoney(row.original.summary?.calculations?.total ?? 0) }}
          </span>
        </template>

        <template #status-cell="{ row }">
          <StatusBadge :display="estimateStatusDisplay[row.original.status]" />
        </template>

        <template #signatures-cell="{ row }">
          <SignatureChips :signatures="row.original.signatures" />
        </template>

        <template #actions-cell="{ row }">
          <div class="flex justify-end gap-1">
            <template v-if="row.original.status === 'draft' && canCreate">
              <UButton color="error" variant="ghost" icon="i-lucide-trash-2" size="xs"
                :loading="deletingId === row.original.id" @click.stop="deleteDraft(row.original.id)" />
              <UButton color="neutral" variant="ghost" icon="i-lucide-pencil" size="xs"
                :to="`/contracts/${contractId}/estimates/new?edit=${row.original.id}`" @click.stop />
            </template>
            <UButton color="neutral" variant="ghost" icon="i-lucide-chevron-right"
              :to="`/contracts/${contractId}/estimates/${row.original.id}`" />
          </div>
        </template>
      </UTable>
    </template>
  </UDashboardPanel>
</template>