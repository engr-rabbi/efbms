// =============================================================================
// Engine: Plumbing estimation (Mode A automatic + Mode B drawing-based)
// =============================================================================
import { FIXTURE_TYPES } from './catalog'
import type {
  EngProject,
  EngineContext,
  EstimationResult,
  RawEstimateItem,
} from './types'
import { type DrawingRoute, type DrawingSymbol } from './types'

const P = 'PLUMBING' as const

function meta(fx: string) {
  return FIXTURE_TYPES.find((f) => f.type === fx)
}

function r2(n: number) {
  return Math.round(n * 100) / 100
}

interface PipeAcc {
  [pipeKey: string]: { name: string; spec: string; size: string; len: number }
}

function addPipe(acc: PipeAcc, key: string, name: string, spec: string, size: string, len: number) {
  if (!acc[key]) acc[key] = { name, spec, size, len: 0 }
  acc[key].len += len
}

export function estimatePlumbing(
  project: EngProject,
  ctx: EngineContext,
  warnings: string[],
): { items: RawEstimateItem[]; plumbing: EstimationResult['plumbingSummary'] } {
  const R = ctx.rules
  const items: RawEstimateItem[] = []
  const acc: PipeAcc = {}
  const fitting: Record<string, number> = {
    elbowPPR: 0, teePPR: 0, unionPPR: 0, ballValve15: 0, ballValve25: 0, nrv: 0,
    bendPVC110: 0, bendPVC75: 0, teePVC: 0, reducer: 0, floorTrap: 0, floorDrain: 0,
    cleanout: 0, clamp: 0, solvent: 0, tape: 0, angleValve: 0, bibCock: 0,
    pTrap: 0, bottleTrap: 0, wasteCoupling: 0,
  }
  const sanitary: Record<string, number> = {}

  const floors = project.floors
  const nFloors = Math.max(1, floors.length)
  const occupants = project.occupants > 0 ? project.occupants : nFloors * R.occupantsPerFloor
  const buildingHeight = floors.reduce((a, f) => a + (f.height || 3.05), 0)

  let coldBranchM = 0
  let hotBranchM = 0
  let wasteBranchM = 0
  let soilBranchM = 0
  let wetRooms = 0
  let totalFixtures = 0

  for (const floor of floors) {
    for (const room of floor.rooms) {
      let roomWet = false
      for (const fx of room.fixtures) {
        const m = meta(fx.fixtureType)
        if (!m) continue
        const q = Math.max(1, fx.quantity)
        totalFixtures += q
        if (m.wetArea) roomWet = true

        sanitary[fx.fixtureType] = (sanitary[fx.fixtureType] ?? 0) + q

        // Mode A branch allowances per fixture
        if (m.coldAllowM > 0) {
          coldBranchM += m.coldAllowM * q
          addPipe(acc, `COLD-${m.coldDia}`, 'PPR Pipe PN-20 (Cold Water)', 'PPC PN-20, 4m stick', m.coldDia, m.coldAllowM * q)
          fitting.elbowPPR += 1 * q
          if (['WC', 'SINK', 'SHOWER', 'BASIN', 'WASHING_MACHINE', 'GEYSER'].includes(fx.fixtureType)) {
            fitting.ballValve15 += q // angle/ball valve per fixture branch
          }
        }
        if (m.hotAllowM > 0) {
          hotBranchM += m.hotAllowM * q
          addPipe(acc, `HOT-${m.hotDia}`, 'PPR Pipe PN-20 (Hot Water)', 'PPC PN-20, 4m stick', m.hotDia, m.hotAllowM * q)
          fitting.elbowPPR += 1 * q
          if (fx.fixtureType === 'GEYSER' || fx.fixtureType === 'BASIN' || fx.fixtureType === 'SINK' || fx.fixtureType === 'SHOWER') {
            fitting.angleValve += q
          }
        }
        if (m.wasteAllowM > 0) {
          wasteBranchM += m.wasteAllowM * q
          const dia = fx.pipeDiameter || m.wasteDia
          addPipe(acc, `WASTE-${dia}`, 'uPVC Pipe (Wastewater)', 'Schedule-40 uPVC, 3m stick', dia, m.wasteAllowM * q)
          fitting.pTrap += q
          if (fx.fixtureType === 'FLOOR_DRAIN') fitting.floorDrain += q
          if (fx.fixtureType === 'FLOOR_TRAP') fitting.floorTrap += q
        }
        if (m.soilAllowM > 0) {
          soilBranchM += m.soilAllowM * q
          const dia = fx.pipeDiameter || m.soilDia
          if (fx.fixtureType === 'RAINWATER_OUTLET') {
            addPipe(acc, `RAIN-${dia}`, 'uPVC Pipe (Rainwater)', 'Schedule-40 uPVC, 3m stick', dia, m.soilAllowM * q)
          } else {
            addPipe(acc, `SOIL-${dia}`, 'uPVC Pipe (Soil & Waste)', 'Schedule-40 uPVC, 3m stick', dia, m.soilAllowM * q)
            fitting.bendPVC110 += q
          }
        }
      }
      if (roomWet) wetRooms++
    }
  }

  // ---- Distribution headers & risers (Mode A) ----
  const coldHeader = wetRooms * 4 // assumption: 4m header per wet room
  const hotHeader = wetRooms * 3
  addPipe(acc, 'COLD-25', 'PPR Pipe PN-20 (Cold Distribution)', 'PPC PN-20, 4m stick', '25', coldHeader)
  addPipe(acc, 'HOT-25', 'PPR Pipe PN-20 (Hot Distribution)', 'PPC PN-20, 4m stick', '25', hotHeader)
  fitting.teePPR += wetRooms
  fitting.elbowPPR += Math.ceil(wetRooms / 2)

  const coldRiser = R.coldRiserPerFloor * nFloors
  const hotRiser = R.hotRiserPerFloor * nFloors
  addPipe(acc, 'COLD-32', 'PPR Pipe PN-20 (Cold Riser)', 'PPC PN-20, 4m stick', '32', coldRiser)
  addPipe(acc, 'HOT-20', 'PPR Pipe PN-20 (Hot Riser)', 'PPC PN-20, 4m stick', '20', hotRiser)
  fitting.ballValve25 += nFloors
  fitting.nrv += 1

  // Soil stacks: 1 per 2 bathrooms per building (min 1) + vent
  const bathCount = project.floors.flatMap((f) => f.rooms).filter((r) => r.roomType === 'BATHROOM').reduce((a, r) => a + r.fixtures.filter((x) => x.fixtureType === 'WC').reduce((b, x) => b + Math.max(1, x.quantity), 0), 0)
  const soilStacks = Math.max(1, Math.ceil(bathCount / (2 * nFloors)))
  addPipe(acc, 'SOIL-110-STACK', 'uPVC Pipe (Soil Stack)', 'Schedule-40 uPVC, 3m stick', '110', buildingHeight * soilStacks)
  addPipe(acc, 'VENT-110', 'uPVC Pipe (Vent Stack)', 'Schedule-40 uPVC, 3m stick', '110', buildingHeight * soilStacks + 1)
  fitting.cleanout += soilStacks * nFloors
  fitting.bendPVC110 += soilStacks

  // Rainwater downpipes
  addPipe(acc, 'RAIN-75', 'uPVC Pipe (Rainwater Downpipe)', 'Schedule-40 uPVC, 3m stick', '75', buildingHeight * R.rainDownpipes)
  fitting.bendPVC75 += R.rainDownpipes

  // ---- Water demand / tanks / pump ----
  const dailyDemandL = occupants * R.perCapitaLpd
  const ohtL = Math.max(500, dailyDemandL * R.ohtFactor)
  const ugtL = dailyDemandL * R.ugtFactor
  const pumpFlowLpm = dailyDemandL / (R.pumpHours * 60)
  const topHeight = buildingHeight + 1.5
  const pumpHeadM = r2(topHeight * 1.15 + 5) // static + 15% friction + residual 5m
  // P(kW) = ρgQH/η ; Q in m³/s ; η=0.55
  const qM3s = pumpFlowLpm / 60000
  const powerKw = (1000 * 9.81 * qM3s * pumpHeadM) / (0.55 * 1000)
  const hp = powerKw / 0.746
  const stdHp = [0.5, 1, 1.5, 2, 3, 5].find((s) => s >= hp) ?? 5

  // ---- Pipe items ----
  const pushPipes = () => {
    for (const [key, p] of Object.entries(acc)) {
      if (p.len <= 0) continue
      items.push({
        system: P, category: 'Pipe', name: p.name, brand: '',
        specification: `${p.spec}, Ø ${p.size} mm`, size: p.size, unit: 'm', mode: 'AUTO',
        qty: r2(p.len),
        formula: key.includes('STACK') || key.includes('RISER') || key.includes('VENT') || key.includes('RAIN-75')
          ? 'Building height × stacks/downpipes (vertical, Mode A)'
          : 'Σ fixture branch allowances + wet-room headers (Mode A)',
        assumptions: key.includes('STACK') || key.includes('RISER')
          ? ['Riser/stack run assumed vertical at shaft; verify location']
          : ['Branch allowances per fixture type table; verify with actual routing'],
        wastagePct: R.pipeWastagePct, sourceRef: 'Mode A',
      })
    }
  }

  // ---- Fittings ----
  const pushFittings = () => {
    const f = (cat: string, name: string, spec: string, size: string, qty: number, formula: string) => {
      if (qty <= 0) return
      items.push({
        system: P, category: cat, name, brand: '', specification: spec, size, unit: 'Pcs',
        mode: 'AUTO', qty: Math.ceil(qty), formula, assumptions: ['Quantity derived from fixture count & pipe runs (Mode A); refine with drawing routes'],
        wastagePct: R.fittingWastagePct, sourceRef: 'Mode A',
      })
    }
    const totalPipeM = Object.values(acc).reduce((a, p) => a + p.len, 0)
    f('Fitting', 'PPR Elbow 90°', 'PPR PN-20 elbow', '20/25/32', fitting.elbowPPR, '≈1 per fixture branch + header turns')
    f('Fitting', 'PPR Tee', 'PPR PN-20 equal tee', '20/25/32', fitting.teePPR, '1 per wet-room takeoff')
    f('Fitting', 'PPR Union', 'PPR PN-20 union', '20/25', Math.ceil(wetRooms / 2), 'Connection joints (pump/tank/headers)')
    f('Valve', 'Ball Valve 15mm (Brass)', 'Brass ball valve, screw end', '15', fitting.ballValve15, '1 per fixture branch')
    f('Valve', 'Ball Valve 25mm (Brass)', 'Brass ball valve', '25', fitting.ballValve25, '1 per floor riser isolation')
    f('Valve', 'Non-Return Valve', 'Brass NRV inline', '25', fitting.nrv, '1 at pump delivery')
    f('Valve', 'Angle Valve (Hot/Cold)', 'Brass angle valve', '15', fitting.angleValve, '1 per sanitary branch')
    f('Fitting', 'PVC Bend 90° 110mm', 'uPVC solvent bend', '110', fitting.bendPVC110, '1 per WC + stack base')
    f('Fitting', 'PVC Bend 90° 75mm', 'uPVC solvent bend', '75', fitting.bendPVC75, '1 per downpipe base')
    f('Fitting', 'PVC Tee / Reducer Set', 'uPVC tees & reducers', '40-110', fitting.teePVC + fitting.reducer + Math.ceil(totalPipeM / 12), '≈1 per 12m pipe run (branches)')
    f('Fitting', 'Floor Trap (PVC)', 'PVC floor trap with grate', '50', fitting.floorTrap, 'As per fixture entries')
    f('Fitting', 'Floor Drain (SS Grate)', 'Stainless steel grate floor drain', '50/75', fitting.floorDrain, 'As per fixture entries')
    f('Fitting', 'Cleanout / Inspection Cover', 'uPVC cleanout with cover', '110', fitting.cleanout, '1 per stack per floor')
    f('Fitting', 'P-Trap / Bottle Trap', 'PVC P-trap (sink/shower) & bottle trap (basin)', '32/40/50', fitting.pTrap, '1 per waste fixture')
    f('Fitting', 'Pipe Clamp / Support', 'PVC/metal clamp with insert', 'All', Math.ceil(totalPipeM / R.clampPerM), `1 per ${R.clampPerM}m pipe`)
    f('Consumable', 'Solvent Cement (Can)', 'uPVC solvent cement', '100ml', Math.ceil(totalPipeM / 30), '≈1 can per 30m PVC pipe')
    f('Consumable', 'Thread Seal Tape (Roll)', 'PTFE tape', '12mm', Math.ceil(fitting.ballValve15 + fitting.ballValve25 + fitting.angleValve + fitting.bibCock) / 20 + 1, '≈1 roll per 20 threaded joints')
    f('Sanitary', 'Bib Cock 15mm (Long Body)', 'Brass/chrome bib cock', '15', sanitary['BIB_COCK'] ?? 0, 'As per fixture entries')
  }

  // ---- Sanitary ware ----
  const pushSanitary = () => {
    const s = (type: string, name: string, spec: string, unit: string, qty: number, formula: string) => {
      if (qty <= 0) return
      items.push({
        system: P, category: 'Sanitary', name, brand: '', specification: spec, size: '', unit,
        mode: 'AUTO', qty, formula, assumptions: [],
        wastagePct: 0, sourceRef: 'Mode A',
      })
    }
    s('WC', 'Water Closet (Long Pan) with Cistern', 'Ceramic, P/S trap, dual flush', 'Set', sanitary['WC'] ?? 0, 'Fixture count')
    s('BASIN', 'Wash Basin with Pedestal', 'Ceramic counter/wall basin', 'Set', sanitary['BASIN'] ?? 0, 'Fixture count')
    s('SINK', 'Kitchen Sink (SS)', 'Stainless steel single/double bowl', 'Set', sanitary['SINK'] ?? 0, 'Fixture count')
    s('SHOWER', 'Shower Set (Mixing Valve + Head)', 'Chrome plated set', 'Set', sanitary['SHOWER'] ?? 0, 'Fixture count')
    s('GEYSER', 'Instant/Storage Water Heater', 'As per capacity selection', 'Pcs', sanitary['GEYSER'] ?? 0, 'Fixture count')
    s('WASHING_MACHINE', 'Washing Machine Tap Point', 'Wall bib + waste connection', 'Set', sanitary['WASHING_MACHINE'] ?? 0, 'Fixture count')
    s('PURIFIER', 'Water Purifier', 'RO/UV purifier', 'Pcs', sanitary['PURIFIER'] ?? 0, 'Fixture count')
  }

  pushPipes()
  pushFittings()
  pushSanitary()

  // Tank & pump equipment
  const ohtStd = [500, 750, 1000, 1500, 2000, 3000].find((s) => s >= ohtL) ?? 5000
  const ugtStd = [1000, 1500, 2000, 3000, 5000].find((s) => s >= ugtL) ?? 5000
  items.push({
    system: P, category: 'Equipment', name: `Water Tank (Overhead) ${ohtStd}L`, brand: '',
    specification: `Plastic water tank ${ohtStd}L (required calc: ${Math.round(ohtL)}L)`, size: String(ohtStd),
    unit: 'Pcs', mode: 'AUTO', qty: 1,
    formula: `Daily demand ${Math.round(dailyDemandL)}L × ${R.ohtFactor} → next standard size`,
    assumptions: [`Occupants: ${occupants} (@ ${R.perCapitaLpd} L/person/day)`],
    wastagePct: 0, sourceRef: 'Mode A',
  })
  items.push({
    system: P, category: 'Equipment', name: `Water Tank (Underground) ${ugtStd}L`, brand: '',
    specification: `UGT/reserve tank ${ugtStd}L (required calc: ${Math.round(ugtL)}L)`, size: String(ugtStd),
    unit: 'Pcs', mode: 'AUTO', qty: 1,
    formula: `Daily demand ${Math.round(dailyDemandL)}L × ${R.ugtFactor} → next standard size`,
    assumptions: ['Verify municipal supply hours & reserve policy'],
    wastagePct: 0, sourceRef: 'Mode A',
  })
  items.push({
    system: P, category: 'Equipment', name: `Water Pump ${stdHp} HP`, brand: '',
    specification: `Centrifugal/mono-block pump, Flow ≈ ${Math.round(pumpFlowLpm)} LPM, Head ≈ ${pumpHeadM} m`,
    size: `${stdHp}HP`,
    unit: 'Pcs', mode: 'AUTO', qty: 1,
    formula: `Q = demand/pumpHours; H = (building height + 1.5m) × 1.15 + 5m; P = ρgQH/η (η=0.55)`,
    assumptions: ['Pump selection needs verification against actual suction & delivery losses'],
    wastagePct: 0, sourceRef: 'Mode A',
  })

  if (totalFixtures === 0) {
    warnings.push('No plumbing fixtures defined. Add fixtures to rooms for plumbing estimation.')
  }
  warnings.push('Pipe lengths are Mode A estimates (fixture allowances + riser assumptions). Draw pipe routes for drawing-based verified quantities.')
  warnings.push('Drainage horizontal runs assume slope 1:50 — verify against available fall.')

  return {
    items,
    plumbing: {
      occupants,
      dailyDemandL: Math.round(dailyDemandL),
      ohtL: Math.round(ohtL),
      ugtL: Math.round(ugtL),
      pumpFlowLpm: Math.round(pumpFlowLpm),
      pumpHeadM,
      pumpHp: `${stdHp}`,
    },
  }
}

// =============================================================================
// Mode B: drawing-based verified plumbing quantities
// =============================================================================

const PIPE_KIND_META: Record<string, { name: string; spec: string }> = {
  COLD: { name: 'PPR Pipe PN-20 (Cold Water)', spec: 'PPC PN-20, 4m stick' },
  HOT: { name: 'PPR Pipe PN-20 (Hot Water)', spec: 'PPC PN-20, 4m stick' },
  SOIL: { name: 'uPVC Pipe (Soil & Waste)', spec: 'Schedule-40 uPVC, 3m stick' },
  WASTE: { name: 'uPVC Pipe (Wastewater)', spec: 'Schedule-40 uPVC, 3m stick' },
  VENT: { name: 'uPVC Pipe (Vent)', spec: 'Schedule-40 uPVC, 3m stick' },
  RAIN: { name: 'uPVC Pipe (Rainwater)', spec: 'Schedule-40 uPVC, 3m stick' },
}

export function estimatePlumbingFromDrawing(
  routes: DrawingRoute[],
  symbols: DrawingSymbol[],
  ctx: EngineContext,
): RawEstimateItem[] {
  const R = ctx.rules
  const items: RawEstimateItem[] = []
  if (!routes.length) return items

  const acc: PipeAcc = {}
  let fittings = 0
  let clamps = 0

  for (const rt of routes) {
    if (rt.system !== 'pipe') continue
    let len = 0
    for (let i = 1; i < rt.points.length; i++) {
      len += Math.hypot(rt.points[i].x - rt.points[i - 1].x, rt.points[i].y - rt.points[i - 1].y)
    }
    if (len <= 0) continue
    // spec format "PPR-20" or "PVC-110"
    const [mat, dia] = rt.spec.split('-')
    const m = PIPE_KIND_META[rt.kind] ?? { name: `Pipe (${rt.kind})`, spec: mat === 'PPR' ? 'PPR PN-20' : 'uPVC' }
    const key = `${rt.kind}-${dia}`
    addPipe(acc, key, m.name, mat === 'PPR' ? 'PPC PN-20, 4m stick' : 'Schedule-40 uPVC, 3m stick', dia ?? '', len)
    fittings += Math.max(1, Math.round(len / 4)) // elbow per ~4m + branch
    clamps += Math.ceil(len / R.clampPerM)
  }

  for (const [key, p] of Object.entries(acc)) {
    if (p.len <= 0) continue
    const [kind] = key.split('-')
    items.push({
      system: P, category: 'Pipe', name: p.name, brand: '',
      specification: `${p.spec}, Ø ${p.size} mm — route: ${kind}`, size: p.size, unit: 'm',
      mode: 'DRAWING', qty: r2(p.len),
      formula: 'Σ polyline segment lengths (calibrated scale)',
      assumptions: ['Measured on calibrated drawing'], wastagePct: R.pipeWastagePct,
      sourceRef: 'Drawing routes',
    })
  }
  if (fittings > 0) {
    items.push({
      system: P, category: 'Fitting', name: 'Pipe Fittings Set (Elbow/Tee/Bend as per route)',
      brand: '', specification: 'Assorted fittings measured from route corners/branches', size: 'Mixed',
      unit: 'Pcs', mode: 'DRAWING', qty: fittings,
      formula: '≈1 fitting per 4m route + corners', assumptions: ['Refine per actual branch connection detail'],
      wastagePct: R.fittingWastagePct, sourceRef: 'Drawing routes',
    })
    items.push({
      system: P, category: 'Fitting', name: 'Pipe Clamp / Support',
      brand: '', specification: 'PVC/metal clamp with insert', size: 'All', unit: 'Pcs',
      mode: 'DRAWING', qty: clamps, formula: `1 per ${R.clampPerM}m route`,
      assumptions: [], wastagePct: R.fittingWastagePct, sourceRef: 'Drawing routes',
    })
  }

  // placed plumbing symbols
  const byType: Record<string, number> = {}
  for (const s of symbols) {
    if (s.system === 'PLUMBING') byType[s.type] = (byType[s.type] ?? 0) + 1
  }
  const symMap: Record<string, { name: string; spec: string; unit: string }> = {
    WC: { name: 'Water Closet (Long Pan) with Cistern', spec: 'Ceramic, dual flush', unit: 'Set' },
    BASIN: { name: 'Wash Basin with Pedestal', spec: 'Ceramic', unit: 'Set' },
    SINK: { name: 'Kitchen Sink (SS)', spec: 'Stainless steel', unit: 'Set' },
    SHOWER: { name: 'Shower Set', spec: 'Chrome set', unit: 'Set' },
    FLOOR_DRAIN: { name: 'Floor Drain (SS Grate)', spec: '50/75mm', unit: 'Pcs' },
    FLOOR_TRAP: { name: 'Floor Trap (PVC)', spec: '50mm', unit: 'Pcs' },
    GEYSER: { name: 'Water Heater (Geyser)', spec: 'As placed', unit: 'Pcs' },
    TANK: { name: 'Water Tank', spec: 'As placed', unit: 'Pcs' },
    PUMP: { name: 'Water Pump', spec: 'As placed', unit: 'Pcs' },
  }
  for (const [t, n] of Object.entries(byType)) {
    const m = symMap[t]
    if (!m) continue
    items.push({
      system: P, category: 'Sanitary', name: m.name, brand: '', specification: m.spec, size: '',
      unit: m.unit, mode: 'DRAWING', qty: n, formula: 'Symbol count on calibrated drawing',
      assumptions: [], wastagePct: 0, sourceRef: 'Drawing symbols',
    })
  }

  return items
}
