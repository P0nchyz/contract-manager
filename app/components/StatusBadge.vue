<!-- app/components/StatusBadge.vue -->
<script setup lang="ts">
import type { StatusDisplay } from '~/utils/format'

defineProps<{
  display: StatusDisplay
  size?: 'sm' | 'md' | 'lg'
}>()
</script>

<template>
  <UBadge
    :label="display.label"
    :color="display.color"
    :variant="display.variant"
    :size="size ?? 'sm'"
    :class="display.dashed ? 'border border-dashed' : undefined"
  />
</template>
