// app/data/repositories/http/index.ts
/**
 * HTTP implementation SKELETON. Endpoints and schemas are not yet known, so each
 * method calls the client against a plausible REST path and currently returns
 * the raw payload cast to the domain type.
 *
 * WHEN SCHEMAS LAND, change ONLY this file + `data/dto` + `data/mappers`:
 *   - define the backend DTO types in `data/dto`
 *   - write DTO <-> domain mappers in `data/mappers` (parse ISO dates, convert
 *     money to integer cents, etc.)
 *   - replace each `as Domain` cast below with the matching mapper call
 * Nothing above this layer changes.
 */
import type { HttpClient } from '../../http/client'
import type {
  Alert,
  Concept,
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
} from '../../models'
import type {
  CloseFlowRepository,
  CreateAgreementInput,
  CreateConceptInput,
  CreateContractInput,
  CreateCorporationInput,
  CreateEstimateInput,
  CreateEvidenceNoteInput,
  CreateFolderInput,
  CreateLogNoteInput,
  CreateUserInput,
  Credentials,
  ListParams,
  Repositories,
  UploadFileInput,
  UploadProgress,
} from '../types'

export function createHttpRepositories(http: HttpClient): Repositories {
  const closeFlow = <T>(base: string): CloseFlowRepository<T, string> => ({
    getByContract: (contractId) => http.get<T>(`/contracts/${contractId}/${base}`), // TODO(map)
    initiate: (contractId) => http.post<T>(`/contracts/${contractId}/${base}`), // TODO(map)
    submit: (id) => http.post<T>(`/${base}/${id}/submit`), // TODO(map)
    approve: (id) => http.post<T>(`/${base}/${id}/approve`), // TODO(map)
    returnWithNotes: (id, note) => http.post<T>(`/${base}/${id}/return`, { note }), // TODO(map)
    reject: (id, note) => http.post<T>(`/${base}/${id}/reject`, { note }), // TODO(map)
    sign: (id) => http.post<T>(`/${base}/${id}/sign`), // TODO(map)
  })

  return {
    auth: {
      login: (c: Credentials) => http.post('/auth/login', c), // TODO(map)
      logout: () => http.post<void>('/auth/logout'),
      me: () => http.get<User>('/auth/me'), // TODO(map)
      refresh: (refreshToken) => http.post('/auth/refresh', { refreshToken }),
    },
    contracts: {
      listMine: (p?: ListParams) => http.get<Contract[]>('/contracts', { query: p as never }), // TODO(map)
      getById: (id) => http.get<Contract>(`/contracts/${id}`), // TODO(map)
      create: (input: CreateContractInput) => http.post<Contract>('/contracts', input), // TODO(map)
      update: (id, patch) => http.patch<Contract>(`/contracts/${id}`, patch), // TODO(map)
      getFinancials: (id) => http.get<ContractFinancials>(`/contracts/${id}/financials`), // TODO(map)
    },
    concepts: {
      listByContract: (id) => http.get<Concept[]>(`/contracts/${id}/concepts`), // TODO(map)
      create: (id, input: CreateConceptInput) => http.post<Concept>(`/contracts/${id}/concepts`, input), // TODO(map)
      delete: (id) => http.delete<void>(`/concepts/${id}`), // TODO(map)
    },
    estimates: {
      listByContract: (id, p?: ListParams) => http.get<Estimate[]>(`/contracts/${id}/estimates`, { query: p as never }), // TODO(map)
      getById: (id) => http.get<Estimate>(`/estimates/${id}`), // TODO(map)
      create: (input: CreateEstimateInput) => http.post<Estimate>('/estimates', input), // TODO(map)
      updateDraft: (id, input) => http.put<Estimate>(`/estimates/${id}`, input), // TODO(map)
      submit: (id) => http.post<Estimate>(`/estimates/${id}/submit`), // TODO(map)
      approve: (id) => http.post<Estimate>(`/estimates/${id}/approve`), // TODO(map)
      returnWithNotes: (id, note) => http.post<Estimate>(`/estimates/${id}/return`, { note }), // TODO(map)
      reject: (id, note) => http.post<Estimate>(`/estimates/${id}/reject`, { note }), // TODO(map)
      markPaid: (id, fileId) => http.post<Estimate>(`/estimates/${id}/pay`, { paymentEvidenceFileId: fileId }), // TODO(map)
      sign: (id) => http.post<Estimate>(`/estimates/${id}/sign`), // TODO(map)
    },
    logNotes: {
      listByContract: (id, p?: ListParams) => http.get<LogNote[]>(`/contracts/${id}/log-notes`, { query: p as never }), // TODO(map)
      getById: (id) => http.get<LogNote>(`/log-notes/${id}`), // TODO(map)
      create: (input: CreateLogNoteInput) => http.post<LogNote>('/log-notes', input), // TODO(map)
      sign: (id) => http.post<LogNote>(`/log-notes/${id}/sign`), // TODO(map)
    },
    agreements: {
      listByContract: (id) => http.get<ModificationAgreement[]>(`/contracts/${id}/agreements`), // TODO(map)
      getById: (id) => http.get<ModificationAgreement>(`/agreements/${id}`), // TODO(map)
      create: (input: CreateAgreementInput) => http.post<ModificationAgreement>('/agreements', input), // TODO(map)
      update: (id, patch) => http.put<ModificationAgreement>(`/agreements/${id}`, patch), // TODO(map)
      submit: (id) => http.post<ModificationAgreement>(`/agreements/${id}/submit`), // TODO(map)
      approve: (id) => http.post<ModificationAgreement>(`/agreements/${id}/approve`), // TODO(map)
      returnWithNotes: (id, note) => http.post<ModificationAgreement>(`/agreements/${id}/return`, { note }), // TODO(map)
      reject: (id, note) => http.post<ModificationAgreement>(`/agreements/${id}/reject`, { note }), // TODO(map)
      sign: (id) => http.post<ModificationAgreement>(`/agreements/${id}/sign`), // TODO(map)
    },
    reception: closeFlow<ReceptionStatement>('reception'),
    finiquito: closeFlow<FiniquitoStatement>('finiquito'),
    schedule: {
      getByContract: (id) => http.get<WorkSchedule>(`/contracts/${id}/schedule`), // TODO(map)
    },
    files: {
      listFolders: (id) => http.get<Folder[]>(`/contracts/${id}/folders`), // TODO(map)
      listFiles: (id, folderId) => http.get<FileAsset[]>(`/contracts/${id}/files`, { query: { folderId } }), // TODO(map)
      createFolder: (input: CreateFolderInput) => http.post<Folder>('/folders', input), // TODO(map)
      upload: (input: UploadFileInput, _onProgress?: UploadProgress) => {
        const form = new FormData()
        form.set('contractId', input.contractId)
        form.set('folderId', input.folderId)
        form.set('file', input.file)
        // TODO: progress needs XHR or a streaming body; fetch can't report it.
        return http.upload<FileAsset>('/files', form) // TODO(map)
      },
      renameFolder: (id, name) => http.patch<Folder>(`/folders/${id}`, { name }), // TODO(map)
      deleteFolder: (id) => http.delete<void>(`/folders/${id}`), // TODO(map)
      remove: (id) => http.delete<void>(`/files/${id}`),
      getDownloadUrl: async (id) => (await http.get<{ url: string }>(`/files/${id}/download-url`)).url,
    },
    evidence: {
      listByContract: (id) => http.get<EvidenceNote[]>(`/contracts/${id}/evidence`), // TODO(map)
      create: (input: CreateEvidenceNoteInput) => http.post<EvidenceNote>('/evidence', input), // TODO(map)
    },
    alerts: {
      listMine: () => http.get<Alert[]>('/alerts'), // TODO(map)
      markRead: (id) => http.post<void>(`/alerts/${id}/read`),
    },
    users: {
      list: (p?: ListParams) => http.get<User[]>('/users', { query: p as never }), // TODO(map)
      getById: (id) => http.get<User>(`/users/${id}`), // TODO(map)
      create: (input: CreateUserInput) => http.post<User>('/users', input), // TODO(map)
      update: (id, patch) => http.patch<User>(`/users/${id}`, patch), // TODO(map)
      setActive: (id, active) => http.patch<User>(`/users/${id}`, { active }), // TODO(map)
      setPassword: (id, password) => http.post<void>(`/users/${id}/password`, { password }),
    },
    corporations: {
      list: () => http.get<Corporation[]>('/corporations'), // TODO(map)
      create: (input: CreateCorporationInput) => http.post<Corporation>('/corporations', input), // TODO(map)
      update: (id, patch) => http.patch<Corporation>(`/corporations/${id}`, patch), // TODO(map)
    },
  }
}