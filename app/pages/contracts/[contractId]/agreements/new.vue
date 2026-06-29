<!-- app/pages/contracts/[contractId]/agreements/new.vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'

definePageMeta({ requiredPermission: 'agreement:create' })

const AG = S.agreement

const route = useRoute()
const repos = useRepositories()
const contractId = computed(() => route.params.contractId as string)
const editId = computed(() => (typeof route.query.edit === 'string' ? route.query.edit : null))
const isEdit = computed(() => !!editId.value)

const { data, status, error, refresh } = await useAsyncData(
  () => `agreement-form-${contractId.value}-${editId.value ?? 'new'}`,
  async () => {
    const editing = editId.value
      ? await repos.agreements.getById(editId.value).catch(() => null)
      : null
    return { editing }
  },
)

// --- Form state ---
const description = ref('')
const amountDeltaRaw = ref('')   // string so blank means null
const timeDeltaRaw = ref('')
const inited = ref(false)

watchEffect(() => {
  if (!data.value || inited.value) return
  const e = data.value.editing
  if (e) {
    description.value = e.description
    amountDeltaRaw.value = e.amountDelta != null ? String(e.amountDelta / 100) : ''
    timeDeltaRaw.value = e.timeDeltaDays != null ? String(e.timeDeltaDays) : ''
  }
  inited.value = true
})

const amountDelta = computed(() => {
  const n = parseFloat(amountDeltaRaw.value)
  return isNaN(n) ? null : Math.round(n * 100)
})
const timeDeltaDays = computed(() => {
  const n = parseInt(timeDeltaRaw.value, 10)
  return isNaN(n) ? null : n
})

// --- Validation ---
const descError = computed(() =>
  !description.value.trim() ? AG.validation.descriptionRequired : null,
)
const deltaError = computed(() =>
  amountDelta.value == null && timeDeltaDays.value == null ? AG.validation.noDelta : null,
)
const canSave = computed(() => !descError.value && !deltaError.value)

// Derived kind label for preview
const kindLabel = computed(() => {
  if (amountDelta.value != null && timeDeltaDays.value != null) return AG.kind.mixed
  if (timeDeltaDays.value != null) return AG.kind.time
  if (amountDelta.value != null) return AG.kind.amount
  return null
})

// --- Submit ---
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
      amountDelta: amountDelta.value,
      timeDeltaDays: timeDeltaDays.value,
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
        <USkeleton class="h-28 w-full rounded-lg" />
      </div>

      <template v-else>
        <UCard class="max-w-2xl">
          <div class="space-y-5">
            <!-- Description -->
            <UFormField :label="AG.fields.description" :error="descError || undefined">
              <UTextarea
                v-model="description"
                :rows="4"
                class="w-full"
                :placeholder="AG.fields.descriptionPlaceholder"
              />
            </UFormField>

            <!-- Amount delta -->
            <UFormField :label="AG.fields.amountDelta" :hint="AG.fields.amountDeltaHint">
              <UInput
                v-model="amountDeltaRaw"
                type="number"
                step="0.01"
                class="w-full"
                placeholder="0.00"
              >
                <template #leading>
                  <span class="text-sm text-muted">$</span>
                </template>
              </UInput>
            </UFormField>

            <!-- Time delta -->
            <UFormField :label="AG.fields.timeDeltaDays" :hint="AG.fields.timeDeltaHint">
              <UInput
                v-model="timeDeltaRaw"
                type="number"
                step="1"
                class="w-full"
                placeholder="0"
              >
                <template #trailing>
                  <span class="pr-1 text-xs text-muted">días</span>
                </template>
              </UInput>
            </UFormField>

            <!-- Kind preview -->
            <div v-if="kindLabel" class="flex items-center gap-2 text-sm text-muted">
              <UIcon name="i-lucide-tag" class="size-4" />
              {{ kindLabel }}
            </div>

            <!-- Effect notice -->
            <UAlert
              color="neutral"
              variant="soft"
              icon="i-lucide-info"
              :title="AG.effectNotice"
            />

            <UAlert
              v-if="deltaError && description.trim()"
              color="warning"
              variant="soft"
              icon="i-lucide-triangle-alert"
              :title="deltaError"
            />

            <UAlert
              v-if="submitError"
              color="error"
              variant="soft"
              icon="i-lucide-alert-triangle"
              :title="submitError"
            />
          </div>
        </UCard>

        <!-- Actions -->
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
      </template>
    </template>
  </UDashboardPanel>
</template>