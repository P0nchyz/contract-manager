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
  ConceptScheduleEntry,
} from '../models'

const d = (iso: string) => new Date(iso)

// --- Organizations ---------------------------------------------------------
export const corporations: Corporation[] = [
  { id: 'CORP-001', name: 'Constructora del Valle, S.A. de C.V.', rfc: 'CVA120511AB3', superintendentId: 'U-SUP', active: true },
]

export const users: User[] = [
  { id: 'U-ADMIN', fullName: 'Ana Admin', username: 'admin', email: 'admin@example.mx', role: 'admin', corporationId: null, active: true },
  { id: 'U-RES', fullName: 'Roberto Residente', username: 'rresidente', email: 'rres@example.mx', role: 'resident', corporationId: null, active: true },
  { id: 'U-SUP', fullName: 'Susana Superintendente', username: 'ssuper', email: 'ssup@example.mx', role: 'superintendent', corporationId: 'CORP-001', active: true },
  { id: 'U-SVR', fullName: 'Sergio Supervisor', username: 'ssupervisor', email: 'ssvr@example.mx', role: 'supervisor', corporationId: null, active: true },
  { id: 'U-FIN', fullName: 'Fabiola Financiera', username: 'ffinanzas', email: 'ffin@example.mx', role: 'financial', corporationId: null, active: true },
]

// --- Contract --------------------------------------------------------------
export const contracts: Contract[] = [
  {
    id: 'CT-001',
    code: 'LPI-SRO-2024-014',
    title: 'Diseñar e instrumentar el modelo virtual AutoDesk',
    status: 'active',
    amount: 32_600_000_000, // $326,000,000.00
    anticipoPercentage: 20,
    ivaRate: 16,
    retentionPercentage: 5,
    estimatePeriodicity: 'monthly' as const,
    startDate: d('2024-01-15'),
    endDate: d('2024-12-31'),
    createdById: 'U-RES',
    residentId: 'U-RES',
    superintendentId: 'U-SUP',
    supervisorId: 'U-SVR',
    financialId: 'U-FIN',
    contractorCorporationId: 'CORP-001',
    createdAt: d('2024-01-10'),
    updatedAt: d('2024-03-01'),
  },
]

export const contractFinancials: ContractFinancials[] = [
  {
    contractId: 'CT-001',
    contractedAmount: 32_600_000_000,
    executedAmount: 13_670_000_000, // $136,700,000.00
    paidAmount: 12_000_000_000,
    balancePercentage: 25,
    anticipoPercentage: 20,
    anticipoAmount: 6_520_000_000,
    physicalProgress: 27,
    financialProgress: 25,
  },
]

// --- Concept catalog (unitPrice in cents) ----------------------------------
export const conceptSections: ConceptSection[] = [
  { id: 'CS-01' as ConceptSection['id'], contractId: 'CT-001', specificationNumber: 'A', description: 'Trabajos topográficos y modelado', startDate: d('2024-01-15'), endDate: d('2024-04-30'), order: 0 },
  { id: 'CS-02' as ConceptSection['id'], contractId: 'CT-001', specificationNumber: 'B', description: 'Implementación BIM y coordinación', startDate: d('2024-03-01'), endDate: d('2024-10-31'), order: 1 },
  { id: 'CS-03' as ConceptSection['id'], contractId: 'CT-001', specificationNumber: 'C', description: 'Capacitación y entrega', startDate: d('2024-09-01'), endDate: d('2024-12-31'), order: 2 },
]

export const concepts: Concept[] = [
  { id: 'CN-01', contractId: 'CT-001', sectionId: 'CS-01' as ConceptSection['id'], specificationNumber: 'E-101', description: 'Levantamiento topográfico con estación total', unit: 'ha', unitPrice: 1_850_000, contractedQuantity: 40 },
  { id: 'CN-02', contractId: 'CT-001', sectionId: 'CS-02' as ConceptSection['id'], specificationNumber: 'E-205', description: 'Modelado BIM de estructura principal', unit: 'm2', unitPrice: 95_000, contractedQuantity: 12_000 },
  { id: 'CN-03', contractId: 'CT-001', sectionId: 'CS-02' as ConceptSection['id'], specificationNumber: 'E-210', description: 'Modelado BIM de instalaciones MEP', unit: 'm2', unitPrice: 120_000, contractedQuantity: 12_000 },
  { id: 'CN-04', contractId: 'CT-001', sectionId: 'CS-02' as ConceptSection['id'], specificationNumber: 'E-330', description: 'Detección de interferencias (clash detection)', unit: 'lote', unitPrice: 48_000_000, contractedQuantity: 1 },
  { id: 'CN-05', contractId: 'CT-001', sectionId: 'CS-03' as ConceptSection['id'], specificationNumber: 'E-410', description: 'Capacitación al personal en plataforma', unit: 'curso', unitPrice: 9_500_000, contractedQuantity: 6 },
]

// --- Estimates -------------------------------------------------------------
export const estimates: Estimate[] = [
  {
    id: 'ES-001',
    contractId: 'CT-001',
    number: 1,
    status: 'paid',
    periodStart: d('2024-02-01'),
    periodEnd: d('2024-02-28'),
    cover: {
      contractCode: 'LPI-SRO-2024-014',
      contractTitle: 'Diseñar e instrumentar el modelo virtual AutoDesk',
      contractorName: 'Constructora del Valle, S.A. de C.V.',
      contractorCorporationId: 'CORP-001',
      estimateNumber: 1,
      periodIndex: 1,
      periodStart: d('2024-02-01'),
      periodEnd: d('2024-02-28'),
    },
    lineItems: [
      { conceptId: 'CN-01', conceptNumber: 1, specificationNumber: 'E-101', description: 'Levantamiento topográfico con estación total', unit: 'ha', inProject: 40, upToLastEstimate: 0, inThisEstimate: 40, totalEstimated: 40, toExecute: 0, unitPrice: 1_850_000, totalAmount: 74_000_000 },
      { conceptId: 'CN-02', conceptNumber: 2, specificationNumber: 'E-205', description: 'Modelado BIM de estructura principal', unit: 'm2', inProject: 12_000, upToLastEstimate: 0, inThisEstimate: 2_000, totalEstimated: 2_000, toExecute: 10_000, unitPrice: 95_000, totalAmount: 190_000_000 },
    ],
    summary: {
      conceptSummary: {
        rows: [
          { conceptId: 'CN-01', specificationNumber: 'E-101', description: 'Levantamiento topográfico con estación total', amount: 74_000_000 },
          { conceptId: 'CN-02', specificationNumber: 'E-205', description: 'Modelado BIM de estructura principal', amount: 190_000_000 },
        ],
        subtotal: 264_000_000,
      },
      calculations: {
        rows: [
          { conceptId: 'CN-01', specificationNumber: 'E-101', description: 'Levantamiento topográfico con estación total', amount: 74_000_000 },
          { conceptId: 'CN-02', specificationNumber: 'E-205', description: 'Modelado BIM de estructura principal', amount: 190_000_000 },
        ],
        ivaRate: 16,
        estimateAmount: 264_000_000,
        estimateIva: 42_240_000,
        estimateTotal: 306_240_000,
        anticipoAmortization: 52_800_000,
        amortizationIva: 8_448_000,
        amortizationTotal: 61_248_000,
        retentions: 13_200_000,
        cincoAlMillarSfp: 1_320_000,
        total: 230_472_000,
      },
    },
    signatures: [
      { id: 'SG-1', role: 'superintendent', userId: 'U-SUP', signedAt: d('2024-03-02'), status: 'signed' },
      { id: 'SG-2', role: 'supervisor', userId: 'U-SVR', signedAt: d('2024-03-04'), status: 'signed' },
      { id: 'SG-3', role: 'resident', userId: 'U-RES', signedAt: d('2024-03-05'), status: 'signed' },
    ],
    history: [
      { id: 'EV-1', action: 'created', byUserId: 'U-SUP', at: d('2024-03-01') },
      { id: 'EV-2', action: 'submitted', byUserId: 'U-SUP', at: d('2024-03-02') },
      { id: 'EV-3', action: 'approved', byUserId: 'U-SVR', at: d('2024-03-04') },
      { id: 'EV-4', action: 'paid', byUserId: 'U-FIN', at: d('2024-03-12') },
    ],
    evidenceFileIds: ['FILE-10'],
    linkedLogNoteIds: ['LN-237'],
    createdById: 'U-SUP',
    createdAt: d('2024-03-01'),
    updatedAt: d('2024-03-12'),
  },
  {
    id: 'ES-002',
    contractId: 'CT-001',
    number: 2,
    periodIndex: 2,
    status: 'with_notes', // returned by supervisor; loops back to draft on edit
    periodStart: d('2024-03-01'),
    periodEnd: d('2024-03-31'),
    cover: {
      contractCode: 'LPI-SRO-2024-014',
      contractTitle: 'Diseñar e instrumentar el modelo virtual AutoDesk',
      contractorName: 'Constructora del Valle, S.A. de C.V.',
      contractorCorporationId: 'CORP-001',
      estimateNumber: 2,
      periodIndex: 2,
      periodStart: d('2024-03-01'),
      periodEnd: d('2024-03-31'),
    },
    lineItems: [
      { conceptId: 'CN-02', conceptNumber: 1, specificationNumber: 'E-205', description: 'Modelado BIM de estructura principal', unit: 'm2', inProject: 12_000, upToLastEstimate: 2_000, inThisEstimate: 3_000, totalEstimated: 5_000, toExecute: 7_000, unitPrice: 95_000, totalAmount: 285_000_000 },
    ],
    summary: {
      conceptSummary: {
        rows: [
          { conceptId: 'CN-02', specificationNumber: 'E-205', description: 'Modelado BIM de estructura principal', amount: 285_000_000 },
        ],
        subtotal: 285_000_000,
      },
      calculations: {
        rows: [
          { conceptId: 'CN-02', specificationNumber: 'E-205', description: 'Modelado BIM de estructura principal', amount: 285_000_000 },
        ],
        ivaRate: 16,
        estimateAmount: 285_000_000,
        estimateIva: 45_600_000,
        estimateTotal: 330_600_000,
        anticipoAmortization: 57_000_000,
        amortizationIva: 9_120_000,
        amortizationTotal: 66_120_000,
        retentions: 14_250_000,
        cincoAlMillarSfp: 1_425_000,
        total: 248_805_000,
      },
    },
    signatures: [
      { id: 'SG-4', role: 'superintendent', userId: 'U-SUP', signedAt: d('2024-04-02'), status: 'signed' },
      { id: 'SG-5', role: 'supervisor', userId: null, signedAt: null, status: 'pending' },
      { id: 'SG-6', role: 'resident', userId: null, signedAt: null, status: 'pending' },
    ],
    history: [
      { id: 'EV-5', action: 'created', byUserId: 'U-SUP', at: d('2024-04-01') },
      { id: 'EV-6', action: 'submitted', byUserId: 'U-SUP', at: d('2024-04-02') },
      { id: 'EV-7', action: 'returned_with_notes', byUserId: 'U-SVR', at: d('2024-04-05'), note: 'Revisar volumen del concepto E-205; no coincide con la bitácora folio 240.' },
    ],
    evidenceFileIds: [],
    linkedLogNoteIds: ['LN-240'],
    createdById: 'U-SUP',
    createdAt: d('2024-04-01'),
    updatedAt: d('2024-04-05'),
  },
]

// --- Logbook (each signed by resident + superintendent + supervisor) -------
export const logNotes: LogNote[] = [
  { id: 'LN-237', contractId: 'CT-001', folio: 237, title: 'Inicio de levantamiento topográfico', date: d('2024-02-05'), body: 'Se inician trabajos de levantamiento en el polígono norte...', authorId: 'U-SUP', signatures: [
    { id: 'LS-1', role: 'superintendent', userId: 'U-SUP', signedAt: d('2024-02-05'), status: 'signed' },
    { id: 'LS-2', role: 'supervisor', userId: 'U-SVR', signedAt: d('2024-02-06'), status: 'signed' },
    { id: 'LS-3', role: 'resident', userId: 'U-RES', signedAt: d('2024-02-06'), status: 'signed' },
  ], attachmentFileIds: ['FILE-10'], locked: true, createdAt: d('2024-02-05') },
  { id: 'LN-240', contractId: 'CT-001', folio: 240, title: 'Avance de modelado estructural', date: d('2024-03-20'), body: 'Avance del 40% en el modelado de la estructura principal...', authorId: 'U-SUP', signatures: [
    { id: 'LS-4', role: 'superintendent', userId: 'U-SUP', signedAt: d('2024-03-20'), status: 'signed' },
    { id: 'LS-5', role: 'supervisor', userId: null, signedAt: null, status: 'pending' },
    { id: 'LS-6', role: 'resident', userId: null, signedAt: null, status: 'pending' },
  ], attachmentFileIds: [], locked: false, createdAt: d('2024-03-20') },
  { id: 'LN-241', contractId: 'CT-001', folio: 241, title: 'Entrega de capacitación módulo 1', date: d('2024-03-28'), body: 'Se impartió el primer curso de capacitación...', authorId: 'U-RES', signatures: [
    { id: 'LS-7', role: 'resident', userId: 'U-RES', signedAt: d('2024-03-28'), status: 'signed' },
    { id: 'LS-8', role: 'superintendent', userId: 'U-SUP', signedAt: d('2024-03-29'), status: 'signed' },
    { id: 'LS-9', role: 'supervisor', userId: 'U-SVR', signedAt: d('2024-03-29'), status: 'signed' },
  ], attachmentFileIds: [], locked: true, createdAt: d('2024-03-28') },
]

// --- Modification agreements ----------------------------------------------
export const agreements: ModificationAgreement[] = [
  { id: 'AG-001', contractId: 'CT-001', number: 1, kind: 'amount', description: 'Ampliación de alcance: 2,000 m2 adicionales de modelado MEP.', conceptChanges: [], newConcepts: [], newSections: [], newContractStartDate: null, newContractEndDate: null, amountDelta: 240_000_000, timeDeltaDays: null, status: 'approved', signatures: [
    { id: 'AS-1', role: 'superintendent', userId: 'U-SUP', signedAt: d('2024-03-15'), status: 'signed' },
    { id: 'AS-2', role: 'supervisor', userId: 'U-SVR', signedAt: d('2024-03-16'), status: 'signed' },
    { id: 'AS-3', role: 'resident', userId: 'U-RES', signedAt: d('2024-03-17'), status: 'signed' },
  ], history: [
    { id: 'AE-1', action: 'created', byUserId: 'U-RES', at: d('2024-03-14') },
    { id: 'AE-2', action: 'submitted', byUserId: 'U-RES', at: d('2024-03-14') },
    { id: 'AE-3', action: 'approved', byUserId: 'U-SVR', at: d('2024-03-16') },
  ], attachmentFileIds: [], createdById: 'U-RES', createdAt: d('2024-03-14'), updatedAt: d('2024-03-16') },
]

// --- Reception / finiquito (separate flows; none started yet) --------------
export const receptionStatements: ReceptionStatement[] = []
export const finiquitoStatements: FiniquitoStatement[] = []

// --- Work schedule (Gantt items + derived S-curve) -------------------------
export const schedules: WorkSchedule[] = [
  {
    id: 'SCH-001',
    contractId: 'CT-001',
    entries: [
  { id: 'SE-101' as ConceptScheduleEntry['id'], contractId: 'CT-001', conceptId: 'CN-01' as ConceptScheduleEntry['conceptId'], periodIndex: 0, plannedQuantity: 20 },
  { id: 'SE-102' as ConceptScheduleEntry['id'], contractId: 'CT-001', conceptId: 'CN-01' as ConceptScheduleEntry['conceptId'], periodIndex: 1, plannedQuantity: 20 },
  { id: 'SE-103' as ConceptScheduleEntry['id'], contractId: 'CT-001', conceptId: 'CN-02' as ConceptScheduleEntry['conceptId'], periodIndex: 1, plannedQuantity: 2400 },
  { id: 'SE-104' as ConceptScheduleEntry['id'], contractId: 'CT-001', conceptId: 'CN-02' as ConceptScheduleEntry['conceptId'], periodIndex: 2, plannedQuantity: 2400 },
  { id: 'SE-105' as ConceptScheduleEntry['id'], contractId: 'CT-001', conceptId: 'CN-02' as ConceptScheduleEntry['conceptId'], periodIndex: 3, plannedQuantity: 2400 },
  { id: 'SE-106' as ConceptScheduleEntry['id'], contractId: 'CT-001', conceptId: 'CN-02' as ConceptScheduleEntry['conceptId'], periodIndex: 4, plannedQuantity: 2400 },
  { id: 'SE-107' as ConceptScheduleEntry['id'], contractId: 'CT-001', conceptId: 'CN-02' as ConceptScheduleEntry['conceptId'], periodIndex: 5, plannedQuantity: 2400 },
  { id: 'SE-108' as ConceptScheduleEntry['id'], contractId: 'CT-001', conceptId: 'CN-03' as ConceptScheduleEntry['conceptId'], periodIndex: 3, plannedQuantity: 2000 },
  { id: 'SE-109' as ConceptScheduleEntry['id'], contractId: 'CT-001', conceptId: 'CN-03' as ConceptScheduleEntry['conceptId'], periodIndex: 4, plannedQuantity: 2000 },
  { id: 'SE-110' as ConceptScheduleEntry['id'], contractId: 'CT-001', conceptId: 'CN-03' as ConceptScheduleEntry['conceptId'], periodIndex: 5, plannedQuantity: 2000 },
  { id: 'SE-111' as ConceptScheduleEntry['id'], contractId: 'CT-001', conceptId: 'CN-03' as ConceptScheduleEntry['conceptId'], periodIndex: 6, plannedQuantity: 2000 },
  { id: 'SE-112' as ConceptScheduleEntry['id'], contractId: 'CT-001', conceptId: 'CN-03' as ConceptScheduleEntry['conceptId'], periodIndex: 7, plannedQuantity: 2000 },
  { id: 'SE-113' as ConceptScheduleEntry['id'], contractId: 'CT-001', conceptId: 'CN-03' as ConceptScheduleEntry['conceptId'], periodIndex: 8, plannedQuantity: 2000 },
  { id: 'SE-114' as ConceptScheduleEntry['id'], contractId: 'CT-001', conceptId: 'CN-04' as ConceptScheduleEntry['conceptId'], periodIndex: 8, plannedQuantity: 1 },
  { id: 'SE-115' as ConceptScheduleEntry['id'], contractId: 'CT-001', conceptId: 'CN-05' as ConceptScheduleEntry['conceptId'], periodIndex: 2, plannedQuantity: 1 },
  { id: 'SE-116' as ConceptScheduleEntry['id'], contractId: 'CT-001', conceptId: 'CN-05' as ConceptScheduleEntry['conceptId'], periodIndex: 3, plannedQuantity: 1 },
  { id: 'SE-117' as ConceptScheduleEntry['id'], contractId: 'CT-001', conceptId: 'CN-05' as ConceptScheduleEntry['conceptId'], periodIndex: 4, plannedQuantity: 1 },
  { id: 'SE-118' as ConceptScheduleEntry['id'], contractId: 'CT-001', conceptId: 'CN-05' as ConceptScheduleEntry['conceptId'], periodIndex: 5, plannedQuantity: 1 },
  { id: 'SE-119' as ConceptScheduleEntry['id'], contractId: 'CT-001', conceptId: 'CN-05' as ConceptScheduleEntry['conceptId'], periodIndex: 6, plannedQuantity: 1 },
  { id: 'SE-120' as ConceptScheduleEntry['id'], contractId: 'CT-001', conceptId: 'CN-05' as ConceptScheduleEntry['conceptId'], periodIndex: 7, plannedQuantity: 1 },
    ],
  },
]

// --- Files & evidence ------------------------------------------------------
export const folders: Folder[] = [
  { id: 'FD-CONTRACT', contractId: 'CT-001', name: 'Documentos del contrato', parentId: null, kind: 'contract', predefined: true },
  { id: 'FD-EVIDENCE', contractId: 'CT-001', name: 'Evidencias', parentId: null, kind: 'evidence', predefined: true },
  { id: 'FD-PAYMENTS', contractId: 'CT-001', name: 'Comprobantes de pago', parentId: null, kind: 'payments', predefined: true },
  { id: 'FD-LAB', contractId: 'CT-001', name: 'Análisis de laboratorio', parentId: null, kind: 'custom', predefined: false },
]

export const files: FileAsset[] = [
  { id: 'FILE-01', contractId: 'CT-001', folderId: 'FD-CONTRACT', name: 'Contrato_LPI-SRO-2024-014.pdf', mimeType: 'application/pdf', sizeBytes: 4_200_000, uploadedById: 'U-RES', uploadedAt: d('2024-01-10'), downloadUrl: '#' },
  { id: 'FILE-10', contractId: 'CT-001', folderId: 'FD-EVIDENCE', name: 'topografia_norte.jpg', mimeType: 'image/jpeg', sizeBytes: 1_800_000, uploadedById: 'U-SUP', uploadedAt: d('2024-02-05'), downloadUrl: '#' },
]

export const evidenceNotes: EvidenceNote[] = [
  { id: 'EVN-01', contractId: 'CT-001', title: 'Condición del terreno - polígono norte', body: 'Fotografías del estado del terreno antes del inicio.', date: d('2024-02-05'), fileIds: ['FILE-10'], authorId: 'U-SUP', createdAt: d('2024-02-05') },
]

// --- Alerts ----------------------------------------------------------------
export const alerts: Alert[] = [
  { id: 'AL-01', userId: 'U-SVR', contractId: 'CT-001', kind: 'pending_signature', message: 'La estimación #2 espera tu firma.', read: false, createdAt: d('2024-04-02') },
  { id: 'AL-02', userId: 'U-SUP', contractId: 'CT-001', kind: 'estimate_returned', message: 'La estimación #2 fue devuelta con notas.', read: false, createdAt: d('2024-04-05') },
]