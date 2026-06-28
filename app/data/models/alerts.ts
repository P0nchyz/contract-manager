// app/data/models/alerts.ts
import type { AlertId, ContractId, UserId } from './common'

// REVIEW: refine the set of alert kinds once we design the Alerts area.
export type AlertKind =
  | 'pending_signature' // something awaits my signature
  | 'estimate_returned' // an estimate came back with notes / rejected
  | 'estimate_approved'
  | 'assignment' // I was assigned to a contract
  | 'generic'

/**
 * A per-user alert. Drives the dot on a contract card in the Main Dashboard
 * and (eventually) an alerts feed.
 */
export interface Alert {
  id: AlertId
  userId: UserId
  contractId: ContractId | null
  kind: AlertKind
  message: string
  read: boolean
  createdAt: Date
}
