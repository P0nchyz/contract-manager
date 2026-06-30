// app/data/repositories/index.ts
/**
 * The provider switch. ONE flag chooses mock vs http. In the Nuxt app a plugin
 * calls `createRepositories` with values from runtimeConfig and provides the
 * result to the rest of the app (stores/composables), so views import nothing
 * from mock/ or http/ directly.
 */
import { DEFAULT_API_BASE_URL, DEFAULT_DATA_SOURCE, type DataSource } from '../config'
import { createHttpClient, type HttpClient } from '../http/client'
import { createMockRepositories, resetMockDb } from './mock'
import { createHttpRepositories } from './http'
import type { Repositories } from './types'

export interface CreateRepositoriesOptions {
  source?: DataSource
  /** Provide a configured client, or let it build a default from the options. */
  client?: HttpClient
  baseUrl?: string
  getAccessToken?: () => string | null
  onUnauthorized?: () => Promise<string | null>
}

export function createRepositories(opts: CreateRepositoriesOptions = {}): Repositories {
  const source = opts.source ?? DEFAULT_DATA_SOURCE
  if (source === 'mock') return createMockRepositories()

  const client =
    opts.client ??
    createHttpClient({
      baseUrl: opts.baseUrl ?? DEFAULT_API_BASE_URL,
      getAccessToken: opts.getAccessToken ?? (() => null),
      onUnauthorized: opts.onUnauthorized,
    })
  return createHttpRepositories(client)
}

export * from './types'
export { resetMockDb }
