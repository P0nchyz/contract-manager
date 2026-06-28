// app/data/errors.ts
/**
 * Normalized error type. The HTTP client converts transport/HTTP failures into
 * this so the rest of the app handles ONE error shape regardless of backend.
 */
export class RepositoryError extends Error {
  constructor(
    public readonly status: number, // HTTP status, or 0 for network/transport
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'RepositoryError'
  }
}

export const isRepositoryError = (e: unknown): e is RepositoryError =>
  e instanceof RepositoryError

export const notFound = (what: string) =>
  new RepositoryError(404, `${what} no encontrado`, 'not_found')
