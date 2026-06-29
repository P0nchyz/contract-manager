<!-- app/pages/contracts/[contractId]/logbook/new.vue -->
<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'

definePageMeta({ requiredPermission: 'logNote:create' })

const L = S.logNote

const route = useRoute()
const repos = useRepositories()
const contractId = computed(() => route.params.contractId as string)

const schema = z.object({
  title: z.string().min(1, L.validation.titleRequired),
  date:  z.string().min(1, L.validation.dateRequired),
  body:  z.string().min(1, L.validation.bodyRequired),
})

type Schema = z.output<typeof schema>

const state = reactive({
  title: '',
  date:  new Date().toISOString().split('T')[0],
  body:  '',
})

const loading = ref(false)
const errorMsg = ref<string | null>(null)

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  errorMsg.value = null
  try {
    const { title, date, body } = event.data
    const note = await repos.logNotes.create({
      contractId: contractId.value,
      title,
      date: new Date(`${date}T12:00:00`),
      body,
    })
    // Navigate to the detail page — the note is locked for editing from here on.
    await navigateTo(`/contracts/${contractId.value}/logbook/${note.id}`)
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
      <UDashboardNavbar :title="L.newTitle">
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
        <!-- Lock notice -->
        <UAlert
          color="neutral"
          variant="soft"
          icon="i-lucide-lock"
          :title="L.lockedNotice"
          class="mb-4"
        />

        <UCard>
          <UForm :schema="schema" :state="state" class="space-y-4" @submit="onSubmit">
            <UFormField :label="L.fields.title" name="title">
              <UInput
                v-model="state.title"
                class="w-full"
                :placeholder="L.fields.titlePlaceholder"
              />
            </UFormField>

            <UFormField :label="L.fields.date" name="date">
              <UInput v-model="state.date" type="date" class="w-full" />
            </UFormField>

            <UFormField :label="L.fields.body" name="body">
              <UTextarea
                v-model="state.body"
                :rows="6"
                class="w-full"
                :placeholder="L.fields.bodyPlaceholder"
              />
            </UFormField>

            <UAlert
              v-if="errorMsg"
              :title="errorMsg"
              color="error"
              variant="soft"
              icon="i-lucide-alert-triangle"
            />

            <div class="flex justify-end gap-3 border-t border-default pt-4">
              <UButton
                color="neutral"
                variant="ghost"
                :to="`/contracts/${contractId}/logbook`"
              >
                {{ S.common.cancel }}
              </UButton>
              <UButton type="submit" :loading="loading" icon="i-lucide-save">
                {{ L.save }}
              </UButton>
            </div>
          </UForm>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>