<!-- app/pages/login.vue -->
<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'

definePageMeta({ layout: 'auth', public: true })

const schema = z.object({
  username: z.string().min(1, S.login.usernameRequired),
  password: z.string().min(1, S.login.passwordRequired),
})
type Schema = z.output<typeof schema>

const state = reactive({ username: '', password: '' })
const loading = ref(false)
const errorMsg = ref<string | null>(null)
const auth = useAuthStore()

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  errorMsg.value = null
  try {
    await auth.login(event.data)
    await navigateTo('/')
  } catch (e) {
    errorMsg.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-3">
        <UIcon name="i-lucide-hard-hat" class="size-7 text-primary" />
        <div>
          <h1 class="text-lg font-semibold">{{ S.app.name }}</h1>
          <p class="text-sm text-muted">{{ S.login.subtitle }}</p>
        </div>
      </div>
    </template>

    <UForm :schema="schema" :state="state" class="space-y-4" @submit="onSubmit">
      <UFormField :label="S.login.username" name="username">
        <UInput v-model="state.username" autocomplete="username" class="w-full" spellcheck="false" />
      </UFormField>
      <UFormField :label="S.login.password" name="password">
        <UInput v-model="state.password" type="password" autocomplete="current-password" class="w-full" />
      </UFormField>

      <UAlert v-if="errorMsg" :title="errorMsg" color="error" variant="soft" icon="i-lucide-alert-triangle" />

      <UButton type="submit" :loading="loading" block>{{ S.login.submit }}</UButton>
    </UForm>
  </UCard>
</template>
