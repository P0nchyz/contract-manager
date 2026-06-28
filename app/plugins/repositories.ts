// app/plugins/repositories.ts
import { createRepositories } from '~/data/repositories'

/**
 * Builds the repository set from runtimeConfig and provides it as `$repos`.
 * This is where mock vs http is chosen and where token/refresh are wired in.
 */
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const auth = useAuthStore()

  const repos = createRepositories({
    source: config.public.dataSource as 'mock' | 'http',
    baseUrl: config.public.apiBaseUrl as string,
    getAccessToken: () => auth.accessToken,
    onUnauthorized: async () => {
      if (!auth.refreshToken) {
        await auth.logout()
        return null
      }
      try {
        const res = await $fetch<{ accessToken: string; refreshToken: string | null }>(
          `${config.public.apiBaseUrl}/auth/refresh`,
          { method: 'POST', body: { refreshToken: auth.refreshToken } },
        )
        auth.accessToken = res.accessToken
        auth.refreshToken = res.refreshToken
        auth.persist()
        return res.accessToken
      } catch {
        await auth.logout()
        return null
      }
    },
  })

  return { provide: { repos } }
})
