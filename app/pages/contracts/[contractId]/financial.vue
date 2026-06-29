<!-- app/pages/contracts/[contractId]/financial.vue -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import type { BreakdownSlice } from '~/components/FinancialBreakdownChart.client.vue'

definePageMeta({ requiredPermission: 'financial:view' })

const FIN = S.financial

const route = useRoute()
const repos = useRepositories()
const { can } = usePermissions()

const contractId = computed(() => route.params.contractId as string)
const canPay = computed(() => can('estimate:pay'))

// ─── Data load ────────────────────────────────────────────────────────────────
const { data, status, error, refresh } = await useAsyncData(
  () => `financial-${contractId.value}`,
  async () => {
    const [contract, financials, estimates, sections, concepts] = await Promise.all([
      repos.contracts.getById(contractId.value),
      repos.contracts.getFinancials(contractId.value),
      repos.estimates.listByContract(contractId.value),
      repos.concepts.listSectionsByContract(contractId.value),
      repos.concepts.listByContract(contractId.value),
    ])

    // Unpaid = approved but not yet paid
    const unpaidEstimates = estimates
      .filter((e) => e.status === 'approved')
      .sort((a, b) => a.number - b.number)

    // Total amortized anticipo across all executed estimates
    const amortized = estimates
      .filter((e) => e.status === 'approved' || e.status === 'paid')
      .reduce((s, e) => s + (e.summary?.calculations?.anticipoAmortization ?? 0), 0)

    // Pie chart: contracted amount per section; unsectioned concepts get individual slices
    const sectionMap: Record<string, number> = {}      // sectionId → contracted amount
    const unsectionedConcepts: { label: string; amount: number }[] = []

    for (const c of concepts) {
      const amount = c.unitPrice * c.contractedQuantity
      if (c.sectionId) {
        sectionMap[c.sectionId] = (sectionMap[c.sectionId] ?? 0) + amount
      } else {
        unsectionedConcepts.push({
          label: `${c.specificationNumber} ${c.description}`,
          amount,
        })
      }
    }

    // Build ordered slices: sections first (by order), then individual unsectioned concepts
    const PALETTE = [
      '#3b82f6', '#22c55e', '#f59e0b', '#ef4444',
      '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16',
      '#f97316', '#14b8a6', '#a855f7', '#6366f1',
    ]
    let colorIdx = 0
    const nextColor = () => PALETTE[colorIdx++ % PALETTE.length]

    const slices: BreakdownSlice[] = [
      ...sections
        .slice()
        .sort((a, b) => a.order - b.order)
        .filter((s) => sectionMap[s.id] != null)
        .map((s) => ({
          label: `${s.specificationNumber} ${s.description}`,
          amount: sectionMap[s.id],
          color: nextColor(),
        })),
      ...unsectionedConcepts.map((c) => ({
        label: c.label,
        amount: c.amount,
        color: nextColor(),
      })),
    ]

    return {
      contract,
      financials,
      unpaidEstimates,
      amortized,
      slices,
    }
  },
)

// ─── Derived values ───────────────────────────────────────────────────────────
const fin = computed(() => data.value?.financials)

const anticipoGranted   = computed(() => fin.value?.anticipoAmount ?? 0)
const anticipoRemaining = computed(() => Math.max(0, anticipoGranted.value - (data.value?.amortized ?? 0)))
const anticipoAmortizedPct = computed(() =>
  anticipoGranted.value > 0
    ? Math.min(((data.value?.amortized ?? 0) / anticipoGranted.value) * 100, 100)
    : 0,
)

const balanceToPay = computed(() =>
  Math.max(0, (fin.value?.executedAmount ?? 0) - (fin.value?.paidAmount ?? 0)),
)

// ─── Mark paid ────────────────────────────────────────────────────────────────
const payingId = ref<string | null>(null)
const payError = ref<string | null>(null)

async function markPaid(estimateId: string) {
  payingId.value = estimateId
  payError.value = null
  try {
    await repos.estimates.markPaid(estimateId)
    await refresh()
  } catch (e) {
    payError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    payingId.value = null
  }
}
</script>

<template>
  <UDashboardPanel id="financial">
    <template #header>
      <UDashboardNavbar :title="FIN.title">
        <template #leading>
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            :to="`/contracts/${contractId}`"
            :aria-label="S.common.back"
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
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <USkeleton v-for="i in 4" :key="i" class="h-24 rounded-lg" />
        </div>
        <USkeleton class="h-48 w-full rounded-lg" />
        <USkeleton class="h-64 w-full rounded-lg" />
      </div>

      <div v-else-if="data" class="flex flex-col gap-6">

        <!-- ① Monto contratado vs ejecutado vs pagado -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-bar-chart-3" class="size-4 text-muted" />
              {{ FIN.sections.amounts }}
            </div>
          </template>

          <div class="grid gap-6 sm:grid-cols-3">
            <!-- Contracted -->
            <div>
              <div class="mb-1 text-xs text-muted">{{ FIN.amounts.contracted }}</div>
              <div class="text-2xl font-bold tabular-nums text-highlighted">
                {{ formatMoney(fin?.contractedAmount ?? 0) }}
              </div>
              <div class="mt-2 h-2.5 w-full rounded-full bg-elevated">
                <div class="h-full w-full rounded-full bg-default/30" />
              </div>
              <div class="mt-1 text-xs text-muted">100%</div>
            </div>

            <!-- Executed (approved + paid) -->
            <div>
              <div class="mb-1 text-xs text-muted">{{ FIN.amounts.executed }}</div>
              <div class="text-2xl font-bold tabular-nums text-primary">
                {{ formatMoney(fin?.executedAmount ?? 0) }}
              </div>
              <div class="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-elevated">
                <div
                  class="h-full rounded-full bg-primary transition-all"
                  :style="`width:${fin?.balancePercentage ?? 0}%`"
                />
              </div>
              <div class="mt-1 text-xs text-muted">{{ formatPercent(fin?.balancePercentage ?? 0) }}</div>
            </div>

            <!-- Paid -->
            <div>
              <div class="mb-1 text-xs text-muted">{{ FIN.amounts.paid }}</div>
              <div class="text-2xl font-bold tabular-nums text-success">
                {{ formatMoney(fin?.paidAmount ?? 0) }}
              </div>
              <div class="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-elevated">
                <div
                  class="h-full rounded-full bg-success transition-all"
                  :style="`width:${fin?.financialProgress ?? 0}%`"
                />
              </div>
              <div class="mt-1 text-xs text-muted">{{ formatPercent(fin?.financialProgress ?? 0) }}</div>
            </div>
          </div>

          <!-- Balance to pay callout -->
          <div
            v-if="balanceToPay > 0"
            class="mt-5 flex items-center justify-between rounded-lg border border-warning/40 bg-warning/5 px-4 py-3"
          >
            <div class="flex items-center gap-2 text-sm text-warning">
              <UIcon name="i-lucide-clock" class="size-4" />
              {{ FIN.amounts.balance }}
            </div>
            <span class="font-semibold tabular-nums text-warning">
              {{ formatMoney(balanceToPay) }}
            </span>
          </div>
        </UCard>

        <!-- ② Anticipo -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-wallet" class="size-4 text-muted" />
              {{ FIN.sections.anticipo }}
            </div>
          </template>

          <div class="grid gap-4 sm:grid-cols-3">
            <div>
              <div class="text-xs text-muted">{{ FIN.anticipo.granted }}</div>
              <div class="mt-0.5 text-lg font-semibold tabular-nums text-highlighted">
                {{ formatMoney(anticipoGranted) }}
              </div>
              <div class="mt-0.5 text-xs text-muted">
                {{ formatPercent(data.contract.anticipoPercentage, 0) }} del contrato
              </div>
            </div>
            <div>
              <div class="text-xs text-muted">{{ FIN.anticipo.amortized }}</div>
              <div class="mt-0.5 text-lg font-semibold tabular-nums text-primary">
                {{ formatMoney(data.amortized) }}
              </div>
              <div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-elevated">
                <div
                  class="h-full rounded-full bg-primary transition-all"
                  :style="`width:${anticipoAmortizedPct}%`"
                />
              </div>
              <div class="mt-0.5 text-xs text-muted">{{ formatPercent(anticipoAmortizedPct) }}</div>
            </div>
            <div>
              <div class="text-xs text-muted">{{ FIN.anticipo.remaining }}</div>
              <div
                class="mt-0.5 text-lg font-semibold tabular-nums"
                :class="anticipoRemaining > 0 ? 'text-warning' : 'text-success'"
              >
                {{ formatMoney(anticipoRemaining) }}
              </div>
              <UBadge
                v-if="anticipoRemaining === 0"
                label="Amortizado completamente"
                color="success"
                variant="soft"
                size="sm"
                class="mt-1"
              />
            </div>
          </div>
        </UCard>

        <!-- ③ Estimaciones por pagar -->
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-receipt" class="size-4 text-muted" />
              {{ FIN.sections.unpaid }}
              <UBadge
                v-if="data.unpaidEstimates.length"
                :label="String(data.unpaidEstimates.length)"
                color="warning"
                variant="soft"
                size="sm"
              />
            </div>
          </template>

          <div v-if="!data.unpaidEstimates.length" class="px-4 py-6 text-sm text-muted">
            {{ FIN.unpaid.empty }}
          </div>
          <div v-else>
            <table class="w-full text-sm">
              <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                <tr>
                  <th class="px-4 py-2.5 text-left font-medium">{{ FIN.unpaid.number }}</th>
                  <th class="px-4 py-2.5 text-left font-medium">{{ FIN.unpaid.period }}</th>
                  <th class="px-4 py-2.5 text-right font-medium">{{ FIN.unpaid.amount }}</th>
                  <th v-if="canPay" class="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr
                  v-for="est in data.unpaidEstimates"
                  :key="est.id"
                  class="hover:bg-elevated/40 transition-colors"
                >
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-2">
                      <span class="font-medium text-highlighted">{{ est.number }}</span>
                      <UButton
                        icon="i-lucide-arrow-up-right"
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        :to="`/contracts/${contractId}/estimates/${est.id}`"
                      />
                    </div>
                  </td>
                  <td class="px-4 py-3 text-muted">
                    {{ formatDate(est.periodStart) }} – {{ formatDate(est.periodEnd) }}
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums font-semibold text-highlighted">
                    {{ formatMoney(est.summary?.calculations?.total ?? 0) }}
                  </td>
                  <td v-if="canPay" class="px-4 py-3 text-right">
                    <UButton
                      icon="i-lucide-banknote"
                      size="xs"
                      color="success"
                      variant="soft"
                      :loading="payingId === est.id"
                      @click="markPaid(est.id)"
                    >
                      {{ FIN.unpaid.markPaid }}
                    </UButton>
                  </td>
                </tr>
              </tbody>
              <tfoot class="border-t-2 border-default bg-elevated/50">
                <tr>
                  <td colspan="2" class="px-4 py-2.5 text-right text-xs font-medium text-muted">
                    Total
                  </td>
                  <td class="px-4 py-2.5 text-right tabular-nums font-bold text-highlighted">
                    {{ formatMoney(data.unpaidEstimates.reduce((s, e) => s + (e.summary?.calculations?.total ?? 0), 0)) }}
                  </td>
                  <td v-if="canPay" />
                </tr>
              </tfoot>
            </table>

            <UAlert
              v-if="payError"
              :title="payError"
              color="error"
              variant="soft"
              icon="i-lucide-alert-triangle"
              class="m-4"
            />
          </div>
        </UCard>

        <!-- ④ Distribución por sección / concepto -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-pie-chart" class="size-4 text-muted" />
              {{ FIN.sections.breakdown }}
            </div>
          </template>

          <div v-if="!data.slices.length" class="text-sm text-muted">
            {{ S.common.empty }}
          </div>
          <div v-else class="grid gap-8 lg:grid-cols-2 items-start">
            <FinancialBreakdownChart :slices="data.slices" :height="280" />

            <!-- Breakdown table alongside -->
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="border-b border-default text-xs text-muted">
                  <tr>
                    <th class="py-2 pr-3 text-left font-medium">{{ FIN.sections.breakdown }}</th>
                    <th class="py-2 text-right font-medium">Importe</th>
                    <th class="py-2 pl-3 text-right font-medium">%</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-default">
                  <tr v-for="slice in data.slices" :key="slice.label">
                    <td class="py-2 pr-3">
                      <div class="flex items-center gap-2">
                        <span class="size-2.5 shrink-0 rounded-sm" :style="`background:${slice.color}`" />
                        <span class="truncate text-highlighted">{{ slice.label }}</span>
                      </div>
                    </td>
                    <td class="py-2 text-right tabular-nums text-highlighted">
                      {{ formatMoney(slice.amount) }}
                    </td>
                    <td class="py-2 pl-3 text-right tabular-nums text-muted">
                      {{
                        fin?.contractedAmount
                          ? ((slice.amount / fin.contractedAmount) * 100).toFixed(1) + '%'
                          : '—'
                      }}
                    </td>
                  </tr>
                </tbody>
                <tfoot class="border-t-2 border-default">
                  <tr>
                    <td class="py-2 pr-3 text-xs font-medium text-muted">{{ FIN.breakdown.total }}</td>
                    <td class="py-2 text-right tabular-nums font-bold text-highlighted">
                      {{ formatMoney(fin?.contractedAmount ?? 0) }}
                    </td>
                    <td class="py-2 pl-3 text-right text-muted">100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </UCard>

      </div>
    </template>
  </UDashboardPanel>
</template>