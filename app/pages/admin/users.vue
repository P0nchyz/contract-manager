<!-- app/pages/admin/users.vue -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
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
  return { users, corporations, corpMap, supMap }
})

// ─── Tab state ────────────────────────────────────────────────────────────────
const activeTab = ref<'users' | 'corporations'>('users')

// ─── Role options ─────────────────────────────────────────────────────────────
const ROLE_OPTIONS: { label: string; value: Role }[] = [
  { label: S.roles.resident,       value: 'resident'       },
  { label: S.roles.superintendent, value: 'superintendent' },
  { label: S.roles.supervisor,     value: 'supervisor'     },
  { label: S.roles.financial,      value: 'financial'      },
  { label: S.roles.admin,          value: 'admin'          },
]

// ─── New user form ─────────────────────────────────────────────────────────────
const showUserForm   = ref(false)
const userFullName   = ref('')
const userUsername   = ref('')
const userPassword   = ref('')
const showPassword   = ref(false)
const userRole       = ref<Role | null>(null)
const userCorpId     = ref<string | null>(null)
const userSaving     = ref(false)
const userError      = ref<string | null>(null)

const userErrors = computed(() => ({
  fullName:    !userFullName.value.trim()  ? A.users.validation.fullNameRequired    : null,
  username:    !userUsername.value.trim()  ? A.users.validation.usernameRequired    : null,
  password:    !userPassword.value.trim()  ? A.users.validation.passwordRequired    : null,
  role:        !userRole.value             ? A.users.validation.roleRequired        : null,
  corporation: userRole.value === 'superintendent' && !userCorpId.value
    ? A.users.validation.corporationRequired : null,
}))

const canCreateUser = computed(() =>
  Object.values(userErrors.value).every((e) => e === null),
)

function openUserForm() {
  userFullName.value = ''
  userUsername.value = ''
  userPassword.value = ''
  userRole.value     = null
  userCorpId.value   = null
  userError.value    = null
  showUserForm.value = true
}

async function createUser() {
  if (!canCreateUser.value || !userRole.value) return
  userSaving.value = true
  userError.value  = null
  try {
    await repos.users.create({
      fullName:      userFullName.value.trim(),
      username:      userUsername.value.trim(),
      password:      userPassword.value.trim(),
      email:         null,
      role:          userRole.value,
      corporationId: userRole.value === 'superintendent' ? userCorpId.value : null,
    })
    showUserForm.value = false
    await refresh()
  } catch (e) {
    userError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    userSaving.value = false
  }
}

// ─── New corporation form ──────────────────────────────────────────────────────
const showCorpForm  = ref(false)
const corpName      = ref('')
const corpRfc       = ref('')
const corpSupId     = ref<string | null>(null)
const corpSaving    = ref(false)
const corpError     = ref<string | null>(null)

const corpErrors = computed(() => ({
  name: !corpName.value.trim() ? A.corporations.validation.nameRequired : null,
}))
const canCreateCorp = computed(() => Object.values(corpErrors.value).every((e) => e === null))

// Only superintendents available as assignable
const superintendents = computed(() =>
  (data.value?.users ?? []).filter((u) => u.role === 'superintendent' && u.active),
)

function openCorpForm() {
  corpName.value   = ''
  corpRfc.value    = ''
  corpSupId.value  = null
  corpError.value  = null
  showCorpForm.value = true
}

async function createCorporation() {
  if (!canCreateCorp.value) return
  corpSaving.value = true
  corpError.value  = null
  try {
    await repos.corporations.create({
      name:             corpName.value.trim(),
      rfc:              corpRfc.value.trim() || null,
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
          <UButton
            v-if="activeTab === 'users'"
            icon="i-lucide-user-plus"
            size="sm"
            @click="openUserForm"
          >
            {{ A.users.new }}
          </UButton>
          <UButton
            v-else
            icon="i-lucide-building-2"
            size="sm"
            @click="openCorpForm"
          >
            {{ A.corporations.new }}
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <!-- Tabs -->
      <div class="mb-4 flex gap-1 border-b border-default">
        <button
          v-for="tab in (['users', 'corporations'] as const)"
          :key="tab"
          class="rounded-t-md px-4 py-2 text-sm font-medium transition-colors"
          :class="activeTab === tab
            ? 'border-b-2 border-primary text-primary'
            : 'text-muted hover:text-default'"
          @click="activeTab = tab"
        >
          {{ tab === 'users' ? A.tabs.users : A.tabs.corporations }}
          <UBadge
            :label="String(tab === 'users' ? (data?.users.length ?? 0) : (data?.corporations.length ?? 0))"
            color="neutral"
            variant="soft"
            size="xs"
            class="ml-1.5"
          />
        </button>
      </div>

      <!-- ─── Users tab ──────────────────────────────────────────────── -->
      <template v-if="activeTab === 'users'">
        <div
          v-if="!data?.users.length"
          class="py-16 text-center text-sm text-muted"
        >
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
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr
                  v-for="user in data?.users"
                  :key="user.id"
                  class="hover:bg-elevated/40 transition-colors"
                >
                  <td class="px-4 py-3 font-medium text-highlighted">{{ user.fullName }}</td>
                  <td class="px-4 py-3 font-mono text-sm text-muted">{{ user.username }}</td>
                  <td class="px-4 py-3">
                    <UBadge
                      :label="S.roles[user.role]"
                      color="neutral"
                      variant="soft"
                      size="sm"
                    />
                  </td>
                  <td class="px-4 py-3 text-muted">
                    {{ user.corporationId ? (data?.corpMap[user.corporationId] ?? '—') : '—' }}
                  </td>
                  <td class="px-4 py-3">
                    <UBadge
                      :label="user.active ? A.users.status.active : A.users.status.inactive"
                      :color="user.active ? 'success' : 'neutral'"
                      variant="soft"
                      size="sm"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>
      </template>

      <!-- ─── Corporations tab ───────────────────────────────────────── -->
      <template v-else>
        <div
          v-if="!data?.corporations.length"
          class="py-16 text-center text-sm text-muted"
        >
          {{ A.corporations.empty }}
        </div>

        <UCard v-else :ui="{ body: 'p-0 sm:p-0' }">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                <tr>
                  <th class="px-4 py-2.5 text-left font-medium">{{ A.corporations.columns.name }}</th>
                  <th class="px-4 py-2.5 text-left font-medium">{{ A.corporations.columns.rfc }}</th>
                  <th class="px-4 py-2.5 text-left font-medium">{{ A.corporations.columns.superintendent }}</th>
                  <th class="px-4 py-2.5 text-left font-medium">{{ A.corporations.columns.status }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr
                  v-for="corp in data?.corporations"
                  :key="corp.id"
                  class="hover:bg-elevated/40 transition-colors"
                >
                  <td class="px-4 py-3 font-medium text-highlighted">{{ corp.name }}</td>
                  <td class="px-4 py-3 font-mono text-sm text-muted">{{ corp.rfc ?? '—' }}</td>
                  <td class="px-4 py-3 text-muted">
                    {{ corp.superintendentId ? (data?.supMap[corp.superintendentId] ?? '—') : '—' }}
                  </td>
                  <td class="px-4 py-3">
                    <UBadge
                      :label="corp.active ? A.users.status.active : A.users.status.inactive"
                      :color="corp.active ? 'success' : 'neutral'"
                      variant="soft"
                      size="sm"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>
      </template>

      <!-- ─── New user modal ─────────────────────────────────────────── -->
      <UModal v-model:open="showUserForm" :title="A.users.form.title">
        <template #body>
          <div class="space-y-4">
            <UFormField :label="A.users.form.fullName">
              <UInput
                v-model="userFullName"
                class="w-full"
                :placeholder="A.users.form.fullNamePlaceholder"
              />
            </UFormField>

            <UFormField :label="A.users.form.username">
              <UInput
                v-model="userUsername"
                class="w-full"
                :placeholder="A.users.form.usernamePlaceholder"
                autocomplete="off"
              />
            </UFormField>

            <UFormField :label="A.users.form.password">
              <UInput
                v-model="userPassword"
                :type="showPassword ? 'text' : 'password'"
                class="w-full"
                autocomplete="new-password"
              >
                <template #trailing>
                  <UButton
                    :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    @click="showPassword = !showPassword"
                  />
                </template>
              </UInput>
            </UFormField>

            <UFormField :label="A.users.form.role">
              <USelect
                v-model="userRole"
                :items="ROLE_OPTIONS"
                :placeholder="`— ${A.users.form.role} —`"
                class="w-full"
              />
            </UFormField>

            <UFormField
              v-if="userRole === 'superintendent'"
              :label="A.users.form.corporation"
            >
              <USelect
                v-model="userCorpId"
                :items="(data?.corporations ?? []).map((c) => ({ label: c.name, value: c.id }))"
                :placeholder="`— ${A.users.form.corporation} —`"
                class="w-full"
              />
            </UFormField>

            <UAlert
              v-if="userError"
              :title="userError"
              color="error"
              variant="soft"
              icon="i-lucide-alert-triangle"
            />
          </div>
        </template>
        <template #footer>
          <div class="flex w-full justify-end gap-3">
            <UButton color="neutral" variant="ghost" @click="showUserForm = false">
              {{ S.common.cancel }}
            </UButton>
            <UButton
              icon="i-lucide-user-plus"
              :loading="userSaving"
              :disabled="!canCreateUser"
              @click="createUser"
            >
              {{ A.users.form.save }}
            </UButton>
          </div>
        </template>
      </UModal>

      <!-- ─── New corporation modal ──────────────────────────────────── -->
      <UModal v-model:open="showCorpForm" :title="A.corporations.form.title">
        <template #body>
          <div class="space-y-4">
            <UFormField :label="A.corporations.form.name" :error="corpErrors.name || undefined">
              <UInput
                v-model="corpName"
                class="w-full"
                :placeholder="A.corporations.form.namePlaceholder"
              />
            </UFormField>

            <UFormField :label="A.corporations.form.rfc">
              <UInput
                v-model="corpRfc"
                class="w-full"
                :placeholder="A.corporations.form.rfcPlaceholder"
              />
            </UFormField>

            <UFormField :label="A.corporations.form.superintendent">
              <USelect
                v-model="corpSupId"
                :items="superintendents.map((u) => ({ label: u.fullName, value: u.id }))"
                :placeholder="`— ${A.corporations.form.superintendent} —`"
                class="w-full"
              />
            </UFormField>

            <UAlert
              v-if="corpError"
              :title="corpError"
              color="error"
              variant="soft"
              icon="i-lucide-alert-triangle"
            />
          </div>
        </template>
        <template #footer>
          <div class="flex w-full justify-end gap-3">
            <UButton color="neutral" variant="ghost" @click="showCorpForm = false">
              {{ S.common.cancel }}
            </UButton>
            <UButton
              icon="i-lucide-building-2"
              :loading="corpSaving"
              :disabled="!canCreateCorp"
              @click="createCorporation"
            >
              {{ A.corporations.form.save }}
            </UButton>
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>