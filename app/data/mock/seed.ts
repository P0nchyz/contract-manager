// app/data/mock/seed.ts
/**
 * Representative seed data for development. Typed against the domain models so
 * any model change surfaces here as a type error. The mock repository (built
 * later) reads from this; swapping to the real HTTP client won't touch
 * components or stores.
 *
 * All Money values are INTEGER CENTS (MXN). One fully-populated contract.
 */
import type {
  Alert,
  Concept,
  ConceptSection,
  Contract,
  ContractFinancials,
  Corporation,
  Estimate,
  EvidenceNote,
  FileAsset,
  FiniquitoStatement,
  Folder,
  LogNote,
  ModificationAgreement,
  ReceptionStatement,
  User,
  WorkSchedule,
} from '../models'

const d = (iso: string) => new Date(iso)

// --- Organizations ---------------------------------------------------------
export const corporations: Corporation[] = [
  
]

export const users: User[] = [
  { id: 'U-ADMIN', fullName: 'Ana Admin', username: 'admin', email: 'admin@example.mx', role: 'admin', corporationId: null, active: true }
]

// --- Contract --------------------------------------------------------------
export const contracts: Contract[] = [
  
]

export const contractFinancials: ContractFinancials[] = [
  
]

// --- Concept catalog (unitPrice in cents) ----------------------------------
export const conceptSections: ConceptSection[] = [
  
]

export const concepts: Concept[] = [
  
]

// --- Estimates -------------------------------------------------------------
export const estimates: Estimate[] = [
  
]

// --- Logbook (each signed by resident + superintendent + supervisor) -------
export const logNotes: LogNote[] = [
  
]

// --- Modification agreements ----------------------------------------------
export const agreements: ModificationAgreement[] = [
  
]

// --- Reception / finiquito (separate flows; none started yet) --------------
export const receptionStatements: ReceptionStatement[] = []
export const finiquitoStatements: FiniquitoStatement[] = []

// --- Work schedule (Gantt items + derived S-curve) -------------------------
export const schedules: WorkSchedule[] = [
  
]

// --- Files & evidence ------------------------------------------------------
export const folders: Folder[] = [
  
]

export const files: FileAsset[] = [
  
]

export const evidenceNotes: EvidenceNote[] = [
  
]

// --- Alerts ----------------------------------------------------------------
export const alerts: Alert[] = [
  
]
