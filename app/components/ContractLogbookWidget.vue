<!-- app/components/ContractLogbookWidget.vue -->
<script setup lang="ts">
import type { LogNote } from '~/data/models'
import { S } from '~/constants/strings'

const props = defineProps<{ notes: LogNote[]; contractId: string }>()
</script>

<template>
  <UCard :ui="{ body: 'p-0 sm:p-0' }">
    <template #header>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 font-medium">
          <UIcon name="i-lucide-notebook-pen" class="size-4 text-muted" />
          {{ S.contractDashboard.recentLogbook }}
        </div>
        <ULink :to="`/contracts/${props.contractId}/logbook`" class="text-sm text-primary">
          {{ S.contractDashboard.viewAll }}
        </ULink>
      </div>
    </template>

    <p v-if="!notes.length" class="text-sm text-muted p-4">{{ S.contractDashboard.noLogNotes }}</p>

    <ul v-else class="divide-y divide-default">
      <li v-for="note in notes" :key="note.id">
        <ULink :to="`/contracts/${props.contractId}/logbook/${note.id}`"
          class="flex items-center justify-between gap-3 px-4 py-3 hover:bg-elevated/50 transition">
          <div class="min-w-0">
            <p class="font-medium truncate">{{ note.title }}</p>
            <p class="text-xs text-muted">
              {{ S.contractDashboard.folio }} {{ note.folio }} · {{ formatDate(note.createdAt) }}
            </p>
          </div>
          <SignatureChips :signatures="note.signatures" />
        </ULink>
      </li>
    </ul>
  </UCard>
</template>