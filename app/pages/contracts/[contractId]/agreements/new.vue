<!-- app/pages/contracts/[contractId]/agreements/new.vue -->
<script setup lang="ts">
import { ref, computed, watch, watchEffect } from 'vue'
import { S } from '~/constants/strings'
import { isRepositoryError } from '~/data/errors'
import { formatNumber, formatMoney, formatDate } from '~/utils/format'
import { buildPeriods } from '~/data/calc/schedule'
import { groupConceptsBySections } from '~/composables/useConceptSections'
import type { ConceptChange, NewConceptDraft, NewSectionDraft, ScheduleMove, AgreementKind } from '~/data/models/agreements'
import type { ConceptId, FileAsset } from '~/data/models'

definePageMeta({ requiredPermission: 'agreement:create' })

const AG = S.agreement

const route = useRoute()
const repos = useRepositories()
const contractId = computed(() => route.params.contractId as string)
const editId = computed(() => (typeof route.query.edit === 'string' ? route.query.edit : null))
const isEdit = computed(() => !!editId.value)

const toInputDate = (d: Date | string | undefined) =>
  d ? new Date(d).toISOString().slice(0, 10) : ''

// ─── Data load ───────────────────────────────────────────────────────────────
const { data, status, error, refresh } = await useAsyncData(
  () => `agreement-form-${contractId.value}-${editId.value ?? 'new'}`,
  async () => {
    const [contract, sections, concepts, schedule, estimates, folders, files, editing] = await Promise.all([
      repos.contracts.getById(contractId.value),
      repos.concepts.listSectionsByContract(contractId.value),
      repos.concepts.listByContract(contractId.value),
      repos.schedule.getByContract(contractId.value).catch(() => null),
      repos.estimates.listByContract(contractId.value).catch(() => []),
      repos.files.listFolders(contractId.value).catch(() => []),
      repos.files.listFiles(contractId.value).catch(() => []),
      editId.value ? repos.agreements.getById(editId.value).catch(() => null) : Promise.resolve(null),
    ])
    const periods = buildPeriods(
      new Date(contract.startDate), new Date(contract.endDate), contract.estimatePeriodicity ?? 'monthly',
    )
    return {
      contract, sections, concepts, groups: groupConceptsBySections(sections, concepts),
      scheduleEntries: schedule?.entries ?? [], periods, estimates, folders, files, editing,
    }
  },
)

// ─── Kind — chosen explicitly, fixed once the agreement exists ──────────────
const kind = ref<AgreementKind>(data.value?.editing?.kind ?? 'amount')

// ─── Shared: description ──────────────────────────────────────────────────────
const description = ref('')

// ─── AMOUNT-type state ────────────────────────────────────────────────────────
const conceptChanges = ref<(ConceptChange & { _newQtyRaw: string; _newPriceRaw: string })[]>([])
type NewConceptEntry = NewConceptDraft & { _qtyRaw: string; _priceRaw: string; _mode: 'new' | 'extend' }
const newConcepts = ref<NewConceptEntry[]>([])
const newSections = ref<NewSectionDraft[]>([])

// ─── SCHEDULE-type state ──────────────────────────────────────────────────────
const scheduleMoves = ref<ScheduleMove[]>([])
const newContractStartRaw = ref('')
const newContractEndRaw = ref('')
// Declared early: effectivePeriods (below) reads these, and an immediate
// watch further down evaluates that chain synchronously at setup time — so
// these must already exist before that point, not just later in file order.
const newContractStartDate = computed(() =>
  newContractStartRaw.value ? new Date(`${newContractStartRaw.value}T12:00:00`) : null,
)
const newContractEndDate = computed(() =>
  newContractEndRaw.value ? new Date(`${newContractEndRaw.value}T12:00:00`) : null,
)

const inited = ref(false)
watchEffect(() => {
  if (!data.value || inited.value) return
  const e = data.value.editing
  if (e) {
    kind.value = e.kind
    description.value = e.description
    conceptChanges.value = e.conceptChanges.map((cc) => ({
      ...cc,
      _newQtyRaw: cc.newQuantity != null ? String(cc.newQuantity) : '',
      _newPriceRaw: cc.newUnitPrice != null ? String(cc.newUnitPrice / 100) : '',
    }))
    newConcepts.value = e.newConcepts.map((nc) => ({
      ...nc,
      _qtyRaw: String(nc.contractedQuantity),
      _priceRaw: String(nc.unitPrice / 100),
      _mode: nc.extendsConceptId ? 'extend' : 'new',
    }))
    newSections.value = (e.newSections ?? []).map((ns) => ({ ...ns }))
    scheduleMoves.value = (e.scheduleMoves ?? []).map((m) => ({ ...m }))
    if (e.newContractStartDate) newContractStartRaw.value = toInputDate(e.newContractStartDate)
    if (e.newContractEndDate) newContractEndRaw.value = toInputDate(e.newContractEndDate)
    existingAttachmentIds.value = [...(e.attachmentFileIds ?? [])]
  }
  inited.value = true
})

// ─── AMOUNT: concept-reduction picker ─────────────────────────────────────────
const pickerSearch = ref('')
const alreadyAdded = computed(() => new Set(conceptChanges.value.map((c) => c.conceptId)))
const pickerGroups = computed(() => {
  const q = pickerSearch.value.trim().toLowerCase()
  return (data.value?.groups ?? [])
    .map((g) => ({
      ...g,
      concepts: g.concepts.filter(
        (c) =>
          !c.isExtra && !alreadyAdded.value.has(c.id) &&
          (!q || c.specificationNumber.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)),
      ),
    }))
    .filter((g) => g.concepts.length > 0)
})
function addConceptChange(conceptId: ConceptId) {
  conceptChanges.value.push({ conceptId, _newQtyRaw: '', _newPriceRaw: '' })
}
function removeConceptChange(idx: number) {
  const [removed] = conceptChanges.value.splice(idx, 1)
  if (removed) delete reductionQty.value[String(removed.conceptId)]
}

// Which periods lose schedule when a concept's quantity is reduced — capped
// by that period's UNCLAIMED (not yet estimated) amount, since already-
// estimated quantity can't be taken back. Keyed by conceptId -> periodIndex0.
const reductionQty = ref<Record<string, Record<number, number>>>({})
function reductionQtyFor(conceptId: string, periodIdx0: number): number {
  return reductionQty.value[conceptId]?.[periodIdx0] ?? 0
}
function setReductionQty(conceptId: string, periodIdx0: number, raw: string) {
  const v = parseFloat(raw)
  if (!reductionQty.value[conceptId]) reductionQty.value[conceptId] = {}
  reductionQty.value[conceptId][periodIdx0] = isNaN(v) ? 0 : v
}
function unclaimedForReduction(conceptId: string, periodIdx0: number): number {
  return Math.max(0, plannedFor(conceptId, periodIdx0) - claimedFor(conceptId, periodIdx0))
}
// Periods where this concept actually has any schedule at all (only these are shown)
function scheduledPeriodsFor(conceptId: string): number[] {
  if (!data.value) return []
  const out: number[] = []
  for (let p = 0; p < data.value.periods.length; p++) {
    if (plannedFor(conceptId, p) > 0) out.push(p)
  }
  return out
}
// Target reduction = how much the concept's total quantity is shrinking by
function reductionTargetFor(conceptId: string, newQtyRaw: string): number {
  const orig = data.value?.concepts.find((c) => c.id === conceptId)
  if (!orig) return 0
  const newQty = parseFloat(newQtyRaw)
  if (isNaN(newQty)) return 0
  return Math.max(0, orig.contractedQuantity - newQty)
}
function reductionTotalFor(conceptId: string): number {
  const row = reductionQty.value[conceptId] ?? {}
  return Object.values(row).reduce((s, v) => s + v, 0)
}
function isReductionBalanced(conceptId: string, newQtyRaw: string): boolean {
  return Math.abs(reductionTotalFor(conceptId) - reductionTargetFor(conceptId, newQtyRaw)) < 1e-9
}

// ─── AMOUNT: new sections ─────────────────────────────────────────────────────
function addNewSection() {
  newSections.value.push({
    specificationNumber: '',
    description: '',
    order: (data.value?.sections.length ?? 0) + newSections.value.length,
  })
}
function removeNewSection(idx: number) {
  newSections.value.splice(idx, 1)
  newConcepts.value.forEach((nc) => {
    if ((nc.sectionId as unknown) === `new:${idx}`) nc.sectionId = null
    const refv = nc.sectionId as string | null
    if (refv?.startsWith('new:')) {
      const refIdx = parseInt(refv.slice(4), 10)
      if (refIdx > idx) (nc as unknown as { sectionId: string }).sectionId = `new:${refIdx - 1}`
    }
  })
}

// ─── AMOUNT: additional concepts (extend existing OR brand new) ──────────────
function addNewConcept(mode: 'new' | 'extend' = 'new') {
  newConcepts.value.push({
    specificationNumber: '', description: '', unit: '', unitPrice: 0, contractedQuantity: 0,
    sectionId: null, extendsConceptId: null, _qtyRaw: '', _priceRaw: '', _mode: mode,
  })
}
function removeNewConcept(idx: number) {
  newConcepts.value.splice(idx, 1)
  delete newConceptAllocation.value[idx]
  // Reindex allocations for rows after the removed one
  const next: Record<number, Record<number, number>> = {}
  for (const [k, v] of Object.entries(newConceptAllocation.value)) {
    const ki = Number(k)
    next[ki > idx ? ki - 1 : ki] = v
  }
  newConceptAllocation.value = next
}
// Which periods get schedule for a brand-new/extra concept — no claimed
// constraint at all, since it's a fresh concept with no prior schedule.
// Keyed by index into newConcepts (the concept doesn't have a real id yet).
const newConceptAllocation = ref<Record<number, Record<number, number>>>({})
function allocationQtyFor(idx: number, periodIdx0: number): number {
  return newConceptAllocation.value[idx]?.[periodIdx0] ?? 0
}
function setAllocationQty(idx: number, periodIdx0: number, raw: string) {
  const v = parseFloat(raw)
  if (!newConceptAllocation.value[idx]) newConceptAllocation.value[idx] = {}
  newConceptAllocation.value[idx][periodIdx0] = isNaN(v) ? 0 : v
}
function allocationTotalFor(idx: number): number {
  const row = newConceptAllocation.value[idx] ?? {}
  return Object.values(row).reduce((s, v) => s + v, 0)
}
function isAllocationBalanced(idx: number, qtyRaw: string): boolean {
  const target = parseFloat(qtyRaw)
  if (isNaN(target)) return true // nothing to balance yet
  return Math.abs(allocationTotalFor(idx) - target) < 1e-9
}
// Only non-extra concepts can be extended (an extra concept extending another extra gets confusing fast)
const extendableConcepts = computed(() => (data.value?.concepts ?? []).filter((c) => !c.isExtra))
function onPickExtendConcept(entry: NewConceptEntry, conceptId: string) {
  const orig = data.value?.concepts.find((c) => String(c.id) === conceptId)
  if (!orig) return
  entry.extendsConceptId = orig.id
  entry.specificationNumber = orig.specificationNumber
  entry.description = orig.description
  entry.unit = orig.unit
  entry.sectionId = orig.sectionId
  if (!entry._priceRaw) entry._priceRaw = String(orig.unitPrice / 100)
}

// ─── SCHEDULE: claimed / unclaimed math ───────────────────────────────────────
function claimedFor(conceptId: string, periodIdx0: number): number {
  if (!data.value) return 0
  let claimed = 0
  for (const est of data.value.estimates) {
    if (est.status === 'draft' || est.status === 'rejected') continue
    if (est.periodIndex - 1 !== periodIdx0) continue
    for (const h of est.hojas) {
      if (String(h.conceptId) !== String(conceptId)) continue
      claimed += h.rows.reduce((s, r) => s + r.quantity, 0)
    }
  }
  return claimed
}
function plannedFor(conceptId: string, periodIdx0: number): number {
  if (!data.value) return 0
  return data.value.scheduleEntries
    .filter((se) => String(se.conceptId) === String(conceptId) && se.periodIndex === periodIdx0)
    .reduce((s, se) => s + se.plannedQuantity, 0)
}
function conceptLabel(id: string): string {
  const c = data.value?.concepts.find((c) => String(c.id) === String(id))
  return c ? `${c.specificationNumber} ${c.description}` : String(id)
}

// ─── SCHEDULE: period-tab grid editor (mirrors the contract-creation
// schedule input) — edit quantities directly; the diff vs the original is
// what actually gets sent as discrete moves on save. ─────────────────────────
const workingQty = ref<Record<string, Record<number, number>>>({})
const activeScheduleTab = ref(0)

// Periods reflecting this SAME draft's pending date change (if any) — so
// extending the contract immediately opens new period tabs, without needing
// to save the date change in a separate agreement first.
const effectivePeriods = computed(() => {
  if (!data.value) return []
  const start = newContractStartDate.value ?? new Date(data.value.contract.startDate)
  const end = newContractEndDate.value ?? new Date(data.value.contract.endDate)
  return buildPeriods(start, end, data.value.contract.estimatePeriodicity ?? 'monthly')
})
// If the date change would REMOVE trailing periods, keep showing them (as a
// distinct, flagged range) so the user can move their quantity out first —
// otherwise it'd be silently stranded once the shorter range is approved.
const gridPeriodCount = computed(() => Math.max(effectivePeriods.value.length, data.value?.periods.length ?? 0))
function isPeriodBeingRemoved(periodIdx0: number): boolean {
  return periodIdx0 >= effectivePeriods.value.length
}

watchEffect(() => {
  if (!data.value || Object.keys(workingQty.value).length) return // seed once
  const map: Record<string, Record<number, number>> = {}
  for (const c of data.value.concepts) {
    const cid = String(c.id)
    map[cid] = {}
    for (let p = 0; p < data.value.periods.length; p++) map[cid][p] = plannedFor(cid, p)
  }
  // Editing an existing schedule-type draft: apply its own already-saved
  // moves on top, so the grid reflects where the user left off instead of
  // the raw current schedule (which would silently discard those moves).
  const e = data.value.editing
  if (e && e.kind === 'schedule') {
    for (const m of (e.scheduleMoves ?? [])) {
      const cid = String(m.conceptId)
      if (!map[cid]) map[cid] = {}
      if (m.fromPeriodIndex >= 0) map[cid][m.fromPeriodIndex] = (map[cid][m.fromPeriodIndex] ?? 0) - m.quantity
      if (m.toPeriodIndex >= 0) map[cid][m.toPeriodIndex] = (map[cid][m.toPeriodIndex] ?? 0) + m.quantity
    }
  }
  workingQty.value = map
})

function workingQtyFor(conceptId: string, periodIdx0: number): number {
  return workingQty.value[conceptId]?.[periodIdx0] ?? 0
}
function setWorkingQty(conceptId: string, periodIdx0: number, raw: string) {
  const v = parseFloat(raw)
  if (!workingQty.value[conceptId]) workingQty.value[conceptId] = {}
  workingQty.value[conceptId][periodIdx0] = isNaN(v) ? 0 : v
}
// A period already fully claimed for this concept can't be touched at all;
// a partially-claimed period can only shrink toward its claimed floor
// (growing it would mean adding to an already-estimated period). A period
// being removed by a pending date change can only shrink toward 0.
function cellMin(conceptId: string, periodIdx0: number): number {
  return claimedFor(conceptId, periodIdx0)
}
function cellMax(conceptId: string, periodIdx0: number): number | null {
  const claimed = claimedFor(conceptId, periodIdx0)
  if (claimed > 0) return plannedFor(conceptId, periodIdx0)
  return null
}
function isCellLocked(conceptId: string, periodIdx0: number): boolean {
  const claimed = claimedFor(conceptId, periodIdx0)
  return claimed > 0 && claimed >= plannedFor(conceptId, periodIdx0)
}

function originalTotalFor(conceptId: string): number {
  if (!data.value) return 0
  let total = 0
  for (let p = 0; p < gridPeriodCount.value; p++) total += plannedFor(conceptId, p)
  return total
}
function workingTotalFor(conceptId: string): number {
  if (!data.value) return 0
  let total = 0
  for (let p = 0; p < gridPeriodCount.value; p++) total += workingQtyFor(conceptId, p)
  return total
}
function isBalanced(conceptId: string): boolean {
  return Math.abs(workingTotalFor(conceptId) - originalTotalFor(conceptId)) < 1e-9
}
// Concepts actually touched (some period differs from its original value)
const editedConceptIds = computed(() => {
  if (!data.value) return []
  const ids: string[] = []
  for (const c of data.value.concepts) {
    const cid = String(c.id)
    for (let p = 0; p < gridPeriodCount.value; p++) {
      if (workingQtyFor(cid, p) !== plannedFor(cid, p)) { ids.push(cid); break }
    }
  }
  return ids
})
const allBalanced = computed(() => editedConceptIds.value.every((cid) => isBalanced(cid)))
// Every period being removed by a pending date change must be emptied out
// first — otherwise that quantity would be silently stranded on approval.
const hasStrandedQuantity = computed(() => {
  for (let p = effectivePeriods.value.length; p < gridPeriodCount.value; p++) {
    for (const c of (data.value?.concepts ?? [])) {
      if (workingQtyFor(String(c.id), p) > 0) return true
    }
  }
  return false
})

// Derive discrete from/to moves from the diff (greedily pairs decreases with
// increases per concept) — this is what's actually sent to the server, so
// the existing backend/model needs no changes.
const derivedMoves = computed<ScheduleMove[]>(() => {
  const moves: ScheduleMove[] = []
  if (!data.value) return moves
  for (const cid of editedConceptIds.value) {
    const decreases: { p: number; amt: number }[] = []
    const increases: { p: number; amt: number }[] = []
    for (let p = 0; p < gridPeriodCount.value; p++) {
      const diff = workingQtyFor(cid, p) - plannedFor(cid, p)
      if (diff < -1e-9) decreases.push({ p, amt: -diff })
      else if (diff > 1e-9) increases.push({ p, amt: diff })
    }
    let di = 0, ii = 0
    while (di < decreases.length && ii < increases.length) {
      const amt = Math.min(decreases[di].amt, increases[ii].amt)
      moves.push({ conceptId: cid as ConceptId, fromPeriodIndex: decreases[di].p, toPeriodIndex: increases[ii].p, quantity: amt })
      decreases[di].amt -= amt
      increases[ii].amt -= amt
      if (decreases[di].amt <= 1e-9) di++
      if (increases[ii].amt <= 1e-9) ii++
    }
  }
  return moves
})
watch(derivedMoves, (v) => { scheduleMoves.value = v }, { immediate: true })

// ─── Attachments ─────────────────────────────────────────────────────────────
const existingAttachmentIds = ref<string[]>([])
const existingAttachments = computed(() =>
  (data.value?.files ?? []).filter((f) => existingAttachmentIds.value.includes(f.id)),
)
function removeExistingAttachment(id: string) {
  existingAttachmentIds.value = existingAttachmentIds.value.filter((x) => x !== id)
}

type AttachmentEntry = {
  id: string
  file: File
  status: 'queued' | 'uploading' | 'done' | 'error'
  progress: number
  uploadedFileId: string | null
  errorMsg: string | null
}
const attachmentEntries = ref<AttachmentEntry[]>([])
const isDraggingAttachment = ref(false)
let _attId = 0

function makeAttachmentEntry(f: File): AttachmentEntry {
  return { id: String(++_attId), file: f, status: 'queued', progress: 0, uploadedFileId: null, errorMsg: null }
}
function addAttachments(files: File[]) {
  attachmentEntries.value.push(...files.map(makeAttachmentEntry))
}
function removeAttachmentEntry(id: string) {
  attachmentEntries.value = attachmentEntries.value.filter((e) => e.id !== id)
}
function onAttachmentDrop(e: DragEvent) {
  isDraggingAttachment.value = false
  addAttachments(Array.from(e.dataTransfer?.files ?? []))
}
function onAttachmentInput(e: Event) {
  addAttachments(Array.from((e.target as HTMLInputElement).files ?? []))
    ; (e.target as HTMLInputElement).value = ''
}
function formatBytes(n: number) {
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1_048_576).toFixed(1)} MB`
}

const viewerOpen = ref(false)
const viewingFile = ref<FileAsset | null>(null)
function openViewer(file: FileAsset) {
  viewingFile.value = file
  viewerOpen.value = true
}

async function uploadAttachments(): Promise<string[]> {
  const contractFolder = (data.value?.folders ?? []).find((f) => f.kind === 'contract')
  const ids: string[] = [...existingAttachmentIds.value]
  for (const entry of attachmentEntries.value) {
    if (entry.status === 'done' && entry.uploadedFileId) {
      ids.push(entry.uploadedFileId)
      continue
    }
    if (entry.status === 'queued' || entry.status === 'error') {
      if (!contractFolder) {
        entry.status = 'error'
        entry.errorMsg = 'No se encontró la carpeta de documentos del contrato.'
        continue
      }
      entry.status = 'uploading'
      entry.progress = 0
      entry.errorMsg = null
      try {
        const asset = await repos.files.upload(
          { contractId: contractId.value, folderId: contractFolder.id, file: entry.file },
          (p) => { entry.progress = p },
        )
        entry.status = 'done'
        entry.progress = 1
        entry.uploadedFileId = asset.id
        ids.push(asset.id)
      } catch (err) {
        entry.status = 'error'
        entry.errorMsg = isRepositoryError(err) ? err.message : S.common.error
      }
    }
  }
  return ids
}

// ─── Derived payload ─────────────────────────────────────────────────────────
const resolvedChanges = computed<ConceptChange[]>(() =>
  conceptChanges.value.map((c) => {
    const qty = parseFloat(c._newQtyRaw)
    const price = parseFloat(c._newPriceRaw)
    return {
      conceptId: c.conceptId,
      newQuantity: isNaN(qty) ? undefined : qty,
      newUnitPrice: isNaN(price) ? undefined : Math.round(price * 100),
    }
  }),
)
const resolvedNewSections = computed<NewSectionDraft[]>(() =>
  newSections.value.map((ns, i) => ({
    specificationNumber: ns.specificationNumber.trim(),
    description: ns.description.trim(),
    order: (data.value?.sections.length ?? 0) + i,
  })),
)
const resolvedNewConcepts = computed<NewConceptDraft[]>(() =>
  newConcepts.value.map((nc) => ({
    specificationNumber: nc.specificationNumber.trim(),
    description: nc.description.trim(),
    unit: nc.unit.trim(),
    contractedQuantity: parseFloat(nc._qtyRaw) || 0,
    unitPrice: Math.round((parseFloat(nc._priceRaw) || 0) * 100),
    sectionId: nc.sectionId ?? null,
    extendsConceptId: nc._mode === 'extend' ? nc.extendsConceptId ?? null : null,
  })),
)

const derivedAmountDelta = computed(() => {
  if (kind.value !== 'amount') return null
  let delta = 0
  for (const ch of resolvedChanges.value) {
    const orig = data.value?.concepts.find((c) => c.id === ch.conceptId)
    if (!orig) continue
    const oldAmt = orig.unitPrice * orig.contractedQuantity
    const newPrice = ch.newUnitPrice ?? orig.unitPrice
    const newQty = ch.newQuantity ?? orig.contractedQuantity
    delta += newPrice * newQty - oldAmt
  }
  for (const nc of resolvedNewConcepts.value) {
    delta += nc.unitPrice * nc.contractedQuantity
  }
  return delta === 0 ? null : delta
})
const derivedTimeDelta = computed(() => {
  if (kind.value !== 'schedule') return null
  if (!newContractEndDate.value || !data.value?.contract?.endDate) return null
  const shift = Math.round(
    (newContractEndDate.value.getTime() - new Date(data.value.contract.endDate).getTime()) / 86_400_000,
  )
  return shift === 0 ? null : shift
})

// ─── Validation ──────────────────────────────────────────────────────────────
const descError = computed(() => (description.value.trim() ? null : AG.validation.descriptionRequired))
const conceptChangeErrors = computed(() =>
  conceptChanges.value.map((cc) => {
    const orig = data.value?.concepts.find((c) => c.id === cc.conceptId)
    const qty = parseFloat(cc._newQtyRaw)
    if (!orig || isNaN(qty)) return ''
    return qty >= orig.contractedQuantity ? AG.conceptChanges.validation.mustReduce : ''
  }),
)
const conceptChangesValid = computed(() =>
  conceptChangeErrors.value.every((e) => !e) &&
  conceptChanges.value.every((cc) => isReductionBalanced(String(cc.conceptId), cc._newQtyRaw)),
)
const newConceptErrors = computed(() =>
  newConcepts.value.map((nc) => ({
    spec: nc.specificationNumber.trim() ? '' : AG.newConcepts.validation.specRequired,
    desc: nc.description.trim() ? '' : AG.newConcepts.validation.descRequired,
    unit: nc.unit.trim() ? '' : AG.newConcepts.validation.unitRequired,
    qty: parseFloat(nc._qtyRaw) > 0 ? '' : AG.newConcepts.validation.qtyRequired,
    price: parseFloat(nc._priceRaw) > 0 ? '' : AG.newConcepts.validation.priceRequired,
    extend: nc._mode === 'extend' && !nc.extendsConceptId ? AG.newConcepts.validation.extendConceptRequired : '',
  })),
)
const newConceptsValid = computed(() =>
  newConceptErrors.value.every((e) => !e.spec && !e.desc && !e.unit && !e.qty && !e.price && !e.extend) &&
  newConcepts.value.every((nc, idx) => isAllocationBalanced(idx, nc._qtyRaw)),
)

const hasAmountChanges = computed(
  () => conceptChanges.value.length > 0 || newConcepts.value.length > 0 || newSections.value.length > 0,
)
const hasScheduleChanges = computed(
  () => scheduleMoves.value.length > 0 || !!newContractStartRaw.value || !!newContractEndRaw.value,
)
const hasChanges = computed(() => (kind.value === 'amount' ? hasAmountChanges.value : hasScheduleChanges.value))
const noChangesError = computed(() => (!hasChanges.value ? AG.validation.noChanges : null))

const canSave = computed(() => {
  if (descError.value || !hasChanges.value) return false
  if (kind.value === 'amount') return conceptChangesValid.value && newConceptsValid.value
  return allBalanced.value && !hasStrandedQuantity.value
})

// ─── Submit ──────────────────────────────────────────────────────────────────
const loading = ref(false)
const submitError = ref<string | null>(null)
const backTo = computed(() =>
  isEdit.value
    ? `/contracts/${contractId.value}/agreements/${editId.value}`
    : `/contracts/${contractId.value}/contract`,
)

// Amount-type schedule side-effects: reductions (pure decrease, no target)
// and new-concept allocations (pure increase, no source) — reuses the same
// ScheduleMove shape as the schedule-type moves via -1 sentinels.
const amountScheduleMoves = computed<ScheduleMove[]>(() => {
  const moves: ScheduleMove[] = []
  for (const cc of conceptChanges.value) {
    const row = reductionQty.value[String(cc.conceptId)] ?? {}
    for (const [p, qty] of Object.entries(row)) {
      if (qty > 0) moves.push({ conceptId: cc.conceptId, fromPeriodIndex: Number(p), toPeriodIndex: -1, quantity: qty })
    }
  }
  newConcepts.value.forEach((_, idx) => {
    const row = newConceptAllocation.value[idx] ?? {}
    for (const [p, qty] of Object.entries(row)) {
      if (qty > 0) moves.push({ conceptId: `new:${idx}` as ConceptId, fromPeriodIndex: -1, toPeriodIndex: Number(p), quantity: qty })
    }
  })
  return moves
})

async function onSave() {
  if (!canSave.value) return
  loading.value = true
  submitError.value = null
  try {
    const attachmentFileIds = await uploadAttachments()
    if (attachmentEntries.value.some((e) => e.status === 'error')) {
      submitError.value = 'Algunos archivos no pudieron subirse. Corrígelos antes de guardar.'
      return
    }
    const payload = {
      kind: kind.value,
      description: description.value.trim(),
      conceptChanges: kind.value === 'amount' ? resolvedChanges.value : [],
      newConcepts: kind.value === 'amount' ? resolvedNewConcepts.value : [],
      newSections: kind.value === 'amount' ? resolvedNewSections.value : [],
      scheduleMoves: kind.value === 'schedule'
        ? scheduleMoves.value.map((m) => ({ ...m }))
        : amountScheduleMoves.value.map((m) => ({ ...m })),
      newContractStartDate: kind.value === 'schedule' ? newContractStartDate.value : null,
      newContractEndDate: kind.value === 'schedule' ? newContractEndDate.value : null,
      amountDelta: derivedAmountDelta.value,
      timeDeltaDays: derivedTimeDelta.value,
      attachmentFileIds,
    }
    const result = isEdit.value && editId.value
      ? await repos.agreements.update(editId.value, payload)
      : await repos.agreements.create({ contractId: contractId.value, ...payload })
    await navigateTo(`/contracts/${contractId.value}/agreements/${result.id}`)
  } catch (e) {
    submitError.value = isRepositoryError(e) ? e.message : S.common.error
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="agreement-new">
    <template #header>
      <UDashboardNavbar :title="isEdit && data?.editing
        ? `${AG.editTitlePrefix} No. ${data?.editing?.number}`
        : AG.newTitle">
        <template #leading>
          <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" :to="backTo"
            :aria-label="S.common.back" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-alert-triangle" :title="S.common.error"
        :actions="[{ label: 'Reintentar', color: 'neutral', variant: 'subtle', onClick: () => refresh() }]" />
      <div v-else-if="status === 'pending'" class="space-y-3">
        <USkeleton class="h-24 w-full rounded-lg" />
        <USkeleton class="h-48 w-full rounded-lg" />
      </div>

      <div v-else class="flex flex-col gap-6">
        <!-- Kind selector — fixed once the agreement exists -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-git-branch" class="size-4 text-muted" />
              {{ AG.kindSelector.title }}
            </div>
          </template>
          <p class="mb-3 text-xs text-muted">{{ AG.kindSelector.hint }}</p>
          <div class="grid gap-3 sm:grid-cols-2">
            <button type="button" :disabled="isEdit" class="rounded-lg border p-4 text-left transition-colors"
              :class="kind === 'amount' ? 'border-primary bg-primary/5' : 'border-default hover:border-primary/50'"
              @click="kind = 'amount'">
              <div class="mb-1 flex items-center gap-2 font-semibold text-highlighted">
                <UIcon name="i-lucide-coins" class="size-4" />{{ AG.kindSelector.amountLabel }}
              </div>
              <p class="text-xs text-muted">{{ AG.kindSelector.amountHint }}</p>
            </button>
            <button type="button" :disabled="isEdit" class="rounded-lg border p-4 text-left transition-colors"
              :class="kind === 'schedule' ? 'border-primary bg-primary/5' : 'border-default hover:border-primary/50'"
              @click="kind = 'schedule'">
              <div class="mb-1 flex items-center gap-2 font-semibold text-highlighted">
                <UIcon name="i-lucide-calendar-clock" class="size-4" />{{ AG.kindSelector.scheduleLabel }}
              </div>
              <p class="text-xs text-muted">{{ AG.kindSelector.scheduleHint }}</p>
            </button>
          </div>
        </UCard>

        <!-- Description -->
        <UCard>
          <UFormField :label="AG.fields.description" :error="descError || undefined">
            <UTextarea v-model="description" :rows="3" class="w-full" :placeholder="AG.fields.descriptionPlaceholder" />
          </UFormField>
        </UCard>

        <!-- ═══════════════ AMOUNT (DE MONTO) ═══════════════ -->
        <template v-if="kind === 'amount'">
          <!-- Reduce existing concepts -->
          <UCard :ui="{ body: 'p-0 sm:p-0' }">
            <template #header>
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-pencil-ruler" class="size-4 text-muted" />
                {{ AG.conceptChanges.title }}
              </div>
            </template>

            <div class="border-b border-default px-4 py-3">
              <p class="mb-2 text-xs text-muted">{{ AG.conceptChanges.hint }}</p>
              <UInput v-model="pickerSearch" :placeholder="S.conceptCatalog.search" icon="i-lucide-search"
                class="mb-2 w-60" />
              <div class="max-h-64 overflow-y-auto rounded-lg border border-default">
                <template v-for="group in pickerGroups" :key="group.section?.id ?? 'no-section'">
                  <div class="sticky top-0 flex items-center gap-2 border-b border-default bg-elevated px-3 py-1.5">
                    <span class="font-mono text-xs font-semibold text-muted">{{ group.section?.specificationNumber
                      }}</span>
                    <span class="text-xs font-semibold text-default">{{ group.section?.description ??
                      S.conceptSections.noSection }}</span>
                  </div>
                  <div v-for="c in group.concepts" :key="c.id"
                    class="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-elevated/60 transition-colors"
                    @click="addConceptChange(c.id)">
                    <UIcon name="i-lucide-minus" class="size-3.5 shrink-0 text-warning" />
                    <span class="font-mono text-xs text-muted w-16 shrink-0">{{ c.specificationNumber }}</span>
                    <span class="min-w-0 flex-1 truncate text-sm text-highlighted">{{ c.description }}</span>
                    <span class="shrink-0 text-xs text-muted">{{ c.unit }}</span>
                    <span class="shrink-0 tabular-nums text-xs text-muted">{{ formatNumber(c.contractedQuantity)
                      }}</span>
                  </div>
                </template>
                <div v-if="pickerGroups.length === 0" class="px-3 py-4 text-center text-sm text-muted">
                  Sin coincidencias
                </div>
              </div>
            </div>

            <div v-if="conceptChanges.length === 0" class="px-4 py-6 text-sm text-muted">
              {{ AG.conceptChanges.empty }}
            </div>
            <div v-else class="overflow-x-auto">
              <table class="w-full min-w-[42rem] text-sm">
                <thead class="border-b border-default bg-elevated/50 text-xs text-muted">
                  <tr>
                    <th class="px-3 py-2 text-left font-medium">{{ AG.conceptChanges.columns.specification }}</th>
                    <th class="px-3 py-2 text-left font-medium">{{ AG.conceptChanges.columns.description }}</th>
                    <th class="px-3 py-2 text-right font-medium">{{ AG.conceptChanges.columns.currentQty }}</th>
                    <th class="px-3 py-2 text-right font-medium text-warning">{{ AG.conceptChanges.columns.newQty }}
                    </th>
                    <th class="px-3 py-2 text-right font-medium">{{ AG.conceptChanges.columns.currentPrice }}</th>
                    <th class="px-3 py-2 text-right font-medium text-warning">{{ AG.conceptChanges.columns.newPrice }}
                    </th>
                    <th class="px-2 py-2" />
                  </tr>
                </thead>
                <tbody class="divide-y divide-default">
                  <tr v-for="(cc, idx) in conceptChanges" :key="cc.conceptId">
                    <template v-if="data">
                      <td class="px-3 py-2 font-mono text-xs text-highlighted">
                        {{data.concepts.find(c => c.id === cc.conceptId)?.specificationNumber}}
                      </td>
                      <td class="min-w-[12rem] px-3 py-2 text-highlighted">
                        {{data.concepts.find(c => c.id === cc.conceptId)?.description}}
                      </td>
                      <td class="px-3 py-2 text-right tabular-nums text-muted">
                        {{formatNumber(data.concepts.find(c => c.id === cc.conceptId)?.contractedQuantity ?? 0)}}
                      </td>
                      <td class="px-3 py-2">
                        <UInput v-model="cc._newQtyRaw" type="number" min="0" step="any"
                          :placeholder="String(data.concepts.find(c => c.id === cc.conceptId)?.contractedQuantity ?? '')"
                          :color="conceptChangeErrors[idx] ? 'error' : undefined"
                          class="w-28 [&_input]:text-right [&_input]:text-warning [&_input]:font-medium" />
                        <p v-if="conceptChangeErrors[idx]" class="mt-0.5 text-xs text-error">{{ conceptChangeErrors[idx]
                          }}</p>
                      </td>
                      <td class="px-3 py-2 text-right tabular-nums text-muted">
                        {{formatMoney(data.concepts.find(c => c.id === cc.conceptId)?.unitPrice ?? 0)}}
                      </td>
                      <td class="px-3 py-2">
                        <UInput v-model="cc._newPriceRaw" type="number" min="0" step="0.01"
                          :placeholder="String((data.concepts.find(c => c.id === cc.conceptId)?.unitPrice ?? 0) / 100)"
                          class="w-32 [&_input]:text-right [&_input]:text-warning [&_input]:font-medium">
                          <template #leading><span class="pl-1 text-xs text-muted">$</span></template>
                        </UInput>
                      </td>
                    </template>
                    <td class="px-2 py-2">
                      <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost"
                        @click="removeConceptChange(idx)" />
                    </td>
                  </tr>
                  <tr v-if="data && reductionTargetFor(String(cc.conceptId), cc._newQtyRaw) > 0">
                    <td colspan="7" class="bg-elevated/20 px-3 py-3">
                      <p class="mb-1 text-xs font-medium text-highlighted">{{ AG.conceptChanges.scheduleReduction.title
                        }}</p>
                      <p class="mb-2 text-xs text-muted">{{ AG.conceptChanges.scheduleReduction.hint }}</p>
                      <div v-if="!scheduledPeriodsFor(String(cc.conceptId)).length" class="text-xs text-warning">
                        {{ AG.conceptChanges.scheduleReduction.noScheduledPeriods }}
                      </div>
                      <div v-else class="flex flex-wrap items-center gap-3">
                        <div v-for="p in scheduledPeriodsFor(String(cc.conceptId))" :key="p"
                          class="flex flex-col items-center gap-0.5">
                          <span class="text-[10px] text-muted">P{{ p + 1 }}</span>
                          <UInput type="number" min="0" :max="unclaimedForReduction(String(cc.conceptId), p)" step="any"
                            :model-value="reductionQtyFor(String(cc.conceptId), p)"
                            class="w-16 [&_input]:px-1.5 [&_input]:text-center [&_input]:text-xs"
                            @update:model-value="(v) => setReductionQty(String(cc.conceptId), p, String(v))" />
                          <span class="text-[9px] text-muted">/ {{
                            formatNumber(unclaimedForReduction(String(cc.conceptId), p))
                            }}</span>
                        </div>
                        <div class="ml-2 text-xs"
                          :class="isReductionBalanced(String(cc.conceptId), cc._newQtyRaw) ? 'text-success' : 'text-warning'">
                          {{ isReductionBalanced(String(cc.conceptId), cc._newQtyRaw) ?
                            AG.conceptChanges.scheduleReduction.balanced
                            :
                            `${AG.conceptChanges.scheduleReduction.remaining}:
                          ${formatNumber(reductionTargetFor(String(cc.conceptId),
                          cc._newQtyRaw) - reductionTotalFor(String(cc.conceptId)))}` }}
                        </div>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </UCard>

          <!-- Additional concepts: extend existing or brand new -->
          <UCard :ui="{ body: 'p-0 sm:p-0' }">
            <template #header>
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 font-medium">
                  <UIcon name="i-lucide-list-plus" class="size-4 text-muted" />
                  {{ AG.newConcepts.title }}
                </div>
                <div class="flex gap-2">
                  <UButton size="xs" icon="i-lucide-git-branch-plus" color="neutral" variant="outline"
                    @click="addNewConcept('extend')">
                    {{ AG.newConcepts.modeExtend }}
                  </UButton>
                  <UButton size="xs" icon="i-lucide-plus" color="neutral" variant="outline"
                    @click="addNewConcept('new')">
                    {{ AG.newConcepts.modeNew }}
                  </UButton>
                </div>
              </div>
            </template>
            <p class="border-b border-default px-4 py-2 text-xs text-muted">{{ AG.newConcepts.hint }}</p>

            <div v-if="newConcepts.length === 0" class="px-4 py-6 text-sm text-muted">
              {{ AG.newConcepts.empty }}
            </div>
            <div v-else class="divide-y divide-default">
              <div v-for="(nc, idx) in newConcepts" :key="idx" class="px-4 py-3">
                <div class="mb-2 flex items-center gap-2">
                  <UBadge :label="nc._mode === 'extend' ? AG.newConcepts.modeExtend : AG.newConcepts.modeNew"
                    color="warning" variant="subtle" size="xs" />
                  <UFormField v-if="nc._mode === 'extend'" class="flex-1"
                    :error="newConceptErrors[idx]?.extend || undefined">
                    <USelect :model-value="nc.extendsConceptId"
                      :items="extendableConcepts.map(c => ({ label: `${c.specificationNumber} — ${c.description}`, value: c.id }))"
                      :placeholder="AG.newConcepts.pickConceptToExtend" class="w-full"
                      @update:model-value="(v) => onPickExtendConcept(nc, String(v))" />
                  </UFormField>
                  <div class="ml-auto">
                    <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost"
                      @click="removeNewConcept(idx)" />
                  </div>
                </div>
                <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                  <UFormField :label="AG.newConcepts.columns.specification"
                    :error="newConceptErrors[idx]?.spec || undefined">
                    <UInput v-model="nc.specificationNumber" class="w-full" :disabled="nc._mode === 'extend'" />
                  </UFormField>
                  <UFormField :label="AG.newConcepts.columns.description" class="lg:col-span-2"
                    :error="newConceptErrors[idx]?.desc || undefined">
                    <UInput v-model="nc.description" class="w-full" :disabled="nc._mode === 'extend'" />
                  </UFormField>
                  <UFormField :label="AG.newConcepts.columns.unit" :error="newConceptErrors[idx]?.unit || undefined">
                    <UInput v-model="nc.unit" class="w-full" placeholder="m2" :disabled="nc._mode === 'extend'" />
                  </UFormField>
                  <UFormField :label="AG.newConcepts.columns.qty" :error="newConceptErrors[idx]?.qty || undefined">
                    <UInput v-model="nc._qtyRaw" type="number" min="0" step="any"
                      class="w-full [&_input]:text-right [&_input]:text-warning [&_input]:font-medium" />
                  </UFormField>
                  <UFormField :label="AG.newConcepts.columns.unitPrice"
                    :error="newConceptErrors[idx]?.price || undefined">
                    <UInput v-model="nc._priceRaw" type="number" min="0" step="0.01"
                      class="w-full [&_input]:text-right [&_input]:text-warning [&_input]:font-medium">
                      <template #leading><span class="pl-1 text-xs text-muted">$</span></template>
                    </UInput>
                  </UFormField>
                </div>
                <UFormField v-if="nc._mode === 'new'" label="Sección" class="mt-3 max-w-xs">
                  <USelect v-model="nc.sectionId" :items="[
                    { label: '— Sin sección —', value: null },
                    ...(data?.sections ?? []).map(s => ({ label: `${s.specificationNumber} ${s.description}`, value: s.id })),
                    ...newSections.map((ns, i) => ({ label: `[Nueva] ${ns.specificationNumber || i + 1} ${ns.description}`, value: `new:${i}` })),
                  ]" class="w-full" />
                </UFormField>

                <div v-if="parseFloat(nc._qtyRaw) > 0" class="mt-3 rounded-lg bg-elevated/40 p-3">
                  <p class="mb-1 text-xs font-medium text-highlighted">{{ AG.newConcepts.scheduleAllocation.title }}</p>
                  <p class="mb-2 text-xs text-muted">{{ AG.newConcepts.scheduleAllocation.hint }}</p>
                  <div class="flex flex-wrap items-center gap-3">
                    <div v-for="(period, p) in (data?.periods ?? [])" :key="p"
                      class="flex flex-col items-center gap-0.5">
                      <span class="text-[10px] text-muted">P{{ p + 1 }}</span>
                      <UInput type="number" min="0" step="any" :model-value="allocationQtyFor(idx, p)"
                        class="w-16 [&_input]:px-1.5 [&_input]:text-center [&_input]:text-xs"
                        @update:model-value="(v) => setAllocationQty(idx, p, String(v))" />
                    </div>
                    <div class="ml-2 text-xs"
                      :class="isAllocationBalanced(idx, nc._qtyRaw) ? 'text-success' : 'text-warning'">
                      {{ isAllocationBalanced(idx, nc._qtyRaw) ? AG.newConcepts.scheduleAllocation.balanced :
                        `${AG.newConcepts.scheduleAllocation.remaining}: ${formatNumber((parseFloat(nc._qtyRaw) || 0) -
                      allocationTotalFor(idx))}` }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </UCard>

          <!-- New sections -->
          <UCard :ui="{ body: 'p-0 sm:p-0' }">
            <template #header>
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 font-medium">
                  <UIcon name="i-lucide-layers" class="size-4 text-muted" />
                  {{ S.conceptSections.addSection }}
                </div>
                <UButton size="xs" icon="i-lucide-plus" color="neutral" variant="outline" @click="addNewSection">
                  {{ S.conceptSections.addSection }}
                </UButton>
              </div>
            </template>

            <div v-if="!newSections.length" class="px-4 py-4 text-sm text-muted">
              Agrega secciones nuevas que se crearán en el catálogo al aprobarse el convenio.
            </div>
            <div v-else class="divide-y divide-default">
              <div v-for="(ns, idx) in newSections" :key="idx"
                class="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-5">
                <UFormField :label="S.conceptSections.specificationNumber">
                  <UInput v-model="ns.specificationNumber" class="w-full" placeholder="D" />
                </UFormField>
                <UFormField :label="S.conceptSections.description" class="lg:col-span-2">
                  <UInput v-model="ns.description" class="w-full" placeholder="Nueva etapa" />
                </UFormField>
                <div class="flex items-end gap-2 lg:col-span-3">
                  <UButton icon="i-lucide-x" size="sm" color="neutral" variant="ghost" class="mb-0.5"
                    @click="removeNewSection(idx)" />
                </div>
              </div>
            </div>
          </UCard>
        </template>

        <!-- ═══════════════ SCHEDULE (DE PLAZO) ═══════════════ -->
        <template v-if="kind === 'schedule'">
          <!-- Contract date changes (set first — the grid below reacts to this) -->
          <UCard>
            <template #header>
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-calendar" class="size-4 text-muted" />
                {{ AG.contractDates.title }}
              </div>
            </template>
            <p class="mb-4 text-xs text-muted">
              Deja en blanco los campos que no cambien. Si extiendes el contrato, los nuevos períodos aparecen abajo de
              inmediato; si lo acortas, vacía primero los períodos que se eliminarán.
            </p>
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField :label="AG.contractDates.newStart">
                <UInput v-model="newContractStartRaw" type="date" class="w-full [&_input]:text-warning" />
                <template v-if="data?.contract?.startDate" #hint>
                  {{ AG.contractDates.current }}: {{ formatDate(data.contract.startDate) }}
                </template>
              </UFormField>
              <UFormField :label="AG.contractDates.newEnd">
                <UInput v-model="newContractEndRaw" type="date" class="w-full [&_input]:text-warning" />
                <template v-if="data?.contract?.endDate" #hint>
                  {{ AG.contractDates.current }}: {{ formatDate(data.contract.endDate) }}
                </template>
              </UFormField>
            </div>
          </UCard>

          <UCard :ui="{ body: 'p-0 sm:p-0' }">
            <template #header>
              <div class="flex items-center gap-2 font-medium">
                <UIcon name="i-lucide-calendar-clock" class="size-4 text-muted" />
                {{ AG.scheduleMoves.title }}
              </div>
            </template>
            <p class="border-b border-default px-4 py-2 text-xs text-muted">{{ AG.scheduleMoves.hint }}</p>

            <!-- Period tabs -->
            <div class="flex overflow-x-auto border-b border-default bg-elevated/30">
              <button v-for="pi in gridPeriodCount" :key="pi - 1"
                class="shrink-0 border-b-2 px-4 py-2 text-sm transition-colors" :class="[
                  activeScheduleTab === pi - 1
                    ? 'border-primary font-semibold text-primary'
                    : 'border-transparent text-muted hover:text-default',
                  isPeriodBeingRemoved(pi - 1) ? 'opacity-60' : '',
                ]" @click="activeScheduleTab = pi - 1">
                P{{ pi }}
                <span v-if="isPeriodBeingRemoved(pi - 1)" class="ml-1 text-[10px] text-error">
                  ({{ AG.scheduleMoves.periodRemoved }})
                </span>
              </button>
            </div>

            <!-- Active period grid -->
            <div class="px-4 py-3">
              <UAlert v-if="isPeriodBeingRemoved(activeScheduleTab)" class="mb-3" color="error" variant="soft"
                icon="i-lucide-triangle-alert" :title="AG.scheduleMoves.periodRemovedHint" />
              <div class="space-y-4">
                <div v-for="group in (data?.groups ?? [])" :key="group.section?.id ?? 'no-section'">
                  <div class="mb-1.5 flex items-center gap-2">
                    <span v-if="group.section" class="font-mono text-xs font-semibold text-muted">
                      {{ group.section.specificationNumber }}
                    </span>
                    <span class="text-sm font-semibold text-highlighted">
                      {{ group.section ? group.section.description : S.conceptSections.noSection }}
                    </span>
                  </div>
                  <div class="space-y-1.5">
                    <div v-for="c in group.concepts" :key="c.id"
                      class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2"
                      :class="isBalanced(String(c.id)) ? 'border-default' : 'border-warning/50 bg-warning/5'">
                      <div class="min-w-0 flex-1">
                        <span class="font-mono text-xs text-muted">{{ c.specificationNumber }}</span>
                        <span class="ml-2 text-sm text-highlighted">{{ c.description }}</span>
                        <UBadge v-if="c.isExtra" :label="S.conceptCatalog.extraBadge" color="warning" variant="subtle"
                          size="xs" class="ml-1.5" />
                      </div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <UInput type="number" step="any" :model-value="workingQtyFor(String(c.id), activeScheduleTab)"
                          :min="isPeriodBeingRemoved(activeScheduleTab) ? 0 : cellMin(String(c.id), activeScheduleTab)"
                          :max="isPeriodBeingRemoved(activeScheduleTab) ? 0 : (cellMax(String(c.id), activeScheduleTab) ?? undefined)"
                          :disabled="!isPeriodBeingRemoved(activeScheduleTab) && isCellLocked(String(c.id), activeScheduleTab)"
                          class="w-24 [&_input]:text-right"
                          :class="isCellLocked(String(c.id), activeScheduleTab) ? '' : '[&_input]:text-warning [&_input]:font-medium'"
                          @update:model-value="(v) => setWorkingQty(String(c.id), activeScheduleTab, String(v))" />
                        <span class="text-xs text-muted">{{ c.unit }}</span>
                      </div>
                      <div class="shrink-0 text-xs text-muted">
                        <UIcon v-if="isCellLocked(String(c.id), activeScheduleTab)" name="i-lucide-lock"
                          class="mr-1 size-3" />
                        {{ AG.scheduleMoves.quantity }}: {{ formatNumber(workingTotalFor(String(c.id))) }} /
                        {{ formatNumber(originalTotalFor(String(c.id))) }}
                        <span v-if="!isBalanced(String(c.id))" class="ml-1 text-warning">⚠</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Derived moves preview -->
            <div class="border-t border-default px-4 py-3">
              <p class="mb-2 text-xs font-medium text-muted">{{ AG.scheduleMoves.title }} — {{ derivedMoves.length ? ''
                :
                AG.scheduleMoves.empty }}</p>
              <ul v-if="derivedMoves.length" class="space-y-1">
                <li v-for="(m, idx) in derivedMoves" :key="idx" class="flex items-center gap-2 text-sm">
                  <UIcon name="i-lucide-arrow-right-left" class="size-3.5 shrink-0 text-muted" />
                  <span class="font-medium text-highlighted">{{ conceptLabel(m.conceptId) }}</span>
                  <span class="text-muted">P{{ m.fromPeriodIndex + 1 }} → P{{ m.toPeriodIndex + 1 }}:</span>
                  <span class="font-medium tabular-nums text-warning">{{ formatNumber(m.quantity) }}</span>
                </li>
              </ul>
              <UAlert v-if="!allBalanced" class="mt-2" color="warning" variant="soft" icon="i-lucide-triangle-alert"
                title="Hay conceptos sin balancear — la suma por concepto debe regresar al total original antes de guardar." />
              <UAlert v-if="hasStrandedQuantity" class="mt-2" color="error" variant="soft"
                icon="i-lucide-triangle-alert" :title="AG.scheduleMoves.strandedQuantity" />
            </div>
          </UCard>
        </template>

        <!-- Attachments -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-paperclip" class="size-4 text-muted" />
              {{ AG.attachments.title }}
            </div>
          </template>
          <p class="mb-3 text-xs text-muted">{{ AG.attachments.hint }}</p>

          <ul v-if="existingAttachments.length" class="mb-3 divide-y divide-default rounded-lg border border-default">
            <li v-for="file in existingAttachments" :key="file.id" class="flex items-center gap-3 px-3 py-2.5">
              <UIcon :name="fileIcon(file.mimeType)" class="size-4 shrink-0 text-muted" />
              <button type="button" class="min-w-0 flex-1 truncate text-left text-sm text-highlighted hover:underline"
                @click="openViewer(file)">
                {{ file.name }}
              </button>
              <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" :aria-label="AG.attachments.remove"
                @click="removeExistingAttachment(file.id)" />
            </li>
          </ul>

          <div class="mb-3 cursor-pointer rounded-xl border-2 border-dashed transition-colors"
            :class="isDraggingAttachment ? 'border-primary bg-primary/5' : 'border-default hover:border-primary/50'"
            @dragover.prevent="isDraggingAttachment = true" @dragleave.prevent="isDraggingAttachment = false"
            @drop.prevent="onAttachmentDrop" @click="($refs.attachmentInput as HTMLInputElement).click()">
            <div class="flex flex-col items-center gap-2 px-4 py-6">
              <UIcon name="i-lucide-upload-cloud" class="size-7 text-muted" />
              <p class="text-sm text-muted">
                {{ isDraggingAttachment ? AG.attachments.dropzoneActive : AG.attachments.dropzone }}
              </p>
            </div>
          </div>
          <input ref="attachmentInput" type="file" multiple class="sr-only" @change="onAttachmentInput" />

          <ul v-if="attachmentEntries.length" class="divide-y divide-default rounded-lg border border-default">
            <li v-for="entry in attachmentEntries" :key="entry.id" class="flex items-center gap-3 px-3 py-2.5">
              <UIcon :name="entry.status === 'done' ? 'i-lucide-check-circle-2'
                : entry.status === 'error' ? 'i-lucide-alert-circle'
                  : entry.status === 'uploading' ? 'i-lucide-loader-circle'
                    : 'i-lucide-file'" class="size-4 shrink-0" :class="entry.status === 'done' ? 'text-success'
                        : entry.status === 'error' ? 'text-error'
                          : entry.status === 'uploading' ? 'text-primary animate-spin'
                            : 'text-muted'" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-sm text-highlighted">{{ entry.file.name }}</span>
                  <span class="shrink-0 text-xs text-muted">{{ formatBytes(entry.file.size) }}</span>
                </div>
                <div v-if="entry.status === 'uploading'"
                  class="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-elevated">
                  <div class="h-full rounded-full bg-primary transition-all"
                    :style="`width:${Math.round(entry.progress * 100)}%`" />
                </div>
                <p v-if="entry.errorMsg" class="text-xs text-error">{{ entry.errorMsg }}</p>
              </div>
              <UButton v-if="entry.status === 'queued' || entry.status === 'error'" icon="i-lucide-x" size="xs"
                color="neutral" variant="ghost" :aria-label="AG.attachments.remove"
                @click="removeAttachmentEntry(entry.id)" />
            </li>
          </ul>
          <p v-else-if="!existingAttachments.length" class="text-sm text-muted">{{ AG.attachments.empty }}</p>
        </UCard>

        <!-- Summary -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 font-medium">
              <UIcon name="i-lucide-calculator" class="size-4 text-muted" />
              {{ AG.sections.detail }}
            </div>
          </template>

          <dl class="divide-y divide-default text-sm">
            <div class="flex items-center justify-between py-2">
              <dt class="text-muted">Tipo de convenio</dt>
              <dd>
                <UBadge :label="AG.kind[kind]" color="neutral" variant="soft" size="sm" />
              </dd>
            </div>
            <div v-if="kind === 'amount'" class="flex items-center justify-between py-2">
              <dt class="text-muted">{{ AG.summary.derivedAmountDelta }}</dt>
              <dd v-if="derivedAmountDelta != null" class="font-semibold tabular-nums"
                :class="derivedAmountDelta >= 0 ? 'text-success' : 'text-error'">
                {{ derivedAmountDelta >= 0 ? '+' : '' }}{{ formatMoney(derivedAmountDelta) }}
              </dd>
              <dd v-else class="text-muted">{{ AG.summary.noChanges }}</dd>
            </div>
            <div v-if="kind === 'schedule'" class="flex items-center justify-between py-2">
              <dt class="text-muted">{{ AG.summary.derivedTimeDelta }}</dt>
              <dd v-if="derivedTimeDelta != null" class="font-semibold tabular-nums"
                :class="derivedTimeDelta > 0 ? 'text-warning' : 'text-success'">
                {{ derivedTimeDelta > 0 ? '+' : '' }}{{ derivedTimeDelta }} {{ AG.summary.days }}
              </dd>
              <dd v-else class="text-muted">—</dd>
            </div>
          </dl>

          <UAlert class="mt-3" color="neutral" variant="soft" icon="i-lucide-info" :title="AG.effectNotice" />
        </UCard>

        <UAlert v-if="noChangesError && description.trim()" color="warning" variant="soft"
          icon="i-lucide-triangle-alert" :title="noChangesError" />
        <UAlert v-if="submitError" color="error" variant="soft" icon="i-lucide-alert-triangle" :title="submitError" />

        <!-- Sticky actions -->
        <div
          class="sticky bottom-0 -mx-4 mt-2 flex justify-end gap-3 border-t border-default bg-default/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <UButton color="neutral" variant="ghost" :to="backTo">{{ S.common.cancel }}</UButton>
          <UButton :icon="isEdit ? 'i-lucide-save' : 'i-lucide-file-plus-2'" :loading="loading" :disabled="!canSave"
            @click="onSave">
            {{ isEdit ? AG.saveChanges : AG.saveDraft }}
          </UButton>
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <!-- File viewer — must live outside UDashboardPanel -->
  <FileViewerModal v-model:open="viewerOpen" :file="viewingFile" />
</template>