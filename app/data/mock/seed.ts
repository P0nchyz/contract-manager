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
  LogNoteCategory,
  ModificationAgreement,
  ReceptionStatement,
  User,
  WorkSchedule,
  ConceptScheduleEntry,
} from '../models'

const d = (iso: string) => new Date(iso)

// --- Organizations ---------------------------------------------------------
export const corporations: Corporation[] = [
  { id: 'CORP-001', name: 'Constructora del Valle, S.A. de C.V.', rfc: 'CVA120511AB3', active: true },
  { id: 'CORP-002', name: 'Supervisores Técnicos Asociados, S.C.', rfc: 'STA150309XY2', active: true },
]

export const users: User[] = [
  { id: 'U-ADMIN', fullName: 'Ana Admin',                       username: 'admin',       email: 'admin@example.mx', role: 'admin',          corporationId: null,       entityId: null,    cedula: null, active: true },
  { id: 'U-ENT',  fullName: 'Dirección General de Obra Pública', username: 'entidad',     email: 'ent@srob.gob.mx',  role: 'entity',         corporationId: null,       entityId: null,    cedula: null, active: true },
  { id: 'U-RES',  fullName: 'Roberto Residente',                 username: 'rresidente',  email: 'rres@srob.gob.mx', role: 'resident',       corporationId: null,       entityId: 'U-ENT', cedula: '1234567', active: true },
  { id: 'U-SUP',  fullName: 'Susana Superintendente',            username: 'ssuper',      email: 'ssup@example.mx',  role: 'superintendent', corporationId: 'CORP-001', entityId: null,    cedula: '7654321', active: true },
  { id: 'U-SVR',  fullName: 'Sergio Supervisor',                 username: 'ssupervisor', email: 'ssvr@example.mx',  role: 'supervisor',     corporationId: 'CORP-002', entityId: null,    cedula: null, active: true },
  { id: 'U-FIN',  fullName: 'Fabiola Financiera',                username: 'ffinanzas',   email: 'ffin@srob.gob.mx', role: 'financial',      corporationId: null,       entityId: 'U-ENT', cedula: null, active: true },
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
    estimatePeriodicity: 'monthly' as const,
    startDate: d('2024-01-15'),
    endDate: d('2024-12-31'),
    entityId: 'U-ENT',
    createdById: 'U-ENT',
    residentId: 'U-RES',
    superintendentId: 'U-SUP',
    supervisorId: 'U-SVR',
    superintendentCorporationId: 'CORP-001',
    supervisorCorporationId: 'CORP-002',
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
  { id: 'CN-01', contractId: 'CT-001', sectionId: 'CS-01' as ConceptSection['id'], specificationNumber: 'E-101', description: 'Levantamiento topográfico con estación total', unit: 'ha', unitPrice: 1_850_000, contractedQuantity: 40, isExtra: false, extendsConceptId: null, originAgreementId: null },
  { id: 'CN-02', contractId: 'CT-001', sectionId: 'CS-02' as ConceptSection['id'], specificationNumber: 'E-205', description: 'Modelado BIM de estructura principal', unit: 'm2', unitPrice: 95_000, contractedQuantity: 12_000, isExtra: false, extendsConceptId: null, originAgreementId: null },
  { id: 'CN-03', contractId: 'CT-001', sectionId: 'CS-02' as ConceptSection['id'], specificationNumber: 'E-210', description: 'Modelado BIM de instalaciones MEP', unit: 'm2', unitPrice: 120_000, contractedQuantity: 12_000, isExtra: false, extendsConceptId: null, originAgreementId: null },
  { id: 'CN-04', contractId: 'CT-001', sectionId: 'CS-02' as ConceptSection['id'], specificationNumber: 'E-330', description: 'Detección de interferencias (clash detection)', unit: 'lote', unitPrice: 48_000_000, contractedQuantity: 1, isExtra: false, extendsConceptId: null, originAgreementId: null },
  { id: 'CN-05', contractId: 'CT-001', sectionId: 'CS-03' as ConceptSection['id'], specificationNumber: 'E-410', description: 'Capacitación al personal en plataforma', unit: 'curso', unitPrice: 9_500_000, contractedQuantity: 6, isExtra: false, extendsConceptId: null, originAgreementId: null },
]

// --- Estimates -------------------------------------------------------------
export const estimates: Estimate[] = [
  {
    id: 'ES-001',
    contractId: 'CT-001',
    number: 1,
    periodIndex: 1,
    kind: 'normal',
    status: 'paid',
    periodStart: d('2024-01-15'),
    periodEnd: d('2024-01-31'),
    cover: {
      entityName: 'Dirección General de Obra Pública',
      contractCode: 'LPI-SRO-2024-014',
      contractTitle: 'Diseñar e instrumentar el modelo virtual AutoDesk',
      contractStartDate: d('2024-01-15'),
      contractorName: 'Constructora del Valle, S.A. de C.V.',
      contractorRfc: 'CVA120511AB3',
      estimateNumber: 1,
      periodIndex: 1,
      periodStart: d('2024-01-15'),
      periodEnd: d('2024-01-31'),
    },
    hojas: [
      {
        id: 'HG-001', number: 1, conceptId: 'CN-01' as Concept['id'],
        specificationNumber: 'E-101', description: 'Levantamiento topográfico con estación total',
        unit: 'ha', sectionId: 'CS-01' as ConceptSection['id'],
        contractedQuantity: 40, unitPrice: 1_850_000,
        rows: [
          { id: 'HR-001', quantity: 12, photoFileId: 'FILE-10' as FileAsset['id'], fileIds: [], logNoteIds: ['LN-002'] as LogNote['id'][] },
          { id: 'HR-002', quantity: 8,  photoFileId: 'FILE-10' as FileAsset['id'], fileIds: [], logNoteIds: [] },
        ],
      },
    ],
    lineItems: [
      { conceptId: 'CN-01', conceptNumber: 1, specificationNumber: 'E-101', description: 'Levantamiento topográfico con estación total', unit: 'ha', inProject: 40, upToLastEstimate: 0, inThisEstimate: 20, totalEstimated: 20, toExecute: 20, unitPrice: 1_850_000, totalAmount: 37_000_000 },
    ],
    summary: {
      partidas: [
        { sectionId: 'CS-01' as ConceptSection['id'], partidaNumber: 'A', description: 'Trabajos topográficos y modelado', amount: 37_000_000 },
      ],
      partidasSubtotal: 37_000_000,
      calculations: {
        ivaRate: 16,
        estimateAmount: 37_000_000,
        estimateIva: 5_920_000,
        estimateTotal: 42_920_000,
        anticipoAmortization: 11_100_000,
        amortizationIva: 1_776_000,
        amortizationTotal: 12_876_000,
        cincoAlMillarSfp: 185_000,
        total: 28_009_000,
      },
    },
    evidenceFileIds: ['FILE-10'] as FileAsset['id'][],
    sectionNotes: {},
    paymentRequest: {
      accountHolder: 'Constructora del Valle S.A. de C.V.',
      bankName: 'BBVA México',
      accountNumber: '0123456789',
      clabe: '012180001234567895',
      fileIds: ['FILE-01'] as FileAsset['id'][],
      requestedById: 'U-SUP',
      requestedAt: d('2024-02-06'),
    },
    signatures: [
      { id: 'SG-1', role: 'superintendent', userId: 'U-SUP', signedAt: d('2024-02-02'), status: 'signed' },
      { id: 'SG-2', role: 'supervisor', userId: 'U-SVR', signedAt: d('2024-02-04'), status: 'signed' },
      { id: 'SG-3', role: 'resident', userId: 'U-RES', signedAt: d('2024-02-05'), status: 'signed' },
    ],
    history: [
      { id: 'EV-1', action: 'created', byUserId: 'U-SUP', at: d('2024-02-01') },
      { id: 'EV-2', action: 'submitted', byUserId: 'U-SUP', at: d('2024-02-02') },
      { id: 'EV-3', action: 'approved', byUserId: 'U-SVR', at: d('2024-02-04') },
      { id: 'EV-4', action: 'paid', byUserId: 'U-FIN', at: d('2024-02-12') },
    ],
    createdById: 'U-SUP',
    createdAt: d('2024-02-01'),
    updatedAt: d('2024-02-12'),
  },
  {
    id: 'ES-002',
    contractId: 'CT-001',
    number: 2,
    periodIndex: 2,
    kind: 'normal',
    status: 'rejected',
    periodStart: d('2024-02-01'),
    periodEnd: d('2024-02-29'),
    cover: {
      entityName: 'Dirección General de Obra Pública',
      contractCode: 'LPI-SRO-2024-014',
      contractTitle: 'Diseñar e instrumentar el modelo virtual AutoDesk',
      contractStartDate: d('2024-01-15'),
      contractorName: 'Constructora del Valle, S.A. de C.V.',
      contractorRfc: 'CVA120511AB3',
      estimateNumber: 2,
      periodIndex: 2,
      periodStart: d('2024-02-01'),
      periodEnd: d('2024-02-29'),
    },
    hojas: [
      {
        id: 'HG-002', number: 1, conceptId: 'CN-01' as Concept['id'],
        specificationNumber: 'E-101', description: 'Levantamiento topográfico con estación total',
        unit: 'ha', sectionId: 'CS-01' as ConceptSection['id'],
        contractedQuantity: 40, unitPrice: 1_850_000,
        rows: [
          { id: 'HR-003', quantity: 20, photoFileId: 'FILE-10' as FileAsset['id'], fileIds: [], logNoteIds: [] },
        ],
      },
      {
        id: 'HG-003', number: 2, conceptId: 'CN-02' as Concept['id'],
        specificationNumber: 'E-205', description: 'Modelado BIM de estructura principal',
        unit: 'm2', sectionId: 'CS-02' as ConceptSection['id'],
        contractedQuantity: 12_000, unitPrice: 95_000,
        rows: [
          { id: 'HR-004', quantity: 1_500, photoFileId: 'FILE-10' as FileAsset['id'], fileIds: [], logNoteIds: ['LN-003'] as LogNote['id'][] },
          { id: 'HR-005', quantity: 900,   photoFileId: 'FILE-10' as FileAsset['id'], fileIds: [], logNoteIds: [] },
        ],
      },
    ],
    lineItems: [
      { conceptId: 'CN-01', conceptNumber: 1, specificationNumber: 'E-101', description: 'Levantamiento topográfico con estación total', unit: 'ha', inProject: 40, upToLastEstimate: 20, inThisEstimate: 20, totalEstimated: 40, toExecute: 0, unitPrice: 1_850_000, totalAmount: 37_000_000 },
      { conceptId: 'CN-02', conceptNumber: 2, specificationNumber: 'E-205', description: 'Modelado BIM de estructura principal', unit: 'm2', inProject: 12_000, upToLastEstimate: 0, inThisEstimate: 2_400, totalEstimated: 2_400, toExecute: 9_600, unitPrice: 95_000, totalAmount: 228_000_000 },
    ],
    summary: {
      partidas: [
        { sectionId: 'CS-01' as ConceptSection['id'], partidaNumber: 'A', description: 'Trabajos topográficos y modelado', amount: 37_000_000 },
        { sectionId: 'CS-02' as ConceptSection['id'], partidaNumber: 'B', description: 'Implementación BIM y coordinación', amount: 228_000_000 },
      ],
      partidasSubtotal: 265_000_000,
      calculations: {
        ivaRate: 16,
        estimateAmount: 265_000_000,
        estimateIva: 42_400_000,
        estimateTotal: 307_400_000,
        anticipoAmortization: 79_500_000,
        amortizationIva: 12_720_000,
        amortizationTotal: 92_220_000,
        cincoAlMillarSfp: 1_325_000,
        total: 200_605_000,
      },
    },
    evidenceFileIds: ['FILE-10'] as FileAsset['id'][],
    sectionNotes: {
      services: 'Verificar que las cantidades de levantamiento coincidan con el plano topográfico anexo.',
      'hoja:CN-02': 'Falta soporte fotográfico del segundo tramo de modelado. Adjuntar evidencia por renglón.',
      evidence: 'Faltan fotografías generales del avance de este periodo.',
    },
    paymentRequest: null,
    signatures: [
      { id: 'SG-4', role: 'superintendent', userId: 'U-SUP', signedAt: d('2024-03-02'), status: 'signed' },
      { id: 'SG-5', role: 'supervisor', userId: null, signedAt: null, status: 'pending' },
      { id: 'SG-6', role: 'resident', userId: null, signedAt: null, status: 'pending' },
    ],
    history: [
      { id: 'EV-5', action: 'created', byUserId: 'U-SUP', at: d('2024-03-01') },
      { id: 'EV-6', action: 'submitted', byUserId: 'U-SUP', at: d('2024-03-02') },
      { id: 'EV-7', action: 'rejected', byUserId: 'U-SVR', at: d('2024-03-05') },
    ],
    createdById: 'U-SUP',
    createdAt: d('2024-03-01'),
    updatedAt: d('2024-03-05'),
  },
]

// --- Logbook (each signed by resident + superintendent + supervisor) -------
export const logNotes: LogNote[] = [
  {
    id: 'LN-001', contractId: 'CT-001', folio: 1, category: 'apertura' as LogNoteCategory,
    title: 'Apertura de Bitácora',
    fixedBody: `Con fecha de hoy, 15 de enero de 2024, se declara formalmente abierta la Bitácora Electrónica y Seguimiento a Obra Pública (BESOP) de la presente obra, de conformidad con lo establecido en los Artículos 46 de la Ley de Obras Públicas y Servicios Relacionados con las Mismas, así como el 122, 123 y 124 de su Reglamento.

Para efectos de dar constancia jurídica y técnica al desarrollo de los trabajos, se asientan los datos generales del contrato de obra base:

• Contrato No.: LPI-SRO-2024-014
• Obra: Diseñar e instrumentar el modelo virtual AutoDesk
• Dependencia Convocante: Dirección General de Obra Pública
• Contratista: Constructora del Valle, S.A. de C.V.
• Monto Contractual: $27,590,000.00 M.N. (antes de I.V.A.)
• Monto del Anticipo (30%): $8,277,000.00 M.N. (antes de I.V.A.)
• Plazo de Ejecución: 351 días naturales
• Fecha de Inicio Contractual: 15 de enero de 2024
• Fecha de Término Contractual: 31 de diciembre de 2024

Se registran las personalidades técnicas autorizadas para actuar en este libro digital:

• Por la Dependencia (Residente de Obra): Roberto Residente (Cédula Prof. 1234567)
• Por la Empresa Contratista (Superintendente): Susana Superintendente (Cédula Prof. 7654321)

Ambas partes reconocen la obligatoriedad y validez jurídica de los asientos realizados en este sistema, comprometiéndose a su revisión y firma diaria.`,
    customBody: '',
    isOpeningNote: true,
    authorId: 'U-RES',
    signatures: [
      { id: 'LS-1', role: 'superintendent', userId: 'U-SUP', signedAt: d('2024-01-15'), status: 'signed' },
      { id: 'LS-2', role: 'supervisor',     userId: 'U-SVR', signedAt: d('2024-01-15'), status: 'signed' },
      { id: 'LS-3', role: 'resident',       userId: 'U-RES', signedAt: d('2024-01-15'), status: 'signed' },
    ],
    locked: true, createdAt: d('2024-01-15'),
  },
  {
    id: 'LN-002', contractId: 'CT-001', folio: 2, category: 'inicio_trabajos' as LogNoteCategory,
    title: 'Inicio de levantamiento topográfico',
    fixedBody: null,
    customBody: 'Se inician trabajos de levantamiento en el polígono norte. Condiciones del terreno favorables. Equipo completo en sitio.',
    isOpeningNote: false,
    authorId: 'U-SUP',
    signatures: [
      { id: 'LS-4', role: 'superintendent', userId: 'U-SUP', signedAt: d('2024-02-05'), status: 'signed' },
      { id: 'LS-5', role: 'supervisor',     userId: 'U-SVR', signedAt: d('2024-02-06'), status: 'signed' },
      { id: 'LS-6', role: 'resident',       userId: 'U-RES', signedAt: d('2024-02-06'), status: 'signed' },
    ],
    locked: true, createdAt: d('2024-02-05'),
  },
  {
    id: 'LN-003', contractId: 'CT-001', folio: 3, category: 'estimaciones' as LogNoteCategory,
    title: 'Avance de modelado estructural',
    fixedBody: null,
    customBody: 'Avance del 40% en el modelado de la estructura principal. Se presentan 3,000 m2 de modelado BIM para validación del supervisor.',
    isOpeningNote: false,
    authorId: 'U-SUP',
    signatures: [
      { id: 'LS-7', role: 'superintendent', userId: 'U-SUP', signedAt: d('2024-03-20'), status: 'signed' },
      { id: 'LS-8', role: 'supervisor',     userId: null,    signedAt: null,             status: 'pending' },
      { id: 'LS-9', role: 'resident',       userId: null,    signedAt: null,             status: 'pending' },
    ],
    locked: false, createdAt: d('2024-03-20'),
  },
]

// --- Modification agreements ----------------------------------------------
export const agreements: ModificationAgreement[] = [
  { id: 'AG-001', contractId: 'CT-001', number: 1, kind: 'amount', description: 'Ampliación de alcance: 2,000 m2 adicionales de modelado MEP.', conceptChanges: [], newConcepts: [], newSections: [], scheduleMoves: [], newContractStartDate: null, newContractEndDate: null, amountDelta: 240_000_000, timeDeltaDays: null, status: 'approved', signatures: [
    { id: 'AS-1', role: 'superintendent', userId: 'U-SUP', signedAt: d('2024-03-15'), status: 'signed' },
    { id: 'AS-2', role: 'supervisor', userId: 'U-SVR', signedAt: d('2024-03-16'), status: 'signed' },
    { id: 'AS-3', role: 'resident', userId: 'U-RES', signedAt: d('2024-03-17'), status: 'signed' },
  ], history: [
    { id: 'AE-1', action: 'created', byUserId: 'U-RES', at: d('2024-03-14') },
    { id: 'AE-2', action: 'submitted', byUserId: 'U-RES', at: d('2024-03-14') },
    { id: 'AE-3', action: 'approved', byUserId: 'U-SVR', at: d('2024-03-16') },
  ], attachmentFileIds: ['FILE-01'], createdById: 'U-RES', createdAt: d('2024-03-14'), updatedAt: d('2024-03-16') },
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
  { id: 'FD-ESTIMACIONES', contractId: 'CT-001', name: 'Estimaciones', parentId: 'FD-EVIDENCE', kind: 'custom', predefined: true },
  { id: 'FD-HOJAS', contractId: 'CT-001', name: 'Hojas generadoras', parentId: 'FD-ESTIMACIONES', kind: 'hoja_generadora', predefined: true },
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