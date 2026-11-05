// =============================================================================
// Engine: Electrical estimation (Mode A - automatic, Mode B - drawing-based)
// Formulas are transparent and surfaced on every EstimateItem.
// =============================================================================
import {
  POINT_TYPES,
  feederSizeForAmps,
  pickBreaker,
  pickDbWays,
} from './catalog'
import type {
  EngCircuit,
  EngFloor,
  EngProject,
  EngSummary,
  EngineContext,
  EstimationResult,
  RawEstimateItem,
} from './types'
import { type DrawingRoute, type DrawingSymbol } from './types'

const E = 'ELECTRICAL' as const

function meta(pt: string) {
  return POINT_TYPES.find((p) => p.type === pt)
}

function r2(n: number) {
  return Math.round(n * 100) / 100
}

interface WireAcc {
  [size: string]: number // total run length (m) of wire of this size (all runs combined)
}

interface ElecAcc {
  wire: WireAcc
  conduitM: number
  flexM: number
  lights: number
  fans: number
  exhaust: number
  sockets6A: number
  sockets16A: number
  switches1W: number
  switches2W: number
  regulators: number
  switchboards: number
  switchBoxes: number
  jBoxes: number
  ceilingRose: number
  clips: number
  ties: number
  tape: number
  lugs: number
  tvSockets: number
  tvCableM: number
  emergencyLights: number
  outdoorLights: number
  acPoints: number
}

function newAcc(): ElecAcc {
  return {
    wire: {}, conduitM: 0, flexM: 0, lights: 0, fans: 0, exhaust: 0,
    sockets6A: 0, sockets16A: 0, switches1W: 0, switches2W: 0, regulators: 0,
    switchboards: 0, switchBoxes: 0, jBoxes: 0, ceilingRose: 0, clips: 0,
    ties: 0, tape: 0, lugs: 0, tvSockets: 0, tvCableM: 0, emergencyLights: 0,
    outdoorLights: 0, acPoints: 0,
  }
}

function addWire(acc: ElecAcc, size: string, runM: number) {
  acc.wire[size] = (acc.wire[size] ?? 0) + runM
}

// Mode A per-room cable length for a circuit group
function modeARoomLength(
  roomLen: number,
  roomW: number,
  nCircuits: number,
  avgHoriz: number,
): number {
  // Formula: nCircuits x (avgHoriz + (L+W)) + vertical drops are added by caller
  return nCircuits * (avgHoriz + roomLen + roomW)
}

export function estimateElectrical(
  project: EngProject,
  ctx: EngineContext,
  warnings: string[],
): { items: RawEstimateItem[]; circuits: EngCircuit[]; summary: EngSummary } {
  const R = ctx.rules
  const items: RawEstimateItem[] = []
  const circuits: EngCircuit[] = []
  const acc = newAcc()
  const floors = project.floors

  let totalConnectedW = 0
  let totalPoints = 0

  for (const floor of floors) {
    const floorHeight = floor.height || 3.05
    let floorLoadW = 0

    for (const room of floor.rooms) {
      const counts: Record<string, number> = {}
      for (const pt of room.points) {
        const m = meta(pt.pointType)
        if (!m) continue
        counts[pt.pointType] = (counts[pt.pointType] ?? 0) + pt.quantity
        const load = (pt.connectedLoadW && pt.connectedLoadW > 0 ? pt.connectedLoadW : m.defaultLoadW) * pt.quantity
        totalConnectedW += load
        floorLoadW += load
        totalPoints += pt.quantity

        if (pt.pointType === 'LIGHT') acc.lights += pt.quantity
        if (pt.pointType === 'CEILING_FAN') acc.fans += pt.quantity
        if (pt.pointType === 'EXHAUST_FAN') acc.exhaust += pt.quantity
        if (pt.pointType === 'SOCKET') acc.sockets6A += pt.quantity
        if (pt.pointType === 'TV_DATA') acc.tvSockets += pt.quantity
        if (pt.pointType === 'EMERGENCY_LIGHT') acc.emergencyLights += pt.quantity
        if (pt.pointType === 'OUTDOOR_LIGHT') acc.outdoorLights += pt.quantity
        if (pt.pointType === 'AC') acc.acPoints += pt.quantity
      }

      // switchboards: user-entered or assumed 1 per room with points
      const nSB = counts['SWITCHBOARD'] ?? (Object.keys(counts).length > 0 ? 1 : 0)
      acc.switchboards += nSB
      acc.switchBoxes += nSB

      const nLightFan = (counts['LIGHT'] ?? 0) + (counts['CEILING_FAN'] ?? 0) + (counts['EXHAUST_FAN'] ?? 0) + (counts['EMERGENCY_LIGHT'] ?? 0) + (counts['OUTDOOR_LIGHT'] ?? 0)
      const nSockets = (counts['SOCKET'] ?? 0) + (counts['FRIDGE'] ?? 0) + (counts['TV_DATA'] ?? 0)

      // ---- Light/Fan circuit cable (Mode A) ----
      if (nLightFan > 0) {
        const nCirc = Math.max(1, Math.ceil(nLightFan / R.lightCircuitMaxPoints))
        const cableM = modeARoomLength(room.length, room.width, nCirc, R.avgHorizontalToDbM)
          + nLightFan * R.ceilingDropM
          + nSB * R.switchDropM
        addWire(acc, R.lightWire, cableM * 3) // P + N + E runs
        acc.conduitM += cableM
        acc.switches1W += nLightFan
        acc.regulators += counts['CEILING_FAN'] ?? 0
        acc.ceilingRose += (counts['LIGHT'] ?? 0) + (counts['EMERGENCY_LIGHT'] ?? 0)
        acc.jBoxes += Math.ceil((nLightFan + nSockets) / 4)

        const load = (counts['LIGHT'] ?? 0) * 25 + (counts['CEILING_FAN'] ?? 0) * 75 + (counts['EXHAUST_FAN'] ?? 0) * 60 + (counts['EMERGENCY_LIGHT'] ?? 0) * 10 + (counts['OUTDOOR_LIGHT'] ?? 0) * 60
        circuits.push({
          floorName: floor.name,
          name: `${room.name} – Light/Fan ${nCirc > 1 ? `(${nCirc} ckts)` : ''}`.trim(),
          circuitType: 'LIGHT',
          phase: '1P',
          loadW: load,
          designAmps: r2((load * R.demandFactor) / R.voltage),
          breakerRating: String(R.lightBreakerA),
          breakerType: 'MCB',
          rccb: true,
          cableSize: R.lightWire,
          cableLength: r2(cableM),
          pointsCount: nLightFan,
          remarks: `Room: ${room.name}; rule: ≤${R.lightCircuitMaxPoints} points/circuit`,
        })
      }

      // ---- Socket circuit (Mode A) ----
      if (nSockets > 0) {
        const nCirc = Math.max(1, Math.ceil(nSockets / R.socketCircuitMaxPoints))
        const cableM = modeARoomLength(room.length, room.width, nCirc, R.avgHorizontalToDbM)
          + nSockets * R.socketDropM
        addWire(acc, R.socketWire, cableM * 3)
        acc.conduitM += cableM
        acc.switches1W += 0
        const load = (counts['SOCKET'] ?? 0) * 200 + (counts['FRIDGE'] ?? 0) * 300 + (counts['TV_DATA'] ?? 0) * 50
        circuits.push({
          floorName: floor.name,
          name: `${room.name} – Socket ${nCirc > 1 ? `(${nCirc} ckts)` : ''}`.trim(),
          circuitType: 'SOCKET',
          phase: '1P',
          loadW: load,
          designAmps: r2((load * R.demandFactor) / R.voltage),
          breakerRating: String(R.socketBreakerA),
          breakerType: 'MCB',
          rccb: true,
          cableSize: R.socketWire,
          cableLength: r2(cableM),
          pointsCount: nSockets,
          remarks: `Room: ${room.name}; rule: ≤${R.socketCircuitMaxPoints} points/circuit`,
        })
      }

      // ---- Dedicated circuits (AC, Geyser, Kitchen, Washer, other dedicated) ----
      const dedicated = room.points.filter((p) => meta(p.pointType)?.circuitGroup === 'DEDICATED')
      for (const d of dedicated) {
        const m = meta(d.pointType)!
        const cktType = m.dedicatedCircuit ?? 'DEDICATED'
        const breakerA =
          cktType === 'AC' ? R.acBreakerA : cktType === 'GEYSER' ? R.geyserBreakerA :
          cktType === 'KITCHEN' ? R.kitchenBreakerA : cktType === 'WASHER' ? R.washerBreakerA : 20
        const wireSize =
          cktType === 'AC' ? R.acWire : cktType === 'GEYSER' ? R.geyserWire :
          cktType === 'KITCHEN' ? R.kitchenWire : '4.0'
        for (let q = 0; q < d.quantity; q++) {
          const cableM = R.avgHorizontalToDbM + (room.length + room.width) / 2 + R.ceilingDropM
          addWire(acc, wireSize, cableM * 3)
          acc.conduitM += cableM
          acc.sockets16A += 1
          acc.lugs += 6
          const load = d.connectedLoadW && d.connectedLoadW > 0 ? d.connectedLoadW : m.defaultLoadW
          circuits.push({
            floorName: floor.name,
            name: `${room.name} – ${m.labelEn}`,
            circuitType: cktType,
            phase: '1P',
            loadW: load,
            designAmps: r2((load * R.demandFactor) / R.voltage),
            breakerRating: String(breakerA),
            breakerType: 'MCB',
            rccb: cktType !== 'AC',
            cableSize: wireSize,
            cableLength: r2(cableM),
            pointsCount: 1,
            remarks: `Dedicated circuit: ${m.labelEn} @ ${room.name}`,
          })
        }
      }

      // TV coax cable
      if ((counts['TV_DATA'] ?? 0) > 0) {
        acc.tvCableM += R.avgHorizontalToDbM + room.length + room.width
      }

      // flexible conduit per light/fan point
      acc.flexM += (nLightFan + (counts['AC'] ?? 0)) * 0.5
    }

    // ---- Floor DB & sub-main (Mode A) ----
    if (floors.length > 0) {
      const floorAmps = (floorLoadW * R.demandFactor) / R.voltage
      const submainM = floor.floorNumber * floorHeight + R.avgHorizontalToDbM
      const submainSize = feederSizeForAmps(floorAmps)
      addWire(acc, submainSize, submainM * 3)
      acc.conduitM += submainM * 0.5
      circuits.push({
        floorName: floor.name,
        name: `${floor.name} – Sub-main Feeder`,
        circuitType: 'SUBMAIN',
        phase: project.supplyType === '3-PHASE' ? '3P' : '1P',
        loadW: r2(floorLoadW),
        designAmps: r2(floorAmps),
        breakerRating: pickBreaker(floorAmps),
        breakerType: Number(pickBreaker(floorAmps)) >= 100 ? 'MCCB' : 'MCB',
        rccb: false,
        cableSize: submainSize,
        cableLength: r2(submainM),
        pointsCount: 0,
        remarks: `Floor demand load (DF=${R.demandFactor})`,
      })
    }
  }

  // ---- Main feeder (building) ----
  const demandW = totalConnectedW * R.demandFactor
  const designAmps = demandW / (project.supplyType === '3-PHASE' ? Math.sqrt(3) * 400 : R.voltage)
  const mainBreaker = pickBreaker(designAmps * 1.15)
  const feederSize = feederSizeForAmps(designAmps * 1.15)
  const feederLen = R.mainFeederAssumedM
  addWire(acc, feederSize, feederLen * 3)
  acc.lugs += 12

  circuits.unshift({
    floorName: 'Building',
    name: 'Main Feeder (Meter → Main DB)',
    circuitType: 'FEEDER',
    phase: project.supplyType === '3-PHASE' ? '3P' : '1P',
    loadW: r2(totalConnectedW),
    designAmps: r2(designAmps),
    breakerRating: mainBreaker,
    breakerType: Number(mainBreaker) >= 100 ? 'MCCB' : 'MCB',
    rccb: false,
    cableSize: feederSize,
    cableLength: feederLen,
    pointsCount: 0,
    remarks: `Assumed length ${feederLen}m (calibrate with actual route)`,
  })

  // ---- DBs, RCCB, SPD, earthing ----
  const floorsWithCircuits = new Set(circuits.filter((c) => c.circuitType !== 'FEEDER').map((c) => c.floorName))
  const dbCount = Math.max(1, floorsWithCircuits.size)
  const waysPerDb = pickDbWays(Math.max(2, Math.ceil(circuits.length / dbCount)))
  items.push(...buildProtectionItems(acc, circuits, dbCount, waysPerDb, mainBreaker, R, project, warnings))

  // ---- Accessory items ----
  items.push(...buildAccessoryItems(acc, R))

  // ---- Wire items (coil purchase rounding in BOQ layer) ----
  for (const [size, len] of Object.entries(acc.wire)) {
    const isEarthOnly = false
    items.push({
      system: E,
      category: 'Cable',
      name: `PVC Insulated Copper Cable (Single Core) ${size} sqmm`,
      brand: '',
      specification: `Single core, ${size} mm², 650/1100V grade`,
      size: size,
      unit: 'm',
      mode: 'AUTO',
      qty: r2(len),
      formula: `Σ per-room runs × 3 (P+N+E)${isEarthOnly ? '' : ''}`,
      assumptions: [
        `Avg horizontal room→DB distance assumed ${R.avgHorizontalToDbM} m (Mode A)`,
        `Ceiling/switch drops: ${R.ceilingDropM}m / ${R.switchDropM}m`,
        `Wastage ${R.wireWastagePct}% applied at BOQ; purchase rounded to ${R.coilLengthM}m coil`,
      ],
      wastagePct: R.wireWastagePct,
      sourceRef: 'Mode A',
    })
  }

  // ---- Summary + warnings ----
  const wireTotalM = Object.values(acc.wire).reduce((a, b) => a + b, 0)
  const summary: EngSummary = {
    totalConnectedW: r2(totalConnectedW),
    demandW: r2(demandW),
    designAmps: r2(designAmps),
    mainBreaker: `${mainBreaker}A`,
    totalRooms: floors.reduce((a, f) => a + f.rooms.length, 0),
    totalPoints,
    totalFixtures: 0,
    wireTotalM: r2(wireTotalM),
    conduitTotalM: r2(acc.conduitM),
    warnings,
  }

  if (totalPoints === 0) {
    warnings.push('No electrical points defined. Add rooms & points for a meaningful estimation.')
  }
  if (!ctx.drawing?.calibrated) {
    warnings.push('Cable lengths are Mode A estimates (assumed distances). Import/Draw a plan and route cables for drawing-based verified quantities.')
  }
  if (project.supplyType === '3-PHASE' && designAmps > 100) {
    warnings.push('Three-phase supply with high load: verify phase balancing and fault level with a qualified engineer.')
  }

  return { items, circuits, summary }
}

function buildProtectionItems(
  acc: ElecAcc,
  circuits: EngCircuit[],
  dbCount: number,
  waysPerDb: string,
  mainBreaker: string,
  R: typeof import('./catalog').DEFAULT_RULES,
  project: EngProject,
  warnings: string[],
): RawEstimateItem[] {
  const items: RawEstimateItem[] = []
  const push = (i: RawEstimateItem) => items.push(i)

  push({
    system: E, category: 'Distribution Board', name: `Distribution Board (DB) ${waysPerDb}-Way`,
    brand: '', specification: `${waysPerDb}-way, single door, with neutral & earth bar`, size: waysPerDb,
    unit: 'Pcs', mode: 'AUTO', qty: dbCount,
    formula: `1 DB per floor (rule), ${dbCount} floors with circuits`,
    assumptions: ['DB assumed at stair core of each floor', 'Verify DB location on plan'],
    wastagePct: 0, sourceRef: 'Mode A',
  })
  push({
    system: E, category: 'Protection', name: `RCCB ${R.rccbRating} (2P)`,
    brand: '', specification: `Residual current circuit breaker ${R.rccbRating}, 30mA sensitivity`, size: R.rccbRating,
    unit: 'Pcs', mode: 'AUTO', qty: dbCount,
    formula: `1 RCCB per DB (safety rule)`,
    assumptions: ['30mA RCD protection for socket circuits required'],
    wastagePct: 0, sourceRef: 'Mode A',
  })
  if (R.spdPerBuilding > 0) {
    push({
      system: E, category: 'Protection', name: 'SPD (Surge Protection Device) Type-2',
      brand: '', specification: 'Type-2, In=20kA, 275V', size: '20kA',
      unit: 'Pcs', mode: 'AUTO', qty: R.spdPerBuilding,
      formula: `${R.spdPerBuilding} SPD per building (rule)`,
      assumptions: [], wastagePct: 0, sourceRef: 'Mode A',
    })
  }
  push({
    system: E, category: 'Earthing', name: 'Earthing Rod 5/8" x 6ft (Copper Bonded)',
    brand: '', specification: 'Copper bonded steel rod with clamp & backfill compound', size: '5/8"',
    unit: 'Pcs', mode: 'AUTO', qty: 1,
    formula: '1 earth pit per building (minimum rule)',
    assumptions: ['Earth resistance ≤ 5Ω; test and add rods if needed'],
    wastagePct: 0, sourceRef: 'Mode A',
  })
  // Earthing wire: main feeder length × 1 run + riser allowance (already counted in wires? no, add separately)
  const earthM = R.mainFeederAssumedM * 1.5
  acc.wire['10'] = (acc.wire['10'] ?? 0) + 0 // keep map untouched
  push({
    system: E, category: 'Cable', name: 'PVC Insulated Copper Cable (Single Core) 10 sqmm (Earth)',
    brand: '', specification: 'Single core, 10 mm² earth continuity conductor', size: '10',
    unit: 'm', mode: 'AUTO', qty: r2(earthM),
    formula: 'Main feeder × 1.5 (earth run + pit connection)',
    assumptions: ['Separate earth conductor run from DB to earth pit'],
    wastagePct: R.wireWastagePct, sourceRef: 'Mode A',
  })

  // Breakers per circuit (consolidated by rating in BOQ layer)
  const byRating: Record<string, number> = {}
  for (const c of circuits) {
    if (c.circuitType === 'FEEDER' || c.circuitType === 'SUBMAIN') continue
    const key = `${c.breakerType}-${c.breakerRating}`
    byRating[key] = (byRating[key] ?? 0) + 1
  }
  for (const [key, n] of Object.entries(byRating)) {
    const [type, rating] = key.split('-')
    push({
      system: E, category: 'Protection', name: `${type === 'MCCB' ? 'MCCB' : 'MCB'} ${rating}A (1P)`,
      brand: '', specification: `${rating}A ${type}, 1-Pole, C-curve, 10kA`, size: rating,
      unit: 'Pcs', mode: 'AUTO', qty: n,
      formula: `1 breaker per circuit (circuit schedule)`,
      assumptions: ['C-curve; verify breaking capacity against fault level'],
      wastagePct: 0, sourceRef: 'Mode A',
    })
  }
  push({
    system: E, category: 'Protection', name: `Main Breaker ${mainBreaker}A`,
    brand: '', specification: `${mainBreaker}A ${Number(mainBreaker) >= 100 ? 'MCCB' : 'MCB'} ${project.supplyType === '3-PHASE' ? '3-Pole' : '2-Pole'}`,
    size: mainBreaker,
    unit: 'Pcs', mode: 'AUTO', qty: dbCount,
    formula: `Design amps × 1.15 rounded to standard rating`,
    assumptions: [`Connected load × demand factor ${R.demandFactor} = design load`],
    wastagePct: 0, sourceRef: 'Mode A',
  })

  warnings.push('Breaker & cable sizes are rule-based (Mode A). Final approval requires engineer review with actual fault level & installation method.')
  return items
}

function buildAccessoryItems(acc: ElecAcc, R: typeof import('./catalog').DEFAULT_RULES): RawEstimateItem[] {
  const items: RawEstimateItem[] = []
  const w = R.accessoryWastagePct
  const push = (
    category: string, name: string, specification: string, size: string,
    unit: string, qty: number, formula: string, assumptions: string[] = [],
  ) => {
    if (qty <= 0) return
    items.push({
      system: E, category, name, brand: '', specification, size, unit, mode: 'AUTO',
      qty: Math.ceil(qty * 100) / 100, formula, assumptions, wastagePct: w, sourceRef: 'Mode A',
    })
  }

  const conduitM = acc.conduitM * (1 + R.conduitWastagePct / 100)
  push('Conduit', 'PVC Conduit Pipe 20mm (3/4")', 'ISI PVC conduit, medium grade, 3m stick', '20', 'm', acc.conduitM,
    `Cable route length (Mode A) + wastage ${R.conduitWastagePct}%`, ['3 wires per conduit assumed for wire/conduit ratio'])
  push('Conduit', 'Flexible Conduit 20mm', 'PVC flexible conduit with copper wire', '20', 'm', acc.flexM,
    '0.5 m per light/fan/AC point (final connection)')
  push('Accessories', 'Junction Box (Circular)', 'PVC circular junction box 3"x3"', '3"x3"', 'Pcs', acc.jBoxes,
    '≈ 1 per 4 points')
  push('Accessories', 'Switch Box (Modular, Metal/PVC)', 'Modular switch box, flush type', '', 'Pcs', acc.switchBoxes,
    '1 per switchboard')
  push('Switch', 'Modular Switch 1-Way 6A', 'Modular, 6A, 1-way', '6A', 'Pcs', acc.switches1W,
    '1 per light/fan point')
  push('Switch', 'Modular Switch 2-Way 6A', 'Modular, 6A, 2-way (stair/corridor)', '6A', 'Pcs', Math.ceil(acc.switches1W * 0.1),
    '10% of switches assumed 2-way', ['Adjust per actual control scheme'])
  push('Switch', 'Fan Regulator / Dimmer', 'Modular electronic fan regulator', '', 'Pcs', acc.regulators,
    '1 per ceiling fan')
  push('Socket', 'Modular Socket 3-Pin 6A', 'Modular shuttered socket 6A', '6A', 'Pcs', acc.sockets6A,
    '1 per general socket point')
  push('Socket', 'Modular Socket 3-Pin 16A', 'Modular socket 16A with switch', '16A', 'Pcs', acc.sockets16A,
    '1 per dedicated point (AC/Geyser/Kitchen/Washer)')
  push('Socket', 'TV / RF Socket', 'Coaxial TV socket', '', 'Pcs', acc.tvSockets, '1 per TV point')
  push('Cable', 'Coaxial Cable RG-6', 'RG-6 75Ω coaxial cable', 'RG-6', 'm', acc.tvCableM,
    'Room run to distribution point (Mode A)')
  push('Accessories', 'Ceiling Rose / Connector', 'PVC ceiling rose 6A', '6A', 'Pcs', acc.ceilingRose,
    '1 per light point')
  push('Light', 'LED Light (per point)', 'LED lamp/batten as per point specification', '', 'Pcs', acc.lights + acc.emergencyLights + acc.outdoorLights,
    '1 per light point (verify fixtures schedule)')
  push('Fan', 'Ceiling Fan 56"', '1200mm sweep, 220V', '56"', 'Pcs', acc.fans, '1 per fan point')
  push('Fan', 'Exhaust Fan', 'As per point size (6"/8"/10")', '', 'Pcs', acc.exhaust, '1 per exhaust point')
  push('Accessories', 'Cable Clip 20mm', 'PVC saddle clamp', '20', 'Pcs', Math.ceil(conduitM / 0.5),
    '2 clips per meter of conduit (0.5m spacing)')
  push('Accessories', 'Cable Tie 100mm', 'Nylon cable tie', '100mm', 'Pcs', Math.ceil(conduitM / 1.5),
    '1 per 1.5m conduit run')
  push('Accessories', 'Insulation Tape (Roll)', 'PVC electrical tape', '', 'Roll', Math.ceil(Object.values(acc.wire).reduce((a, b) => a + b, 0) / 100),
    '1 roll per 100m wire')
  push('Accessories', 'Cable Lug & Gland Set', 'Copper lug set for ≥4mm² & main connections', '', 'Set', acc.lugs / 6,
    '6 lugs per dedicated/main connection group')
  push('Accessories', 'Switchboard Faceplate', 'Modular faceplate as per gang count', '', 'Pcs', acc.switchboards,
    '1 per switchboard (gang count per room layout)')

  return items
}

// =============================================================================
// Mode B: drawing-based verified electrical quantities
// =============================================================================

const CABLE_RUNS: Record<string, number> = {
  LIGHT: 3, SOCKET: 3, AC: 3, GEYSER: 3, KITCHEN: 3, WASHER: 3,
  FEEDER: 3, SUBMAIN: 3, EARTH: 1,
}

export function estimateElectricalFromDrawing(
  routes: DrawingRoute[],
  symbols: DrawingSymbol[],
  ctx: EngineContext,
  warnings: string[],
): RawEstimateItem[] {
  const R = ctx.rules
  const items: RawEstimateItem[] = []
  if (!routes.length) return items

  const cableLen: Record<string, { size: string; len: number }> = {}
  let conduitM = 0
  let corners = 0

  for (const rt of routes) {
    if (rt.system !== 'cable') continue
    let len = 0
    for (let i = 1; i < rt.points.length; i++) {
      len += Math.hypot(rt.points[i].x - rt.points[i - 1].x, rt.points[i].y - rt.points[i - 1].y)
      // count corners (angle change)
      if (i < rt.points.length - 1) {
        const a1 = Math.atan2(rt.points[i].y - rt.points[i - 1].y, rt.points[i].x - rt.points[i - 1].x)
        const a2 = Math.atan2(rt.points[i + 1].y - rt.points[i].y, rt.points[i + 1].x - rt.points[i].x)
        if (Math.abs(a1 - a2) > 0.26) corners++
      }
    }
    if (len <= 0) continue
    conduitM += len
    corners++

    const runs = CABLE_RUNS[rt.kind] ?? 3
    const size = rt.spec || (rt.kind === 'LIGHT' ? R.lightWire : rt.kind === 'SOCKET' ? R.socketWire : '4.0')
    const key = `${rt.kind}|${size}`
    if (!cableLen[key]) cableLen[key] = { size, len: 0 }
    cableLen[key].len += len * runs
  }

  for (const [key, v] of Object.entries(cableLen)) {
    const [kind, size] = key.split('|')
    items.push({
      system: E, category: 'Cable',
      name: `PVC Insulated Copper Cable (Single Core) ${size} sqmm`,
      brand: '', specification: `Single core, ${size} mm², 650/1100V grade — route: ${kind}`, size,
      unit: 'm', mode: 'DRAWING', qty: r2(v.len),
      formula: `Σ polyline segment lengths (calibrated scale) × ${CABLE_RUNS[kind] ?? 3} runs (${kind})`,
      assumptions: ['Measured on calibrated drawing; scale verified with known dimension'],
      wastagePct: R.wireWastagePct, sourceRef: 'Drawing routes',
    })
  }
  if (conduitM > 0) {
    items.push({
      system: E, category: 'Conduit', name: 'PVC Conduit Pipe 20mm (3/4")',
      brand: '', specification: 'ISI PVC conduit, medium grade, 3m stick — drawing routes', size: '20',
      unit: 'm', mode: 'DRAWING', qty: r2(conduitM),
      formula: 'Σ cable route polyline lengths (calibrated scale)',
      assumptions: [], wastagePct: R.conduitWastagePct, sourceRef: 'Drawing routes',
    })
    items.push({
      system: E, category: 'Accessories', name: 'Junction Box (Circular)',
      brand: '', specification: 'PVC circular junction box — at route corners/branches', size: '',
      unit: 'Pcs', mode: 'DRAWING', qty: corners,
      formula: '1 per route corner/branch measured on drawing',
      assumptions: [], wastagePct: R.accessoryWastagePct, sourceRef: 'Drawing routes',
    })
  }

  // placed symbols → fixtures
  const byType: Record<string, number> = {}
  for (const s of symbols) {
    if (s.system === 'ELECTRICAL') byType[s.type] = (byType[s.type] ?? 0) + 1
  }
  const symMap: Record<string, { cat: string; name: string; spec: string }> = {
    LIGHT: { cat: 'Light', name: 'LED Light (placed)', spec: 'As placed on drawing' },
    CEILING_FAN: { cat: 'Fan', name: 'Ceiling Fan 56" (placed)', spec: '1200mm sweep' },
    EXHAUST_FAN: { cat: 'Fan', name: 'Exhaust Fan (placed)', spec: 'As placed' },
    SOCKET: { cat: 'Socket', name: 'Modular Socket 3-Pin 6A (placed)', spec: 'Shuttered 6A' },
    AC: { cat: 'Socket', name: 'Modular Socket 3-Pin 16A AC (placed)', spec: '16A' },
    SWITCHBOARD: { cat: 'Accessories', name: 'Switchboard Faceplate (placed)', spec: 'Gang per layout' },
  }
  for (const [t, n] of Object.entries(byType)) {
    const m = symMap[t]
    if (!m) continue
    items.push({
      system: E, category: m.cat, name: m.name, brand: '', specification: m.spec, size: '',
      unit: 'Pcs', mode: 'DRAWING', qty: n, formula: 'Symbol count on calibrated drawing',
      assumptions: [], wastagePct: R.accessoryWastagePct, sourceRef: 'Drawing symbols',
    })
  }

  return items
}

// Voltage drop check helper (single phase): VD% = 2·I·L·ρ/(A·V)·100
export function voltageDropPct(amps: number, lengthM: number, sizeMm2: number, voltage: number, threePhase = false): number {
  const rho = 0.0175 // Ω·mm²/m copper
  const vd = threePhase
    ? Math.sqrt(3) * amps * lengthM * rho / sizeMm2
    : 2 * amps * lengthM * rho / sizeMm2
  return r2((vd / voltage) * 100)
}
