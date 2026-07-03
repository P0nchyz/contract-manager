<!-- app/components/FileViewerModal.vue -->
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import { isPreviewable } from '~/utils/fileIcon'
import type { FileAsset } from '~/data/models'

const props = defineProps<{
  open: boolean
  file: FileAsset | null
}>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const FV = S.fileViewer
const repos = useRepositories()

const url = ref<string | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)

const isImage = computed(() => !!props.file?.mimeType?.startsWith('image/'))
const isPdf = computed(() => props.file?.mimeType === 'application/pdf')
const canPreview = computed(() => isPreviewable(props.file?.mimeType))

watch(
  [() => props.open, () => props.file?.id],
  async ([open, fileId]) => {
    url.value = null
    loadError.value = null
    if (!open || !fileId || !props.file) return
    loading.value = true
    try {
      url.value = await repos.files.getDownloadUrl(props.file.id)
    } catch (e) {
      loadError.value = isRepositoryError(e) ? e.message : FV.loadError
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

function download() {
  if (!url.value || !props.file) return
  const a = document.createElement('a')
  a.href = url.value
  a.download = props.file.name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function formatBytes(n: number) {
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1_048_576).toFixed(1)} MB`
}
</script>

<template>
  <UModal :open="open" :title="file?.name ?? ''" :ui="{ content: 'sm:max-w-3xl' }"
    @update:open="(v) => emit('update:open', v)">
    <template #body>
      <div class="flex min-h-[40vh] items-center justify-center">
        <USkeleton v-if="loading" class="h-96 w-full rounded-lg" />

        <UAlert v-else-if="loadError" color="error" variant="soft" icon="i-lucide-alert-triangle"
          :title="loadError" class="w-full" />

        <img v-else-if="isImage && url" :src="url" :alt="file?.name"
          class="max-h-[75vh] w-auto max-w-full rounded-lg border border-default object-contain" />

        <iframe v-else-if="isPdf && url" :src="url" :title="file?.name"
          class="h-[75vh] w-full rounded-lg border border-default" />

        <div v-else class="flex flex-col items-center gap-3 py-10 text-center">
          <UIcon name="i-lucide-file" class="size-10 text-muted" />
          <p class="text-sm font-medium text-highlighted">{{ file?.name }}</p>
          <p v-if="file" class="text-xs text-muted">{{ formatBytes(file.sizeBytes) }}</p>
          <p class="text-sm text-muted">{{ FV.cannotPreview }}</p>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full items-center justify-between gap-3">
        <span v-if="!canPreview" class="text-xs text-muted">{{ FV.cannotPreview }}</span>
        <span v-else />
        <div class="flex gap-2">
          <UButton color="neutral" variant="ghost" icon="i-lucide-download" :disabled="!url" @click="download">
            {{ FV.download }}
          </UButton>
          <UButton color="neutral" variant="soft" @click="emit('update:open', false)">{{ FV.close }}</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>