// app/data/models/organization.ts
import type { CorporationId, Role, UserId } from './common'

/**
 * A registered corporation. Superintendents must belong to one (they represent
 * the contractor). Managed by Admin.
 */
export interface Corporation {
  id: CorporationId
  name: string
  rfc: string | null // Mexican tax ID
  active: boolean
}

/**
 * Application user. Exactly one global role per user. Contract visibility is
 * derived from assignment, not from the role itself. Login is by username.
 */
export interface User {
  id: UserId
  fullName: string
  username: string // login credential
  email: string | null
  role: Role
  // Required when role === 'superintendent'; null otherwise.
  corporationId: CorporationId | null
  active: boolean
}
