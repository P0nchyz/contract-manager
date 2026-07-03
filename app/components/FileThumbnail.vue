<!-- app/components/FileThumbnail.vue -->
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { S } from '~/constants/strings'
import type { FileAsset } from '~/data/models'

const props = withDefaults(
  defineProps<{
    file: FileAsset | null
    size?: 'sm' | 'md' | 'lg'
    /** Shown (in error styling) when there's no file at all — for mandatory evidence. */
    required?: boolean
  }>(),
  { size: 'md', required: false },
)
const emit = defineEmits<{ click: [file: FileAsset] }>()

const FV = S.fileViewer
const repos = useRepositories()

const url = ref<string | null>(null)
const loading = ref(false)
const failed = ref(false)

const isImage = computed(() => !!props.file?.mimeType?.startsWith('image/'))

watch(
  () => props.file?.id,
  async (id) => {
    url.value = null
    failed.value = false
    if (!id || !props.file || !isImage.value) { loading.value = false; return }
    loading.value = true
    try {
      url.value = await repos.files.getDownloadUrl(props.file.id)
    } catch {
      failed.value = true
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

const sizeClass = computed(() => {
  if (props.size === 'sm') return 'h-14 w-14'
  if (props.size === 'lg') return 'h-40 w-40'
  return 'h-24 w-24'
})

function onClick() {
  if (props.file) emit('click', props.file)
}
</script>

<template>
  <!-- No file at all — required evidence missing -->
  <div v-if="!file"
    class="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-1 text-center"
    :class="[sizeClass, required ? 'border-error/50 bg-error/5 text-error' : 'border-default text-muted']">
    <UIcon name="i-lucide-image-off" class="size-4" />
    <span class="text-[10px] leading-tight">{{ required ? FV.missingRequired : FV.noPhoto }}</span>
  </div>

  <USkeleton v-else-if="loading" :class="sizeClass" class="rounded-lg" />

  <!-- Not an image, or failed to load — show a file chip instead of a broken image -->
  <button v-else-if="failed || !isImage || !url" type="button"
    class="flex flex-col items-center justify-center gap-1 rounded-lg border border-default bg-elevated/40 p-1 text-center text-muted transition-colors hover:bg-elevated/70"
    :class="sizeClass" @click="onClick">
    <UIcon name="i-lucide-image" class="size-4" />
    <span class="w-full truncate text-[10px] leading-tight">{{ file.name }}</span>
  </button>

  <button v-else type="button" class="block overflow-hidden rounded-lg border border-default" :class="sizeClass"
    @click="onClick">
    <img :src="url" :alt="file.name"
      class="size-full cursor-zoom-in object-cover transition-opacity hover:opacity-90" />
  </button>
</template>