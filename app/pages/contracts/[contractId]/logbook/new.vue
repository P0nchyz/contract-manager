<!-- app/pages/contracts/[contractId]/logbook/new.vue -->
<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'

definePageMeta({ requiredPermission: 'logNote:create' })

const route = useRoute()
const repos = useRepositories()
const contractId = computed(() => route.params.contractId as string)

const schema = z.object({
  title: z.string().min(1, 'El título es requerido'),
  date: z.string().min(1, 'La fecha es requerida'),
  body: z.string().min(1, 'La descripción es requerida'),
})

type Schema = z.output<typeof schema>

const state = reactive({
  title: '',
  date: new Date().toISOString().split('T')[0], // Defaults to today (YYYY-MM-DD)
  body: '',
})

const loading = ref(false)
const errorMsg = ref<string | null>(null)

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  errorMsg.value = null
  try {
    const { title, date, body } = event.data
    // Convert the HTML date string back to a Javascript Date object for the repository
    await repos.logNotes.create({
      contractId: contractId.value,
      title,
      date: new Date(date + 'T12:00:00'), 
      body,
    })
    await navigateTo(`/contracts/${contractId.value}/logbook`)
  } catch (e) {
    errorMsg.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="lognote-new">
    <template #header>
      <UDashboardNavbar :title="S.actions.newLogNote">
        <template #leading>
          <UButton 
            icon="i-lucide-arrow-left" 
            color="neutral" 
            variant="ghost" 
            :to="`/contracts/${contractId}/logbook`" 
            :aria-label="S.common.back" 
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="max-w-2xl">
        <UCard>
          <UForm :schema="schema" :state="state" class="space-y-4" @submit="onSubmit">
            <UFormField label="Título" name="title">
              <UInput v-model="state.title" class="w-full" placeholder="Ej. Inicio de trazo y nivelación" />
            </UFormField>

            <UFormField label="Fecha" name="date">
              <UInput v-model="state.date" type="date" class="w-full" />
            </UFormField>

            <UFormField label="Descripción" name="body">
              <UTextarea v-model="state.body" :rows="6" class="w-full" placeholder="Redacta la nota de bitácora aquí..." />
            </UFormField>

            <UAlert
              v-if="errorMsg"
              :title="errorMsg"
              color="error"
              variant="soft"
              icon="i-lucide-alert-triangle"
            />

            <div class="flex justify-end gap-3 pt-4 border-t border-default">
              <UButton 
                color="neutral" 
                variant="ghost" 
                :to="`/contracts/${contractId}/logbook`"
              >
                {{ S.common.cancel }}
              </UButton>
              <UButton type="submit" :loading="loading" icon="i-lucide-save">
                {{ S.common.save }}
              </UButton>
            </div>
          </UForm>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>