<!-- app/layouts/default.vue -->
<script setup lang="ts">
import { buildNavigation } from '~/config/navigation'
import { S } from '~/constants/strings'

const auth = useAuthStore()
const route = useRoute()
const { can, role } = usePermissions()

const nav = computed(() =>
  buildNavigation({ can, contractId: route.params.contractId as string | undefined }),
)

async function onLogout() {
  await auth.logout()
  await navigateTo('/login')
}
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar collapsible resizable :min-size="14" :default-size="18" :max-size="26">
      <template #header>
        <div class="flex items-center gap-2 font-semibold">
          <UIcon name="i-lucide-hard-hat" class="size-5 text-primary" />
          <span>{{ S.app.shortName }}</span>
        </div>
      </template>

      <UNavigationMenu :items="nav.global" orientation="vertical" />
      <template v-if="nav.contract.length">
        <USeparator class="my-2" />
        <UNavigationMenu :items="nav.contract" orientation="vertical" />
      </template>

      <template #footer>
        <div class="flex items-center gap-2 w-full">
          <UAvatar :alt="auth.user?.fullName" size="sm" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium truncate">{{ auth.user?.fullName }}</p>
            <p class="text-xs text-muted truncate">{{ roleLabel(role) }}</p>
          </div>
          <UButton
            icon="i-lucide-log-out"
            color="neutral"
            variant="ghost"
            :aria-label="S.nav.logout"
            @click="onLogout"
          />
        </div>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
