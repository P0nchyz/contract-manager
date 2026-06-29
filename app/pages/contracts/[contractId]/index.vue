<!-- app/pages/contracts/[contractId]/index.vue -->
<script setup lang="ts">
import { buildScheduleCurve, type ConceptProgress } from '~/data/calc/schedule'
import { S } from '~/constants/strings'
import type { Permission } from '~/lib/permissions'

const route = useRoute()
const repos = useRepositories()
const { can } = usePermissions()
const contractId = computed(() => route.params.contractId as string)

const { data, status, error, refresh } = await useAsyncData(
  () => `contract-dashboard-${contractId.value}`,
  async () => {
    const [contract, financials, logNotes, estimates, schedule, concepts] = await Promise.all([
      repos.contracts.getById(contractId.value),
      repos.contracts.getFinancials(contractId.value).catch(() => null),
      repos.logNotes.listByContract(contractId.value),
      repos.estimates.listByContract(contractId.value),
      repos.schedule.getByContract(contractId.value).catch(() => null),
      repos.concepts.listByContract(contractId.value).catch(() => []),
    ])

    // Roll up physical (approved+paid) and financial (paid) progress per concept.
    const physQty: Record<string, number> = {}
    const finQty:  Record<string, number> = {}
    for (const est of estimates) {
      const isPhysical  = est.status === 'approved' || est.status === 'paid'
      const isPaid      = est.status === 'paid'
      for (const li of est.lineItems) {
        if (isPhysical) physQty[li.conceptId] = (physQty[li.conceptId] ?? 0) + li.inThisEstimate
        if (isPaid)     finQty[li.conceptId]  = (finQty[li.conceptId]  ?? 0) + li.inThisEstimate
      }
    }
    const contractedQty: Record<string, number> = {}
    for (const c of concepts) contractedQty[c.id] = c.contractedQuantity

    const conceptProgress: ConceptProgress[] = (schedule?.items ?? [])
      .filter((i) => i.conceptId)
      .map((i) => {
        const cid = i.conceptId!
        const contracted = contractedQty[cid] ?? 0
        return {
          conceptId:         cid,
          physicalProgress:  contracted > 0 ? Math.min((physQty[cid] ?? 0) / contracted * 100, 100) : 0,
          financialProgress: contracted > 0 ? Math.min((finQty[cid]  ?? 0) / contracted * 100, 100) : 0,
        }
      })

    return {
      contract,
      financials,
      recentLogNotes: [...logNotes].sort((a, b) => b.folio - a.folio).slice(0, 5),
      recentEstimates: [...estimates].sort((a, b) => b.number - a.number).slice(0, 5),
      curve: schedule
        ? buildScheduleCurve(schedule.items, contract.estimatePeriodicity ?? 'monthly', conceptProgress)
        : [],
    }
  },
)

interface QuickAction {
  label: string
  icon: string
  to: string
  permission?: Permission
}
const quickActions = computed<QuickAction[]>(() => {
  const base = `/contracts/${contractId.value}`
  return (
    [
      { label: S.actions.newLogNote, icon: 'i-lucide-notebook-pen', to: `${base}/logbook/new`, permission: 'logNote:create' },
      { label: S.actions.uploadEvidence, icon: 'i-lucide-image-plus', to: `${base}/evidence`, permission: 'evidence:upload' },
      { label: S.actions.conceptCatalog, icon: 'i-lucide-list', to: `${base}/concepts` },
      { label: S.actions.schedule, icon: 'i-lucide-chart-gantt', to: `${base}/schedule` },
      { label: S.actions.files, icon: 'i-lucide-folder', to: `${base}/files` },
    ] satisfies QuickAction[]
  ).filter((a) => !a.permission || can(a.permission))
})
</script>

<template>
  <UDashboardPanel id="contract-dashboard">
    <template #header>
      <UDashboardNavbar :title="data?.contract.code ?? S.nav.dashboard">
        <template #leading>
          <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" to="/" :aria-label="S.common.back" />
        </template>
        <template #right>
          <div class="flex items-center gap-1">
            <UTooltip v-for="a in quickActions" :key="a.icon" :text="a.label">
              <UButton :icon="a.icon" :to="a.to" color="neutral" variant="ghost" :aria-label="a.label" />
            </UTooltip>
          </div>
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

      <div v-else-if="status === 'pending'" class="grid gap-4 lg:grid-cols-12">
        <USkeleton class="h-56 lg:col-span-4 rounded-lg" />
        <USkeleton class="h-56 lg:col-span-8 rounded-lg" />
        <USkeleton class="h-64 lg:col-span-7 rounded-lg" />
        <USkeleton class="h-64 lg:col-span-5 rounded-lg" />
      </div>

      <template v-else-if="data">
        <div>
          <h2 class="text-base font-medium leading-snug">{{ data.contract.title }}</h2>
        </div>

        <div class="grid gap-4 lg:grid-cols-12">
          <ContractFinancialWidget
            v-if="data.financials"
            class="lg:col-span-4"
            :financials="data.financials"
          />
          <ContractScheduleWidget
            class="lg:col-span-8"
            :points="data.curve"
            :financials="data.financials"
            :contract-id="contractId"
          />
          <ContractLogbookWidget
            class="lg:col-span-7"
            :notes="data.recentLogNotes"
            :contract-id="contractId"
          />
          <ContractEstimatesWidget
            class="lg:col-span-5"
            :estimates="data.recentEstimates"
            :contract-id="contractId"
          />
        </div>
      </template>
    </template>
  </UDashboardPanel>
</template>