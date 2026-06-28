<!-- app/components/SignatureChips.vue -->
<script setup lang="ts">
import type { Signature } from '~/data/models'
import { S } from '~/constants/strings'

defineProps<{ signatures: Signature[] }>()

const shortRole: Record<string, string> = {
  resident: 'R',
  superintendent: 'SI',
  supervisor: 'SV',
}
</script>

<template>
  <div class="flex items-center gap-1">
    <UTooltip
      v-for="s in signatures"
      :key="s.id"
      :text="`${S.roles[s.role]} · ${s.status === 'signed' ? 'firmado' : 'pendiente'}`"
    >
      <span
        class="inline-flex items-center justify-center size-5 rounded text-[10px] font-medium leading-none"
        :class="s.status === 'signed'
          ? 'bg-success text-inverted'
          : 'border border-dashed border-default text-muted'"
      >
        {{ shortRole[s.role] }}
      </span>
    </UTooltip>
  </div>
</template>
