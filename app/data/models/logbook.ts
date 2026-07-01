// app/data/models/logbook.ts
import type { ContractId, LogNoteId, UserId } from './common'
import type { FileId } from './files'
import type { Signature } from './workflow'

export type LogNoteCategory =
  | 'apertura'          // Apertura de Bitácora — only for opening note
  | 'inicio_trabajos'   // Inicio de Trabajos
  | 'suspension'        // Suspensión de Trabajos
  | 'reanudacion'       // Reanudación de Trabajos
  | 'terminacion'       // Terminación de Trabajos
  | 'cierre'            // Cierre de Bitácora — only for reception note
  | 'estimaciones'      // Estimaciones / Conciliación de Volúmenes
  | 'conceptos_extra'   // Conceptos Extraordinarios / Volúmenes Excedentes
  | 'anticipos'         // Anticipos
  | 'retenciones'       // Retenciones / Sanciones
  | 'ordenes'           // Órdenes e Instrucciones
  | 'calidad'           // Control de Calidad y Laboratorio
  | 'planos'            // Planos y Especificaciones
  | 'seguridad'         // Seguridad e Higiene
  | 'personal'          // Designación / Cambio de Personal Técnico
  | 'minutas'           // Minutas de Trabajo / Visitas de Supervisión

export interface LogNote {
  id: LogNoteId
  contractId: ContractId
  folio: number         // sequential per contract, starts at 1
  category: LogNoteCategory
  title: string
  /**
   * For the opening note: the system-generated fixed block (non-editable).
   * null for all other notes.
   */
  fixedBody: string | null
  /** Free-text body written by the author. */
  customBody: string
  /** True only for folio=1 (Apertura de Bitácora). */
  isOpeningNote: boolean
  authorId: UserId
  signatures: Signature[]
  attachmentFileIds: FileId[]
  locked: boolean       // true once all three roles have signed
  createdAt: Date       // auto-set at creation; also serves as the note date
}