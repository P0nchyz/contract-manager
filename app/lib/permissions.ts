// app/lib/permissions.ts
/**
 * Permission policy. Pure, framework-free: `can(role, permission)`. The Nuxt
 * composable `usePermissions()` wraps this with the current user. The backend
 * remains the source of truth; this only gates the UI.
 *
 * Roles are global; contract visibility is handled separately (by assignment).
 */
import type { Role } from '~/data/models'

export type Permission =
  | 'contract:create'
  | 'contract:manage'
  | 'contract:assign'
  | 'estimate:create'
  | 'estimate:view'
  | 'estimate:approve' // approve / return-with-notes (supervisor)
  | 'estimate:reject' // reject (resident)
  | 'estimate:pay' // mark paid (financial)
  | 'logNote:create'
  | 'agreement:create'
  | 'agreement:approve'
  | 'evidence:upload'
  | 'evidence:create'
  | 'file:upload'
  | 'sign'
  | 'close:initiate'
  | 'financial:view'
  | 'admin:users'

const MATRIX: Record<Role, readonly Permission[]> = {
  admin: ['admin:users'],
  resident: [
    'contract:create', 'contract:manage', 'contract:assign',
    'estimate:view', 'estimate:reject',
    'logNote:create', 'agreement:create',
    'evidence:upload', 'evidence:create', 'file:upload',
    'sign', 'close:initiate', 'financial:view',
  ],
  superintendent: [
    'estimate:create', 'estimate:view',
    'logNote:create', 'agreement:create',
    'evidence:upload', 'evidence:create', 'file:upload',
    'sign', 'financial:view',
  ],
  supervisor: [
    'estimate:view', 'estimate:approve',
    'logNote:create', 'agreement:approve',
    'file:upload', 'sign', 'financial:view',
  ],
  financial: ['estimate:view', 'estimate:pay', 'financial:view'],
}

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission)
}

export function permissionsFor(role: Role): readonly Permission[] {
  return MATRIX[role]
}
