// app/data/config.ts
/**
 * Data-layer configuration. In the Nuxt app these defaults are overridden from
 * runtimeConfig (a Nuxt plugin builds the repositories and provides them).
 */
export type DataSource = 'mock' | 'http'

export const DEFAULT_DATA_SOURCE: DataSource = 'mock'
export const DEFAULT_API_BASE_URL = '/api'
