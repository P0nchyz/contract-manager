// app/types/nuxt.d.ts
import type { Repositories } from '~/data/repositories'
import type { Permission } from '~/lib/permissions'

declare module '#app' {
  interface NuxtApp {
    $repos: Repositories
  }
  interface PageMeta {
    /** Route reachable without authentication (e.g. /login). */
    public?: boolean
    /** Gate the route behind a permission. */
    requiredPermission?: Permission
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $repos: Repositories
  }
}

export {}
