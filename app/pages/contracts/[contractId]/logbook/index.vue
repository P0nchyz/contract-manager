<!-- app/pages/contracts/[contractId]/logbook/index.vue -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { S } from '~/constants/strings'
import type { LogNoteCategory } from '~/data/models'

definePageMeta({ requiredPermission: 'logNote:create' })

const L = S.logNote

const route = useRoute()
const repos = useRepositories()
const { can } = usePermissions()

const contractId = computed(() => route.params.contractId as string)

const { data, status, error, refresh } = await useAsyncData(
  `logbook-${contractId.value}`,
  async () => {
    const [notes, users] = await Promise.all([
      repos.logNotes.listByContract(contractId.value),
      repos.users.list().catch(() => []),
    ])
    const nameOf = (id: string | null | undefined) =>
      (id && users.find((u) => u.id === id)?.fullName) || id || '—'
    return { notes, nameOf }
  },
)

const canCreate = computed(() => can('logNote:create'))

// ─── Opening note state ───────────────────────────────────────────────────────
const openingNote = computed(() => data.value?.notes.find((n) => n.isOpeningNote) ?? null)
const hasOpening = computed(() => !!openingNote.value)

// ─── Filters ─────────────────────────────────────────────────────────────────
const searchText = ref('')
const filterDateFrom = ref('')
const filterDateTo = ref('')
const filterCategory = ref<LogNoteCategory | null>(null)
const filterAuthor = ref<string | null>(null)

const AUTHORS = computed(() => {
  const seen = new Set<string>()
  const list: { label: string; value: string }[] = []
  for (const n of data.value?.notes ?? []) {
    if (!seen.has(n.authorId)) {
      seen.add(n.authorId)
      list.push({ label: data.value!.nameOf(n.authorId), value: n.authorId })
    }
  }
  return list
})

const CATEGORY_OPTIONS = Object.entries(L.categories)
  .filter(([k]) => k !== 'apertura' && k !== 'cierre')
  .map(([value, label]) => ({ label, value }))

const hasActiveFilters = computed(() =>
  !!(searchText.value || filterDateFrom.value || filterDateTo.value || filterCategory.value != null || filterAuthor.value != null),
)

function clearFilters() {
  searchText.value = ''
  filterDateFrom.value = ''
  filterDateTo.value = ''
  filterCategory.value = null
  filterAuthor.value = null
}

const filteredNotes = computed(() => {
  if (!data.value) return []
  const q = searchText.value.toLowerCase()
  const from = filterDateFrom.value ? new Date(`${filterDateFrom.value}T00:00:00`) : null
  const to = filterDateTo.value ? new Date(`${filterDateTo.value}T23:59:59`) : null
  return data.value.notes.filter((n) => {
    if (q && !n.title.toLowerCase().includes(q) && !(n.customBody ?? '').toLowerCase().includes(q) && !(n.fixedBody ?? '').toLowerCase().includes(q)) return false
    const created = new Date(n.createdAt)
    if (from && created < from) return false
    if (to && created > to) return false
    if (filterCategory.value != null && n.category !== filterCategory.value) return false
    if (filterAuthor.value != null && n.authorId !== filterAuthor.value) return false
    return true
  })
})

// ─── Expand/collapse per note ─────────────────────────────────────────────────
// We collapse notes whose combined body > ~800 chars
const COLLAPSE_THRESHOLD = 800
const expanded = ref<Set<string>>(new Set())
function toggle(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
}
function isLong(note: typeof filteredNotes.value[0]) {
  return ((note.fixedBody?.length ?? 0) + (note.customBody?.length ?? 0)) > COLLAPSE_THRESHOLD
}
function isExpanded(id: string) { return expanded.value.has(id) }

function fmt(d: Date | string) {
  return new Date(d).toLocaleString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
</script>

<template>
  <UDashboardPanel id="logbook">
    <template #header>
      <UDashboardNavbar :title="L.title">
        <template #right>
          <UButton v-if="canCreate && hasOpening" icon="i-lucide-plus" size="sm"
            :to="`/contracts/${contractId}/logbook/new`">
            Nueva nota
          </UButton>
          <UButton v-else-if="canCreate && !hasOpening" icon="i-lucide-notebook-pen" size="sm" color="warning"
            :to="`/contracts/${contractId}/logbook/new`">
            Abrir bitácora
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-alert-triangle" :title="S.common.error"
        :actions="[{ label: 'Reintentar', color: 'neutral', variant: 'subtle', onClick: () => refresh() }]" />

      <div v-else-if="status === 'pending'" class="space-y-4">
        <USkeleton v-for="i in 3" :key="i" class="h-40 w-full rounded-xl" />
      </div>

      <template v-else-if="data">
        <!-- ─── Filters ───────────────────────────────────────────────── -->
        <UCard class="mb-4 overflow-visible" :ui="{ body: 'py-3' }">
          <div class="flex flex-wrap gap-3">
            <UInput v-model="searchText" icon="i-lucide-search" :placeholder="L.search.placeholder"
              class="min-w-[14rem] flex-1" />
            <USelect v-model="filterCategory" :items="CATEGORY_OPTIONS" :placeholder="L.search.filterCategory"
              class="w-56" />
            <USelect v-model="filterAuthor" :items="AUTHORS" :placeholder="L.search.filterAuthor" class="w-44" />
            <div class="flex items-center gap-2">
              <UInput v-model="filterDateFrom" type="date" class="w-36" />
              <span class="text-muted text-xs">–</span>
              <UInput v-model="filterDateTo" type="date" class="w-36" />
            </div>
            <UButton v-if="hasActiveFilters" icon="i-lucide-x" color="neutral" variant="ghost" size="sm"
              @click="clearFilters">
              {{ L.search.clearFilters }}
            </UButton>
          </div>
        </UCard>

        <!-- ─── Feed ─────────────────────────────────────────────────── -->
        <div v-if="!filteredNotes.length" class="rounded-xl border border-dashed border-default py-16 text-center">
          <UIcon name="i-lucide-notebook-pen" class="mx-auto mb-3 size-8 text-muted" />
          <p class="text-sm text-muted">{{ hasActiveFilters ? L.search.noResults : L.empty }}</p>
        </div>

        <div v-else class="space-y-4">
          <article v-for="note in filteredNotes" :key="note.id"
            class="rounded-xl border border-default bg-default overflow-hidden">
            <!-- Note header -->
            <div class="flex items-start justify-between gap-3 border-b border-default px-4 py-3"
              :class="note.isOpeningNote ? 'bg-primary/5' : 'bg-elevated/30'">
              <div class="flex items-center gap-3 min-w-0">
                <!-- Folio badge -->
                <span
                  class="shrink-0 rounded-md bg-elevated px-2 py-0.5 font-mono text-xs font-semibold text-highlighted">
                  #{{ note.folio }}
                </span>
                <!-- Category pill -->
                <span class="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  {{ L.categories[note.category] }}
                </span>
                <!-- Title -->
                <NuxtLink :to="`/contracts/${contractId}/logbook/${note.id}`"
                  class="truncate text-sm font-semibold text-highlighted hover:underline">
                  {{ note.title }}
                </NuxtLink>
              </div>
              <!-- Status + date -->
              <div class="shrink-0 flex items-center gap-2">
                <UBadge :label="note.locked ? L.status.locked : L.status.unlocked"
                  :color="note.locked ? 'success' : 'warning'" variant="soft" size="sm" />
                <NuxtLink :to="`/contracts/${contractId}/logbook/${note.id}`"
                  class="text-xs text-muted hover:text-default">
                  <UIcon name="i-lucide-arrow-up-right" class="size-3.5" />
                </NuxtLink>
              </div>
            </div>

            <!-- Body -->
            <div class="px-4 py-3 space-y-2">
              <!-- Fixed block (opening note) -->
              <template v-if="note.fixedBody">
                <p class="text-xs font-semibold uppercase tracking-wide text-muted">{{ L.sections.fixedBody }}</p>
                <p class="whitespace-pre-wrap text-sm text-highlighted"
                  :class="!isExpanded(note.id) && isLong(note) ? 'line-clamp-6' : ''">{{ note.fixedBody }}</p>
              </template>
              <!-- Custom body -->
              <template v-if="note.customBody">
                <p v-if="note.fixedBody" class="text-xs font-semibold uppercase tracking-wide text-muted mt-2">{{
                  L.sections.customBody }}</p>
                <p class="whitespace-pre-wrap text-sm text-highlighted"
                  :class="!isExpanded(note.id) && isLong(note) && !note.fixedBody ? 'line-clamp-6' : ''">{{
                    note.customBody }}</p>
              </template>
              <p v-if="!note.fixedBody && !note.customBody" class="text-sm text-muted italic">Sin contenido.</p>
            </div>

            <!-- Expand/collapse -->
            <div v-if="isLong(note)" class="border-t border-default px-4 py-2">
              <button class="text-xs text-primary hover:underline" @click="toggle(note.id)">
                {{ isExpanded(note.id) ? L.verMenos : L.verMas }}
              </button>
            </div>

            <!-- Footer: author, date, signature chips -->
            <div
              class="flex flex-wrap items-center justify-between gap-3 border-t border-default bg-elevated/30 px-4 py-2.5">
              <div class="flex items-center gap-3 text-xs text-muted">
                <span class="flex items-center gap-1">
                  <UIcon name="i-lucide-user" class="size-3.5" />
                  {{ data.nameOf(note.authorId) }}
                </span>
                <span class="flex items-center gap-1">
                  <UIcon name="i-lucide-clock" class="size-3.5" />
                  {{ fmt(note.createdAt) }}
                </span>
              </div>
              <!-- Signature chips -->
              <div class="flex items-center gap-1.5">
                <div v-for="sig in note.signatures" :key="sig.id"
                  :title="`${S.roles[sig.role]}: ${sig.status === 'signed' ? data.nameOf(sig.userId) : 'pendiente'}`"
                  class="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" :class="sig.status === 'signed'
                    ? 'bg-success/10 text-success'
                    : 'bg-neutral/10 text-muted border border-default'">
                  <UIcon :name="sig.status === 'signed' ? 'i-lucide-badge-check' : 'i-lucide-circle-dashed'"
                    class="size-3" />
                  {{ S.roles[sig.role].slice(0, 3).toUpperCase() }}
                </div>
              </div>
            </div>
          </article>
        </div>
      </template>
    </template>
  </UDashboardPanel>
</template>