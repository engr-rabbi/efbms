import { newId } from './gas'
import * as repo from './repo'
import { ensure, mutate, opCreate, opDelete, updateOp, byCreated, byCreatedDesc, type Row, type MutateOp } from './repo'
import { LENGTH_UNITS, AREA_UNITS, isRounding } from '@/lib/units'
import { type Handler, str, num, bool, notFound, badReq, pickFields, floorsOf, FLOOR_TABLES } from './handlers-core'

// ------------------------------------------------------------------ settings/units
const K_LEN = 'units.length', K_AREA = 'units.area', K_PLEN = 'units.precision.length', K_PAREA = 'units.precision.area', K_ROUND = 'units.rounding'

function readUnits() {
  const m = new Map(repo.rows('settings').map((r) => [r.id, r.value as string]))
  const lu = m.get(K_LEN), au = m.get(K_AREA), pl = m.get(K_PLEN), pa = m.get(K_PAREA), ro = m.get(K_ROUND)
  const prec = (v: string | undefined) => (v !== undefined && v !== '' && v !== 'null' && Number.isFinite(Number(v)) ? Number(v) : null)
  return {
    lengthUnit: lu && lu in LENGTH_UNITS ? lu : 'm',
    areaUnit: au && au in AREA_UNITS ? au : 'm2',
    lengthPrecision: prec(pl), areaPrecision: prec(pa),
    rounding: ro && isRounding(ro) ? ro : 'NEAREST',
  }
}
export const unitSettings: Handler = async ({ method, body }) => {
  await ensure(['settings'])
  if (method === 'GET') return { units: readUnits() }
  const b = body as Row
  if (!(b.lengthUnit in LENGTH_UNITS)) throw badReq(`Unsupported length unit: ${str(b.lengthUnit)}`)
  if (!(b.areaUnit in AREA_UNITS)) throw badReq(`Unsupported area unit: ${str(b.areaUnit)}`)
  const okPrec = (v: unknown) => v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 6)
  if (!okPrec(b.lengthPrecision) || !okPrec(b.areaPrecision)) throw badReq('Precision must be 0–6 or null')
  if (!isRounding(b.rounding)) throw badReq('Invalid rounding mode')
  const rows: Array<[string, string]> = [
    [K_LEN, String(b.lengthUnit)], [K_AREA, String(b.areaUnit)],
    [K_PLEN, b.lengthPrecision == null ? '' : String(Math.round(b.lengthPrecision))],
    [K_PAREA, b.areaPrecision == null ? '' : String(Math.round(b.areaPrecision))], [K_ROUND, b.rounding],
  ]
  await mutate(rows.map(([id, value]) => ({ op: 'upsert' as const, t: 'settings', id, data: { value } })), 'Save unit settings')
  return { units: readUnits() }
}

// ------------------------------------------------------------------ projects
const PROJECT_STR = ['name', 'clientName', 'clientAddress', 'clientPhone', 'location', 'buildingType', 'supplyType', 'startDate', 'estimationDate',
  'description', 'notes', 'status', 'code', 'unitLength', 'unitArea', 'members']
const floorName = (i: number) => (i === 1 ? '1st Floor' : i === 2 ? '2nd Floor' : i === 3 ? '3rd Floor' : `${i}th Floor`)

export const projects: Handler = async ({ method, body }) => {
  await ensure(['projects', 'floors', 'rooms', 'quotations'])
  if (method === 'GET') {
    const list = repo.where('projects', (p) => !p.archived).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map((p) => ({
      ...p, floors: floorsOf(p.id, false), quotations: repo.where('quotations', (q) => q.projectId === p.id).sort(byCreatedDesc),
    }))
    return { projects: list }
  }
  if (!body?.name) throw badReq('Project name is required')
  const code = str(body.code) || `PRJ-${Date.now().toString(36).toUpperCase()}`
  if (repo.rows('projects').some((p) => String(p.code).toLowerCase() === code.toLowerCase())) throw badReq('Project code already exists')
  const id = newId()
  const ops: MutateOp[] = [opCreate('projects', {
    code, name: str(body.name), clientName: str(body.clientName), clientAddress: str(body.clientAddress), clientPhone: str(body.clientPhone),
    location: str(body.location), buildingType: str(body.buildingType, 'Apartment'), supplyType: str(body.supplyType, '1-PHASE'),
    totalFloors: num(body.totalFloors, 1), occupants: num(body.occupants, 0), startDate: str(body.startDate),
    estimationDate: str(body.estimationDate, new Date().toISOString().slice(0, 10)), description: str(body.description), notes: str(body.notes),
    status: str(body.status, 'DRAFT'),
  }, id)]
  const n = num(body.autoCreateFloors, 0)
  if (n > 0 && n <= 40) for (let i = 1; i <= n; i++) ops.push(opCreate('floors', { projectId: id, floorNumber: i, name: floorName(i), height: 3.05 }, newId()))
  const res = await mutate(ops, 'Create project')
  return { __status: 201, project: res.results[0].row }
}

export const projectById: Handler = async ({ method, body }, [id]) => {
  await ensure([...FLOOR_TABLES, 'circuits', 'quotations'])
  if (method === 'GET') {
    const p = repo.get('projects', id)
    if (!p) throw notFound('Project not found')
    return { project: { ...p, floors: floorsOf(id), circuits: repo.where('circuits', (c) => c.projectId === id).sort(byCreated) } }
  }
  if (method === 'PATCH') {
    if (!repo.get('projects', id)) throw notFound('Project not found')
    const data = pickFields(body, PROJECT_STR, [['totalFloors', 1], ['occupants', 0]], ['archived'])
    const res = await mutate([updateOp('projects', id, data)], 'Update project')
    return { project: res.results[0].row }
  }
  if (method === 'DELETE') {
    await mutate([opDelete('projects', id)], 'Delete project')
    return { success: true }
  }
  throw badReq('Unsupported')
}

export const projectDuplicate: Handler = async (_r, [id]) => {
  await ensure(FLOOR_TABLES)
  const src = repo.get('projects', id)
  if (!src) throw notFound('Project not found')
  const newPid = newId()
  const ops: MutateOp[] = [opCreate('projects', {
    code: `${src.code}-COPY${Date.now().toString(36).toUpperCase().slice(-4)}`, name: `${src.name} (Copy)`,
    clientName: src.clientName, clientAddress: src.clientAddress, clientPhone: src.clientPhone, location: src.location, buildingType: src.buildingType,
    supplyType: src.supplyType, totalFloors: src.totalFloors, occupants: src.occupants, startDate: src.startDate,
    estimationDate: new Date().toISOString().slice(0, 10), description: src.description, notes: src.notes, status: 'DRAFT', isDemo: false,
  }, newPid)]
  for (const f of floorsOf(id)) {
    const nf = newId()
    ops.push(opCreate('floors', { projectId: newPid, floorNumber: f.floorNumber, name: f.name, height: f.height, area: f.area }, nf))
    for (const r of f.rooms as Row[]) {
      const nr = newId()
      ops.push(opCreate('rooms', { floorId: nf, name: r.name, roomType: r.roomType, length: r.length, width: r.width, height: r.height, doorCount: r.doorCount, windowCount: r.windowCount, notes: r.notes }, nr))
      for (const p of r.points as Row[]) ops.push(opCreate('points', { roomId: nr, pointType: p.pointType, quantity: p.quantity, location: p.location, mountingHeight: p.mountingHeight, connectedLoadW: p.connectedLoadW, specification: p.specification, notes: p.notes }, newId()))
      for (const x of r.fixtures as Row[]) ops.push(opCreate('fixtures', { roomId: nr, fixtureType: x.fixtureType, quantity: x.quantity, connectionType: x.connectionType, pipeDiameter: x.pipeDiameter, system: x.system, notes: x.notes }, newId()))
    }
  }
  // parents always precede children, so any prefix of the list is consistent; chunk at the server limit
  let project: Row | undefined
  try {
    for (let i = 0; i < ops.length; i += 900) {
      const res = await mutate(ops.slice(i, i + 900), 'Duplicate project')
      if (i === 0) project = res.results[0].row
    }
  } catch (e) {
    try { await mutate([opDelete('projects', newPid)], 'Clean up failed copy') } catch { /* best effort */ }
    throw e
  }
  return { __status: 201, project }
}

// ------------------------------------------------------------------ floors / rooms / points / fixtures
export const floors: Handler = async ({ body }) => {
  await ensure(['projects', 'floors'])
  if (!body?.projectId) throw badReq('projectId required')
  const count = repo.where('floors', (f) => f.projectId === body.projectId).length
  const n = num(body.floorNumber, count + 1)
  const res = await mutate([opCreate('floors', { projectId: str(body.projectId), floorNumber: n, name: str(body.name, `${n}th Floor`), height: num(body.height, 3.05), area: num(body.area, 0) }, newId())], 'Add floor')
  return { __status: 201, floor: res.results[0].row }
}
export const floorById: Handler = async ({ method, body }, [id]) => {
  await ensure(['floors', 'rooms', 'points', 'fixtures'])
  if (method === 'DELETE') { await mutate([opDelete('floors', id)], 'Delete floor'); return { success: true } }
  const data = pickFields(body, ['name'], [['floorNumber', 1], ['height', 3.05], ['area', 0]])
  const res = await mutate([updateOp('floors', id, data)], 'Update floor')
  return { floor: res.results[0].row }
}

export const rooms: Handler = async ({ body }) => {
  await ensure(['floors', 'rooms'])
  if (!body?.floorId || !body?.name) throw badReq('floorId and name required')
  const res = await mutate([opCreate('rooms', {
    floorId: str(body.floorId), name: str(body.name), roomType: str(body.roomType, 'BEDROOM'), length: num(body.length), width: num(body.width),
    height: num(body.height, 3.05), doorCount: num(body.doorCount, 1), windowCount: num(body.windowCount, 0), notes: str(body.notes),
  }, newId())], 'Add room')
  return { __status: 201, room: { ...res.results[0].row, points: [], fixtures: [] } }
}
export const roomById: Handler = async ({ method, body }, [id]) => {
  await ensure(['rooms', 'points', 'fixtures'])
  if (method === 'DELETE') { await mutate([opDelete('rooms', id)], 'Delete room'); return { success: true } }
  const data = pickFields(body, ['name', 'roomType', 'notes'], [['length', 0], ['width', 0], ['height', 3.05], ['doorCount', 1], ['windowCount', 0]])
  const res = await mutate([updateOp('rooms', id, data)], 'Update room')
  return { room: res.results[0].row }
}

export const points: Handler = async ({ body }) => {
  await ensure(['rooms', 'points'])
  if (!body?.roomId || !body?.pointType) throw badReq('roomId and pointType required')
  const res = await mutate([opCreate('points', {
    roomId: str(body.roomId), pointType: str(body.pointType), quantity: num(body.quantity, 1), location: str(body.location),
    mountingHeight: num(body.mountingHeight, 2.7), connectedLoadW: num(body.connectedLoadW, 0), specification: str(body.specification), notes: str(body.notes),
  }, newId())], 'Add electrical point')
  return { __status: 201, point: res.results[0].row }
}
export const pointById: Handler = async ({ method, body }, [id]) => {
  await ensure(['points'])
  if (method === 'DELETE') { await mutate([opDelete('points', id)], 'Delete point'); return { success: true } }
  const data = pickFields(body, ['pointType', 'location', 'specification', 'notes'], [['quantity', 1], ['mountingHeight', 2.7], ['connectedLoadW', 0]])
  const res = await mutate([updateOp('points', id, data)], 'Update electrical point')
  return { point: res.results[0].row }
}

export const fixtures: Handler = async ({ body }) => {
  await ensure(['rooms', 'fixtures'])
  if (!body?.roomId || !body?.fixtureType) throw badReq('roomId and fixtureType required')
  const res = await mutate([opCreate('fixtures', {
    roomId: str(body.roomId), fixtureType: str(body.fixtureType), quantity: num(body.quantity, 1), connectionType: str(body.connectionType, 'Cold'),
    pipeDiameter: str(body.pipeDiameter), system: str(body.system, 'Cold Water'), notes: str(body.notes),
  }, newId())], 'Add plumbing fixture')
  return { __status: 201, fixture: res.results[0].row }
}
export const fixtureById: Handler = async ({ method, body }, [id]) => {
  await ensure(['fixtures'])
  if (method === 'DELETE') { await mutate([opDelete('fixtures', id)], 'Delete fixture'); return { success: true } }
  const data = pickFields(body, ['fixtureType', 'connectionType', 'pipeDiameter', 'system', 'notes'], [['quantity', 1]])
  const res = await mutate([updateOp('fixtures', id, data)], 'Update plumbing fixture')
  return { fixture: res.results[0].row }
}

void bool
