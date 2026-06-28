// app/data/repositories/mock/index.ts
/**
 * In-memory mock implementation of every repository, backed by the seed. Clones
 * the seed so mutations don't corrupt it, simulates latency, and runs the real
 * workflow transitions (status changes + appended history + signatures).
 *
 * Faithful to two visibility rules: contract visibility by assignment, and
 * draft estimates visible to the resident only.
 */
import * as seed from '../../mock/seed'
import { buildLineItem, buildSummary, DEFAULT_RATES } from '../../calc/estimate'
import { RepositoryError, notFound } from '../../errors'
import type {
  Alert,
  Concept,
  Contract,
  Estimate,
  EstimateCover,
  FiniquitoStatement,
  LogNote,
  ModificationAgreement,
  ReceptionStatement,
  Signature,
  SigningRole,
  User,
  UserId,
  WorkflowAction,
  WorkflowEvent,
} from '../../models'
import { SIGNING_ROLES } from '../../models'
import type {
  Repositories,
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
  UploadFileInput,
  UploadProgress,
} from '../types'

const delay = (ms = 150) => new Promise<void>((r) => setTimeout(r, ms))
const clone = <T>(v: T): T => structuredClone(v)
const counters: Record<string, number> = {}
const genId = (prefix: string) => `${prefix}-${(counters[prefix] = (counters[prefix] ?? 100) + 1)}`

export function createMockRepositories(): Repositories {
  // Mutable working copies of the seed.
  const db = {
    corporations: clone(seed.corporations),
    users: clone(seed.users),
    contracts: clone(seed.contracts),
    financials: clone(seed.contractFinancials),
    concepts: clone(seed.concepts),
    estimates: clone(seed.estimates),
    logNotes: clone(seed.logNotes),
    agreements: clone(seed.agreements),
    reception: clone(seed.receptionStatements),
    finiquito: clone(seed.finiquitoStatements),
    schedules: clone(seed.schedules),
    folders: clone(seed.folders),
    files: clone(seed.files),
    evidence: clone(seed.evidenceNotes),
    alerts: clone(seed.alerts),
  }

  // Mock session — set on login; defaults to the resident for convenience.
  let currentUserId: UserId = 'U-RES'
  const currentUser = (): User => {
    const u = db.users.find((x) => x.id === currentUserId)
    if (!u) throw new RepositoryError(401, 'No autenticado', 'unauthenticated')
    return u
  }

  // --- workflow helpers ----------------------------------------------------
  const pendingSignatures = (): Signature[] =>
    SIGNING_ROLES.map((role) => ({
      id: genId('SG'),
      role,
      userId: null,
      signedAt: null,
      status: 'pending' as const,
    }))

  const event = (action: WorkflowAction, note?: string): WorkflowEvent => ({
    id: genId('EV'),
    action,
    byUserId: currentUserId,
    at: new Date(),
    note,
  })

  const applySignature = (signatures: Signature[]): Signature[] => {
    const role = currentUser().role
    if (!SIGNING_ROLES.includes(role as SigningRole)) {
      throw new RepositoryError(403, 'Tu rol no firma este documento', 'forbidden')
    }
    const slot = signatures.find((s) => s.role === role)
    if (!slot) throw new RepositoryError(409, 'No hay espacio de firma para tu rol', 'no_slot')
    slot.userId = currentUserId
    slot.signedAt = new Date()
    slot.status = 'signed'
    return signatures
  }

  return {
    // --- auth --------------------------------------------------------------
    auth: {
      async login({ username }: Credentials) {
        await delay()
        const user = db.users.find((u) => u.username === username && u.active)
        if (!user) throw new RepositoryError(401, 'Credenciales inválidas', 'invalid_credentials')
        currentUserId = user.id
        return { user: clone(user), accessToken: `mock.${user.id}`, refreshToken: `mockr.${user.id}` }
      },
      async logout() {
        await delay()
      },
      async me() {
        await delay()
        return clone(currentUser())
      },
      async refresh() {
        await delay()
        return { accessToken: `mock.${currentUserId}`, refreshToken: `mockr.${currentUserId}` }
      },
    },

    // --- contracts ---------------------------------------------------------
    contracts: {
      async listMine() {
        await delay()
        const u = currentUser()
        const mine = db.contracts.filter((c) => {
          switch (u.role) {
            case 'resident': return c.residentId === u.id || c.createdById === u.id
            case 'superintendent': return c.superintendentId === u.id
            case 'supervisor': return c.supervisorId === u.id
            case 'financial': return c.financialId === u.id
            default: return false // admin has no contract access
          }
        })
        return clone(mine)
      },
      async getById(id) {
        await delay()
        const c = db.contracts.find((x) => x.id === id)
        if (!c) throw notFound('Contrato')
        return clone(c)
      },
      async create(input: CreateContractInput) {
        await delay()
        const now = new Date()
        const contract: Contract = {
          id: genId('CT'),
          code: input.code,
          title: input.title,
          status: 'active',
          amount: input.amount,
          anticipoPercentage: input.anticipoPercentage,
          startDate: input.startDate,
          endDate: input.endDate,
          createdById: currentUserId,
          residentId: currentUserId,
          superintendentId: input.superintendentId,
          supervisorId: input.supervisorId,
          financialId: input.financialId,
          contractorCorporationId: input.contractorCorporationId,
          createdAt: now,
          updatedAt: now,
        }
        db.contracts.push(contract)
        return clone(contract)
      },
      async update(id, patch) {
        await delay()
        const c = db.contracts.find((x) => x.id === id)
        if (!c) throw notFound('Contrato')
        Object.assign(c, patch, { updatedAt: new Date() })
        return clone(c)
      },
      async getFinancials(id) {
        await delay()
        const f = db.financials.find((x) => x.contractId === id)
        if (!f) throw notFound('Información financiera')
        return clone(f)
      },
    },

    // --- concept catalog ---------------------------------------------------
    concepts: {
      async listByContract(contractId) {
        await delay()
        return clone(db.concepts.filter((c) => c.contractId === contractId))
      },
      async create(contractId, input: CreateConceptInput) {
        await delay()
        const concept: Concept = { id: genId('CN'), contractId, ...input }
        db.concepts.push(concept)
        return clone(concept)
      },
    },

    // --- estimates ---------------------------------------------------------
    estimates: {
      async listByContract(contractId) {
        await delay()
        const isResident = currentUser().role === 'resident'
        const list = db.estimates.filter(
          (e) => e.contractId === contractId && (isResident || e.status !== 'draft'),
        )
        return clone(list)
      },
      async getById(id) {
        await delay()
        const e = db.estimates.find((x) => x.id === id)
        if (!e) throw notFound('Estimación')
        return clone(e)
      },
      async create(input: CreateEstimateInput) {
        await delay()
        const contract = db.contracts.find((c) => c.id === input.contractId)
        if (!contract) throw notFound('Contrato')
        const corp = db.corporations.find((c) => c.id === contract.contractorCorporationId)
        const catalog = db.concepts.filter((c) => c.contractId === input.contractId)
        const prior = db.estimates.filter((e) => e.contractId === input.contractId)

        const lineItems = input.lineItems.map((li, i) => {
          const concept = catalog.find((c) => c.id === li.conceptId)
          if (!concept) throw notFound(`Concepto ${li.conceptId}`)
          const upToLast = prior.reduce(
            (s, e) => s + (e.lineItems.find((x) => x.conceptId === li.conceptId)?.inThisEstimate ?? 0),
            0,
          )
          return buildLineItem(concept, li.inThisEstimate, upToLast, i + 1)
        })
        const summary = buildSummary(lineItems, {
          ...DEFAULT_RATES,
          anticipoPercentage: contract.anticipoPercentage,
        })
        const number = prior.length + 1
        const cover: EstimateCover = {
          contractCode: contract.code,
          contractTitle: contract.title,
          contractorName: corp?.name ?? '',
          contractorCorporationId: contract.contractorCorporationId,
          estimateNumber: number,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        }
        const now = new Date()
        const estimate: Estimate = {
          id: genId('ES'),
          contractId: input.contractId,
          number,
          status: 'draft',
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          cover,
          lineItems,
          summary,
          signatures: pendingSignatures(),
          history: [event('created')],
          evidenceFileIds: [],
          linkedLogNoteIds: [],
          createdById: currentUserId,
          createdAt: now,
          updatedAt: now,
        }
        db.estimates.push(estimate)
        return clone(estimate)
      },
      async updateDraft(id, input) {
        await delay()
        const e = db.estimates.find((x) => x.id === id)
        if (!e) throw notFound('Estimación')
        if (e.status !== 'draft') throw new RepositoryError(409, 'Solo se editan borradores', 'not_draft')
        const contract = db.contracts.find((c) => c.id === e.contractId)!
        const catalog = db.concepts.filter((c) => c.contractId === e.contractId)
        const prior = db.estimates.filter((x) => x.contractId === e.contractId && x.id !== e.id)
        e.lineItems = input.lineItems.map((li, i) => {
          const concept = catalog.find((c) => c.id === li.conceptId)
          if (!concept) throw notFound(`Concepto ${li.conceptId}`)
          const upToLast = prior.reduce(
            (s, x) => s + (x.lineItems.find((y) => y.conceptId === li.conceptId)?.inThisEstimate ?? 0),
            0,
          )
          return buildLineItem(concept, li.inThisEstimate, upToLast, i + 1)
        })
        e.summary = buildSummary(e.lineItems, { ...DEFAULT_RATES, anticipoPercentage: contract.anticipoPercentage })
        e.periodStart = input.periodStart
        e.periodEnd = input.periodEnd
        e.updatedAt = new Date()
        return clone(e)
      },
      async submit(id) {
        return transition(db.estimates, id, 'Estimación', 'submitted', 'submitted')
      },
      async approve(id) {
        return transition(db.estimates, id, 'Estimación', 'approved', 'approved')
      },
      async returnWithNotes(id, note) {
        return transition(db.estimates, id, 'Estimación', 'with_notes', 'returned_with_notes', note)
      },
      async reject(id, note) {
        return transition(db.estimates, id, 'Estimación', 'rejected', 'rejected', note)
      },
      async markPaid(id, paymentEvidenceFileId) {
        await delay()
        const e = db.estimates.find((x) => x.id === id)
        if (!e) throw notFound('Estimación')
        e.status = 'paid'
        if (paymentEvidenceFileId) e.evidenceFileIds.push(paymentEvidenceFileId)
        e.history.push(event('paid'))
        e.updatedAt = new Date()
        return clone(e)
      },
      async sign(id) {
        await delay()
        const e = db.estimates.find((x) => x.id === id)
        if (!e) throw notFound('Estimación')
        applySignature(e.signatures)
        e.history.push(event('signed'))
        e.updatedAt = new Date()
        return clone(e)
      },
    },

    // --- logbook -----------------------------------------------------------
    logNotes: {
      async listByContract(contractId) {
        await delay()
        return clone(
          db.logNotes.filter((n) => n.contractId === contractId).sort((a, b) => a.folio - b.folio),
        )
      },
      async getById(id) {
        await delay()
        const n = db.logNotes.find((x) => x.id === id)
        if (!n) throw notFound('Nota de bitácora')
        return clone(n)
      },
      async create(input: CreateLogNoteInput) {
        await delay()
        const maxFolio = db.logNotes
          .filter((n) => n.contractId === input.contractId)
          .reduce((m, n) => Math.max(m, n.folio), 0)
        const note: LogNote = {
          id: genId('LN'),
          contractId: input.contractId,
          folio: maxFolio + 1,
          title: input.title,
          date: input.date,
          body: input.body,
          authorId: currentUserId,
          signatures: pendingSignatures(),
          attachmentFileIds: input.attachmentFileIds ?? [],
          locked: false,
          createdAt: new Date(),
        }
        db.logNotes.push(note)
        return clone(note)
      },
      async sign(id) {
        await delay()
        const n = db.logNotes.find((x) => x.id === id)
        if (!n) throw notFound('Nota de bitácora')
        applySignature(n.signatures)
        if (n.signatures.every((s) => s.status === 'signed')) n.locked = true
        return clone(n)
      },
    },

    // --- modification agreements ------------------------------------------
    agreements: {
      async listByContract(contractId) {
        await delay()
        return clone(db.agreements.filter((a) => a.contractId === contractId))
      },
      async getById(id) {
        await delay()
        const a = db.agreements.find((x) => x.id === id)
        if (!a) throw notFound('Convenio')
        return clone(a)
      },
      async create(input: CreateAgreementInput) {
        await delay()
        const a: ModificationAgreement = {
          id: genId('AG'),
          contractId: input.contractId,
          number: db.agreements.filter((x) => x.contractId === input.contractId).length + 1,
          kind: deriveAgreementKind(input.amountDelta, input.timeDeltaDays),
          description: input.description,
          amountDelta: input.amountDelta,
          timeDeltaDays: input.timeDeltaDays,
          status: 'draft',
          signatures: pendingSignatures(),
          history: [event('created')],
          attachmentFileIds: input.attachmentFileIds ?? [],
          createdById: currentUserId,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        db.agreements.push(a)
        return clone(a)
      },
      async update(id, patch) {
        await delay()
        const a = db.agreements.find((x) => x.id === id)
        if (!a) throw notFound('Convenio')
        Object.assign(a, patch, { kind: deriveAgreementKind(patch.amountDelta, patch.timeDeltaDays) })
        return clone(a)
      },
      async submit(id) {
        return transition(db.agreements, id, 'Convenio', 'submitted', 'submitted')
      },
      async approve(id) {
        return transition(db.agreements, id, 'Convenio', 'approved', 'approved')
      },
      async returnWithNotes(id, note) {
        return transition(db.agreements, id, 'Convenio', 'with_notes', 'returned_with_notes', note)
      },
      async reject(id, note) {
        return transition(db.agreements, id, 'Convenio', 'rejected', 'rejected', note)
      },
      async sign(id) {
        await delay()
        const a = db.agreements.find((x) => x.id === id)
        if (!a) throw notFound('Convenio')
        applySignature(a.signatures)
        a.history.push(event('signed'))
        return clone(a)
      },
    },

    // --- reception ---------------------------------------------------------
    reception: makeCloseFlow<ReceptionStatement>(db.reception, 'Acta de recepción', () => currentUserId, pendingSignatures, event, applySignature, 'R'),

    // --- finiquito ---------------------------------------------------------
    finiquito: makeCloseFlow<FiniquitoStatement>(db.finiquito, 'Finiquito', () => currentUserId, pendingSignatures, event, applySignature, 'F'),

    // --- schedule ----------------------------------------------------------
    schedule: {
      async getByContract(contractId) {
        await delay()
        const s = db.schedules.find((x) => x.contractId === contractId)
        if (!s) throw notFound('Programa de obra')
        return clone(s)
      },
    },

    // --- files & evidence --------------------------------------------------
    files: {
      async listFolders(contractId) {
        await delay()
        return clone(db.folders.filter((f) => f.contractId === contractId))
      },
      async listFiles(contractId, folderId) {
        await delay()
        return clone(
          db.files.filter((f) => f.contractId === contractId && (!folderId || f.folderId === folderId)),
        )
      },
      async createFolder(input: CreateFolderInput) {
        await delay()
        const folder = { id: genId('FD'), contractId: input.contractId, name: input.name, parentId: input.parentId, kind: 'custom' as const, predefined: false }
        db.folders.push(folder)
        return clone(folder)
      },
      async upload(input: UploadFileInput, onProgress?: UploadProgress) {
        for (let p = 0.2; p < 1; p += 0.2) {
          await delay(80)
          onProgress?.(p)
        }
        const file = {
          id: genId('FILE'),
          contractId: input.contractId,
          folderId: input.folderId,
          name: input.file.name,
          mimeType: input.file.type,
          sizeBytes: input.file.size,
          uploadedById: currentUserId,
          uploadedAt: new Date(),
          downloadUrl: '#',
        }
        db.files.push(file)
        onProgress?.(1)
        return clone(file)
      },
      async remove(fileId) {
        await delay()
        db.files = db.files.filter((f) => f.id !== fileId)
      },
      async getDownloadUrl(fileId) {
        await delay()
        const f = db.files.find((x) => x.id === fileId)
        if (!f) throw notFound('Archivo')
        return f.downloadUrl
      },
    },
    evidence: {
      async listByContract(contractId) {
        await delay()
        return clone(db.evidence.filter((e) => e.contractId === contractId))
      },
      async create(input: CreateEvidenceNoteInput) {
        await delay()
        const note = { id: genId('EVN'), contractId: input.contractId, title: input.title, body: input.body, fileIds: input.fileIds ?? [], authorId: currentUserId, createdAt: new Date() }
        db.evidence.push(note)
        return clone(note)
      },
    },

    // --- alerts ------------------------------------------------------------
    alerts: {
      async listMine() {
        await delay()
        return clone(db.alerts.filter((a) => a.userId === currentUserId))
      },
      async markRead(id) {
        await delay()
        const a = db.alerts.find((x) => x.id === id)
        if (a) a.read = true
      },
    },

    // --- admin: users & corporations --------------------------------------
    users: {
      async list() {
        await delay()
        return clone(db.users)
      },
      async getById(id) {
        await delay()
        const u = db.users.find((x) => x.id === id)
        if (!u) throw notFound('Usuario')
        return clone(u)
      },
      async create(input: CreateUserInput) {
        await delay()
        const user: User = { id: genId('U'), fullName: input.fullName, username: input.username, email: input.email, role: input.role, corporationId: input.corporationId, active: true }
        db.users.push(user)
        return clone(user)
      },
      async update(id, patch) {
        await delay()
        const u = db.users.find((x) => x.id === id)
        if (!u) throw notFound('Usuario')
        Object.assign(u, patch)
        return clone(u)
      },
      async setActive(id, active) {
        await delay()
        const u = db.users.find((x) => x.id === id)
        if (!u) throw notFound('Usuario')
        u.active = active
        return clone(u)
      },
      async setPassword() {
        await delay()
      },
    },
    corporations: {
      async list() {
        await delay()
        return clone(db.corporations)
      },
      async create(input: CreateCorporationInput) {
        await delay()
        const corp = { id: genId('CORP'), name: input.name, rfc: input.rfc, active: true }
        db.corporations.push(corp)
        return clone(corp)
      },
      async update(id, patch) {
        await delay()
        const c = db.corporations.find((x) => x.id === id)
        if (!c) throw notFound('Corporación')
        Object.assign(c, patch)
        return clone(c)
      },
    },
  }

  // --- generic transition for estimate/agreement ---------------------------
  async function transition<T extends { id: string; status: string; history: WorkflowEvent[]; updatedAt: Date }>(
    arr: T[],
    id: string,
    label: string,
    nextStatus: T['status'],
    action: WorkflowAction,
    note?: string,
  ): Promise<T> {
    await delay()
    const item = arr.find((x) => x.id === id)
    if (!item) throw notFound(label)
    item.status = nextStatus
    item.history.push(event(action, note))
    item.updatedAt = new Date()
    return clone(item)
  }
}

// --- helpers outside the closure ------------------------------------------
function deriveAgreementKind(amountDelta: number | null, timeDeltaDays: number | null) {
  const hasAmount = amountDelta != null && amountDelta !== 0
  const hasTime = timeDeltaDays != null && timeDeltaDays !== 0
  return hasAmount && hasTime ? 'mixed' : hasTime ? 'time' : 'amount'
}

type CloseEntity = ReceptionStatement | FiniquitoStatement
function makeCloseFlow<T extends CloseEntity>(
  arr: T[],
  label: string,
  me: () => UserId,
  pending: () => Signature[],
  event: (a: WorkflowAction, n?: string) => WorkflowEvent,
  sign: (s: Signature[]) => Signature[],
  idPrefix: string,
) {
  const delayLocal = (ms = 150) => new Promise<void>((r) => setTimeout(r, ms))
  const cloneLocal = <V>(v: V): V => structuredClone(v)
  const find = (id: string) => {
    const x = arr.find((e) => e.id === id)
    if (!x) throw notFound(label)
    return x
  }
  return {
    async getByContract(contractId: string) {
      await delayLocal()
      return cloneLocal(arr.find((e) => e.contractId === contractId) ?? null)
    },
    async initiate(contractId: string) {
      await delayLocal()
      const entity = {
        id: genId(idPrefix),
        contractId,
        status: 'draft',
        signatures: pending(),
        history: [event('created')],
        attachmentFileIds: [],
        initiatedById: me(),
        createdAt: new Date(),
      } as unknown as T
      arr.push(entity)
      return cloneLocal(entity)
    },
    async submit(id: string) {
      await delayLocal()
      const e = find(id)
      e.status = 'submitted'
      e.history.push(event('submitted'))
      return cloneLocal(e)
    },
    async approve(id: string) {
      await delayLocal()
      const e = find(id)
      e.status = 'approved'
      e.history.push(event('approved'))
      return cloneLocal(e)
    },
    async returnWithNotes(id: string, note: string) {
      await delayLocal()
      const e = find(id)
      e.status = 'with_notes'
      e.history.push(event('returned_with_notes', note))
      return cloneLocal(e)
    },
    async reject(id: string, note: string) {
      await delayLocal()
      const e = find(id)
      e.status = 'rejected'
      e.history.push(event('rejected', note))
      return cloneLocal(e)
    },
    async sign(id: string) {
      await delayLocal()
      const e = find(id)
      sign(e.signatures)
      e.history.push(event('signed'))
      return cloneLocal(e)
    },
  }
}
