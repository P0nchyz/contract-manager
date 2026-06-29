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
  ScheduleItem,
  ScheduleItemId,
  ConceptSection,
  ConceptSectionId,
} from '../models'
import type { ConceptChange, NewConceptDraft, NewSectionDraft } from '../models/agreements'

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
export interface InitialScheduleItem {
  // Ties directly to an index in the initialConcepts array (0-based) so
  // the mock can assign the generated ConceptId after creating each concept.
  conceptIndex: number
  startDate: Date
  endDate: Date
}

export interface CreateContractInput {
  code: string
  title: string
  // amount is DERIVED from initialConcepts — not supplied by the caller.
  anticipoPercentage: Percentage
  ivaRate: Percentage            // e.g. 16
  retentionPercentage: Percentage // e.g. 5
  estimatePeriodicity: 'monthly' | 'biweekly'
  startDate: Date
  endDate: Date
  superintendentId: UserId | null
  supervisorId: UserId | null
  financialId: UserId | null
  contractorCorporationId: CorporationId | null
  initialSections: CreateConceptSectionInput[]
  initialConcepts: CreateConceptInput[]
  scheduleItems: InitialScheduleItem[]
}
export interface ContractRepository {
  /** Contracts visible to the current user (assignment/creation rules applied). */
  listMine(params?: ListParams): Promise<Contract[]>
  getById(id: ContractId): Promise<Contract>
  create(input: CreateContractInput): Promise<Contract>
  update(id: ContractId, patch: Partial<CreateContractInput>): Promise<Contract>
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
export interface EstimateLineInput {
  conceptId: Concept['id']
  inThisEstimate: number // the editable quantity; the rest is derived
}
export interface CreateEstimateInput {
  contractId: ContractId
  periodStart: Date
  periodEnd: Date
  lineItems: EstimateLineInput[]
  evidenceFileIds?: FileId[] // linked at creation/edit
  linkedLogNoteIds?: LogNoteId[] // linked at creation/edit
}
export interface EstimateRepository {
  listByContract(contractId: ContractId, params?: ListParams): Promise<Estimate[]>
  getById(id: EstimateId): Promise<Estimate>
  create(input: CreateEstimateInput): Promise<Estimate> // -> draft
  updateDraft(id: EstimateId, input: Omit<CreateEstimateInput, 'contractId'>): Promise<Estimate>
  submit(id: EstimateId): Promise<Estimate>
  approve(id: EstimateId): Promise<Estimate> // supervisor
  returnWithNotes(id: EstimateId, note: string): Promise<Estimate> // supervisor
  reject(id: EstimateId, note: string): Promise<Estimate> // resident
  markPaid(id: EstimateId, paymentEvidenceFileId?: FileId): Promise<Estimate> // financial
  sign(id: EstimateId): Promise<Estimate>
}

// --- Logbook ---------------------------------------------------------------
export interface CreateLogNoteInput {
  contractId: ContractId
  title: string
  date: Date
  body: string
  attachmentFileIds?: FileId[]
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
  description: string
  // Per-concept changes; deltas are derived from these on save.
  conceptChanges: ConceptChange[]
  newConcepts: NewConceptDraft[]
  newSections: NewSectionDraft[]
  // Direct contract date overrides (applied on approval).
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
export type FiniquitoRepository = CloseFlowRepository<FiniquitoStatement, FiniquitoStatementId>

// --- Schedule --------------------------------------------------------------
export interface ScheduleRepository {
  getByContract(contractId: ContractId): Promise<WorkSchedule> // S-curve derived in utils
  updateItem(itemId: ScheduleItemId, patch: Partial<Pick<ScheduleItem, 'startDate' | 'endDate' | 'programmedAmount'>>): Promise<ScheduleItem>
  // Internal — called by contracts.create; not called directly from UI.
  create(contractId: ContractId, items: Omit<ScheduleItem, 'id' | 'contractId'>[]): Promise<WorkSchedule>
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
  password: string
}
export interface UserRepository {
  list(params?: ListParams): Promise<User[]>
  getById(id: UserId): Promise<User>
  create(input: CreateUserInput): Promise<User>
  update(id: UserId, patch: Partial<Omit<CreateUserInput, 'password'>>): Promise<User>
  setActive(id: UserId, active: boolean): Promise<User>
  setPassword(id: UserId, password: string): Promise<void>
}
export interface CreateCorporationInput {
  name: string
  rfc: string | null
  superintendentId: UserId | null
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