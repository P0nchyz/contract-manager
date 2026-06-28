<!-- app/pages/admin/users.vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'

definePageMeta({ requiredPermission: 'admin:users' })
</script>

<template>
  <UDashboardPanel id="admin-users">
    <template #header>
      <UDashboardNavbar :title="S.nav.users" />
    </template>
    <template #body>
      <p class="text-sm text-muted">
        Administración de usuarios y corporaciones (pendiente de construir).
      </p>
    </template>
  </UDashboardPanel>
</template>
