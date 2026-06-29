<!-- app/pages/contracts/[contractId]/agreements/new.vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import type { ConceptChange, NewConceptDraft } from '~/data/models/agreements'
import type { ConceptId } from '~/data/models'

definePageMeta({ requiredPermission: 'agreement:create' })

const AG = S.agreement

const route = useRoute()
const repos = useRepositories()
const contractId = computed(() => route.params.contractId as string)
const editId = computed(() => (typeof route.query.edit === 'string' ? route.query.edit : null))
const isEdit = computed(() => !!editId.value)

const toInputDate = (d: Date | string | undefined) =>
  d ? new Date(d).toISOString().slice(0, 10) : ''

// ─── Data load ───────────────────────────────────────────────────────────────
const { data, status, error, refresh } = await useAsyncData(
  () => `agreement-form-${contractId.value}-${editId.value ?? 'new'}`,
  async () => {
    const [concepts, schedule, editing] = await Promise.all([
      repos.concepts.listByContract(contractId.value),
      repos.schedule.getByContract(contractId.value).catch(() => null),
      editId.value ? repos.agreements.getById(editId.value).catch(() => null) : Promise.resolve(null),
    ])
    // Build a map of conceptId → schedule item for quick lookup
    const scheduleByConceptId: Record<string, (typeof schedule extends { items: (infer I)[] } | null ? I : never)> = {}
    if (schedule) {
      for (const item of schedule.items) {
        if (item.conceptId) scheduleByConceptId[item.conceptId] = item
      }
    }
    return { concepts, scheduleByConceptId, editing }
  },
)

// ─── Form state ──────────────────────────────────────────────────────────────
const description = ref('')
const conceptChanges = ref<(ConceptChange & {
  _newQtyRaw: string
  _newPriceRaw: string
  _newStart: string
  _newEnd: string
})[]>([])
const newConcepts = ref<(NewConceptDraft & {
  _qtyRaw: string
  _priceRaw: string
  _start: string
  _end: string
})[]>([])
const inited = ref(false)

watchEffect(() => {
  if (!data.value || inited.value) return
  const e = data.value.editing
  if (e) {
    description.value = e.description
    conceptChanges.value = e.conceptChanges.map((cc) => ({
      ...cc,
      _newQtyRaw: cc.contractedQuantity != null ? String(cc.contractedQuantity) : '',
      _newPriceRaw: cc.unitPrice != null ? String(cc.unitPrice / 100) : '',
      _newStart: toInputDate(cc.startDate),
      _newEnd: toInputDate(cc.endDate),
    }))
    newConcepts.value = e.newConcepts.map((nc) => ({
      ...nc,
      _qtyRaw: String(nc.contractedQuantity),
      _priceRaw: String(nc.unitPrice / 100),
      _start: toInputDate((nc as NewConceptDraft & { startDate?: Date }).startDate),
      _end: toInputDate((nc as NewConceptDraft & { endDate?: Date }).endDate),
    }))
  }
  inited.value = true
})

// ─── Concept picker ──────────────────────────────────────────────────────────
const pickerSearch = ref('')
const alreadyAdded = computed(() => new Set(conceptChanges.value.map((c) => c.conceptId)))
const filteredCatalog = computed(() => {
  const q = pickerSearch.value.trim().toLowerCase()
  return (data.value?.concepts ?? []).filter(
    (c) =>
      !alreadyAdded.value.has(c.id) &&
      (!q || c.specificationNumber.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)),
  )
})

function addConceptChange(conceptId: ConceptId) {
  conceptChanges.value.push({
    conceptId,
    _newQtyRaw: '',
    _newPriceRaw: '',
    _newStart: '',
    _newEnd: '',
  })
  pickerSearch.value = ''
}

function removeConceptChange(idx: number) {
  conceptChanges.value.splice(idx, 1)
}

function addNewConcept() {
  newConcepts.value.push({
    specificationNumber: '',
    description: '',
    unit: '',
    unitPrice: 0,
    contractedQuantity: 0,
    _qtyRaw: '',
    _priceRaw: '',
    _start: '',
    _end: '',
  })
}
function removeNewConcept(idx: number) {
  newConcepts.value.splice(idx, 1)
}

// ─── Derived payload ─────────────────────────────────────────────────────────
const resolvedChanges = computed<ConceptChange[]>(() =>
  conceptChanges.value.map((c) => {
    const qty = parseFloat(c._newQtyRaw)
    const price = parseFloat(c._newPriceRaw)
    return {
      conceptId: c.conceptId,
      contractedQuantity: isNaN(qty) ? undefined : qty,
      unitPrice: isNaN(price) ? undefined : Math.round(price * 100),
      startDate: c._newStart ? new Date(`${c._newStart}T12:00:00`) : undefined,
      endDate: c._newEnd ? new Date(`${c._newEnd}T12:00:00`) : undefined,
    }
  }),
)

const resolvedNewConcepts = computed<NewConceptDraft[]>(() =>
  newConcepts.value.map((nc) => ({
    specificationNumber: nc.specificationNumber.trim(),
    description: nc.description.trim(),
    unit: nc.unit.trim(),
    contractedQuantity: parseFloat(nc._qtyRaw) || 0,
    unitPrice: Math.round((parseFloat(nc._priceRaw) || 0) * 100),
    startDate: nc._start ? new Date(`${nc._start}T12:00:00`) : undefined,
    endDate: nc._end ? new Date(`${nc._end}T12:00:00`) : undefined,
  })),
)

// Derived aggregate deltas shown in the summary
const derivedAmountDelta = computed(() => {
  let delta = 0
  for (const ch of resolvedChanges.value) {
    const orig = data.value?.concepts.find((c) => c.id === ch.conceptId)
    if (!orig) continue
    const oldAmt = orig.unitPrice * orig.contractedQuantity
    const newPrice = ch.unitPrice ?? orig.unitPrice
    const newQty = ch.contractedQuantity ?? orig.contractedQuantity
    delta += newPrice * newQty - oldAmt
  }
  for (const nc of resolvedNewConcepts.value) {
    delta += nc.unitPrice * nc.contractedQuantity
  }
  return delta === 0 ? null : delta
})

const derivedTimeDelta = computed(() => {
  // Latest endDate across all changes vs current schedule
  let maxShift = 0
  for (const ch of resolvedChanges.value) {
    if (!ch.endDate) continue
    const item = data.value?.scheduleByConceptId[ch.conceptId]
    if (!item) continue
    const shift = Math.round(
      (new Date(ch.endDate).getTime() - new Date(item.endDate).getTime()) / 86_400_000,
    )
    if (shift > maxShift) maxShift = shift
  }
  return maxShift === 0 ? null : maxShift
})

const kind = computed(() => {
  const hasAmount = derivedAmountDelta.value != null
  const hasTime = derivedTimeDelta.value != null
  return hasAmount && hasTime ? 'mixed' : hasTime ? 'time' : hasAmount ? 'amount' : null
})

// ─── Validation ──────────────────────────────────────────────────────────────
const descError = computed(() =>
  description.value.trim() ? null : AG.validation.descriptionRequired,
)
const newConceptErrors = computed(() =>
  newConcepts.value.map((nc) => ({
    spec: nc.specificationNumber.trim() ? '' : AG.newConcepts.validation.specRequired,
    desc: nc.description.trim() ? '' : AG.newConcepts.validation.descRequired,
    unit: nc.unit.trim() ? '' : AG.newConcepts.validation.unitRequired,
    qty: parseFloat(nc._qtyRaw) > 0 ? '' : AG.newConcepts.validation.qtyRequired,
    price: parseFloat(nc._priceRaw) > 0 ? '' : AG.newConcepts.validation.priceRequired,
  })),
)
const hasChanges = computed(
  () => conceptChanges.value.length > 0 || newConcepts.value.length > 0,
)
const noChangesError = computed(() =>
  !hasChanges.value ? AG.validation.noChanges : null,
)
const newConceptsValid = computed(() =>
  newConceptErrors.value.every((e) => !e.spec && !e.desc && !e.unit && !e.qty && !e.price),
)
const canSave = computed(
  () => !descError.value && hasChanges.value && newConceptsValid.value,
)

// ─── Submit ──────────────────────────────────────────────────────────────────
const loading = ref(false)
const submitError = ref<string | null>(null)
const backTo = computed(() =>
  isEdit.value
    ? `/contracts/${contractId.value}/agreements/${editId.value}`
    : `/contracts/${contractId.value}/contract`,
)

async function onSave() {
  if (!canSave.value) return
  loading.value = true
  submitError.value = null
  try {
    const payload = {
      description: description.value.trim(),
      conceptChanges: resolvedChanges.value,
      newConcepts: resolvedNewConcepts.value,
      amountDelta: derivedAmountDelta.value,
      timeDeltaDays: derivedTimeDelta.value,
    }
    const result = isEdit.value && editId.value
      ? await repos.agreements.update(editId.value, payload)
      : await repos.agreements.create({ contractId: contractId.value, ...payload })
    await navigateTo(`/contracts/${contractId.value}/agreements/${result.id}`)
  } catch (e) {
    submitError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="agreement-new">
    <template #header>
      <UDashboardNavbar
        :title="isEdit && data?.editing
          ? `${AG.editTitlePrefix} No. ${data.editing.number}`
          : AG.newTitle"
      >
        <template #leading>
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            :to="backTo"
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
      <div v-else-if="status === 'pending'" class="space-y-3">
        <USkeleton class="h-24 w-full rounded-lg" />
        <USkeleton class="h-48 w-full rounded-lg" />
      </div>

      <div v-else class="flex flex-col gap-6">
        <!-- Description -->
        <UCard>
          <UFormField :label="AG.fields.description" :error="descError || undefined">
            <UTextarea
              v-model="description"
              :rows="3"
              class="w-full"
              :placeholder="AG.fields.descriptionPlaceholder"
            />
          </UFormField>
        </UCard>

        <!-- Concept changes: picker + table -->
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-pencil-ruler" class="size-4 text-muted" />
              {{ AG.conceptChanges.title }}
            </div>
          </template>

          <!-- Picker -->
          <div class="border-b border-default px-4 py-3">
            <p class="mb-2 text-xs text-muted">{{ AG.conceptChanges.hint }}</p>
            <div class="flex flex-wrap items-center gap-2">
              <UInput
                v-model="pickerSearch"
                :placeholder="S.conceptCatalog.search"
                icon="i-lucide-search"
                class="w-60"
              />
            </div>
            <div
              v-if="pickerSearch.trim()"
              class="mt-1 max-h-40 overflow-y-auto rounded-lg border border-default bg-default shadow-sm"
            >
              <div
                v-for="c in filteredCatalog"
                :key="c.id"
                class="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-elevated"
                @click="addConceptChange(c.id)"
              >
                <UIcon name="i-lucide-plus" class="size-3.5 shrink-0 text-muted" />
                <span class="font-mono text-xs text-muted">{{ c.specificationNumber }}</span>
                <span class="min-w-0 truncate text-sm text-highlighted">{{ c.description }}</span>
              </div>
              <div
                v-if="filteredCatalog.length === 0"
                class="px-3 py-2 text-sm text-muted"
              >
                {{ S.conceptCatalog.search }}…
              </div>
            </div>
          </div>

          <!-- Changes table -->
          <div v-if="conceptChanges.length === 0" class="px-4 py-6 text-sm text-muted">
            {{ AG.conceptChanges.empty }}
          </div>
          <div v-else class="overflow-x-auto">
            <table class="w-full min-w-[56rem] text-sm">
              <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                <tr>
                  <th class="px-3 py-2 text-left font-medium">{{ AG.conceptChanges.columns.specification }}</th>
                  <th class="px-3 py-2 text-left font-medium">{{ AG.conceptChanges.columns.description }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ AG.conceptChanges.columns.currentQty }}</th>
                  <th class="px-3 py-2 text-right font-medium text-success">{{ AG.conceptChanges.columns.newQty }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ AG.conceptChanges.columns.currentPrice }}</th>
                  <th class="px-3 py-2 text-right font-medium text-success">{{ AG.conceptChanges.columns.newPrice }}</th>
                  <th class="px-3 py-2 text-center font-medium">{{ AG.conceptChanges.columns.newStart }}</th>
                  <th class="px-3 py-2 text-center font-medium">{{ AG.conceptChanges.columns.newEnd }}</th>
                  <th class="px-2 py-2" />
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-for="(cc, idx) in conceptChanges" :key="cc.conceptId">
                  <template v-if="data">
                    <td class="px-3 py-2 font-mono text-xs text-highlighted">
                      {{ data.concepts.find(c => c.id === cc.conceptId)?.specificationNumber }}
                    </td>
                    <td class="min-w-[12rem] px-3 py-2 text-highlighted">
                      {{ data.concepts.find(c => c.id === cc.conceptId)?.description }}
                    </td>
                    <!-- Current qty -->
                    <td class="px-3 py-2 text-right tabular-nums text-muted">
                      {{ formatNumber(data.concepts.find(c => c.id === cc.conceptId)?.contractedQuantity ?? 0) }}
                    </td>
                    <!-- New qty (editable, green) -->
                    <td class="px-3 py-2">
                      <UInput
                        v-model="cc._newQtyRaw"
                        type="number"
                        min="0"
                        step="any"
                        :placeholder="String(data.concepts.find(c => c.id === cc.conceptId)?.contractedQuantity ?? '')"
                        class="w-28 [&_input]:text-right [&_input]:text-success [&_input]:font-medium"
                      />
                    </td>
                    <!-- Current price -->
                    <td class="px-3 py-2 text-right tabular-nums text-muted">
                      {{ formatMoney(data.concepts.find(c => c.id === cc.conceptId)?.unitPrice ?? 0) }}
                    </td>
                    <!-- New price (editable, green) -->
                    <td class="px-3 py-2">
                      <UInput
                        v-model="cc._newPriceRaw"
                        type="number"
                        min="0"
                        step="0.01"
                        :placeholder="String((data.concepts.find(c => c.id === cc.conceptId)?.unitPrice ?? 0) / 100)"
                        class="w-32 [&_input]:text-right [&_input]:text-success [&_input]:font-medium"
                      >
                        <template #leading><span class="pl-1 text-xs text-muted">$</span></template>
                      </UInput>
                    </td>
                    <!-- New start date -->
                    <td class="px-3 py-2">
                      <UInput
                        v-model="cc._newStart"
                        type="date"
                        :placeholder="toInputDate(data.scheduleByConceptId[cc.conceptId]?.startDate)"
                        class="w-36 [&_input]:text-success"
                      />
                    </td>
                    <!-- New end date -->
                    <td class="px-3 py-2">
                      <UInput
                        v-model="cc._newEnd"
                        type="date"
                        :placeholder="toInputDate(data.scheduleByConceptId[cc.conceptId]?.endDate)"
                        class="w-36 [&_input]:text-success"
                      />
                    </td>
                  </template>
                  <td class="px-2 py-2">
                    <UButton
                      icon="i-lucide-x"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      @click="removeConceptChange(idx)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>

        <!-- New concepts -->
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-list-plus" class="size-4 text-muted" />
                {{ AG.newConcepts.title }}
              </div>
              <UButton
                size="xs"
                icon="i-lucide-plus"
                color="neutral"
                variant="outline"
                @click="addNewConcept"
              >
                {{ AG.newConcepts.add }}
              </UButton>
            </div>
          </template>

          <div v-if="newConcepts.length === 0" class="px-4 py-6 text-sm text-muted">
            {{ AG.newConcepts.empty }}
          </div>
          <div v-else class="overflow-x-auto">
            <table class="w-full min-w-[60rem] text-sm">
              <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                <tr>
                  <th class="px-3 py-2 text-left font-medium">{{ AG.newConcepts.columns.specification }}</th>
                  <th class="px-3 py-2 text-left font-medium">{{ AG.newConcepts.columns.description }}</th>
                  <th class="px-3 py-2 text-left font-medium">{{ AG.newConcepts.columns.unit }}</th>
                  <th class="px-3 py-2 text-right font-medium text-success">{{ AG.newConcepts.columns.qty }}</th>
                  <th class="px-3 py-2 text-right font-medium text-success">{{ AG.newConcepts.columns.unitPrice }}</th>
                  <th class="px-3 py-2 text-center font-medium">{{ AG.newConcepts.columns.scheduleStart }}</th>
                  <th class="px-3 py-2 text-center font-medium">{{ AG.newConcepts.columns.scheduleEnd }}</th>
                  <th class="px-2 py-2" />
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-for="(nc, idx) in newConcepts" :key="idx">
                  <td class="px-3 py-2">
                    <UInput
                      v-model="nc.specificationNumber"
                      class="w-28"
                      :placeholder="AG.newConcepts.columns.specification"
                      :color="newConceptErrors[idx]?.spec ? 'error' : undefined"
                    />
                  </td>
                  <td class="min-w-[14rem] px-3 py-2">
                    <UInput
                      v-model="nc.description"
                      class="w-full"
                      :placeholder="AG.newConcepts.columns.description"
                      :color="newConceptErrors[idx]?.desc ? 'error' : undefined"
                    />
                  </td>
                  <td class="px-3 py-2">
                    <UInput
                      v-model="nc.unit"
                      class="w-20"
                      placeholder="m2"
                      :color="newConceptErrors[idx]?.unit ? 'error' : undefined"
                    />
                  </td>
                  <td class="px-3 py-2">
                    <UInput
                      v-model="nc._qtyRaw"
                      type="number"
                      min="0"
                      step="any"
                      class="w-24 [&_input]:text-right [&_input]:text-success [&_input]:font-medium"
                      :color="newConceptErrors[idx]?.qty ? 'error' : undefined"
                    />
                  </td>
                  <td class="px-3 py-2">
                    <UInput
                      v-model="nc._priceRaw"
                      type="number"
                      min="0"
                      step="0.01"
                      class="w-32 [&_input]:text-right [&_input]:text-success [&_input]:font-medium"
                      :color="newConceptErrors[idx]?.price ? 'error' : undefined"
                    >
                      <template #leading><span class="pl-1 text-xs text-muted">$</span></template>
                    </UInput>
                  </td>
                  <td class="px-3 py-2">
                    <UInput v-model="nc._start" type="date" class="w-36 [&_input]:text-success" />
                  </td>
                  <td class="px-3 py-2">
                    <UInput v-model="nc._end" type="date" class="w-36 [&_input]:text-success" />
                  </td>
                  <td class="px-2 py-2">
                    <UButton
                      icon="i-lucide-x"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      @click="removeNewConcept(idx)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>

        <!-- Summary -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-calculator" class="size-4 text-muted" />
              {{ AG.sections.detail }}
            </div>
          </template>

          <dl class="divide-y divide-default text-sm">
            <div class="flex items-center justify-between py-2">
              <dt class="text-muted">{{ AG.summary.derivedAmountDelta }}</dt>
              <dd
                v-if="derivedAmountDelta != null"
                class="font-semibold tabular-nums"
                :class="derivedAmountDelta >= 0 ? 'text-success' : 'text-error'"
              >
                {{ derivedAmountDelta >= 0 ? '+' : '' }}{{ formatMoney(derivedAmountDelta) }}
              </dd>
              <dd v-else class="text-muted">{{ AG.summary.noChanges }}</dd>
            </div>
            <div class="flex items-center justify-between py-2">
              <dt class="text-muted">{{ AG.summary.derivedTimeDelta }}</dt>
              <dd
                v-if="derivedTimeDelta != null"
                class="font-semibold tabular-nums"
                :class="derivedTimeDelta > 0 ? 'text-warning' : 'text-success'"
              >
                {{ derivedTimeDelta > 0 ? '+' : '' }}{{ derivedTimeDelta }} {{ AG.summary.days }}
              </dd>
              <dd v-else class="text-muted">—</dd>
            </div>
            <div v-if="kind" class="flex items-center justify-between py-2">
              <dt class="text-muted">Tipo de convenio</dt>
              <dd>
                <UBadge :label="AG.kind[kind]" color="neutral" variant="soft" size="sm" />
              </dd>
            </div>
          </dl>

          <UAlert class="mt-3" color="neutral" variant="soft" icon="i-lucide-info" :title="AG.effectNotice" />
        </UCard>

        <UAlert
          v-if="noChangesError && description.trim()"
          color="warning"
          variant="soft"
          icon="i-lucide-triangle-alert"
          :title="noChangesError"
        />
        <UAlert
          v-if="submitError"
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
          :title="submitError"
        />

        <!-- Sticky actions -->
        <div
          class="sticky bottom-0 -mx-4 mt-2 flex justify-end gap-3 border-t border-default bg-default/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
        >
          <UButton color="neutral" variant="ghost" :to="backTo">{{ S.common.cancel }}</UButton>
          <UButton
            :icon="isEdit ? 'i-lucide-save' : 'i-lucide-file-plus-2'"
            :loading="loading"
            :disabled="!canSave"
            @click="onSave"
          >
            {{ isEdit ? AG.saveChanges : AG.saveDraft }}
          </UButton>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>