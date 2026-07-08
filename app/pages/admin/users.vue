<!-- app/pages/admin/users.vue -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import { resetMockDb } from '~/data/repositories'
import type { Role } from '~/data/models'

definePageMeta({ requiredPermission: 'admin:users' })

const A = S.admin

const repos = useRepositories()

// ─── Data load ────────────────────────────────────────────────────────────────
const { data, refresh } = await useAsyncData('admin-panel', async () => {
  const [users, corporations] = await Promise.all([
    repos.users.list(),
    repos.corporations.list(),
  ])
  const corpMap: Record<string, string> = {}
  for (const c of corporations) corpMap[c.id] = c.name
  // Superintendent name map for corporations tab
  const supMap: Record<string, string> = {}
  for (const u of users) if (u.role === 'superintendent') supMap[u.id] = u.fullName
  const entities = users.filter((u) => u.role === 'entity')
  return { users, corporations, corpMap, supMap, entities }
})

// ─── Tab state ────────────────────────────────────────────────────────────────
const activeTab = ref<'users' | 'corporations' | 'entities'>('users')

// ─── Role options ─────────────────────────────────────────────────────────────
const ROLE_OPTIONS: { label: string; value: Role }[] = [
  { label: S.roles.entity, value: 'entity' },
  { label: S.roles.resident, value: 'resident' },
  { label: S.roles.superintendent, value: 'superintendent' },
  { label: S.roles.supervisor, value: 'supervisor' },
  { label: S.roles.financial, value: 'financial' },
  { label: S.roles.admin, value: 'admin' },
]

// ─── New user form ─────────────────────────────────────────────────────────────
const showUserForm = ref(false)
const userFullName = ref('')
const userUsername = ref('')
const userPassword = ref('')
const showPassword = ref(false)
const userRole = ref<Role | null>(null)
const userCorpId = ref<string | null>(null)
const userEntityId = ref<string | null>(null)
const userSaving = ref(false)
const userCedula = ref('')
const userError = ref<string | null>(null)

const userErrors = computed(() => ({
  fullName: !userFullName.value.trim() ? A.users.validation.fullNameRequired : null,
  username: !userUsername.value.trim() ? A.users.validation.usernameRequired : null,
  password: !userPassword.value.trim() ? A.users.validation.passwordRequired : null,
  role: !userRole.value ? A.users.validation.roleRequired : null,
  corporation: (userRole.value === 'superintendent' || userRole.value === 'supervisor') && !userCorpId.value
    ? A.users.validation.corporationRequired : null,
  entity: (userRole.value === 'resident' || userRole.value === 'financial') && !userEntityId.value
    ? A.users.validation.entityRequired : null,
}))

const canCreateUser = computed(() =>
  Object.values(userErrors.value).every((e) => e === null),
)

function openUserForm() {
  userFullName.value = ''
  userUsername.value = ''
  userPassword.value = ''
  userRole.value = null
  userCorpId.value = null
  userEntityId.value = null
  userCedula.value = ''
  userError.value = null
  showUserForm.value = true
}

async function createUser() {
  if (!canCreateUser.value || !userRole.value) return
  userSaving.value = true
  userError.value = null
  try {
    await repos.users.create({
      fullName: userFullName.value.trim(),
      username: userUsername.value.trim(),
      password: userPassword.value.trim(),
      email: null,
      role: userRole.value,
      corporationId: (userRole.value === 'superintendent' || userRole.value === 'supervisor') ? userCorpId.value : null,
      entityId: (userRole.value === 'resident' || userRole.value === 'financial') ? userEntityId.value : null,
      cedula: userCedula.value.trim() || null,
    })
    showUserForm.value = false
    await refresh()
  } catch (e) {
    userError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    userSaving.value = false
  }
}

// ─── Delete user ──────────────────────────────────────────────────────────────
const deletingUserId = ref<string | null>(null)
const usersActionError = ref<string | null>(null)

async function deleteUser(user: { id: string; fullName: string }) {
  usersActionError.value = null
  if (!confirm(`${A.users.confirmDelete} "${user.fullName}"?`)) return
  deletingUserId.value = user.id
  try {
    await repos.users.delete(user.id)
    await refresh()
  } catch (e) {
    usersActionError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    deletingUserId.value = null
  }
}

// ─── New entity form ──────────────────────────────────────────────────────────
const showEntityForm = ref(false)
const entityName = ref('')
const entityUsername = ref('')
const entityPassword = ref('')
const showEntityPwd = ref(false)
const entitySaving = ref(false)
const entityError = ref<string | null>(null)

const entityErrors = computed(() => ({
  name: !entityName.value.trim() ? A.entities.validation.nameRequired : null,
  username: !entityUsername.value.trim() ? A.entities.validation.usernameRequired : null,
  password: !entityPassword.value.trim() ? A.entities.validation.passwordRequired : null,
}))
const canCreateEntity = computed(() => Object.values(entityErrors.value).every((e) => e === null))

function openEntityForm() {
  entityName.value = ''; entityUsername.value = ''; entityPassword.value = ''; entityError.value = null
  showEntityForm.value = true
}

async function createEntity() {
  if (!canCreateEntity.value) return
  entitySaving.value = true; entityError.value = null
  try {
    await repos.users.create({ fullName: entityName.value.trim(), username: entityUsername.value.trim(), password: entityPassword.value.trim(), email: null, role: 'entity', corporationId: null, entityId: null })
    showEntityForm.value = false
    await refresh()
  } catch (e) { entityError.value = isRepositoryError(e) ? e.message : S.common.error }
  finally { entitySaving.value = false }
}

// ─── New corporation form ──────────────────────────────────────────────────────
const showCorpForm = ref(false)
const corpName = ref('')
const corpRfc = ref('')
const corpSupId = ref<string | null>(null)
const corpSaving = ref(false)
const corpError = ref<string | null>(null)

const corpErrors = computed(() => ({
  name: !corpName.value.trim() ? A.corporations.validation.nameRequired : null,
}))
const canCreateCorp = computed(() => Object.values(corpErrors.value).every((e) => e === null))

// Only superintendents available as assignable
const superintendents = computed(() =>
  (data.value?.users ?? []).filter((u) => u.role === 'superintendent' && u.active),
)

function openCorpForm() {
  corpName.value = ''
  corpRfc.value = ''
  corpSupId.value = null
  corpError.value = null
  showCorpForm.value = true
}

// ─── Dev: reset mock DB ──────────────────────────────────────────────────────
function resetAndReload() {
  resetMockDb()
  window.location.reload()
}

async function createCorporation() {
  if (!canCreateCorp.value) return
  corpSaving.value = true
  corpError.value = null
  try {
    await repos.corporations.create({
      name: corpName.value.trim(),
      rfc: corpRfc.value.trim() || null,
      superintendentId: corpSupId.value,
    })
    showCorpForm.value = false
    await refresh()
  } catch (e) {
    corpError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    corpSaving.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="admin-users">
    <template #header>
      <UDashboardNavbar :title="A.title">
        <template #right>
          <div class="flex items-center gap-2">
            <UButton icon="i-lucide-rotate-ccw" size="sm" color="neutral" variant="ghost"
              title="Reiniciar datos de prueba" @click="resetAndReload" />
            <UButton v-if="activeTab === 'users'" icon="i-lucide-user-plus" size="sm" @click="openUserForm"> {{
              A.users.new }} </UButton>
            <UButton v-if="activeTab === 'corporations'" icon="i-lucide-building-2" size="sm" @click="openCorpForm"> {{
              A.corporations.new }} </UButton>
            <UButton v-if="activeTab === 'entities'" icon="i-lucide-landmark" size="sm" @click="openEntityForm"> {{
              A.entities.new }} </UButton>
          </div>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <!-- Tabs -->
      <div class="mb-4 flex gap-1 border-b border-default">
        <button v-for="tab in (['users', 'corporations', 'entities'] as const)" :key="tab"
          class="rounded-t-md px-4 py-2 text-sm font-medium transition-colors" :class="activeTab === tab
            ? 'border-b-2 border-primary text-primary'
            : 'text-muted hover:text-default'" @click="activeTab = tab">
          {{ tab === 'users' ? A.tabs.users : tab === 'corporations' ? A.tabs.corporations : A.tabs.entities }}
          <UBadge
            :label="String(tab === 'users' ? (data?.users.filter(u => u.role !== 'entity').length ?? 0) : tab === 'corporations' ? (data?.corporations.length ?? 0) : (data?.entities.length ?? 0))"
            color="neutral" variant="soft" size="xs" class="ml-1.5" />
        </button>
      </div>

      <!-- ─── Users tab ──────────────────────────────────────────────── -->
      <template v-if="activeTab === 'users'">
        <UAlert v-if="usersActionError" class="mb-3" :title="usersActionError" color="error" variant="soft"
          icon="i-lucide-alert-triangle" />

        <div v-if="!data?.users.length" class="py-16 text-center text-sm text-muted">
          {{ A.users.empty }}
        </div>

        <UCard v-else :ui="{ body: 'p-0 sm:p-0' }">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                <tr>
                  <th class="px-4 py-2.5 text-left font-medium">{{ A.users.columns.fullName }}</th>
                  <th class="px-4 py-2.5 text-left font-medium">{{ A.users.columns.username }}</th>
                  <th class="px-4 py-2.5 text-left font-medium">{{ A.users.columns.role }}</th>
                  <th class="px-4 py-2.5 text-left font-medium">{{ A.users.columns.corporation }}</th>
                  <th class="px-4 py-2.5 text-left font-medium">{{ A.users.columns.status }}</th>
                  <th class="px-4 py-2.5 text-right font-medium">{{ A.users.columns.actions }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-for="user in data?.users.filter(u => u.role !== 'entity')" :key="user.id"
                  class="hover:bg-elevated/40 transition-colors">
                  <td class="px-4 py-3 font-medium text-highlighted">{{ user.fullName }}</td>
                  <td class="px-4 py-3 font-mono text-sm text-muted">{{ user.username }}</td>
                  <td class="px-4 py-3">
                    <UBadge :label="S.roles[user.role]" color="neutral" variant="soft" size="sm" />
                  </td>
                  <td class="px-4 py-3 text-muted">
                    {{ user.corporationId ? (data?.corpMap[user.corporationId] ?? '—') : '—' }}
                  </td>
                  <td class="px-4 py-3">
                    <UBadge :label="user.active ? A.users.status.active : A.users.status.inactive"
                      :color="user.active ? 'success' : 'neutral'" variant="soft" size="sm" />
                  </td>
                  <td class="px-4 py-3 text-right">
                    <UButton icon="i-lucide-trash-2" size="xs" color="error" variant="ghost"
                      :loading="deletingUserId === user.id" :title="A.users.delete" @click="deleteUser(user)" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>
      </template>

      <!-- ─── Corporations tab ───────────────────────────────────────── -->
      <template v-else>
        <div v-if="!data?.corporations.length" class="py-16 text-center text-sm text-muted">
          {{ A.corporations.empty }}
        </div>

        <UCard v-else :ui="{ body: 'p-0 sm:p-0' }">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                <tr>
                  <th class="px-4 py-2.5 text-left font-medium">{{ A.corporations.columns.name }}</th>
                  <th class="px-4 py-2.5 text-left font-medium">{{ A.corporations.columns.rfc }}</th>

                  <th class="px-4 py-2.5 text-left font-medium">{{ A.corporations.columns.status }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-for="corp in data?.corporations" :key="corp.id" class="hover:bg-elevated/40 transition-colors">
                  <td class="px-4 py-3 font-medium text-highlighted">{{ corp.name }}</td>
                  <td class="px-4 py-3 font-mono text-sm text-muted">{{ corp.rfc ?? '—' }}</td>

                  <td class="px-4 py-3">
                    <UBadge :label="corp.active ? A.users.status.active : A.users.status.inactive"
                      :color="corp.active ? 'success' : 'neutral'" variant="soft" size="sm" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>
      </template>

      <!-- ─── New user modal ─────────────────────────────────────────── -->

      <!-- ─── New corporation modal ──────────────────────────────────── -->

      <!-- Entities tab -->
      <template v-if="activeTab === 'entities'">
        <UAlert v-if="usersActionError" class="mb-3" :title="usersActionError" color="error" variant="soft"
          icon="i-lucide-alert-triangle" />
        <div v-if="!data?.entities.length" class="py-16 text-center text-sm text-muted">{{ A.entities.empty }}</div>
        <UCard v-else :ui="{ body: 'p-0 sm:p-0' }">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                <tr>
                  <th class="px-4 py-2.5 text-left font-medium">{{ A.entities.columns.name }}</th>
                  <th class="px-4 py-2.5 text-left font-medium">{{ A.entities.columns.username }}</th>
                  <th class="px-4 py-2.5 text-left font-medium">{{ A.entities.columns.status }}</th>
                  <th class="px-4 py-2.5 text-right font-medium">{{ A.users.columns.actions }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-for="ent in data?.entities" :key="ent.id" class="hover:bg-elevated/40 transition-colors">
                  <td class="px-4 py-3 font-medium text-highlighted">{{ ent.fullName }}</td>
                  <td class="px-4 py-3 font-mono text-sm text-muted">{{ ent.username }}</td>
                  <td class="px-4 py-3">
                    <UBadge :label="ent.active ? A.users.status.active : A.users.status.inactive"
                      :color="ent.active ? 'success' : 'neutral'" variant="soft" size="sm" />
                  </td>
                  <td class="px-4 py-3 text-right">
                    <UButton icon="i-lucide-trash-2" size="xs" color="error" variant="ghost"
                      :loading="deletingUserId === ent.id" :title="A.users.delete" @click="deleteUser(ent)" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>
      </template>

      <!-- New entity modal -->

    </template>
  </UDashboardPanel>


  <UModal v-model:open="showUserForm" :title="A.users.form.title">
    <template #body>
      <div class="space-y-4">
        <UFormField :label="A.users.form.fullName">
          <UInput v-model="userFullName" class="w-full" :placeholder="A.users.form.fullNamePlaceholder" />
        </UFormField>

        <UFormField :label="A.users.form.username">
          <UInput v-model="userUsername" class="w-full" :placeholder="A.users.form.usernamePlaceholder"
            autocomplete="off" />
        </UFormField>

        <UFormField :label="A.users.form.password">
          <UInput v-model="userPassword" :type="showPassword ? 'text' : 'password'" class="w-full"
            autocomplete="new-password">
            <template #trailing>
              <UButton :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'" color="neutral" variant="ghost"
                size="xs" @click="showPassword = !showPassword" />
            </template>
          </UInput>
        </UFormField>

        <UFormField :label="A.users.form.role">
          <USelect v-model="userRole" :items="ROLE_OPTIONS" :placeholder="`— ${A.users.form.role} —`" class="w-full" />
        </UFormField>

        <UFormField v-if="userRole === 'superintendent' || userRole === 'supervisor'" :label="A.users.form.corporation"
          :error="userErrors.corporation || undefined">
          <USelect v-model="userCorpId" :items="(data?.corporations ?? []).map((c) => ({ label: c.name, value: c.id }))"
            :placeholder="`— ${A.users.form.corporation} —`" class="w-full" />
        </UFormField>

        <UFormField v-if="userRole === 'resident' || userRole === 'financial'" :label="A.users.form.entity"
          :error="userErrors.entity || undefined">
          <USelect v-model="userEntityId"
            :items="(data?.users ?? []).filter(u => u.role === 'entity').map((u) => ({ label: u.fullName, value: u.id }))"
            :placeholder="`— ${A.users.form.entity} —`" class="w-full" />
        </UFormField>

        <UFormField :label="A.users.form.cedula">
          <UInput v-model="userCedula" class="w-full" :placeholder="A.users.form.cedulaPlaceholder" />
        </UFormField>

        <UAlert v-if="userError" :title="userError" color="error" variant="soft" icon="i-lucide-alert-triangle" />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-3">
        <UButton color="neutral" variant="ghost" @click="showUserForm = false">
          {{ S.common.cancel }}
        </UButton>
        <UButton icon="i-lucide-user-plus" :loading="userSaving" :disabled="!canCreateUser" @click="createUser">
          {{ A.users.form.save }}
        </UButton>
      </div>
    </template>
  </UModal>

  <UModal v-model:open="showCorpForm" :title="A.corporations.form.title">
    <template #body>
      <div class="space-y-4">
        <UFormField :label="A.corporations.form.name" :error="corpErrors.name || undefined">
          <UInput v-model="corpName" class="w-full" :placeholder="A.corporations.form.namePlaceholder" />
        </UFormField>

        <UFormField :label="A.corporations.form.rfc">
          <UInput v-model="corpRfc" class="w-full" :placeholder="A.corporations.form.rfcPlaceholder" />
        </UFormField>



        <UAlert v-if="corpError" :title="corpError" color="error" variant="soft" icon="i-lucide-alert-triangle" />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-3">
        <UButton color="neutral" variant="ghost" @click="showCorpForm = false">
          {{ S.common.cancel }}
        </UButton>
        <UButton icon="i-lucide-building-2" :loading="corpSaving" :disabled="!canCreateCorp" @click="createCorporation">
          {{ A.corporations.form.save }}
        </UButton>
      </div>
    </template>
  </UModal>

  <UModal v-model:open="showEntityForm" :title="A.entities.form.title">
    <template #body>
      <div class="space-y-4">
        <UFormField :label="A.entities.form.name" :error="entityErrors.name || undefined">
          <UInput v-model="entityName" class="w-full" :placeholder="A.entities.form.namePlaceholder" />
        </UFormField>
        <UFormField :label="A.entities.form.username" :error="entityErrors.username || undefined">
          <UInput v-model="entityUsername" class="w-full" :placeholder="A.entities.form.usernamePlaceholder"
            autocomplete="off" />
        </UFormField>
        <UFormField :label="A.entities.form.password" :error="entityErrors.password || undefined">
          <UInput v-model="entityPassword" :type="showEntityPwd ? 'text' : 'password'" class="w-full"
            autocomplete="new-password">
            <template #trailing>
              <UButton :icon="showEntityPwd ? 'i-lucide-eye-off' : 'i-lucide-eye'" color="neutral" variant="ghost"
                size="xs" @click="showEntityPwd = !showEntityPwd" />
            </template>
          </UInput>
        </UFormField>
        <UAlert v-if="entityError" :title="entityError" color="error" variant="soft" icon="i-lucide-alert-triangle" />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-3">
        <UButton color="neutral" variant="ghost" @click="showEntityForm = false">{{ S.common.cancel }}</UButton>
        <UButton icon="i-lucide-landmark" :loading="entitySaving" :disabled="!canCreateEntity" @click="createEntity">{{
          A.entities.form.save }}</UButton>
      </div>
    </template>
  </UModal>
</template>