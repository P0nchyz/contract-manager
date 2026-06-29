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
  // NOTE: no 'estimate:approve' — signing IS approving.
  // All three signing roles must sign a submitted estimate; once all slots are
  // filled the mock auto-transitions status to 'approved'.
  | 'estimate:returnWithNotes' // supervisor only: return to superintendent for revision
  | 'estimate:reject'          // resident only: permanently reject
  | 'estimate:pay'             // financial only: mark paid
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
    'estimate:view', 'estimate:returnWithNotes',
    'logNote:create', 'agreement:approve',
    'file:upload', 'sign', 'financial:view',
  ],
  // Financial only sees approved/paid estimates (enforced in listByContract).
  financial: ['estimate:view', 'estimate:pay', 'financial:view'],
}

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission)
}

export function permissionsFor(role: Role): readonly Permission[] {
  return MATRIX[role]
}