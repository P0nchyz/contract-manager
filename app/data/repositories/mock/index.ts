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
import { buildLineItems, buildSummary } from '../../calc/estimate'
import { RepositoryError, notFound } from '../../errors'
import type {
  Alert,
  Concept,
  ConceptId,
  ConceptSection,
  ConceptScheduleEntry,
  ContractId,
  Contract,
  Corporation,
  Estimate,
  EstimateCover,
  EvidenceNote,
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
  WorkSchedule,
} from '../../models'
import type { ConceptChange, NewConceptDraft, NewSectionDraft } from '../../models/agreements'
import { SIGNING_ROLES } from '../../models'
import type {
  Repositories,
  AssignRolesInput,
  CreateAgreementInput,
  CreateConceptInput,
  CreateConceptSectionInput,
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

import { putBlob, getBlob, deleteBlob, deleteBlobs, clearAllBlobs } from './blobStore'

const delay = (ms = 150) => new Promise<void>((r) => setTimeout(r, ms))
const clone = <T>(v: T): T => structuredClone(v)
const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024 // 20MB — keeps things sane for browser-side storage
const counters: Record<string, number> = {}
const genId = (prefix: string) => `${prefix}-${(counters[prefix] = (counters[prefix] ?? 100) + 1)}`

// IDs are strings shaped exactly like "PREFIX-123". Since `counters` above is
// only ever kept in memory, it resets to empty on every page load — without
// this, genId() would always start back at 101 for a given prefix even
// though localStorage already has entities using those IDs, causing
// collisions after the very first session. Walk the whole persisted DB once
// at startup and bump each prefix's counter past the highest ID seen.
function seedCountersFromDb(value: unknown, seen: Set<unknown> = new Set()): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) seedCountersFromDb(item, seen)
    return
  }
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (typeof v === 'string') {
      const m = /^([A-Z]+)-(\d+)$/.exec(v)
      if (m) {
        const num = parseInt(m[2]!, 10)
        if (!Number.isNaN(num) && num > (counters[m[1]!] ?? 100)) counters[m[1]!] = num
      }
    } else if (v && typeof v === 'object') {
      seedCountersFromDb(v, seen)
    }
  }
}

// ─── LocalStorage persistence ──────────────────────────────────────────────
// Dates are tagged as { $date: isoString } so they survive JSON round-trips.
const DATE_TAG = '$date'

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) return { [DATE_TAG]: value.toISOString() }
  return value
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && DATE_TAG in (value as object)) {
    return new Date((value as Record<string, string>)[DATE_TAG]!)
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
    // Migrate old estimate shape: ensure hojas/summary/sectionNotes exist
    if (Array.isArray(parsed.estimates)) {
      const emptyCalc = { ivaRate: 16, estimateAmount: 0, estimateIva: 0, estimateTotal: 0, anticipoAmortization: 0, amortizationIva: 0, amortizationTotal: 0, retentions: 0, cincoAlMillarSfp: 0, total: 0 }
      for (const e of parsed.estimates as Record<string, unknown>[]) {
        if (!e.hojas) e.hojas = []
        if (!e.lineItems) e.lineItems = []
        if (!e.summary) e.summary = { partidas: [], partidasSubtotal: 0, calculations: emptyCalc }
        if (!(e.summary as Record<string, unknown>).calculations) (e.summary as Record<string, unknown>).calculations = emptyCalc
        if (!e.sectionNotes) e.sectionNotes = {}
      }
    }
    // Migrate old estimate shape → Hoja-based model
    if (Array.isArray(parsed.estimates)) {
      for (const e of parsed.estimates as Record<string, unknown>[]) {
        if (!Array.isArray(e.hojas)) e.hojas = []
        if (!e.sectionNotes) e.sectionNotes = {}
        if (!e.cover || typeof e.cover !== 'object') {
          e.cover = {
            entityName: '', contractCode: '', contractTitle: '',
            contractStartDate: new Date(), contractorName: '',
            contractorRfc: null, estimateNumber: e.number ?? 0,
            periodIndex: e.periodIndex ?? 1,
            periodStart: e.periodStart ?? new Date(),
            periodEnd: e.periodEnd ?? new Date(),
          }
        } else {
          const cov = e.cover as Record<string, unknown>
          if (!cov.entityName) cov.entityName = ''
          if (!cov.contractStartDate) cov.contractStartDate = new Date()
          if (cov.contractorRfc === undefined) cov.contractorRfc = null
        }
        if (!e.summary || typeof e.summary !== 'object') {
          e.summary = { partidas: [], partidasSubtotal: 0, calculations: { ivaRate: 16, estimateAmount: 0, estimateIva: 0, estimateTotal: 0, anticipoAmortization: 0, amortizationIva: 0, amortizationTotal: 0, retentions: 0, cincoAlMillarSfp: 0, total: 0 } }
        } else {
          const sum = e.summary as Record<string, unknown>
          if (!Array.isArray(sum.partidas)) sum.partidas = []
          if (typeof sum.partidasSubtotal !== 'number') sum.partidasSubtotal = (sum as any).conceptSummary?.subtotal ?? 0
          // Migrate calculations.rows → no longer needed
          if (sum.calculations && typeof sum.calculations === 'object') {
            delete (sum.calculations as Record<string, unknown>).rows
          }
        }
        if (!Array.isArray(e.lineItems)) e.lineItems = []
        if (!Array.isArray(e.evidenceFileIds)) e.evidenceFileIds = []
        // with_notes was merged into rejected (both now carry per-section notes)
        if (e.status === 'with_notes') e.status = 'rejected'
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
    const cutoff = cutoffs.find((c) => c >= curStart) ?? cutoffs[cutoffs.length - 1]!
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
  clearAllBlobs().catch(() => { /* best-effort — nothing else to do if this fails */ })
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
  seedCountersFromDb(db)

  // Mock session — set on login; defaults to the resident for convenience.
  let currentUserId: UserId = 'U-RES'
  // Tracks the most recently created object URL per file, so a repeat
  // getDownloadUrl() call revokes the old one instead of leaking it.
  const activeObjectUrls = new Map<string, string>()
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
  // Sign the creator's own slot automatically on creation/send — silently
  // skipped for roles that don't have a signing slot (e.g. entity).
  const trySignAsCreator = (signatures: Signature[]): void => {
    if (SIGNING_ROLES.includes(currentUser().role as SigningRole)) applySignature(signatures)
  }

  // --- estimate approval sequencing ----------------------------------------
  // An estimate can only become APPROVED once every earlier period in the
  // same contract has at least one APPROVED/paid estimate. Submitting and
  // signing are never blocked by this — only the final approval transition.
  function priorPeriodsApproved(contractId: string, periodIndex: number): boolean {
    for (let p = 1; p < periodIndex; p++) {
      const ok = db.estimates.some(
        (x) => x.contractId === contractId && x.periodIndex === p && (x.status === 'approved' || x.status === 'paid'),
      )
      if (!ok) return false
    }
    return true
  }
  // Approves `e` if it's fully signed and every prior period already has an
  // approved/paid estimate; otherwise leaves it at 'submitted' (fully signed,
  // pending) with no error — the signer's own signature still succeeded.
  function tryApproveEstimate(e: Estimate): void {
    if (e.status !== 'submitted') return
    if (!e.signatures.every((s) => s.status === 'signed')) return
    if (!priorPeriodsApproved(e.contractId, e.periodIndex)) return
    e.status = 'approved'
    e.history.push(event('approved'))
    promoteFollowingEstimates(e.contractId, e.periodIndex)
  }
  // Once `fromPeriodIndex` gets approved, any later period's estimate that
  // was already fully signed but held pending may now also clear.
  function promoteFollowingEstimates(contractId: string, fromPeriodIndex: number): void {
    const followers = db.estimates
      .filter((x) => x.contractId === contractId && x.periodIndex > fromPeriodIndex && x.status === 'submitted')
      .sort((a, b) => a.periodIndex - b.periodIndex)
    for (const f of followers) tryApproveEstimate(f)
  }

  // --- estimate derivation helpers (closures; no `this` binding) ----------
  function upToLastByConcept(
    contractId: string,
    periodIndex: number,
    excludeId: string,
  ): Record<string, number> {
    const map: Record<string, number> = {}
    for (const e of db.estimates) {
      if (e.contractId !== contractId) continue
      if (e.id === excludeId) continue
      if (e.periodIndex >= periodIndex) continue
      if (e.status !== 'approved' && e.status !== 'paid') continue
      for (const li of (e.lineItems ?? [])) {
        map[String(li.conceptId)] = (map[String(li.conceptId)] ?? 0) + li.inThisEstimate
      }
    }
    return map
  }
  function recomputeEstimate(e: Estimate): void {
    const contract = db.contracts.find((c) => c.id === e.contractId)
    const catalog = db.concepts.filter((c) => c.contractId === e.contractId)
    const sections = db.conceptSections.filter((s) => s.contractId === e.contractId)
    const upToLast = upToLastByConcept(e.contractId, e.periodIndex, e.id)
    const safeHojas = e.hojas ?? []
    e.lineItems = buildLineItems(safeHojas, catalog, upToLast)
    e.summary = buildSummary(e.lineItems, safeHojas, sections, {
      ivaRate: contract?.ivaRate ?? 16,
      retentionPercentage: contract?.retentionPercentage ?? 5,
      cincoAlMillarRate: 0.5,
      anticipoPercentage: contract?.anticipoPercentage ?? 0,
    })
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
          conceptId: createdConcepts[se.conceptIndex]?.id ?? ('' as ConceptId),
          periodIndex: se.periodIndex,
          plannedQuantity: se.plannedQuantity,
        }))
        db.schedules.push({ id: genId('SCH'), contractId, entries: scheduleEntries })
        save()

        // Seed the predefined folders every new contract gets.
        const evidenceFolderId = genId('FD')
        db.folders.push(
          { id: genId('FD'), contractId, name: 'Documentos del contrato', parentId: null, kind: 'contract',  predefined: true },
          { id: evidenceFolderId, contractId, name: 'Evidencias',         parentId: null, kind: 'evidence',  predefined: true },
          { id: genId('FD'), contractId, name: 'Comprobantes de pago',    parentId: null, kind: 'payments',  predefined: true },
        )
        // Evidencias/estimaciones/hojas-generadoras subfolder hierarchy
        const estimacionesFolderId = genId('FD')
        db.folders.push(
          { id: estimacionesFolderId, contractId, name: 'Estimaciones', parentId: evidenceFolderId, kind: 'custom', predefined: true },
          { id: genId('FD'), contractId, name: 'Hojas generadoras', parentId: estimacionesFolderId, kind: 'hoja_generadora', predefined: true },
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
          for (const li of (est.lineItems ?? [])) {
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
        const entity = db.users.find((u) => u.id === contract.entityId)
        const prior = db.estimates.filter((e) => e.contractId === input.contractId)

        // Only APPROVED/paid estimates claim a period. Multiple drafts allowed.
        const approvedForPeriod = prior.find(
          (e) => e.periodIndex === input.periodIndex && (e.status === 'approved' || e.status === 'paid'),
        )
        if (approvedForPeriod) {
          throw new RepositoryError(409, `Ya existe una estimación aprobada para el período ${input.periodIndex}`, 'duplicate_period')
        }

        // Can't skip ahead: an earlier period that still needs a new estimate
        // (no estimate at all, or every one it has is rejected) must get one
        // first. Periods with a draft/submitted/approved/paid estimate don't
        // block — they already have something in progress or resolved.
        for (let p = 1; p < input.periodIndex; p++) {
          const forP = prior.filter((e) => e.periodIndex === p)
          const needsNew = forP.length === 0 || forP.every((e) => e.status === 'rejected')
          if (needsNew) {
            throw new RepositoryError(
              409,
              `Primero debes crear una estimación para el período ${p}`,
              'skipped_period',
            )
          }
        }

        const periods = buildContractPeriods(contract)
        const periodDates = periods[input.periodIndex - 1]
        if (!periodDates) throw new RepositoryError(400, 'Período inválido', 'invalid_period')

        const number = input.periodIndex
        const cover: EstimateCover = {
          entityName: entity?.fullName ?? '',
          contractCode: contract.code,
          contractTitle: contract.title,
          contractStartDate: contract.startDate,
          contractorName: corp?.name ?? '',
          contractorRfc: corp?.rfc ?? null,
          estimateNumber: number,
          periodIndex: input.periodIndex,
          periodStart: periodDates.start,
          periodEnd: periodDates.end,
        }
        const now = new Date()
        const estimate: Estimate = {
          id: genId('ES'),
          contractId: input.contractId,
          number,
          periodIndex: input.periodIndex,
          status: 'draft',
          periodStart: periodDates.start,
          periodEnd: periodDates.end,
          cover,
          hojas: [],
          lineItems: [],
          summary: { partidas: [], partidasSubtotal: 0, calculations: {
            ivaRate: contract.ivaRate ?? 16, estimateAmount: 0, estimateIva: 0, estimateTotal: 0,
            anticipoAmortization: 0, amortizationIva: 0, amortizationTotal: 0, retentions: 0,
            cincoAlMillarSfp: 0, total: 0,
          } },
          evidenceFileIds: [],
          sectionNotes: {},
          signatures: pendingSignatures(),
          history: [event('created')],
          createdById: currentUserId,
          createdAt: now,
          updatedAt: now,
        }
        recomputeEstimate(estimate)
        db.estimates.push(estimate)
        save()
        return clone(estimate)
      },
      async updateDraft(id, input) {
        await delay()
        const e = db.estimates.find((x) => x.id === id)
        if (!e) throw notFound('Estimación')
        // Only drafts are editable. with_notes/rejected are final.
        if (e.status !== 'draft') {
          throw new RepositoryError(409, 'Solo se pueden editar borradores', 'not_editable')
        }
        const contract = db.contracts.find((c) => c.id === e.contractId)!
        const catalog = db.concepts.filter((c) => c.contractId === e.contractId)
        const sections = db.conceptSections.filter((s) => s.contractId === e.contractId)

        // Schedule guard: a concept must have plannedQuantity>0 for this period
        const schedule = db.schedules.find((s) => s.contractId === e.contractId)
        const plannedFor = (conceptId: string) => {
          const entry = (schedule?.entries ?? []).find(
            (en) => String(en.conceptId) === String(conceptId) && en.periodIndex === e.periodIndex - 1,
          )
          return entry ? entry.plannedQuantity : 0
        }

        // Build hojas from input
        const hojas = input.hojas.map((hi, i) => {
          const concept = catalog.find((c) => String(c.id) === String(hi.conceptId))
          if (!concept) throw notFound(`Concepto ${hi.conceptId}`)
          if (!concept.sectionId) {
            throw new RepositoryError(409, `El concepto ${concept.specificationNumber} no tiene partida asignada`, 'concept_without_section')
          }
          const planned = plannedFor(hi.conceptId)
          if (planned <= 0) {
            throw new RepositoryError(409, `El concepto ${concept.specificationNumber} no está programado para este período`, 'concept_not_scheduled')
          }
          const rowsTotal = hi.rows.reduce((s, r) => s + (Number.isFinite(r.quantity) ? r.quantity : 0), 0)
          if (rowsTotal > planned) {
            throw new RepositoryError(
              409,
              `El concepto ${concept.specificationNumber} supera el volumen programado para este período (${planned})`,
              'exceeds_scheduled_quantity',
            )
          }
          return {
            id: hi.id ?? genId('HG'),
            number: i + 1,
            conceptId: concept.id,
            specificationNumber: concept.specificationNumber,
            description: concept.description,
            unit: concept.unit,
            sectionId: concept.sectionId,
            contractedQuantity: concept.contractedQuantity,
            unitPrice: concept.unitPrice,
            rows: hi.rows.map((r) => ({
              id: r.id ?? genId('HR'),
              quantity: Number.isFinite(r.quantity) ? r.quantity : 0,
              photoFileId: r.photoFileId ?? null,
              fileIds: r.fileIds ?? [],
              logNoteIds: r.logNoteIds ?? [],
            })),
          }
        })
        // Enforce one hoja per concept
        const seen = new Set()
        for (const h of hojas) {
          if (seen.has(String(h.conceptId))) {
            throw new RepositoryError(409, 'Solo puede haber una Hoja Generadora por concepto', 'duplicate_hoja')
          }
          seen.add(String(h.conceptId))
        }
        e.hojas = hojas
        if (input.evidenceFileIds !== undefined) e.evidenceFileIds = [...input.evidenceFileIds]
        recomputeEstimate(e)
        e.updatedAt = new Date()
        save()
        return clone(e)
      },
      async delete(id) {
        await delay()
        const idx = db.estimates.findIndex((x) => x.id === id)
        if (idx === -1) throw notFound('Estimación')
        if ((db.estimates[idx])?.status !== 'draft') {
          throw new RepositoryError(409, 'Solo se pueden eliminar borradores', 'not_deletable')
        }
        db.estimates.splice(idx, 1)
        save()
      },
      async submit(id) {
        await delay()
        const e = db.estimates.find((x) => x.id === id)
        if (!e) throw notFound('Estimación')
        if (e.status !== 'draft') throw new RepositoryError(409, 'Solo se envían borradores', 'wrong_status')
        if (!(e.hojas ?? []).length) throw new RepositoryError(409, 'Agrega al menos una Hoja Generadora', 'no_hojas')
        // Every row with quantity > 0 needs a photo AND at least one linked
        // log note (rows registering 0 for the period are exempt — there's
        // nothing to evidence).
        for (const h of (e.hojas ?? [])) {
          for (const r of h.rows) {
            if (r.quantity <= 0) continue
            if (!r.photoFileId) {
              throw new RepositoryError(409, `La Hoja ${h.number} tiene una partida sin fotografía`, 'photo_required')
            }
            if (!r.logNoteIds?.length) {
              throw new RepositoryError(409, `La Hoja ${h.number} tiene una partida sin nota de bitácora vinculada`, 'lognote_required')
            }
          }
        }
        // Every concept scheduled (planned quantity > 0) for this period must
        // have its own Hoja — even if it ends up registering 0 for the period.
        const hojaConceptIds = new Set(e.hojas.map((h) => String(h.conceptId)))
        const schedule = db.schedules.find((s) => s.contractId === e.contractId)
        const scheduledConceptIds = new Set(
          (schedule?.entries ?? [])
            .filter((se) => se.periodIndex === e.periodIndex - 1 && se.plannedQuantity > 0)
            .map((se) => String(se.conceptId)),
        )
        for (const cid of scheduledConceptIds) {
          if (!hojaConceptIds.has(cid)) {
            const concept = db.concepts.find((c) => String(c.id) === cid)
            throw new RepositoryError(
              409,
              `Falta la Hoja del concepto ${concept?.specificationNumber ?? cid} programado para este período`,
              'missing_scheduled_concept',
            )
          }
        }
        // Block if another submitted/approved estimate holds this period
        const claimed = db.estimates.find(
          (x) => x.contractId === e.contractId && x.id !== e.id && x.periodIndex === e.periodIndex &&
            (x.status === 'submitted' || x.status === 'approved' || x.status === 'paid'),
        )
        if (claimed) {
          throw new RepositoryError(409, 'Ya hay una estimación en proceso para este período', 'period_claimed')
        }
        e.status = 'submitted'
        e.history.push(event('submitted'))
        // The superintendent creates/submits estimates — auto-sign their own
        // slot immediately, same as log notes do on creation.
        trySignAsCreator(e.signatures)
        tryApproveEstimate(e)
        e.updatedAt = new Date()
        save()
        return clone(e)
      },
      async approve(id) {
        return transition(db.estimates, id, 'Estimación', 'approved', 'approved')
      },
      async rejectWithNotes(id, notes) {
        await delay()
        const e = db.estimates.find((x) => x.id === id)
        if (!e) throw notFound('Estimación')
        if (e.status !== 'submitted') {
          throw new RepositoryError(409, 'Solo se rechaza una estimación enviada', 'wrong_status')
        }
        const role = currentUser().role
        if (role !== 'resident' && role !== 'supervisor') {
          throw new RepositoryError(403, 'Solo el residente o el supervisor pueden rechazar con notas', 'forbidden')
        }
        const mySlot = e.signatures.find((s) => s.role === role)
        if (mySlot?.status === 'signed') {
          throw new RepositoryError(409, 'Ya firmaste esta estimación; no puedes rechazarla', 'already_signed')
        }
        const cleaned: Record<string, string> = {}
        for (const [k, v] of Object.entries(notes ?? {})) if (v.trim()) cleaned[k] = v.trim()
        if (Object.keys(cleaned).length === 0) {
          throw new RepositoryError(409, 'Agrega al menos una nota para rechazar la estimación', 'notes_required')
        }
        e.status = 'rejected'
        e.sectionNotes = cleaned
        e.history.push(event('rejected'))
        e.updatedAt = new Date()
        save()
        return clone(e)
      },
      async markPaid(id, paymentEvidenceFileId) {
        await delay()
        const e = db.estimates.find((x) => x.id === id)
        if (!e) throw notFound('Estimación')
        e.status = 'paid'
        e.history.push(event('paid'))
        e.updatedAt = new Date()
        void paymentEvidenceFileId
        save()
        return clone(e)
      },
      async sign(id) {
        await delay()
        const e = db.estimates.find((x) => x.id === id)
        if (!e) throw notFound('Estimación')
        if (e.status !== 'submitted') {
          throw new RepositoryError(409, 'Solo se firma una estimación enviada', 'wrong_status')
        }
        // Recording this signer's own signature always succeeds — sequential
        // periods can be submitted and signed freely. Only the final
        // transition to APPROVED is held back if an earlier period isn't
        // approved yet; the estimate simply stays "fully signed, pending"
        // until that clears (see tryApproveEstimate/promoteFollowingEstimates).
        applySignature(e.signatures)
        e.history.push(event('signed'))
        tryApproveEstimate(e)
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
        const contractNotes = db.logNotes.filter((n) => n.contractId === input.contractId)
        const maxFolio = contractNotes.reduce((m, n) => Math.max(m, n.folio), 0)
        const nextFolio = maxFolio + 1
        const isOpeningNote = input.category === 'apertura'

        // --- Guards ---
        // Opening note can only be created once
        if (isOpeningNote && contractNotes.some((n) => n.isOpeningNote)) {
          throw new RepositoryError(409, 'La nota de apertura ya existe para este contrato', 'already_exists')
        }
        // No other notes until the opening note exists
        if (!isOpeningNote) {
          const opening = contractNotes.find((n) => n.isOpeningNote)
          if (!opening) {
            throw new RepositoryError(409, 'Debes crear la nota de apertura antes de agregar otras notas', 'opening_required')
          }
        }

        // --- Build fixed body for opening note ---
        let fixedBody: string | null = null
        if (isOpeningNote) {
          const contract = db.contracts.find((c) => c.id === input.contractId)
          const entity   = contract ? db.users.find((u) => u.id === contract.entityId) : null
          const resident = contract ? db.users.find((u) => u.id === contract.residentId) : null
          const superintendent = contract ? db.users.find((u) => u.id === contract.superintendentId) : null
          const corp     = contract ? db.corporations.find((c) => c.id === contract.contractorCorporationId) : null
          const now      = new Date()
          const fmtDate  = (d: Date) => d.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })
          const fmtMoney = (m: number) => (m / 100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })

          const anticipoAmt = contract ? Math.round(contract.amount * contract.anticipoPercentage / 100) : 0
          const startDate   = contract ? new Date(contract.startDate) : now
          const endDate     = contract ? new Date(contract.endDate)   : now
          const plazo       = contract ? Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) : 0

          fixedBody = `Con fecha de hoy, ${fmtDate(now)}, se declara formalmente abierta la Bitácora Electrónica y Seguimiento a Obra Pública (BESOP) de la presente obra, de conformidad con lo establecido en los Artículos 46 de la Ley de Obras Públicas y Servicios Relacionados con las Mismas, así como el 122, 123 y 124 de su Reglamento.

Para efectos de dar constancia jurídica y técnica al desarrollo de los trabajos, se asientan los datos generales del contrato de obra base:

• Contrato No.: ${contract?.code ?? '—'}
• Obra: ${contract?.title ?? '—'}
• Dependencia Convocante: ${entity?.fullName ?? '—'}
• Contratista: ${corp?.name ?? '—'}
• Monto Contractual: ${fmtMoney(contract?.amount ?? 0)} (antes de I.V.A.)
• Monto del Anticipo (${contract?.anticipoPercentage ?? 0}%): ${fmtMoney(anticipoAmt)} (antes de I.V.A.)
• Plazo de Ejecución: ${plazo} días naturales
• Fecha de Inicio Contractual: ${fmtDate(startDate)}
• Fecha de Término Contractual: ${fmtDate(endDate)}

Se registran las personalidades técnicas autorizadas para actuar en este libro digital:

• Por la Dependencia (Residente de Obra): ${resident?.fullName ?? '—'}${input.residentCedula ? ` (Cédula Prof. ${input.residentCedula})` : ''}
• Por la Empresa Contratista (Superintendente): ${superintendent?.fullName ?? '—'}${input.superintendentCedula ? ` (Cédula Prof. ${input.superintendentCedula})` : ''}

Ambas partes reconocen la obligatoriedad y validez jurídica de los asientos realizados en este sistema, comprometiéndose a su revisión y firma diaria.`
        }

        const note: LogNote = {
          id: genId('LN'),
          contractId: input.contractId,
          folio: nextFolio,
          category: input.category,
          title: input.title,
          fixedBody,
          customBody: input.customBody,
          isOpeningNote,
          authorId: currentUserId,
          signatures: pendingSignatures(),
          locked: false,
          createdAt: new Date(),
        }
        trySignAsCreator(note.signatures)
        if (note.signatures.every((s) => s.status === 'signed')) note.locked = true
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
    reception: makeCloseFlow<ReceptionStatement>(db.reception, 'Acta de recepción', () => currentUserId, pendingSignatures, event, applySignature, 'R', db, save),

    // --- finiquito ---------------------------------------------------------
    finiquito: {
      ...makeCloseFlow<FiniquitoStatement>(db.finiquito, 'Finiquito', () => currentUserId, pendingSignatures, event, applySignature, 'F', db, save),
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
      async upsertEntry(contractId: ContractId, conceptId: ConceptId, periodIndex: number, plannedQuantity: number) {
        await delay()
        let s = db.schedules.find((x: WorkSchedule) => x.contractId === contractId)
        if (!s) {
          s = { id: genId('SCH'), contractId, entries: [] }
          db.schedules.push(s)
        }
        const existing = (s.entries as ConceptScheduleEntry[]).find(
          (e) => String(e.conceptId) === String(conceptId) && e.periodIndex === periodIndex,
        )
        if (existing) {
          existing.plannedQuantity = plannedQuantity
        } else {
          s.entries.push({ id: genId('SE'), contractId, conceptId, periodIndex, plannedQuantity })
        }
        save()
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
        const removedFiles = db.files.filter((x) => toDelete.has(x.folderId))
        db.files = db.files.filter((x) => !toDelete.has(x.folderId))
        save()
        for (const rf of removedFiles) {
          const url = activeObjectUrls.get(rf.id)
          if (url) { URL.revokeObjectURL(url); activeObjectUrls.delete(rf.id) }
        }
        await deleteBlobs(removedFiles.map((x) => x.id)).catch(() => { /* best-effort */ })
      },
      async upload(input: UploadFileInput, onProgress?: UploadProgress) {
        if (input.file.size > MAX_UPLOAD_SIZE_BYTES) {
          throw new RepositoryError(
            413,
            `El archivo supera el límite de ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)}MB.`,
            'file_too_large',
          )
        }
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
          downloadUrl: '#', // resolved on demand by getDownloadUrl() from the IndexedDB blob store
        }
        try {
          await putBlob(file.id, input.file)
        } catch (e) {
          throw new RepositoryError(
            500,
            e instanceof Error ? e.message : 'No se pudo guardar el archivo en este navegador.',
            'blob_store_failed',
          )
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
        const url = activeObjectUrls.get(fileId)
        if (url) { URL.revokeObjectURL(url); activeObjectUrls.delete(fileId) }
        await deleteBlob(fileId).catch(() => { /* best-effort */ })
      },
      async getDownloadUrl(fileId) {
        await delay()
        const f = db.files.find((x) => x.id === fileId)
        if (!f) throw notFound('Archivo')
        const blob = await getBlob(fileId).catch(() => null)
        const prevUrl = activeObjectUrls.get(fileId)
        if (prevUrl) URL.revokeObjectURL(prevUrl)
        // Fallback placeholder for files uploaded before real byte storage
        // was added (their metadata exists but there's no blob on disk).
        const effectiveBlob = blob ?? new Blob(
          [`[Archivo no disponible: ${f.name} — subido antes de habilitar el almacenamiento real de archivos.]`],
          { type: 'text/plain' },
        )
        const url = URL.createObjectURL(effectiveBlob)
        activeObjectUrls.set(fileId, url)
        return url
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
        const user: User = { id: genId('U'), fullName: input.fullName, username: input.username, email: input.email ?? null, role: input.role, corporationId: input.corporationId ?? null, entityId: input.entityId ?? null, cedula: input.cedula ?? null, active: true }
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  save: () => void,
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
      const user = (db.users as User[]).find((u) => u.id === me())
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