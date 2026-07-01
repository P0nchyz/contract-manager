<!-- app/pages/contracts/[contractId]/logbook/new.vue -->
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import type { LogNoteCategory } from '~/data/models'

definePageMeta({ requiredPermission: 'logNote:create' })

const L = S.logNote

const route = useRoute()
const repos = useRepositories()

const contractId = computed(() => route.params.contractId as string)

const { data, status, error } = await useAsyncData(
  `logbook-new-${contractId.value}`,
  async () => {
    const [notes, contract, users] = await Promise.all([
      repos.logNotes.listByContract(contractId.value),
      repos.contracts.getById(contractId.value),
      repos.users.list().catch(() => []),
    ])
    const openingNote    = notes.find((n) => n.isOpeningNote) ?? null
    const resident       = contract.residentId       ? users.find((u) => u.id === contract.residentId)       ?? null : null
    const superintendent = contract.superintendentId ? users.find((u) => u.id === contract.superintendentId) ?? null : null
    const nextFolio      = notes.reduce((m, n) => Math.max(m, n.folio), 0) + 1
    return { openingNote, contract, resident, superintendent, nextFolio }
  },
)

const isOpeningNote = computed(() => !data.value?.openingNote)

const category             = ref('')
const title                = ref('')
const customBody           = ref('')
const residentCedula       = ref(data.value?.resident?.cedula ?? '')
const superintendentCedula = ref(data.value?.superintendent?.cedula ?? '')

watch(isOpeningNote, (v) => { if (v) category.value = 'apertura' }, { immediate: true })

const CATEGORY_OPTIONS = Object.entries(L.categories)
  .filter(([k]) => k !== 'apertura' && k !== 'cierre')
  .map(([value, label]) => ({ label, value }))

const canSave  = computed(() => !!category.value && !!title.value.trim())
const loading  = ref(false)
const errorMsg = ref<string | null>(null)

async function onSave() {
  if (!canSave.value) return
  loading.value = true; errorMsg.value = null
  try {
    const note = await repos.logNotes.create({
      contractId: contractId.value,
      category: category.value as LogNoteCategory,
      title: title.value.trim(),
      customBody: customBody.value.trim(),
      residentCedula: residentCedula.value.trim() || undefined,
      superintendentCedula: superintendentCedula.value.trim() || undefined,
    })
    await navigateTo(`/contracts/${contractId.value}/logbook/${note.id}`)
  } catch (e) {
    errorMsg.value = isRepositoryError(e) ? e.message : S.common.error
  } finally { loading.value = false }
}
</script>

<template>
  <UDashboardPanel id="lognote-new">
    <template #header>
      <UDashboardNavbar :title="isOpeningNote ? L.newOpeningTitle : L.newTitle">
        <template #leading>
          <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost"
            :to="`/contracts/${contractId}/logbook`" :aria-label="S.common.back" />
        </template>
        <template #right>
          <div v-if="data" class="flex items-center gap-1.5 rounded-md bg-elevated px-2.5 py-1 text-xs font-medium text-muted">
            <UIcon name="i-lucide-hash" class="size-3.5" />
            Folio {{ data.nextFolio }}
          </div>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-alert-triangle" :title="S.common.error" />
      <USkeleton v-else-if="status === 'pending'" class="h-64 w-full rounded-xl" />

      <div v-else-if="data" class="max-w-2xl space-y-4">
        <UAlert v-if="isOpeningNote" color="primary" variant="soft" icon="i-lucide-info" :title="L.openingHint" />
        <UAlert color="neutral" variant="soft" icon="i-lucide-lock" :title="L.lockedNotice" />

        <UCard>
          <div class="space-y-4">
            <!-- Category -->
            <UFormField :label="L.fields.category">
              <div v-if="isOpeningNote" class="rounded-md bg-elevated px-3 py-2 text-sm text-muted">
                {{ L.categories.apertura }}
              </div>
              <USelect v-else v-model="category" :items="CATEGORY_OPTIONS"
                :placeholder="`— ${L.fields.category} —`" class="w-full" />
            </UFormField>

            <!-- Title -->
            <UFormField :label="L.fields.title">
              <UInput v-model="title" class="w-full" :placeholder="L.fields.titlePlaceholder" />
            </UFormField>

            <!-- Opening note: cedula fields -->
            <template v-if="isOpeningNote">
              <UFormField :label="L.fields.residentCedula">
                <UInput v-model="residentCedula" class="w-full" :placeholder="L.fields.cedulaPlaceholder" />
                <template v-if="data.resident" #hint>Residente: {{ data.resident.fullName }}</template>
              </UFormField>
              <UFormField :label="L.fields.superintendentCedula">
                <UInput v-model="superintendentCedula" class="w-full" :placeholder="L.fields.cedulaPlaceholder" />
                <template v-if="data.superintendent" #hint>Superintendente: {{ data.superintendent.fullName }}</template>
              </UFormField>
            </template>

            <!-- Body -->
            <UFormField
              :label="isOpeningNote ? L.fields.customBody : 'Nota'"
              :hint="isOpeningNote ? 'Opcional. Se agrega después del texto oficial.' : undefined"
            >
              <UTextarea v-model="customBody" :rows="isOpeningNote ? 4 : 8" class="w-full"
                :placeholder="isOpeningNote ? 'Agrega observaciones adicionales (opcional)…' : L.fields.customBodyPlaceholder" />
            </UFormField>
          </div>
        </UCard>

        <!-- Opening note: generated text preview -->
        <UCard v-if="isOpeningNote">
          <template #header>
            <div class="flex items-center gap-2 text-sm font-medium text-muted">
              <UIcon name="i-lucide-eye" class="size-4" />
              Vista previa del texto oficial
            </div>
          </template>
          <pre class="whitespace-pre-wrap text-xs text-muted leading-relaxed">Con fecha de hoy, [fecha actual], se declara formalmente abierta la Bitácora Electrónica y Seguimiento a Obra Pública (BESOP)…

• Contrato No.: {{ data.contract.code }}
• Obra: {{ data.contract.title }}
• Dependencia Convocante: [entidad del contrato]
• Contratista: [empresa contratista]
• Anticipo: {{ data.contract.anticipoPercentage }}% del monto contractual
• Residente: {{ data.resident?.fullName ?? '—' }}{{ residentCedula ? ` (Cédula: ${residentCedula})` : '' }}
• Superintendente: {{ data.superintendent?.fullName ?? '—' }}{{ superintendentCedula ? ` (Cédula: ${superintendentCedula})` : '' }}</pre>
        </UCard>

        <UAlert v-if="errorMsg" :title="errorMsg" color="error" variant="soft" icon="i-lucide-alert-triangle" />

        <div class="sticky bottom-0 -mx-4 flex justify-end gap-3 border-t border-default bg-default/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <UButton color="neutral" variant="ghost" :to="`/contracts/${contractId}/logbook`">{{ S.common.cancel }}</UButton>
          <UButton icon="i-lucide-save" :loading="loading" :disabled="!canSave" @click="onSave">{{ L.save }}</UButton>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>