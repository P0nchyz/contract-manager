// app/data/models/logbook.ts
import type {
  ContractId,
  FileId,
  LogNoteId,
  Signature,
  UserId,
} from './common'

/**
 * A logbook entry (nota de bitácora). The logbook is chronological and
 * immutable: once created/signed it cannot be edited or deleted, and `folio`
 * is sequential per contract.
 */
export interface LogNote {
  id: LogNoteId
  contractId: ContractId
  folio: number // sequential per contract
  title: string
  date: Date
  body: string
  authorId: UserId
  signatures: Signature[] // the chips = who has/hasn't signed
  attachmentFileIds: FileId[]
  locked: boolean // true once immutable (signed)
  createdAt: Date
}
