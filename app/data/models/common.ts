// app/data/models/common.ts
/**
 * Shared primitives used across all domain models.
 *
 * These are DOMAIN models — what the app works with internally. The backend's
 * raw DTO shapes live separately in `data/dto`, and `data/mappers` translate
 * between the two, so components/stores never depend on the API shape.
 */

// --- Branded identifiers ---------------------------------------------------
// Nominal typing: every ID is a `string` at runtime, but the compiler won't let
// you pass (e.g.) an EstimateId where a ContractId is expected. Raw strings are
// still assignable, so mock data and mappers need no ceremony.
// (Stricter variant requiring explicit construction is available if you prefer.)
declare const __brand: unique symbol
type Brand<T, B extends string> = T & { readonly [__brand]?: B }

export type UserId = Brand<string, 'UserId'>
export type CorporationId = Brand<string, 'CorporationId'>
export type ContractId = Brand<string, 'ContractId'>
export type ConceptId = Brand<string, 'ConceptId'>
export type ConceptSectionId = Brand<string, 'ConceptSectionId'>
export type EstimateId = Brand<string, 'EstimateId'>
export type LogNoteId = Brand<string, 'LogNoteId'>
export type AgreementId = Brand<string, 'AgreementId'>
export type ReceptionStatementId = Brand<string, 'ReceptionStatementId'>
export type FiniquitoStatementId = Brand<string, 'FiniquitoStatementId'>
export type ScheduleId = Brand<string, 'ScheduleId'>
export type ScheduleItemId = Brand<string, 'ScheduleItemId'>
export type FolderId = Brand<string, 'FolderId'>
export type FileId = Brand<string, 'FileId'>
export type EvidenceNoteId = Brand<string, 'EvidenceNoteId'>
export type AlertId = Brand<string, 'AlertId'>
export type SignatureId = Brand<string, 'SignatureId'>

// --- Money & numbers -------------------------------------------------------
// MXN as INTEGER CENTS (e.g. $1,234.56 -> 123456). Avoids float rounding.
// Formatting helpers (cents <-> display) will live in utils, not here.
export type Money = number
// 0–100.
export type Percentage = number

// --- Roles -----------------------------------------------------------------
export type Role =
  | 'admin'
  | 'resident'
  | 'superintendent'
  | 'supervisor'
  | 'financial'

// Every signable entity is signed by exactly these three roles.
export const SIGNING_ROLES = ['resident', 'superintendent', 'supervisor'] as const
export type SigningRole = (typeof SIGNING_ROLES)[number]

// --- Workflow statuses -----------------------------------------------------
// Estimates carry the full lifecycle (incl. paid).
export type EstimateStatus =
  | 'draft' // dotted border, visible to resident only
  | 'submitted' // empty
  | 'with_notes' // black — returned by supervisor for revision (loops to draft)
  | 'rejected' // red — rejected by resident (loops to draft)
  | 'approved' // green
  | 'paid' // blue

// Modification agreements & close flows: same skeleton, no `paid`.
export type AgreementStatus =
  | 'draft'
  | 'submitted'
  | 'with_notes'
  | 'rejected'
  | 'approved'

// --- Signatures (the "chips") ----------------------------------------------
export interface Signature {
  id: SignatureId
  role: SigningRole // resident | superintendent | supervisor
  userId: UserId | null // who signed (null while pending)
  signedAt: Date | null
  status: 'pending' | 'signed'
}

// --- Immutable workflow history (the "trace") ------------------------------
// Append-only. Surfaces inline when viewing an estimate/agreement so
// returned/rejected notes travel with the item.
export type WorkflowAction =
  | 'created'
  | 'submitted'
  | 'returned_with_notes'
  | 'rejected'
  | 'approved'
  | 'paid'
  | 'signed'
  | 'reopened' // a returned/rejected item edited back into draft

export interface WorkflowEvent {
  id: string
  action: WorkflowAction
  byUserId: UserId
  at: Date
  note?: string // the message shown when returned/rejected with notes
}

// --- Pagination envelope ---------------------------------------------------
export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}