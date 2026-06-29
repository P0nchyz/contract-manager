<!-- app/pages/contracts/new.vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import type { CreateConceptInput } from '~/data/repositories/types'

definePageMeta({ requiredPermission: 'contract:create' })

const F = S.newContract

const repos = useRepositories()

// ─── Reference data ──────────────────────────────────────────────────────────
const { data: refs, status: refsStatus } = await useAsyncData('contract-new-refs', async () => {
  const [users, corporations] = await Promise.all([
    repos.users.list(),
    repos.corporations.list(),
  ])
  const superintendents = users.filter((u) => u.role === 'superintendent' && u.active)
  const supervisors     = users.filter((u) => u.role === 'supervisor'     && u.active)
  const financials      = users.filter((u) => u.role === 'financial'      && u.active)
  return { superintendents, supervisors, financials, corporations }
})

// ─── Form sections ────────────────────────────────────────────────────────────

// 1 · General
const code      = ref('')
const title     = ref('')
const startDate = ref('')
const endDate   = ref('')

// 2 · Rates
const anticipoPct   = ref<number | ''>('')
const ivaRate       = ref<number | ''>(16)
const retentionPct  = ref<number | ''>(5)

// 3 · Parties
const superintendentId = ref<string | null>(null)
const supervisorId     = ref<string | null>(null)
const financialId      = ref<string | null>(null)

// Auto-fill corporation from selected superintendent
const corpName = computed(() => {
  if (!superintendentId.value || !refs.value) return null
  const sup = refs.value.superintendents.find((u) => u.id === superintendentId.value)
  if (!sup?.corporationId) return null
  return refs.value.corporations.find((c) => c.id === sup.corporationId)?.name ?? null
})
const contractorCorporationId = computed(() => {
  if (!superintendentId.value || !refs.value) return null
  const sup = refs.value.superintendents.find((u) => u.id === superintendentId.value)
  return sup?.corporationId ?? null
})

// 4 · Concepts
type ConceptDraft = CreateConceptInput & { _qtyRaw: string; _priceRaw: string }

const concepts = ref<ConceptDraft[]>([])

function addConcept() {
  concepts.value.push({
    specificationNumber: '',
    description: '',
    unit: '',
    contractedQuantity: 0,
    unitPrice: 0,
    _qtyRaw: '',
    _priceRaw: '',
  })
}
function removeConcept(idx: number) {
  concepts.value.splice(idx, 1)
  // Remove any schedule entries that referenced this index; reindex rest.
  scheduleItems.value = scheduleItems.value
    .filter((s) => s.conceptIndex !== idx)
    .map((s) => ({
      ...s,
      conceptIndex: s.conceptIndex > idx ? s.conceptIndex - 1 : s.conceptIndex,
    }))
}

const resolvedConcepts = computed<CreateConceptInput[]>(() =>
  concepts.value.map((c) => ({
    specificationNumber: c.specificationNumber.trim(),
    description: c.description.trim(),
    unit: c.unit.trim(),
    contractedQuantity: parseFloat(c._qtyRaw) || 0,
    unitPrice: Math.round((parseFloat(c._priceRaw) || 0) * 100),
  })),
)

const totalAmount = computed(() =>
  resolvedConcepts.value.reduce((s, c) => s + c.unitPrice * c.contractedQuantity, 0),
)

// 5 · Schedule
type ScheduleDraft = { conceptIndex: number; startRaw: string; endRaw: string }
const scheduleItems = ref<ScheduleDraft[]>([])

// When concepts change, sync schedule rows
watch(
  () => concepts.value.length,
  (newLen, oldLen) => {
    // Add new row for newly added concept
    if (newLen > oldLen) {
      scheduleItems.value.push({ conceptIndex: newLen - 1, startRaw: '', endRaw: '' })
    }
  },
)

const contractStartDate = computed(() =>
  startDate.value ? new Date(`${startDate.value}T12:00:00`) : null,
)
const contractEndDate = computed(() =>
  endDate.value ? new Date(`${endDate.value}T12:00:00`) : null,
)

// Per-row schedule validation
const scheduleErrors = computed(() =>
  scheduleItems.value.map((s) => {
    const start = s.startRaw ? new Date(`${s.startRaw}T12:00:00`) : null
    const end   = s.endRaw   ? new Date(`${s.endRaw}T12:00:00`)   : null
    if (!start) return F.schedule.validation.startRequired
    if (!end)   return F.schedule.validation.endRequired
    if (start > end) return F.schedule.validation.startAfterEnd
    if (contractStartDate.value && start < contractStartDate.value)
      return F.schedule.validation.startAfterContract
    if (contractEndDate.value && end > contractEndDate.value)
      return F.schedule.validation.endBeforeContract
    return null
  }),
)

const ganttRows = computed(() =>
  scheduleItems.value.map((s) => {
    const c = concepts.value[s.conceptIndex]
    const rc = resolvedConcepts.value[s.conceptIndex]
    return {
      label: c?.description || `Concepto ${s.conceptIndex + 1}`,
      startDate: s.startRaw ? new Date(`${s.startRaw}T12:00:00`) : null,
      endDate:   s.endRaw   ? new Date(`${s.endRaw}T12:00:00`)   : null,
      amount: rc ? rc.unitPrice * rc.contractedQuantity : 0,
    }
  }),
)

// ─── Concept validation ───────────────────────────────────────────────────────
const conceptErrors = computed(() =>
  concepts.value.map((c) => ({
    spec:  c.specificationNumber.trim() ? '' : F.concepts.validation.specRequired,
    desc:  c.description.trim()         ? '' : F.concepts.validation.descRequired,
    unit:  c.unit.trim()                ? '' : F.concepts.validation.unitRequired,
    qty:   parseFloat(c._qtyRaw)  > 0  ? '' : F.concepts.validation.qtyPositive,
    price: parseFloat(c._priceRaw) > 0 ? '' : F.concepts.validation.pricePositive,
  })),
)
const conceptsValid = computed(() =>
  concepts.value.length > 0 &&
  conceptErrors.value.every((e) => !e.spec && !e.desc && !e.unit && !e.qty && !e.price),
)

// ─── Global validation ────────────────────────────────────────────────────────
const errors = computed(() => ({
  code:          code.value.trim()  ? null : F.validation.codeRequired,
  title:         title.value.trim() ? null : F.validation.titleRequired,
  dates:         (!startDate.value || !endDate.value) ? F.validation.datesRequired
                 : startDate.value >= endDate.value ? F.validation.endBeforeStart : null,
  anticipo:      (anticipoPct.value === '' || Number(anticipoPct.value) < 0 || Number(anticipoPct.value) > 100)
                 ? F.validation.anticipoRange : null,
  iva:           (ivaRate.value === '' || Number(ivaRate.value) < 0 || Number(ivaRate.value) > 100)
                 ? F.validation.ivaRange : null,
  retention:     (retentionPct.value === '' || Number(retentionPct.value) < 0 || Number(retentionPct.value) > 100)
                 ? F.validation.retentionRange : null,
  superintendent: superintendentId.value ? null : F.validation.superintendentRequired,
  supervisor:     supervisorId.value     ? null : F.validation.supervisorRequired,
  concepts:       conceptsValid.value    ? null : F.validation.conceptsRequired,
  schedule:       scheduleErrors.value.every((e) => e === null) ? null
                  : scheduleErrors.value.some((e) => e?.includes('fuera') || e?.includes('≥') || e?.includes('≤'))
                    ? F.validation.scheduleOutOfRange
                    : F.validation.scheduleRequired,
}))

const canSubmit = computed(() => Object.values(errors.value).every((e) => e === null))

// ─── Submit ───────────────────────────────────────────────────────────────────
const loading = ref(false)
const submitError = ref<string | null>(null)

async function onSubmit() {
  if (!canSubmit.value) return
  loading.value = true
  submitError.value = null
  try {
    const contract = await repos.contracts.create({
      code:  code.value.trim(),
      title: title.value.trim(),
      anticipoPercentage:  Number(anticipoPct.value),
      ivaRate:             Number(ivaRate.value),
      retentionPercentage: Number(retentionPct.value),
      startDate: new Date(`${startDate.value}T12:00:00`),
      endDate:   new Date(`${endDate.value}T12:00:00`),
      superintendentId: superintendentId.value as string,
      supervisorId:     supervisorId.value as string,
      financialId:      financialId.value,
      contractorCorporationId: contractorCorporationId.value,
      initialConcepts: resolvedConcepts.value,
      scheduleItems: scheduleItems.value.map((s) => ({
        conceptIndex: s.conceptIndex,
        startDate: new Date(`${s.startRaw}T12:00:00`),
        endDate:   new Date(`${s.endRaw}T12:00:00`),
      })),
    })
    await navigateTo(`/contracts/${contract.id}`)
  } catch (e) {
    submitError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    loading.value = false
  }
}

// Section nav
const sections = [
  { id: 'sec-general',  label: F.sections.general },
  { id: 'sec-rates',    label: F.sections.rates },
  { id: 'sec-parties',  label: F.sections.parties },
  { id: 'sec-concepts', label: F.sections.concepts },
  { id: 'sec-schedule', label: F.sections.schedule },
]
</script>

<template>
  <UDashboardPanel id="contract-new">
    <template #header>
      <UDashboardNavbar :title="F.title">
        <template #leading>
          <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" to="/" :aria-label="S.common.back" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="refsStatus === 'pending'" class="space-y-4">
        <USkeleton class="h-32 w-full rounded-lg" />
        <USkeleton class="h-32 w-full rounded-lg" />
      </div>

      <div v-else class="flex flex-col gap-6">
        <!-- Section nav -->
        <nav class="sticky top-0 z-10 -mx-4 mb-2 flex gap-1 overflow-x-auto border-b border-default bg-default/75 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
          <a
            v-for="s in sections"
            :key="s.id"
            :href="`#${s.id}`"
            class="shrink-0 rounded-md px-2.5 py-1 text-sm text-muted transition-colors hover:bg-elevated hover:text-default"
          >
            {{ s.label }}
          </a>
        </nav>

        <!-- ① General -->
        <UCard id="sec-general" class="scroll-mt-16">
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-file-text" class="size-4 text-muted" />
              {{ F.sections.general }}
            </div>
          </template>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="F.fields.code" :error="errors.code || undefined">
              <UInput v-model="code" class="w-full" :placeholder="F.fields.codePlaceholder" />
            </UFormField>
            <div class="sm:col-span-2">
              <UFormField :label="F.fields.title" :error="errors.title || undefined">
                <UTextarea v-model="title" :rows="2" class="w-full" :placeholder="F.fields.titlePlaceholder" />
              </UFormField>
            </div>
            <UFormField :label="F.fields.startDate" :error="errors.dates || undefined">
              <UInput v-model="startDate" type="date" class="w-full" />
            </UFormField>
            <UFormField :label="F.fields.endDate">
              <UInput v-model="endDate" type="date" class="w-full" />
            </UFormField>
          </div>
        </UCard>

        <!-- ② Rates -->
        <UCard id="sec-rates" class="scroll-mt-16">
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-percent" class="size-4 text-muted" />
              {{ F.sections.rates }}
            </div>
          </template>
          <div class="grid gap-4 sm:grid-cols-3">
            <UFormField :label="F.fields.anticipoPercentage" :error="errors.anticipo || undefined">
              <UInput v-model.number="anticipoPct" type="number" min="0" max="100" step="1" class="w-full">
                <template #trailing><span class="pr-2 text-sm text-muted">%</span></template>
              </UInput>
            </UFormField>
            <UFormField :label="F.fields.ivaRate" :error="errors.iva || undefined">
              <UInput v-model.number="ivaRate" type="number" min="0" max="100" step="1" class="w-full">
                <template #trailing><span class="pr-2 text-sm text-muted">%</span></template>
              </UInput>
            </UFormField>
            <UFormField :label="F.fields.retentionPercentage" :error="errors.retention || undefined">
              <UInput v-model.number="retentionPct" type="number" min="0" max="100" step="0.1" class="w-full">
                <template #trailing><span class="pr-2 text-sm text-muted">%</span></template>
              </UInput>
            </UFormField>
            <div class="sm:col-span-3">
              <p class="text-xs text-muted">
                <span class="font-medium">{{ F.fields.cincoAlMillar }}:</span>
                {{ F.fields.cincoAlMillarFixed }}
              </p>
            </div>
          </div>
        </UCard>

        <!-- ③ Parties -->
        <UCard id="sec-parties" class="scroll-mt-16">
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-users" class="size-4 text-muted" />
              {{ F.sections.parties }}
            </div>
          </template>
          <div class="grid gap-4 sm:grid-cols-2">
            <!-- Superintendent -->
            <UFormField :label="F.fields.superintendent" :error="errors.superintendent || undefined">
              <USelect
                v-model="superintendentId"
                :items="(refs?.superintendents ?? []).map((u) => ({ label: u.fullName, value: u.id }))"
                :placeholder="`— ${F.fields.superintendent} —`"
                class="w-full"
              />
            </UFormField>
            <!-- Contractor (auto-filled) -->
            <UFormField :label="F.fields.contractor" :hint="F.fields.contractorDerived">
              <UInput
                :model-value="corpName ?? ''"
                disabled
                class="w-full"
                :placeholder="F.fields.contractorDerived"
              />
            </UFormField>
            <!-- Supervisor -->
            <UFormField :label="F.fields.supervisor" :error="errors.supervisor || undefined">
              <USelect
                v-model="supervisorId"
                :items="(refs?.supervisors ?? []).map((u) => ({ label: u.fullName, value: u.id }))"
                :placeholder="`— ${F.fields.supervisor} —`"
                class="w-full"
              />
            </UFormField>
            <!-- Financial (optional) -->
            <UFormField :label="F.fields.financial">
              <USelect
                v-model="financialId"
                :items="(refs?.financials ?? []).map((u) => ({ label: u.fullName, value: u.id }))"
                :placeholder="`— ${F.fields.financial} —`"
                class="w-full"
              />
            </UFormField>
          </div>
        </UCard>

        <!-- ④ Concepts -->
        <UCard id="sec-concepts" class="scroll-mt-16" :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-list" class="size-4 text-muted" />
                {{ F.sections.concepts }}
              </div>
              <UButton size="sm" icon="i-lucide-plus" color="neutral" variant="outline" @click="addConcept">
                {{ F.concepts.add }}
              </UButton>
            </div>
          </template>

          <p class="border-b border-default px-4 py-2 text-xs text-muted">{{ F.concepts.hint }}</p>

          <div v-if="!concepts.length" class="px-4 py-8 text-center text-sm text-muted">
            {{ F.concepts.empty }}
          </div>
          <div v-else class="overflow-x-auto">
            <table class="w-full min-w-[52rem] text-sm">
              <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                <tr>
                  <th class="px-3 py-2 text-left font-medium">{{ F.concepts.columns.specification }}</th>
                  <th class="px-3 py-2 text-left font-medium">{{ F.concepts.columns.description }}</th>
                  <th class="px-3 py-2 text-left font-medium">{{ F.concepts.columns.unit }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ F.concepts.columns.qty }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ F.concepts.columns.unitPrice }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ F.concepts.columns.amount }}</th>
                  <th class="px-2 py-2" />
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-for="(c, idx) in concepts" :key="idx" class="align-top">
                  <td class="px-3 py-2">
                    <div>
                      <UInput
                        v-model="c.specificationNumber"
                        class="w-28"
                        placeholder="E-101"
                        :color="conceptErrors[idx]?.spec ? 'error' : undefined"
                      />
                      <p v-if="conceptErrors[idx]?.spec" class="mt-0.5 text-xs text-error">
                        {{ conceptErrors[idx].spec }}
                      </p>
                    </div>
                  </td>
                  <td class="min-w-[14rem] px-3 py-2">
                    <div>
                      <UInput
                        v-model="c.description"
                        class="w-full"
                        :color="conceptErrors[idx]?.desc ? 'error' : undefined"
                      />
                      <p v-if="conceptErrors[idx]?.desc" class="mt-0.5 text-xs text-error">
                        {{ conceptErrors[idx].desc }}
                      </p>
                    </div>
                  </td>
                  <td class="px-3 py-2">
                    <div>
                      <UInput
                        v-model="c.unit"
                        class="w-20"
                        placeholder="m2"
                        :color="conceptErrors[idx]?.unit ? 'error' : undefined"
                      />
                      <p v-if="conceptErrors[idx]?.unit" class="mt-0.5 text-xs text-error">
                        {{ conceptErrors[idx].unit }}
                      </p>
                    </div>
                  </td>
                  <td class="px-3 py-2">
                    <div>
                      <UInput
                        v-model="c._qtyRaw"
                        type="number"
                        min="0"
                        step="any"
                        class="w-24 [&_input]:text-right"
                        :color="conceptErrors[idx]?.qty ? 'error' : undefined"
                      />
                      <p v-if="conceptErrors[idx]?.qty" class="mt-0.5 text-xs text-error">
                        {{ conceptErrors[idx].qty }}
                      </p>
                    </div>
                  </td>
                  <td class="px-3 py-2">
                    <div>
                      <UInput
                        v-model="c._priceRaw"
                        type="number"
                        min="0"
                        step="0.01"
                        class="w-32 [&_input]:text-right"
                        :color="conceptErrors[idx]?.price ? 'error' : undefined"
                      >
                        <template #leading>
                          <span class="pl-1 text-xs text-muted">$</span>
                        </template>
                      </UInput>
                      <p v-if="conceptErrors[idx]?.price" class="mt-0.5 text-xs text-error">
                        {{ conceptErrors[idx].price }}
                      </p>
                    </div>
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums text-muted">
                    {{
                      formatMoney(
                        Math.round((parseFloat(c._priceRaw) || 0) * 100) *
                        (parseFloat(c._qtyRaw) || 0),
                      )
                    }}
                  </td>
                  <td class="px-2 py-2">
                    <UButton
                      icon="i-lucide-x"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      @click="removeConcept(idx)"
                    />
                  </td>
                </tr>
              </tbody>
              <tfoot class="border-t-2 border-default bg-elevated/50">
                <tr>
                  <td colspan="5" class="px-3 py-2 text-right text-xs font-medium text-muted">
                    {{ F.concepts.total }}
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums font-semibold text-highlighted">
                    {{ formatMoney(totalAmount) }}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </UCard>

        <!-- ⑤ Schedule -->
        <UCard
          v-if="concepts.length > 0"
          id="sec-schedule"
          class="scroll-mt-16"
          :ui="{ body: 'p-0 sm:p-0' }"
        >
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-chart-gantt" class="size-4 text-muted" />
              {{ F.sections.schedule }}
            </div>
          </template>

          <p class="border-b border-default px-4 py-2 text-xs text-muted">{{ F.schedule.hint }}</p>

          <!-- Schedule input table -->
          <div class="overflow-x-auto">
            <table class="w-full min-w-[42rem] text-sm">
              <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                <tr>
                  <th class="px-3 py-2 text-left font-medium">{{ F.schedule.columns.concept }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ F.schedule.columns.amount }}</th>
                  <th class="px-3 py-2 text-center font-medium text-success">{{ F.schedule.columns.start }}</th>
                  <th class="px-3 py-2 text-center font-medium text-success">{{ F.schedule.columns.end }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ F.schedule.columns.duration }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr
                  v-for="(s, idx) in scheduleItems"
                  :key="s.conceptIndex"
                  class="align-top"
                  :class="scheduleErrors[idx] ? 'bg-error/5' : ''"
                >
                  <td class="min-w-[12rem] px-3 py-2.5 font-medium text-highlighted">
                    {{ concepts[s.conceptIndex]?.description || `Concepto ${s.conceptIndex + 1}` }}
                    <div class="text-xs font-mono text-muted">
                      {{ concepts[s.conceptIndex]?.specificationNumber }}
                    </div>
                  </td>
                  <td class="px-3 py-2.5 text-right tabular-nums text-muted">
                    {{ formatMoney(resolvedConcepts[s.conceptIndex]?.unitPrice * resolvedConcepts[s.conceptIndex]?.contractedQuantity || 0) }}
                  </td>
                  <td class="px-3 py-2.5">
                    <UInput
                      v-model="s.startRaw"
                      type="date"
                      :min="startDate"
                      :max="endDate"
                      class="w-36 [&_input]:text-success"
                    />
                  </td>
                  <td class="px-3 py-2.5">
                    <UInput
                      v-model="s.endRaw"
                      type="date"
                      :min="s.startRaw || startDate"
                      :max="endDate"
                      class="w-36 [&_input]:text-success"
                    />
                  </td>
                  <td class="px-3 py-2.5 text-right tabular-nums text-muted">
                    <template v-if="s.startRaw && s.endRaw">
                      {{
                        Math.round(
                          (new Date(`${s.endRaw}T12:00:00`).getTime() -
                            new Date(`${s.startRaw}T12:00:00`).getTime()) /
                            86_400_000,
                        )
                      }}
                    </template>
                    <span v-else class="text-muted">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Per-row errors -->
          <div
            v-if="scheduleErrors.some(Boolean)"
            class="border-t border-default px-4 py-2 space-y-1"
          >
            <p
              v-for="(err, idx) in scheduleErrors"
              :key="idx"
              class="text-xs text-error"
            >
              <template v-if="err">
                {{ concepts[scheduleItems[idx]?.conceptIndex]?.specificationNumber }}: {{ err }}
              </template>
            </p>
          </div>
          <p v-else-if="scheduleItems.length && scheduleItems.every((s) => s.startRaw && s.endRaw)" class="border-t border-default px-4 py-2 text-xs text-success">
            ✓ {{ F.schedule.allClear }}
          </p>

          <!-- Gantt preview -->
          <div
            v-if="ganttRows.some((r) => r.startDate)"
            class="border-t border-default px-4 py-4"
          >
            <p class="mb-3 text-sm font-medium text-default">{{ F.schedule.ganttTitle }}</p>
            <GanttChart
              :rows="ganttRows"
              :contract-start="contractStartDate"
              :contract-end="contractEndDate"
              :height="Math.max(160, ganttRows.length * 36 + 60)"
            />
          </div>
        </UCard>

        <UAlert
          v-if="submitError"
          :title="submitError"
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
        />

        <!-- Sticky actions -->
        <div
          class="sticky bottom-0 -mx-4 mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-default bg-default/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
        >
          <div class="flex flex-col">
            <span class="text-xs text-muted">{{ F.concepts.total }}</span>
            <span class="text-lg font-semibold tabular-nums text-primary">
              {{ formatMoney(totalAmount) }}
            </span>
          </div>
          <div class="flex items-center gap-3">
            <span v-if="!canSubmit" class="hidden max-w-xs truncate text-xs text-muted sm:inline">
              {{
                Object.values(errors).find(Boolean)
              }}
            </span>
            <UButton color="neutral" variant="ghost" to="/">{{ S.common.cancel }}</UButton>
            <UButton
              icon="i-lucide-folder-plus"
              :loading="loading"
              :disabled="!canSubmit"
              @click="onSubmit"
            >
              {{ F.submit }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>