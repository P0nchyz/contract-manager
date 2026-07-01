// app/lib/permissions.ts
/**
 * Permission policy. Pure, framework-free: `can(role, permission)`.
 */
import type { Role } from '~/data/models'

export type Permission =
  | 'contract:create'          // entity creates contracts
  | 'contract:manage'          // entity/resident manage contract details
  | 'contract:assign'          // entity: change resident/super/supervisor on a contract
  | 'estimate:create'          // superintendent creates estimates
  | 'estimate:view'
  | 'estimate:returnWithNotes' // supervisor only
  | 'estimate:reject'          // resident only
  | 'estimate:pay'             // financial only
  | 'logNote:create'
  | 'agreement:create'         // resident + superintendent
  | 'agreement:approve'        // entity approves after all sign
  | 'evidence:upload'
  | 'evidence:create'
  | 'file:upload'
  | 'sign'                     // resident + superintendent + supervisor
  | 'close:initiate'           // entity initiates reception/finiquito
  | 'financial:view'
  | 'admin:users'

const MATRIX: Record<Role, readonly Permission[]> = {
  admin: ['admin:users'],

  entity: [
    'contract:create', 'contract:manage', 'contract:assign',
    'estimate:view',      // needs to see all contract pages
    'logNote:create',
    'agreement:approve',
    'evidence:upload', 'evidence:create', 'file:upload',
    'close:initiate', 'financial:view',
  ],

  resident: [
    'contract:manage',
    'estimate:view', 'estimate:reject',
    'logNote:create', 'agreement:create',
    'evidence:upload', 'evidence:create', 'file:upload',
    'sign', 'financial:view',
  ],

  superintendent: [
    'estimate:create', 'estimate:view',
    'logNote:create', 'agreement:create',
    'evidence:upload', 'evidence:create', 'file:upload',
    'sign', 'financial:view',
  ],

  supervisor: [
    'estimate:view', 'estimate:returnWithNotes',
    'logNote:create',
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