// app/stores/auth.ts
import { defineStore } from 'pinia'
import type { User } from '~/data/models'
import type { Credentials } from '~/data/repositories'

const STORAGE_KEY = 'cm.session'

/**
 * Auth state. Token lives in memory and is persisted to localStorage so a page
 * reload keeps the user signed in (SPA). The repositories plugin reads the
 * access token from here and handles 401 -> refresh.
 */
export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const accessToken = ref<string | null>(null)
  const refreshToken = ref<string | null>(null)

  const isAuthenticated = computed(() => !!user.value && !!accessToken.value)

  function persist() {
    if (!import.meta.client) return
    if (accessToken.value && user.value) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ user: user.value, accessToken: accessToken.value, refreshToken: refreshToken.value }),
      )
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  function hydrate() {
    if (!import.meta.client) return
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const s = JSON.parse(raw)
      user.value = s.user ?? null
      accessToken.value = s.accessToken ?? null
      refreshToken.value = s.refreshToken ?? null
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  async function login(credentials: Credentials) {
    const { $repos } = useNuxtApp()
    const session = await $repos.auth.login(credentials)
    user.value = session.user
    accessToken.value = session.accessToken
    refreshToken.value = session.refreshToken
    persist()
  }

  async function logout() {
    const { $repos } = useNuxtApp()
    try {
      await $repos.auth.logout()
    } catch {
      // ignore — we clear local state regardless
    }
    user.value = null
    accessToken.value = null
    refreshToken.value = null
    persist()
  }

  return { user, accessToken, refreshToken, isAuthenticated, login, logout, hydrate, persist }
})
