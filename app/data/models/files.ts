// app/data/models/files.ts
import type {
  ContractId,
  EvidenceNoteId,
  FileId,
  FolderId,
  UserId,
} from './common'

// Predefined folders exist from the start (e.g. contract files, evidence);
// users may also create their own ('custom').
export type FolderKind = 'contract' | 'evidence' | 'payments' | 'custom'

/**
 * A folder in a contract's file explorer. Supports nesting via parentId.
 */
export interface Folder {
  id: FolderId
  contractId: ContractId
  name: string
  parentId: FolderId | null // null = root
  kind: FolderKind
  predefined: boolean // predefined folders can't be deleted/renamed (REVIEW)
}

/**
 * A stored file. Uploaded directly (multipart) to the backend. Designed around
 * ~5MB typical, but can be large PDFs (hundreds of pages).
 */
export interface FileAsset {
  id: FileId
  contractId: ContractId
  folderId: FolderId
  name: string
  mimeType: string
  sizeBytes: number
  uploadedById: UserId
  uploadedAt: Date
  downloadUrl: string
  // thumbnailUrl?: string  // low priority per our agreement
}

/**
 * An evidence note — separate from logbook notes. Created by Resident or
 * Superintendent, typically grouping images + a description.
 */
export interface EvidenceNote {
  id: EvidenceNoteId
  contractId: ContractId
  title: string
  body: string
  fileIds: FileId[]
  authorId: UserId
  createdAt: Date
}