<!-- app/pages/contracts/new.vue -->
<script setup lang="ts">
import { S } from '~/constants/strings'

definePageMeta({ requiredPermission: 'contract:create' })
</script>

<template>
  <UDashboardPanel id="contract-new">
    <template #header>
      <UDashboardNavbar :title="S.dashboard.newContract">
        <template #leading>
          <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" to="/" :aria-label="S.common.back" />
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <p class="text-sm text-muted">Formulario de creación de contrato (pendiente de construir).</p>
    </template>
  </UDashboardPanel>
</template>
