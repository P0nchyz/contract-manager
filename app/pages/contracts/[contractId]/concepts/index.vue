<!-- app/pages/contracts/[contractId]/concepts/index.vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'

definePageMeta({ requiredPermission: 'estimate:view' })

const C = S.conceptCatalog

const route = useRoute()
const repos = useRepositories()
const { can } = usePermissions()

const contractId = computed(() => route.params.contractId as string)

const { data, status, error, refresh } = await useAsyncData(
  () => `concepts-${contractId.value}`,
  async () => {
    const [concepts, estimates] = await Promise.all([
      repos.concepts.listByContract(contractId.value),
      repos.estimates.listByContract(contractId.value),
    ])

    // Roll up executed quantities and amounts from all non-draft estimates.
    // "Executed" = sum of inThisEstimate across paid/approved estimates.
    const executedQty: Record<string, number> = {}
    const executedAmount: Record<string, number> = {}
    for (const est of estimates) {
      if (est.status === 'draft' || est.status === 'rejected') continue
      for (const li of est.lineItems) {
        executedQty[li.conceptId] = (executedQty[li.conceptId] ?? 0) + li.inThisEstimate
        executedAmount[li.conceptId] = (executedAmount[li.conceptId] ?? 0) + li.totalAmount
      }
    }

    return { concepts, executedQty, executedAmount }
  },
)

// --- Search/filter ---
const search = ref('')
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q || !data.value) return data.value?.concepts ?? []
  return data.value.concepts.filter(
    (c) =>
      c.specificationNumber.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.unit.toLowerCase().includes(q),
  )
})

// --- Derived totals ---
const totals = computed(() => {
  if (!data.value) return null
  const concepts = data.value.concepts
  const contractedAmount = concepts.reduce((s, c) => s + c.unitPrice * c.contractedQuantity, 0)
  const executedAmount = concepts.reduce(
    (s, c) => s + (data.value!.executedAmount[c.id] ?? 0),
    0,
  )
  return { contractedAmount, executedAmount }
})

const canCreateAgreement = computed(() => can('agreement:create'))
</script>

<template>
  <UDashboardPanel id="concepts">
    <template #header>
      <UDashboardNavbar :title="C.title">
        <template #right>
          <!-- Modification agreement CTA (only for roles with agreement:create) -->
          <UButton
            v-if="canCreateAgreement"
            color="neutral"
            variant="outline"
            icon="i-lucide-file-plus-2"
            :to="`/contracts/${contractId}/agreements/new`"
            size="sm"
          >
            {{ C.newAgreement }}
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
        <!-- Read-only notice -->
        <UAlert
          color="neutral"
          variant="soft"
          icon="i-lucide-lock"
          :title="C.readonlyNotice"
          :actions="canCreateAgreement
            ? [{ label: C.newAgreement, color: 'neutral', variant: 'subtle',
                 to: `/contracts/${contractId}/agreements/new` }]
            : undefined"
        />

        <!-- Search + count -->
        <div class="flex items-center gap-3">
          <UInput
            v-model="search"
            :placeholder="C.search"
            icon="i-lucide-search"
            class="max-w-xs"
          />
          <span class="text-sm text-muted">
            {{ filtered.length }} / {{ data.concepts.length }}
          </span>
        </div>

        <!-- Empty state -->
        <div
          v-if="!data.concepts.length"
          class="rounded-lg border border-dashed border-default py-16 text-center text-sm text-muted"
        >
          {{ C.empty }}
        </div>

        <!-- Catalog table -->
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

              <tbody class="divide-y divide-default">
                <tr
                  v-for="c in filtered"
                  :key="c.id"
                  class="transition-colors hover:bg-elevated/40"
                >
                  <td class="px-4 py-2.5 font-mono text-xs text-highlighted">
                    {{ c.specificationNumber }}
                  </td>
                  <td class="min-w-[18rem] px-4 py-2.5 text-highlighted">
                    {{ c.description }}
                  </td>
                  <td class="px-4 py-2.5 text-muted">{{ c.unit }}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums text-highlighted">
                    {{ formatMoney(c.unitPrice) }}
                  </td>
                  <td class="px-4 py-2.5 text-right tabular-nums text-highlighted">
                    {{ formatNumber(c.contractedQuantity) }}
                  </td>
                  <td class="px-4 py-2.5 text-right tabular-nums font-medium text-highlighted">
                    {{ formatMoney(c.unitPrice * c.contractedQuantity) }}
                  </td>
                  <!-- Execution progress columns (dimmer; comes from estimates) -->
                  <td class="px-4 py-2.5 text-right tabular-nums text-muted">
                    {{ formatNumber(data.executedQty[c.id] ?? 0) }}
                  </td>
                  <td class="px-4 py-2.5 text-right tabular-nums text-muted">
                    {{ formatMoney(data.executedAmount[c.id] ?? 0) }}
                  </td>
                  <td
                    class="px-4 py-2.5 text-right tabular-nums"
                    :class="
                      (c.contractedQuantity - (data.executedQty[c.id] ?? 0)) < 0
                        ? 'text-error font-medium'
                        : 'text-muted'
                    "
                  >
                    {{ formatNumber(c.contractedQuantity - (data.executedQty[c.id] ?? 0)) }}
                  </td>
                </tr>

                <!-- No-match state (search returned nothing) -->
                <tr v-if="filtered.length === 0 && data.concepts.length > 0">
                  <td colspan="9" class="px-4 py-8 text-center text-sm text-muted">
                    {{ S.common.empty }}
                  </td>
                </tr>
              </tbody>

              <!-- Totals footer -->
              <tfoot v-if="totals" class="border-t-2 border-default bg-elevated/50 text-sm">
                <tr>
                  <td colspan="3" class="px-4 py-2.5" />
                  <td class="px-4 py-2.5 text-right text-xs font-medium text-muted">
                    {{ C.total }}
                  </td>
                  <td class="px-4 py-2.5 text-right tabular-nums font-semibold text-highlighted">
                    {{ formatNumber(data.concepts.reduce((s, c) => s + c.contractedQuantity, 0)) }}
                  </td>
                  <td class="px-4 py-2.5 text-right tabular-nums font-semibold text-highlighted">
                    {{ formatMoney(totals.contractedAmount) }}
                  </td>
                  <td class="px-4 py-2.5 text-right tabular-nums font-medium text-muted">
                    {{ formatNumber(Object.values(data.executedQty).reduce((s, v) => s + v, 0)) }}
                  </td>
                  <td class="px-4 py-2.5 text-right tabular-nums font-medium text-muted">
                    {{ formatMoney(totals.executedAmount) }}
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