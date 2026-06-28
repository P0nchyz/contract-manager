// app/data/http/client.ts
/**
 * The ONE place that talks HTTP. Adds the base URL + auth header, retries once
 * on 401 via a refresh hook, and normalizes every failure into RepositoryError.
 * Backed by global fetch (in the Nuxt app this can be swapped for $fetch
 * without touching repositories).
 */
import { RepositoryError } from '../errors'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface RequestOptions {
  method?: HttpMethod
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

export interface HttpClient {
  request<T>(path: string, opts?: RequestOptions): Promise<T>
  get<T>(path: string, opts?: RequestOptions): Promise<T>
  post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>
  put<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>
  patch<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>
  delete<T>(path: string, opts?: RequestOptions): Promise<T>
  /** Multipart upload. Backend file endpoints use this. */
  upload<T>(path: string, form: FormData, opts?: RequestOptions): Promise<T>
}

export interface HttpClientConfig {
  baseUrl: string
  /** Current access token, or null when unauthenticated. */
  getAccessToken: () => string | null
  /** Called on a 401; should refresh and return a new token (or null to fail). */
  onUnauthorized?: () => Promise<string | null>
}

function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const url = `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

export function createHttpClient(config: HttpClientConfig): HttpClient {
  async function exec<T>(path: string, opts: RequestOptions, isRetry = false): Promise<T> {
    const isUpload = opts.body instanceof FormData
    const token = config.getAccessToken()
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(isUpload ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    }

    let res: Response
    try {
      res = await fetch(buildUrl(config.baseUrl, path, opts.query), {
        method: opts.method ?? 'GET',
        headers,
        body: isUpload ? (opts.body as FormData) : opts.body != null ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      })
    } catch (e) {
      throw new RepositoryError(0, 'Error de red', 'network_error', e)
    }

    if (res.status === 401 && config.onUnauthorized && !isRetry) {
      const refreshed = await config.onUnauthorized()
      if (refreshed) return exec<T>(path, opts, true)
    }

    if (!res.ok) {
      let details: unknown
      try {
        details = await res.json()
      } catch {
        details = await res.text().catch(() => undefined)
      }
      const code = (details as { code?: string } | undefined)?.code
      const message = (details as { message?: string } | undefined)?.message ?? res.statusText
      throw new RepositoryError(res.status, message, code, details)
    }

    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  const request = <T>(path: string, opts: RequestOptions = {}) => exec<T>(path, opts)

  return {
    request,
    get: (p, opts) => request(p, { ...opts, method: 'GET' }),
    post: (p, body, opts) => request(p, { ...opts, method: 'POST', body }),
    put: (p, body, opts) => request(p, { ...opts, method: 'PUT', body }),
    patch: (p, body, opts) => request(p, { ...opts, method: 'PATCH', body }),
    delete: (p, opts) => request(p, { ...opts, method: 'DELETE' }),
    upload: (p, form, opts) => request(p, { ...opts, method: 'POST', body: form }),
  }
}
