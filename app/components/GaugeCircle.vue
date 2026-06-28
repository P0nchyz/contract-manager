<!-- app/components/GaugeCircle.vue -->
<script setup lang="ts">
// Dependency-free circular gauge (donut). Strokes use Nuxt UI CSS vars via
// inline style so they're robust regardless of generated utility classes.
const props = withDefaults(
  defineProps<{
    value: number // 0..100
    size?: number
    thickness?: number
    sublabel?: string
  }>(),
  { size: 120, thickness: 10 },
)

const radius = computed(() => (props.size - props.thickness) / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)
const center = computed(() => props.size / 2)
const dash = computed(() => {
  const clamped = Math.min(Math.max(props.value, 0), 100)
  return (clamped / 100) * circumference.value
})
</script>

<template>
  <div
    class="relative inline-flex items-center justify-center shrink-0"
    :style="{ width: `${size}px`, height: `${size}px` }"
  >
    <svg :width="size" :height="size" class="-rotate-90">
      <circle
        :cx="center" :cy="center" :r="radius"
        fill="none" :stroke-width="thickness"
        :style="{ stroke: 'var(--ui-border)' }"
      />
      <circle
        :cx="center" :cy="center" :r="radius"
        fill="none" :stroke-width="thickness" stroke-linecap="round"
        :stroke-dasharray="`${dash} ${circumference}`"
        :style="{ stroke: 'var(--ui-primary)' }"
        class="transition-all duration-500"
      />
    </svg>
    <div class="absolute inset-0 flex flex-col items-center justify-center">
      <span class="text-xl font-semibold tabular-nums">{{ formatPercent(value) }}</span>
      <span v-if="sublabel" class="text-xs text-muted">{{ sublabel }}</span>
    </div>
  </div>
</template>
