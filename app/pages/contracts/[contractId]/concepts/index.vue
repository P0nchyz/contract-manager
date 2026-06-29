<!-- app/pages/contracts/[contractId]/concepts/index.vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'
import { agreementStatusDisplay } from '~/utils/format'

definePageMeta({ requiredPermission: 'estimate:view' })

const C  = S.conceptCatalog
const CS = S.conceptSections

const route = useRoute()
const repos = useRepositories()
const { can } = usePermissions()

const contractId = computed(() => route.params.contractId as string)

const { data, status, error, refresh } = await useAsyncData(
  () => `concepts-full-${contractId.value}`,
  async () => {
    const [sections, concepts, estimates] = await Promise.all([
      repos.concepts.listSectionsByContract(contractId.value),
      repos.concepts.listByContract(contractId.value),
      repos.estimates.listByContract(contractId.value),
    ])

    // Roll up executed quantities/amounts from non-draft, non-rejected estimates
    const executedQty: Record<string, number>    = {}
    const executedAmount: Record<string, number> = {}
    for (const est of estimates) {
      if (est.status === 'draft' || est.status === 'rejected') continue
      for (const li of est.lineItems) {
        executedQty[li.conceptId]    = (executedQty[li.conceptId]    ?? 0) + li.inThisEstimate
        executedAmount[li.conceptId] = (executedAmount[li.conceptId] ?? 0) + li.totalAmount
      }
    }

    const groups = groupConceptsBySections(sections, concepts)
    return { groups, sections, concepts, executedQty, executedAmount }
  },
)

const canCreateAgreement = computed(() => can('agreement:create'))

// Global search filters concepts inside each group
const search = ref('')
const filteredGroups = computed(() => {
  const q = search.value.trim().toLowerCase()
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
const totalExecutedAmount = computed(() =>
  Object.values(data.value?.executedAmount ?? {}).reduce((s, v) => s + v, 0),
)
</script>

<template>
  <UDashboardPanel id="concepts">
    <template #header>
      <UDashboardNavbar :title="C.title">
        <template #right>
          <UButton
            v-if="canCreateAgreement"
            color="neutral"
            variant="outline"
            icon="i-lucide-file-plus-2"
            :to="`/contracts/${contractId}/agreements/new`"
            size="sm"
          >
            {{ S.contractInfo.agreements.new }}
          </UButton>
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

      <div v-else-if="status === 'pending'" class="space-y-3">
        <USkeleton class="h-10 w-full rounded-lg" />
        <USkeleton class="h-64 w-full rounded-lg" />
      </div>

      <template v-else-if="data">
        <UAlert
          color="neutral"
          variant="soft"
          icon="i-lucide-lock"
          :title="C.readonlyNotice"
          :actions="canCreateAgreement ? [{ label: S.contractInfo.agreements.new, color: 'neutral', variant: 'subtle', to: `/contracts/${contractId}/agreements/new` }] : undefined"
        />

        <div class="flex items-center gap-3">
          <UInput v-model="search" :placeholder="C.search" icon="i-lucide-search" class="max-w-xs" />
          <span class="text-sm text-muted">{{ data.concepts.length }} conceptos · {{ data.sections.length }} secciones</span>
        </div>

        <div v-if="!data.concepts.length" class="rounded-lg border border-dashed border-default py-16 text-center text-sm text-muted">
          {{ C.empty }}
        </div>

        <UCard v-else :ui="{ body: 'p-0 sm:p-0' }">
          <div class="overflow-x-auto">
            <table class="w-full min-w-[56rem] text-sm">
              <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                <tr>
                  <th class="px-4 py-2.5 text-left font-medium">{{ C.columns.specification }}</th>
                  <th class="px-4 py-2.5 text-left font-medium">{{ C.columns.description }}</th>
                  <th class="px-4 py-2.5 text-left font-medium">{{ C.columns.unit }}</th>
                  <th class="px-4 py-2.5 text-right font-medium">{{ C.columns.unitPrice }}</th>
                  <th class="px-4 py-2.5 text-right font-medium">{{ C.columns.contractedQty }}</th>
                  <th class="px-4 py-2.5 text-right font-medium">{{ C.columns.contractedAmount }}</th>
                  <th class="px-4 py-2.5 text-right font-medium text-muted/70">{{ C.columns.executed }}</th>
                  <th class="px-4 py-2.5 text-right font-medium text-muted/70">{{ C.columns.executedAmount }}</th>
                  <th class="px-4 py-2.5 text-right font-medium text-muted/70">{{ C.columns.remaining }}</th>
                </tr>
              </thead>

              <tbody>
                <template v-for="group in filteredGroups" :key="group.section?.id ?? 'no-section'">
                  <!-- Section header row -->
                  <tr class="bg-elevated border-t-2 border-default">
                    <td colspan="9" class="px-4 py-2">
                      <div class="flex items-center justify-between gap-4">
                        <div class="flex items-center gap-3">
                          <span class="font-mono text-xs font-semibold text-muted">
                            {{ group.section?.specificationNumber ?? '' }}
                          </span>
                          <span class="font-semibold text-highlighted">
                            {{ group.section?.description ?? CS.noSection }}
                          </span>
                          <span v-if="group.section" class="text-xs text-muted">
                            {{ formatDate(group.section.startDate) }} – {{ formatDate(group.section.endDate) }}
                          </span>
                        </div>
                        <span class="text-xs font-medium text-muted">
                          {{ CS.subtotal }}: {{ formatMoney(group.contractedAmount) }}
                        </span>
                      </div>
                    </td>
                  </tr>

                  <!-- Concept rows within this section -->
                  <tr
                    v-for="c in group.concepts"
                    :key="c.id"
                    class="divide-x-0 border-t border-default/50 hover:bg-elevated/40 transition-colors"
                  >
                    <td class="px-4 py-2.5 pl-8 font-mono text-xs text-highlighted">{{ c.specificationNumber }}</td>
                    <td class="min-w-[18rem] px-4 py-2.5 text-highlighted">{{ c.description }}</td>
                    <td class="px-4 py-2.5 text-muted">{{ c.unit }}</td>
                    <td class="px-4 py-2.5 text-right tabular-nums text-highlighted">{{ formatMoney(c.unitPrice) }}</td>
                    <td class="px-4 py-2.5 text-right tabular-nums text-highlighted">{{ formatNumber(c.contractedQuantity) }}</td>
                    <td class="px-4 py-2.5 text-right tabular-nums font-medium text-highlighted">{{ formatMoney(c.unitPrice * c.contractedQuantity) }}</td>
                    <td class="px-4 py-2.5 text-right tabular-nums text-muted">{{ formatNumber(data.executedQty[c.id] ?? 0) }}</td>
                    <td class="px-4 py-2.5 text-right tabular-nums text-muted">{{ formatMoney(data.executedAmount[c.id] ?? 0) }}</td>
                    <td
                      class="px-4 py-2.5 text-right tabular-nums"
                      :class="(c.contractedQuantity - (data.executedQty[c.id] ?? 0)) < 0 ? 'text-error font-medium' : 'text-muted'"
                    >
                      {{ formatNumber(c.contractedQuantity - (data.executedQty[c.id] ?? 0)) }}
                    </td>
                  </tr>

                  <!-- Section subtotal row -->
                  <tr class="border-t border-default bg-elevated/30">
                    <td colspan="5" class="px-4 py-1.5 pl-8 text-right text-xs text-muted">
                      {{ CS.subtotal }}
                    </td>
                    <td class="px-4 py-1.5 text-right tabular-nums text-xs font-semibold text-highlighted">
                      {{ formatMoney(group.contractedAmount) }}
                    </td>
                    <td colspan="3" />
                  </tr>
                </template>
              </tbody>

              <!-- Grand total -->
              <tfoot class="border-t-2 border-default bg-elevated/50 text-sm">
                <tr>
                  <td colspan="3" class="px-4 py-2.5" />
                  <td class="px-4 py-2.5 text-right text-xs font-medium text-muted">{{ C.total }}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums font-semibold text-highlighted">
                    {{ formatNumber(data.concepts.reduce((s, c) => s + c.contractedQuantity, 0)) }}
                  </td>
                  <td class="px-4 py-2.5 text-right tabular-nums font-semibold text-highlighted">
                    {{ formatMoney(totalContracted) }}
                  </td>
                  <td class="px-4 py-2.5 text-right tabular-nums font-medium text-muted">
                    {{ formatNumber(Object.values(data.executedQty).reduce((s, v) => s + v, 0)) }}
                  </td>
                  <td class="px-4 py-2.5 text-right tabular-nums font-medium text-muted">
                    {{ formatMoney(totalExecutedAmount) }}
                  </td>
                  <td class="px-4 py-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>
        </UCard>
      </template>
    </template>
  </UDashboardPanel>
</template>