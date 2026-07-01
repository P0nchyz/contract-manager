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
import { buildLineItem, buildSummary } from '../../calc/estimate'
import { RepositoryError, notFound } from '../../errors'
import type {
  Alert,
  Concept,
  ConceptSection,
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
import type { ConceptChange, NewConceptDraft, NewSectionDraft } from '../../models/agreements'
import { SIGNING_ROLES } from '../../models'
import type {
  Repositories,
  CreateAgreementInput,
  CreateConceptInput,
  CreateConceptSectionInput,
  NewSectionDraft,
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

// ─── LocalStorage persistence ──────────────────────────────────────────────
// Dates are tagged as { $date: isoString } so they survive JSON round-trips.
const DATE_TAG = '$date'

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) return { [DATE_TAG]: value.toISOString() }
  return value
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && DATE_TAG in (value as object)) {
    return new Date((value as Record<string, string>)[DATE_TAG])
  }
  return value
}

const STORAGE_KEY = 'mock-db-v1'

function saveDb(db: object): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db, replacer))
  } catch {
    // localStorage may be full or unavailable — fail silently
  }
}

function loadDb<T extends object>(fallback: T): T {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw, reviver) as Record<string, unknown>
    // Migrate old schedule shape: items → entries
    if (Array.isArray(parsed.schedules)) {
      for (const s of parsed.schedules as Record<string, unknown>[]) {
        if (s.items && !s.entries) {
          s.entries = s.items
          delete s.items
        }
      }
    }
    return parsed as T
  } catch {
    return fallback
  }
}

// Debounce saves so rapid mutations don't thrash localStorage
let _saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(db: object): void {
  if (_saveTimer) clearTimeout(_saveTimer)
  _saveTimer = setTimeout(() => saveDb(db), 200)
}

// Helper: compute period array for a contract (same logic as buildPeriods in calc/schedule)
function buildContractPeriods(contract: Contract): { start: Date; end: Date }[] {
  const periods: { start: Date; end: Date }[] = []
  let curStart = new Date(contract.startDate)
  const contractEnd = new Date(contract.endDate)
  const periodicity = contract.estimatePeriodicity ?? 'monthly'
  while (curStart <= contractEnd) {
    const y = curStart.getFullYear(), m = curStart.getMonth()
    const lastDay = new Date(y, m + 1, 0)
    const cutoffs = periodicity === 'monthly'
      ? [lastDay]
      : [new Date(y, m, 15), lastDay]
    const cutoff = cutoffs.find((c) => c >= curStart) ?? cutoffs[cutoffs.length - 1]
    const periodEnd = cutoff > contractEnd ? new Date(contractEnd) : new Date(cutoff)
    periods.push({ start: new Date(curStart), end: periodEnd })
    if (periodEnd >= contractEnd) break
    curStart = new Date(periodEnd)
    curStart.setDate(curStart.getDate() + 1)
  }
  return periods
}

export function resetMockDb(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function createMockRepositories(): Repositories {
  // Build the seed fallback, then overlay with any persisted state from localStorage.
  const seedDb = {
    corporations: clone(seed.corporations),
    users: clone(seed.users),
    passwords: { 'U-ADMIN': 'admin', 'U-ENT': 'entidad', 'U-RES': 'resident', 'U-SUP': 'super', 'U-SVR': 'supervisor', 'U-FIN': 'financial' } as Record<string, string>,
    contracts: clone(seed.contracts),
    financials: clone(seed.contractFinancials),
    conceptSections: clone(seed.conceptSections),
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
  const db = loadDb(seedDb)

  // Mock session — set on login; defaults to the resident for convenience.
  let currentUserId: UserId = 'U-RES'
  const currentUser = (): User => {
    const u = db.users.find((x) => x.id === currentUserId)
    if (!u) throw new RepositoryError(401, 'No autenticado', 'unauthenticated')
    return u
  }

  // Persist the db after every mutating operation.
  const save = () => scheduleSave(db)

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
      async login({ username, password }: Credentials) {
        await delay()
        const user = db.users.find((u) => u.username === username && u.active)
        if (!user) throw new RepositoryError(401, 'Credenciales inválidas', 'invalid_credentials')
        const stored = db.passwords[user.id]
        if (stored && password && stored !== password) throw new RepositoryError(401, 'Credenciales inválidas', 'invalid_credentials')
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
            case 'entity':         return c.entityId === u.id
            case 'resident':       return c.residentId === u.id
            case 'superintendent': return c.superintendentId === u.id
            case 'supervisor':     return c.supervisorId === u.id
            case 'financial':      return c.entityId === u.entityId
            default:               return false
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
        const contractId = genId('CT')

        // Create initial sections.
        const createdSections: ConceptSection[] = (input.initialSections ?? []).map((si, i) => ({
          id: genId('CS') as ConceptSection['id'],
          contractId,
          ...si,
          order: si.order ?? i,
        }))
        db.conceptSections.push(...createdSections)
        save()

        // Create initial concepts. sectionId in input is a numeric index string (e.g. "0", "1")
        // pointing into initialSections/createdSections. Resolve it to the generated id.
        const createdConcepts: Concept[] = input.initialConcepts.map((ci) => {
          let resolvedSectionId: ConceptSection['id'] | null = null
          if (ci.sectionId != null) {
            const idxStr = String(ci.sectionId)
            const asIndex = parseInt(idxStr, 10)
            if (!isNaN(asIndex) && createdSections[asIndex]) {
              resolvedSectionId = createdSections[asIndex].id
            } else {
              // fallback: try direct id match
              resolvedSectionId = createdSections.find(s => s.id === ci.sectionId)?.id ?? null
            }
          }
          return { id: genId('CN'), contractId, ...ci, sectionId: resolvedSectionId }
        })
        db.concepts.push(...createdConcepts)
        save()

        const amount = createdConcepts.reduce(
          (s, c) => s + c.unitPrice * c.contractedQuantity,
          0,
        )

        const contract: Contract = {
          id: contractId,
          code: input.code,
          title: input.title,
          status: 'active',
          amount,
          anticipoPercentage: input.anticipoPercentage,
          ivaRate: input.ivaRate,
          retentionPercentage: input.retentionPercentage,
          estimatePeriodicity: input.estimatePeriodicity,
          startDate: input.startDate,
          endDate: input.endDate,
          entityId: currentUserId,
          createdById: currentUserId,
          residentId: input.residentId ?? null,
          superintendentId: input.superintendentId,
          supervisorId: input.supervisorId,
          superintendentCorporationId: input.superintendentCorporationId ?? null,
          supervisorCorporationId: input.supervisorCorporationId ?? null,
          contractorCorporationId: input.superintendentCorporationId ?? input.contractorCorporationId ?? null,
          createdAt: now,
          updatedAt: now,
        }
        db.contracts.push(contract)
        save()

        // Create period-based schedule entries, resolving conceptIndex → conceptId.
        const scheduleEntries = (input.scheduleEntries ?? []).map((se) => ({
          id: genId('SE'),
          contractId,
          conceptId: createdConcepts[se.conceptIndex]?.id ?? null,
          periodIndex: se.periodIndex,
          plannedQuantity: se.plannedQuantity,
        }))
        db.schedules.push({ id: genId('SCH'), contractId, entries: scheduleEntries })
        save()

        // Seed the three predefined folders every new contract gets.
        db.folders.push(
          { id: genId('FD'), contractId, name: 'Documentos del contrato', parentId: null, kind: 'contract',  predefined: true },
          { id: genId('FD'), contractId, name: 'Evidencias',              parentId: null, kind: 'evidence',  predefined: true },
          { id: genId('FD'), contractId, name: 'Comprobantes de pago',    parentId: null, kind: 'payments',  predefined: true },
        )
        save()

        return clone(contract)
      },
      async update(id, patch) {
        await delay()
        const c = db.contracts.find((x) => x.id === id)
        if (!c) throw notFound('Contrato')
        Object.assign(c, patch, { updatedAt: new Date() })
        return clone(c)
      },
      async assignRoles(id, patch) {
        await delay()
        const user = currentUser()
        if (user.role !== 'entity') throw new RepositoryError(403, 'Solo la entidad puede reasignar roles', 'forbidden')
        const c = db.contracts.find((x) => x.id === id)
        if (!c) throw notFound('Contrato')
        if (c.entityId !== user.id) throw new RepositoryError(403, 'Contrato de otra entidad', 'forbidden')
        if (patch.residentId !== undefined)                  c.residentId = patch.residentId ?? null
        if (patch.superintendentId !== undefined)            c.superintendentId = patch.superintendentId ?? null
        if (patch.supervisorId !== undefined)                c.supervisorId = patch.supervisorId ?? null
        if (patch.superintendentCorporationId !== undefined) c.superintendentCorporationId = patch.superintendentCorporationId ?? null
        if (patch.supervisorCorporationId !== undefined)     c.supervisorCorporationId = patch.supervisorCorporationId ?? null
        c.updatedAt = new Date()
        save()
        return clone(c)
      },
      async getFinancials(id) {
        await delay()
        const contract = db.contracts.find((x) => x.id === id)
        if (!contract) throw notFound('Contrato')

        // Compute financials live from estimates so they stay current.
        const estimates = db.estimates.filter((e) => e.contractId === id)
        const concepts  = db.concepts.filter((c) => c.contractId === id)

        // contractedAmount = sum of (unitPrice × contractedQuantity) across catalog
        const contractedAmount = concepts.reduce(
          (s, c) => s + c.unitPrice * c.contractedQuantity, 0,
        )

        // executedAmount = net total of approved + paid estimates
        // paidAmount     = net total of paid estimates only
        let executedAmount = 0
        let paidAmount     = 0
        const physQty: Record<string, number> = {}
        const contracted: Record<string, number> = {}
        for (const c of concepts) contracted[c.id] = c.contractedQuantity

        for (const est of estimates) {
          const isExecuted = est.status === 'approved' || est.status === 'paid'
          const isPaid     = est.status === 'paid'
          if (!isExecuted) continue
          const net = est.summary?.calculations?.total ?? 0
          executedAmount += net
          if (isPaid) paidAmount += net
          for (const li of est.lineItems) {
            if (isExecuted) {
              physQty[li.conceptId] = (physQty[li.conceptId] ?? 0) + li.inThisEstimate
            }
          }
        }

        // physicalProgress = weighted average of concept completion (approved+paid)
        const totalWeight = concepts.reduce((s, c) => s + c.unitPrice * c.contractedQuantity, 0)
        let physicalProgress = 0
        if (totalWeight > 0) {
          for (const c of concepts) {
            const weight     = (c.unitPrice * c.contractedQuantity) / totalWeight
            const done       = Math.min(physQty[c.id] ?? 0, c.contractedQuantity)
            const completion = c.contractedQuantity > 0 ? done / c.contractedQuantity : 0
            physicalProgress += weight * completion * 100
          }
        }

        // financialProgress = paidAmount / contractedAmount
        const financialProgress = contractedAmount > 0
          ? Math.min((paidAmount / contractedAmount) * 100, 100)
          : 0

        const balancePercentage = contractedAmount > 0
          ? Math.min((executedAmount / contractedAmount) * 100, 100)
          : 0

        return {
          contractId: id,
          contractedAmount,
          executedAmount,
          paidAmount,
          balancePercentage: Math.round(balancePercentage * 10) / 10,
          anticipoPercentage: contract.anticipoPercentage,
          anticipoAmount: Math.round(contractedAmount * contract.anticipoPercentage / 100),
          physicalProgress: Math.round(physicalProgress * 10) / 10,
          financialProgress: Math.round(financialProgress * 10) / 10,
        }
      },
    },

    // --- concept catalog ---------------------------------------------------
    concepts: {
      async listByContract(contractId) {
        await delay()
        return clone(db.concepts.filter((c) => c.contractId === contractId))
      },
      async listSectionsByContract(contractId) {
        await delay()
        return clone(
          db.conceptSections
            .filter((s) => s.contractId === contractId)
            .sort((a, b) => a.order - b.order),
        )
      },
      async create(contractId, input: CreateConceptInput) {
        await delay()
        const concept: Concept = { id: genId('CN'), contractId, sectionId: input.sectionId ?? null, ...input }
        db.concepts.push(concept)
        return clone(concept)
      },
      async createSection(contractId, input: CreateConceptSectionInput) {
        await delay()
        const section: ConceptSection = { id: genId('CS') as ConceptSection['id'], contractId, ...input }
        db.conceptSections.push(section)
        save()
        return clone(section)
      },
      async delete(conceptId) {
        await delay()
        const idx = db.concepts.findIndex((c) => c.id === conceptId)
        if (idx === -1) throw notFound('Concepto')
        db.concepts.splice(idx, 1)
      },
    },

    // --- estimates ---------------------------------------------------------
    estimates: {
      async listByContract(contractId) {
        await delay()
        const user = currentUser()
        const list = db.estimates.filter((e) => {
          if (e.contractId !== contractId) return false
          if (user.role === 'financial') return e.status === 'approved' || e.status === 'paid'
          // Drafts are only visible to their creator
          if (e.status === 'draft') return e.createdById === user.id
          return true
        })
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

        // Validate: no other estimate exists for this period
        const duplicate = prior.find((e) => e.periodIndex === input.periodIndex)
        if (duplicate) throw new RepositoryError(409, `Ya existe una estimación para el período ${input.periodIndex}`, 'duplicate_period')

        // Derive period dates from the contract periodicity
        const periods = buildContractPeriods(contract)
        const periodDates = periods[input.periodIndex - 1] // 1-based → 0-based
        if (!periodDates) throw new RepositoryError(400, 'Período inválido', 'invalid_period')
        const periodStart = periodDates.start
        const periodEnd   = periodDates.end

        // upToLast = quantities from all non-rejected, non-draft estimates EXCEPT the current period
        const lineItems = input.lineItems.map((li, i) => {
          const concept = catalog.find((c) => c.id === li.conceptId)
          if (!concept) throw notFound(`Concepto ${li.conceptId}`)
          const upToLast = prior
            .filter((e) => e.status !== 'draft' && e.status !== 'rejected')
            .reduce(
              (s, e) => s + (e.lineItems.find((x) => x.conceptId === li.conceptId)?.inThisEstimate ?? 0),
              0,
            )
          return buildLineItem(concept, li.inThisEstimate, upToLast, i + 1)
        })
        const summary = buildSummary(lineItems, {
          ivaRate: contract.ivaRate ?? 16,
          retentionPercentage: contract.retentionPercentage ?? 5,
          cincoAlMillarRate: 0.5,
          anticipoPercentage: contract.anticipoPercentage,
        })
        const number = input.periodIndex // period number IS the estimate number
        const cover: EstimateCover = {
          contractCode: contract.code,
          contractTitle: contract.title,
          contractorName: corp?.name ?? '',
          contractorCorporationId: contract.contractorCorporationId,
          estimateNumber: number,
          periodIndex: input.periodIndex,
          periodStart,
          periodEnd,
        }
        const now = new Date()
        const estimate: Estimate = {
          id: genId('ES'),
          contractId: input.contractId,
          number,
          periodIndex: input.periodIndex,
          status: 'draft',
          periodStart,
          periodEnd,
          cover,
          lineItems,
          summary,
          signatures: pendingSignatures(),
          history: [event('created')],
          evidenceFileIds: input.evidenceFileIds ?? [],
          linkedLogNoteIds: input.linkedLogNoteIds ?? [],
          createdById: currentUserId,
          createdAt: now,
          updatedAt: now,
        }
        db.estimates.push(estimate)
        save()
        return clone(estimate)
      },
      async updateDraft(id, input) {
        await delay()
        const e = db.estimates.find((x) => x.id === id)
        if (!e) throw notFound('Estimación')
        const EDITABLE = ['draft', 'with_notes'] // rejected is final — cannot be re-edited
        if (!EDITABLE.includes(e.status)) {
          throw new RepositoryError(409, 'Solo se editan borradores o estimaciones devueltas con notas', 'not_editable')
        }
        const wasReturned = e.status === 'with_notes'
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
        e.summary = buildSummary(e.lineItems, {
          ivaRate: contract.ivaRate ?? 16,
          retentionPercentage: contract.retentionPercentage ?? 5,
          cincoAlMillarRate: 0.5,
          anticipoPercentage: contract.anticipoPercentage,
        })
        // periodIndex handled via re-create; dates derived from periodIndex
        if (input.evidenceFileIds) e.evidenceFileIds = input.evidenceFileIds
        if (input.linkedLogNoteIds) e.linkedLogNoteIds = input.linkedLogNoteIds
        // Editing a returned/rejected estimate sends it back to draft (loop closed).
        if (wasReturned) {
          e.status = 'draft'
          e.history.push(event('reopened'))
        }
        e.updatedAt = new Date()
        save()
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
        save()
        return clone(e)
      },
      async sign(id) {
        await delay()
        const e = db.estimates.find((x) => x.id === id)
        if (!e) throw notFound('Estimación')
        // Signing is only allowed on submitted estimates.
        if (e.status !== 'submitted') {
          throw new RepositoryError(409, 'Solo se firma una estimación enviada', 'wrong_status')
        }
        applySignature(e.signatures)
        e.history.push(event('signed'))
        // Auto-approve once every signing slot is filled.
        const allSigned = e.signatures.every((s) => s.status === 'signed')
        if (allSigned) {
          // Sequential approval: all prior period estimates must be approved or paid
          const priorEstimates = db.estimates.filter(
            (x) => x.contractId === e.contractId && x.periodIndex < e.periodIndex,
          )
          const blocked = priorEstimates.find(
            (x) => x.status !== 'approved' && x.status !== 'paid',
          )
          if (blocked) {
            throw new RepositoryError(
              409,
              `La estimación del período ${blocked.periodIndex} debe aprobarse antes que ésta`,
              'sequential_approval',
            )
          }
          e.status = 'approved'
          e.history.push(event('approved'))
        }
        e.updatedAt = new Date()
        save()
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
        save()
        return clone(note)
      },
      async sign(id) {
        await delay()
        const n = db.logNotes.find((x) => x.id === id)
        if (!n) throw notFound('Nota de bitácora')
        applySignature(n.signatures)
        if (n.signatures.every((s) => s.status === 'signed')) n.locked = true
        save()
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
          conceptChanges: input.conceptChanges ?? [],
          newConcepts: input.newConcepts ?? [],
          newSections: input.newSections ?? [],
          newContractStartDate: input.newContractStartDate ?? null,
          newContractEndDate: input.newContractEndDate ?? null,
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
        save()
        return clone(a)
      },
      async update(id, patch) {
        await delay()
        const a = db.agreements.find((x) => x.id === id)
        if (!a) throw notFound('Convenio')
        if (a.status !== 'draft' && a.status !== 'with_notes') {
          throw new RepositoryError(409, 'Solo se editan convenios en borrador o con notas', 'not_editable')
        }
        Object.assign(a, patch, {
          kind: deriveAgreementKind(patch.amountDelta, patch.timeDeltaDays),
          newSections: patch.newSections ?? a.newSections ?? [],
          newContractStartDate: 'newContractStartDate' in patch ? patch.newContractStartDate : a.newContractStartDate,
          newContractEndDate:   'newContractEndDate'   in patch ? patch.newContractEndDate   : a.newContractEndDate,
          updatedAt: new Date(),
        })
        return clone(a)
      },
      async submit(id) {
        return transition(db.agreements, id, 'Convenio', 'submitted', 'submitted')
      },
      async approve(id) {
        await delay()
        const approver = currentUser()
        if (approver.role !== 'entity') throw new RepositoryError(403, 'Solo la entidad puede aprobar convenios', 'forbidden')
        const a = db.agreements.find((x) => x.id === id)
        if (!a) throw notFound('Convenio')
        if (a.status !== 'pending_entity') {
          throw new RepositoryError(409, 'El convenio debe estar pendiente de aprobación de entidad', 'wrong_status')
        }
        a.status = 'approved'
        a.history.push(event('entity_approved'))
        // Apply contract date overrides and new sections/concepts now that entity approved
        const contract = db.contracts.find((c) => c.id === a.contractId)
        if (contract) {
          if (a.newContractStartDate) { contract.startDate = a.newContractStartDate; contract.updatedAt = new Date() }
          if (a.newContractEndDate)   { contract.endDate   = a.newContractEndDate;   contract.updatedAt = new Date() }
        }
        // Create new sections
        const createdAgSections: ConceptSection[] = (a.newSections ?? []).map((ns, i) => {
          const existingCount = db.conceptSections.filter(s => s.contractId === a.contractId).length
          const sec: ConceptSection = {
            id: genId('CS') as ConceptSection['id'],
            contractId: a.contractId,
            specificationNumber: ns.specificationNumber,
            description: ns.description,
            startDate: new Date(),
            endDate: new Date(),
            order: existingCount + i,
          }
          db.conceptSections.push(sec)
          return sec
        })
        // Apply concept changes and new concepts
        for (const change of a.conceptChanges) {
          const concept = db.concepts.find((c) => String(c.id) === String(change.conceptId))
          if (!concept) continue
          if (change.newQuantity != null)  concept.contractedQuantity = change.newQuantity
          if (change.newUnitPrice != null) concept.unitPrice = change.newUnitPrice
        }
        for (const draft of a.newConcepts) {
          const conceptFields = {
            specificationNumber: draft.specificationNumber,
            description: draft.description,
            unit: draft.unit,
            contractedQuantity: draft.contractedQuantity,
            unitPrice: draft.unitPrice,
          }
          const draftSectionId = (draft as typeof draft & { sectionId?: string }).sectionId ?? null
          const resolvedSectionId = draftSectionId
            ? (createdAgSections.find(s => s.id === draftSectionId)?.id ?? draftSectionId)
            : null
          const newConcept = {
            id: genId('CN'),
            contractId: a.contractId,
            sectionId: resolvedSectionId,
            ...conceptFields,
          }
          db.concepts.push(newConcept)
        }
        // Recalculate contract amount
        const allConcepts = db.concepts.filter(c => c.contractId === a.contractId)
        if (contract) {
          contract.amount = allConcepts.reduce((s, c) => s + c.unitPrice * c.contractedQuantity, 0)
        }
        save()
        return clone(a)
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
        if (a.status !== 'submitted') {
          throw new RepositoryError(409, 'Solo se firma un convenio enviado', 'wrong_status')
        }
        applySignature(a.signatures)
        a.history.push(event('signed'))
        const allSigned = a.signatures.every((s) => s.status === 'signed')
        if (allSigned) {
          a.status = 'pending_entity'
          a.history.push(event('pending_entity'))
          // All contract changes (sections, concepts, dates) are applied when the
          // entity explicitly approves via agreements.approve — not here.
        }
        a.updatedAt = new Date()
        save()
        return clone(a)
      },
    },

    // --- reception ---------------------------------------------------------
    reception: makeCloseFlow<ReceptionStatement>(db.reception, 'Acta de recepción', () => currentUserId, pendingSignatures, event, applySignature, 'R'),

    // --- finiquito ---------------------------------------------------------
    finiquito: {
      ...makeCloseFlow<FiniquitoStatement>(db.finiquito, 'Finiquito', () => currentUserId, pendingSignatures, event, applySignature, 'F'),
      async initiate(contractId: string) {
        await delay()
        const rec = db.reception.find((r) => r.contractId === contractId)
        if (!rec || rec.status !== 'approved') {
          throw new RepositoryError(409, 'El acta de recepción debe estar aprobada antes de iniciar el finiquito', 'reception_not_approved')
        }
        const existing = db.finiquito.find((f) => f.contractId === contractId)
        if (existing) throw new RepositoryError(409, 'Ya existe un finiquito para este contrato', 'already_exists')
        const entity: FiniquitoStatement = {
          id: genId('F'),
          contractId,
          status: 'draft',
          signatures: pendingSignatures(),
          history: [event('created')],
          attachmentFileIds: [],
          initiatedById: currentUserId,
          createdAt: new Date(),
        }
        db.finiquito.push(entity)
        save()
        return clone(entity)
      },
    },

    // --- schedule ----------------------------------------------------------
    schedule: {
      async getByContract(contractId) {
        await delay()
        const s = db.schedules.find((x) => x.contractId === contractId)
        if (!s) throw notFound('Programa de obra')
        return clone(s)
      },
      async updateItem(itemId, patch) {
        await delay()
        for (const s of db.schedules) {
          const item = s.items.find((i) => i.id === itemId)
          if (item) {
            Object.assign(item, patch)
            save()
            return clone(item)
          }
        }
        throw notFound('Elemento de programa')
      },
      async create(contractId, items) {
        await delay()
        const schedule = {
          id: genId('SCH'),
          contractId,
          items: items.map((item) => ({ id: genId('SI'), contractId, ...item })),
        }
        db.schedules.push(schedule)
        return clone(schedule)
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
        save()
        return clone(folder)
      },
      async renameFolder(folderId, name) {
        await delay()
        const f = db.folders.find((x) => x.id === folderId)
        if (!f) throw notFound('Carpeta')
        if (f.predefined) throw new RepositoryError(403, 'No se puede renombrar una carpeta predefinida', 'predefined')
        f.name = name
        save()
        return clone(f)
      },
      async deleteFolder(folderId) {
        await delay()
        const f = db.folders.find((x) => x.id === folderId)
        if (!f) throw notFound('Carpeta')
        if (f.predefined) throw new RepositoryError(403, 'No se puede eliminar una carpeta predefinida', 'predefined')
        // Recursively collect all descendant folder ids
        const toDelete = new Set<string>()
        const collect = (id: string) => {
          toDelete.add(id)
          db.folders.filter((x) => x.parentId === id).forEach((x) => collect(x.id))
        }
        collect(folderId)
        db.folders = db.folders.filter((x) => !toDelete.has(x.id))
        save()
        db.files   = db.files.filter((x) => !toDelete.has(x.folderId))
        save()
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
          downloadUrl: '#', // replaced by getDownloadUrl in production
        }
        db.files.push(file)
        save()
        onProgress?.(1)
        return clone(file)
      },
      async remove(fileId) {
        await delay()
        const f = db.files.find((x) => x.id === fileId)
        if (!f) throw notFound('Archivo')
        if (f.uploadedById !== currentUserId) {
          throw new RepositoryError(403, 'Solo puedes eliminar archivos que tú subiste', 'forbidden')
        }
        db.files = db.files.filter((x) => x.id !== fileId)
        save()
      },
      async getDownloadUrl(fileId) {
        await delay()
        const f = db.files.find((x) => x.id === fileId)
        if (!f) throw notFound('Archivo')
        // Simulate a download by creating a Blob with placeholder content.
        // In production this would return a presigned URL.
        const content = `[Mock file: ${f.name} — ${f.sizeBytes} bytes]`
        const blob = new Blob([content], { type: f.mimeType || 'application/octet-stream' })
        return URL.createObjectURL(blob)
      },
    },
    evidence: {
      async listByContract(contractId) {
        await delay()
        return clone(
          db.evidence
            .filter((e) => e.contractId === contractId)
            .sort((a, b) => {
              const ta = a.date ? new Date(a.date).getTime() : 0
              const tb = b.date ? new Date(b.date).getTime() : 0
              return tb - ta
            }),
        )
      },
      async getById(id) {
        await delay()
        const note = db.evidence.find((e) => e.id === id)
        if (!note) throw notFound('Evidencia')
        return clone(note)
      },
      async create(input: CreateEvidenceNoteInput) {
        await delay()
        const note: EvidenceNote = {
          id: genId('EVN'),
          contractId: input.contractId,
          title: input.title,
          body: input.body,
          date: input.date,
          fileIds: input.fileIds ?? [],
          authorId: currentUserId,
          createdAt: new Date(),
        }
        db.evidence.push(note)
        save()
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
        if (a) { a.read = true; save() }
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
        if (db.users.some((u) => u.username === input.username)) {
          throw new RepositoryError(409, 'El nombre de usuario ya existe', 'username_taken')
        }
        const user: User = { id: genId('U'), fullName: input.fullName, username: input.username, email: input.email ?? null, role: input.role, corporationId: input.corporationId ?? null, entityId: input.entityId ?? null, active: true }
        db.users.push(user)
        save()
        if (input.password) db.passwords[user.id] = input.password
        save()
        return clone(user)
      },
      async update(id, patch) {
        await delay()
        const u = db.users.find((x) => x.id === id)
        if (!u) throw notFound('Usuario')
        Object.assign(u, patch)
        save()
        return clone(u)
      },
      async setActive(id, active) {
        await delay()
        const u = db.users.find((x) => x.id === id)
        if (!u) throw notFound('Usuario')
        u.active = active
        save()
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
        const corp: Corporation = { id: genId('CORP'), name: input.name, rfc: input.rfc ?? null, active: true }
        db.corporations.push(corp)
        save()
        return clone(corp)
      },
      async update(id, patch) {
        await delay()
        const c = db.corporations.find((x) => x.id === id)
        if (!c) throw notFound('Corporación')
        Object.assign(c, patch)
        save()
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
    save()
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
      const existing = arr.find((e) => e.contractId === contractId)
      if (existing) throw new RepositoryError(409, 'Ya existe un registro para este contrato', 'already_exists')
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
      save()
      return cloneLocal(entity)
    },
    async submit(id: string) {
      await delayLocal()
      const e = find(id)
      e.status = 'submitted'
      e.history.push(event('submitted'))
      save()
      save()
      return cloneLocal(e)
    },
    async approve(id: string) {
      await delayLocal()
      const user = db.users.find((u) => u.id === me())
      if (user?.role !== 'entity') throw new RepositoryError(403, 'Solo la entidad puede aprobar', 'forbidden')
      const e = find(id)
      if (e.status !== 'pending_entity') throw new RepositoryError(409, 'El documento debe estar pendiente de aprobación de entidad', 'wrong_status')
      e.status = 'approved'
      e.history.push(event('entity_approved'))
      save()
      return cloneLocal(e)
    },
    async returnWithNotes(id: string, note: string) {
      await delayLocal()
      const e = find(id)
      if (e.status !== 'submitted' && e.status !== 'pending_entity') {
        throw new RepositoryError(409, 'Solo se puede devolver un documento enviado o pendiente de aprobación', 'wrong_status')
      }
      e.status = 'with_notes'
      e.history.push(event('returned_with_notes', note))
      save()
      return cloneLocal(e)
    },
    async reject(id: string, note: string) {
      await delayLocal()
      const e = find(id)
      e.status = 'rejected'
      e.history.push(event('rejected', note))
      save()
      save()
      return cloneLocal(e)
    },
    async sign(id: string) {
      await delayLocal()
      const e = find(id)
      if (e.status !== 'submitted') {
        throw new RepositoryError(409, `Solo se firma un ${label} enviado`, 'wrong_status')
      }
      sign(e.signatures)
      e.history.push(event('signed'))
      // All signed → pending entity approval (entity must explicitly approve)
      const allSigned = (e.signatures as Signature[]).every((s) => s.status === 'signed')
      if (allSigned) {
        e.status = 'pending_entity'
        e.history.push(event('pending_entity'))
      }
      save()
      return cloneLocal(e)
    },
  }
}