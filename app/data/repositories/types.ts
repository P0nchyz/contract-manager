// app/data/repositories/types.ts
/**
 * Repository interfaces — the ONLY surface components and stores depend on.
 * Two implementations satisfy these: `mock` (seed data) and `http` (real API).
 * Swapping between them changes nothing above this layer.
 */
import type {
  Alert,
  AlertId,
  Concept,
  ConceptId,
  ContractId,
  Contract,
  ContractFinancials,
  Corporation,
  CorporationId,
  Estimate,
  EstimateId,
  EvidenceNote,
  EvidenceNoteId,
  FileAsset,
  FileId,
  FiniquitoStatement,
  FiniquitoStatementId,
  Folder,
  FolderId,
  LogNote,
  LogNoteCategory,
  LogNoteId,
  ModificationAgreement,
  AgreementId,
  Money,
  Percentage,
  ReceptionStatement,
  ReceptionStatementId,
  Role,
  User,
  UserId,
  WorkSchedule,
  ConceptScheduleEntry,
  ConceptSection,
  ConceptSectionId,
} from '../models'
import type { AgreementKind, ConceptChange, NewConceptDraft, NewSectionDraft, ScheduleMove } from '../models/agreements'

export interface ListParams {
  page?: number
  pageSize?: number
  search?: string
}

// --- Auth ------------------------------------------------------------------
export interface Credentials {
  username: string
  password: string
}
export interface AuthSession {
  user: User
  accessToken: string
  refreshToken: string | null
}
export interface AuthRepository {
  login(credentials: Credentials): Promise<AuthSession>
  logout(): Promise<void>
  me(): Promise<User>
  refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string | null }>
}

// --- Contracts -------------------------------------------------------------
export interface InitialScheduleEntry {
  /** 0-based index into initialConcepts. */
  conceptIndex: number
  /** 0-based period index. */
  periodIndex: number
  plannedQuantity: number
}

export interface CreateContractInput {
  code: string
  title: string
  // amount is DERIVED from initialConcepts — not supplied by the caller.
  anticipoPercentage: Percentage
  ivaRate: Percentage
  retentionPercentage: Percentage
  estimatePeriodicity: 'monthly' | 'biweekly'
  startDate: Date
  endDate: Date
  residentId: UserId | null
  superintendentId: UserId | null
  supervisorId: UserId | null
  superintendentCorporationId: CorporationId | null
  supervisorCorporationId: CorporationId | null
  contractorCorporationId: CorporationId | null
  initialSections: CreateConceptSectionInput[]
  initialConcepts: CreateConceptInput[]
  scheduleEntries: InitialScheduleEntry[]
}
export interface AssignRolesInput {
  residentId?: UserId | null
  superintendentId?: UserId | null
  supervisorId?: UserId | null
  superintendentCorporationId?: CorporationId | null
  supervisorCorporationId?: CorporationId | null
}

export interface ContractRepository {
  /** Contracts visible to the current user (assignment/creation rules applied). */
  listMine(params?: ListParams): Promise<Contract[]>
  getById(id: ContractId): Promise<Contract>
  create(input: CreateContractInput): Promise<Contract>
  update(id: ContractId, patch: Partial<CreateContractInput>): Promise<Contract>
  assignRoles(id: ContractId, patch: AssignRolesInput): Promise<Contract>
  getFinancials(id: ContractId): Promise<ContractFinancials>
}

// --- Concept catalog -------------------------------------------------------
export interface CreateConceptSectionInput {
  specificationNumber: string
  description: string
  startDate: Date
  endDate: Date
  order: number
}

export interface CreateConceptInput {
  specificationNumber: string
  description: string
  unit: string
  unitPrice: Money
  contractedQuantity: number
  sectionId?: ConceptSectionId | null
}
export interface ConceptRepository {
  listByContract(contractId: ContractId): Promise<Concept[]>
  listSectionsByContract(contractId: ContractId): Promise<ConceptSection[]>
  create(contractId: ContractId, input: CreateConceptInput): Promise<Concept>
  createSection(contractId: ContractId, input: CreateConceptSectionInput): Promise<ConceptSection>
  delete(conceptId: ConceptId): Promise<void>
}

// --- Estimates -------------------------------------------------------------

/** A single measurement row within a Hoja Generadora. */
export interface HojaRowInput {
  id?: string
  quantity: number
  photoFileId?: FileId | null
  fileIds?: FileId[]
  logNoteIds?: LogNoteId[]
}

/** A Hoja Generadora payload (one concept, one or more rows). */
export interface HojaInput {
  id?: string
  conceptId: Concept['id']
  rows: HojaRowInput[]
}

/** Create a draft estimate for a period. Hojas are added via updateDraft. */
export interface CreateEstimateInput {
  contractId: ContractId
  /** 1-based period number. */
  periodIndex: number
  /** Defaults to 'normal'. 'additional' estimates may only contain extra (isExtra) concepts. */
  kind?: 'normal' | 'additional'
}

/** Update a draft estimate's Hojas and/or its whole-estimate photo evidence. */
export interface UpdateEstimateDraftInput {
  hojas: HojaInput[]
  evidenceFileIds?: FileId[]
}

/** Section notes keyed by 'cover' | 'services' | 'summary' | 'evidence' | `hoja:${conceptId}`. At least one must be non-empty. */
export type EstimateRejectNotesInput = Record<string, string>

export interface RequestPaymentInput {
  accountHolder: string
  bankName: string
  accountNumber: string
  clabe: string
  fileIds: FileId[] // at least one required
}

export interface EstimateRepository {
  listByContract(contractId: ContractId, params?: ListParams): Promise<Estimate[]>
  getById(id: EstimateId): Promise<Estimate>
  create(input: CreateEstimateInput): Promise<Estimate> // -> draft
  updateDraft(id: EstimateId, input: UpdateEstimateDraftInput): Promise<Estimate>
  delete(id: EstimateId): Promise<void> // delete a draft
  submit(id: EstimateId): Promise<Estimate>
  approve(id: EstimateId): Promise<Estimate>
  /** Reject with at least one per-section note. Resident or supervisor — only before either has signed. */
  rejectWithNotes(id: EstimateId, notes: EstimateRejectNotesInput): Promise<Estimate>
  /** Superintendent submits account details + docs on an approved estimate, so financial can see it to pay it. */
  requestPayment(id: EstimateId, input: RequestPaymentInput): Promise<Estimate>
  markPaid(id: EstimateId, paymentEvidenceFileId?: FileId): Promise<Estimate> // financial
  sign(id: EstimateId): Promise<Estimate>
}

// --- Logbook ---------------------------------------------------------------
export interface CreateLogNoteInput {
  contractId: ContractId
  category: LogNoteCategory
  title: string
  customBody: string
  residentCedula?: string
  superintendentCedula?: string
}
export interface LogNoteRepository {
  listByContract(contractId: ContractId, params?: ListParams): Promise<LogNote[]>
  getById(id: LogNoteId): Promise<LogNote>
  create(input: CreateLogNoteInput): Promise<LogNote>
  sign(id: LogNoteId): Promise<LogNote>
}

// --- Modification agreements ----------------------------------------------
export interface CreateAgreementInput {
  contractId: ContractId
  kind: AgreementKind // chosen explicitly at the start of the wizard
  description: string
  // Amount-type only:
  conceptChanges: ConceptChange[]
  newConcepts: NewConceptDraft[]
  newSections: NewSectionDraft[]
  // Schedule-type only:
  scheduleMoves: ScheduleMove[]
  // Direct contract date overrides (applied on approval). Schedule-type only.
  newContractStartDate: Date | null
  newContractEndDate: Date | null
  // Aggregate deltas — computed by the form, stored on the model.
  amountDelta: Money | null
  timeDeltaDays: number | null
  attachmentFileIds?: FileId[]
}
export interface AgreementRepository {
  listByContract(contractId: ContractId): Promise<ModificationAgreement[]>
  getById(id: AgreementId): Promise<ModificationAgreement>
  create(input: CreateAgreementInput): Promise<ModificationAgreement>
  update(id: AgreementId, patch: Omit<CreateAgreementInput, 'contractId'>): Promise<ModificationAgreement>
  delete(id: AgreementId): Promise<void> // delete a draft
  submit(id: AgreementId): Promise<ModificationAgreement>
  approve(id: AgreementId): Promise<ModificationAgreement>
  returnWithNotes(id: AgreementId, note: string): Promise<ModificationAgreement>
  reject(id: AgreementId, note: string): Promise<ModificationAgreement>
  sign(id: AgreementId): Promise<ModificationAgreement>
}

// --- Close flows (reception + finiquito share a shape, distinct entities) --
export interface CloseFlowRepository<TEntity, TId> {
  getByContract(contractId: ContractId): Promise<TEntity | null>
  initiate(contractId: ContractId): Promise<TEntity> // resident
  submit(id: TId): Promise<TEntity>
  approve(id: TId): Promise<TEntity>
  returnWithNotes(id: TId, note: string): Promise<TEntity>
  reject(id: TId, note: string): Promise<TEntity>
  sign(id: TId): Promise<TEntity>
}
export type ReceptionRepository = CloseFlowRepository<ReceptionStatement, ReceptionStatementId>
export type FiniquitoRepository = CloseFlowRepository<FiniquitoStatement, FiniquitoStatementId> & {
  /** Update linked files/log notes — only while the finiquito is still a draft. */
  updateAttachments(
    id: FiniquitoStatementId,
    input: { fileIds: FileId[]; logNoteIds: LogNoteId[] },
  ): Promise<FiniquitoStatement>
}

// --- Schedule --------------------------------------------------------------
export interface ScheduleRepository {
  getByContract(contractId: ContractId): Promise<WorkSchedule>
  upsertEntry(contractId: ContractId, conceptId: ConceptId, periodIndex: number, plannedQuantity: number): Promise<void>
}

// --- Files & evidence ------------------------------------------------------
export interface CreateFolderInput {
  contractId: ContractId
  name: string
  parentId: FolderId | null
}
export interface UploadFileInput {
  contractId: ContractId
  folderId: FolderId
  file: File
}
export type UploadProgress = (fraction: number) => void
export interface FileRepository {
  listFolders(contractId: ContractId): Promise<Folder[]>
  listFiles(contractId: ContractId, folderId?: FolderId): Promise<FileAsset[]>
  createFolder(input: CreateFolderInput): Promise<Folder>
  renameFolder(folderId: FolderId, name: string): Promise<Folder>
  deleteFolder(folderId: FolderId): Promise<void>
  upload(input: UploadFileInput, onProgress?: UploadProgress): Promise<FileAsset>
  remove(fileId: FileId): Promise<void>
  getDownloadUrl(fileId: FileId): Promise<string>
}
export interface CreateEvidenceNoteInput {
  contractId: ContractId
  title: string
  body: string
  date: Date
  fileIds?: FileId[]
}
export interface EvidenceRepository {
  listByContract(contractId: ContractId): Promise<EvidenceNote[]>
  getById(id: EvidenceNoteId): Promise<EvidenceNote>
  create(input: CreateEvidenceNoteInput): Promise<EvidenceNote>
}

// --- Alerts ----------------------------------------------------------------
export interface AlertRepository {
  listMine(): Promise<Alert[]>
  markRead(id: AlertId): Promise<void>
}

// --- Admin: users & corporations ------------------------------------------
export interface CreateUserInput {
  fullName: string
  username: string
  email: string | null
  role: Role
  corporationId: CorporationId | null
  entityId?: UserId | null
  cedula?: string | null
  password: string
}
export interface UserRepository {
  list(params?: ListParams): Promise<User[]>
  getById(id: UserId): Promise<User>
  create(input: CreateUserInput): Promise<User>
  update(id: UserId, patch: Partial<Omit<CreateUserInput, 'password'>>): Promise<User>
  setActive(id: UserId, active: boolean): Promise<User>
  setPassword(id: UserId, password: string): Promise<void>
  delete(id: UserId): Promise<void>
}
export interface CreateCorporationInput {
  name: string
  rfc: string | null
}
export interface CorporationRepository {
  list(): Promise<Corporation[]>
  create(input: CreateCorporationInput): Promise<Corporation>
  update(id: CorporationId, patch: Partial<CreateCorporationInput>): Promise<Corporation>
}

// --- Aggregate -------------------------------------------------------------
export interface Repositories {
  auth: AuthRepository
  contracts: ContractRepository
  concepts: ConceptRepository
  estimates: EstimateRepository
  logNotes: LogNoteRepository
  agreements: AgreementRepository
  reception: ReceptionRepository
  finiquito: FiniquitoRepository
  schedule: ScheduleRepository
  files: FileRepository
  evidence: EvidenceRepository
  alerts: AlertRepository
  users: UserRepository
  corporations: CorporationRepository
}