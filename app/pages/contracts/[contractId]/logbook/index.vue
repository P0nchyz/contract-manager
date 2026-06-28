<!-- app/pages/contracts/[contractId]/logbook/index.vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'

const route = useRoute()
const repos = useRepositories()
const { can } = usePermissions()
const contractId = computed(() => route.params.contractId as string)

const { data: logNotes, status, error, refresh } = await useAsyncData(
  `contract-logbook-${contractId.value}`,
  () => repos.logNotes.listByContract(contractId.value),
  { default: () => [] }
)

const canCreate = computed(() => can('logNote:create'))

// Nuxt UI v3 / TanStack Table column definitions
const columns = [
  { accessorKey: 'folio', header: S.contractDashboard.folio },
  { accessorKey: 'title', header: 'Título' },
  { accessorKey: 'date', header: 'Fecha' },
  { accessorKey: 'signatures', header: 'Firmas' },
  { id: 'actions', header: 'Acciones' }
]
</script>

<template>
  <UDashboardPanel id="contract-logbook">
    <template #header>
      <UDashboardNavbar :title="S.nav.logbook">
        <template #leading>
          <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" :to="`/contracts/${contractId}`"
            :aria-label="S.common.back" />
        </template>
        <template #right>
          <UButton v-if="canCreate" :to="`/contracts/${contractId}/logbook/new`" icon="i-lucide-plus"
            :label="S.actions.newLogNote" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-alert-triangle" :title="S.common.error"
        :actions="[{ label: 'Reintentar', color: 'neutral', variant: 'subtle', onClick: () => refresh() }]"
        class="mb-4" />

      <!-- Changed from :rows to :data -->
      <UTable :data="logNotes" :columns="columns" :loading="status === 'pending'"
        :empty-state="{ icon: 'i-lucide-inbox', label: S.contractDashboard.noLogNotes }" class="w-full">
        <!-- Slot names use -cell and data is inside row.original -->
        <template #folio-cell="{ row }">
          <span class="font-medium tabular-nums">{{ row.original.folio }}</span>
        </template>

        <template #date-cell="{ row }">
          {{ formatDate(row.original.date) }}
        </template>

        <template #signatures-cell="{ row }">
          <SignatureChips :signatures="row.original.signatures" />
        </template>

        <template #actions-cell="{ row }">
          <div class="flex justify-end">
            <UButton color="neutral" variant="ghost" icon="i-lucide-chevron-right"
              :to="`/contracts/${contractId}/logbook/${row.original.id}`" />
          </div>
        </template>
      </UTable>
    </template>
  </UDashboardPanel>
</template>