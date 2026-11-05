// =============================================================================
// Engine: shared types for estimation input/output
// =============================================================================

import type { DesignRules } from './catalog'

export interface EngPoint {
  pointType: string
  quantity: number
  connectedLoadW?: number
  mountingHeight?: number
}

export interface EngFixture {
  fixtureType: string
  quantity: number
  system?: string
  pipeDiameter?: string
}

export interface EngRoom {
  id: string
  name: string
  roomType: string
  length: number
  width: number
  height: number
  points: EngPoint[]
  fixtures: EngFixture[]
}

export interface EngFloor {
  id: string
  floorNumber: number
  name: string
  height: number
  rooms: EngRoom[]
}

export interface EngProject {
  id: string
  name: string
  supplyType: string // 1-PHASE | 3-PHASE
  occupants: number
  floors: EngFloor[]
}

export type EstMode = 'AUTO' | 'DRAWING'

export interface RawEstimateItem {
  system: 'ELECTRICAL' | 'PLUMBING'
  category: string
  name: string
  brand: string
  specification: string
  size: string
  unit: string
  mode: EstMode
  qty: number
  formula: string
  assumptions: string[]
  wastagePct: number
  sourceRef: string
  floorId?: string
  floorName?: string
  roomId?: string
  roomName?: string
  materialId?: string
}

export interface EngCircuit {
  floorName: string
  name: string
  circuitType: string
  phase: string
  loadW: number
  designAmps: number
  breakerRating: string
  breakerType: string
  rccb: boolean
  cableSize: string
  cableLength: number
  pointsCount: number
  remarks: string
}

export interface EngSummary {
  totalConnectedW: number
  demandW: number
  designAmps: number
  mainBreaker: string
  totalRooms: number
  totalPoints: number
  totalFixtures: number
  wireTotalM: number
  conduitTotalM: number
  warnings: string[]
}

export interface EstimationResult {
  items: RawEstimateItem[]
  circuits: EngCircuit[]
  summary: EngSummary
  plumbingSummary: {
    occupants: number
    dailyDemandL: number
    ohtL: number
    ugtL: number
    pumpFlowLpm: number
    pumpHeadM: number
    pumpHp: string
  }
}

// ---- Drawing document JSON contract (shared with Drawing Editor) ------------

export interface DrawingRoom {
  roomId: string
  name: string
  x: number // meters
  y: number
  w: number // meters
  h: number
}

export interface DrawingSymbol {
  id: string
  type: string // POINT_TYPES.type or fixture type or DB/TANK/PUMP/RISER
  system: 'ELECTRICAL' | 'PLUMBING'
  floorNumber: number
  roomId?: string
  x: number // meters
  y: number
  label?: string
}

export interface DrawingRoute {
  id: string
  system: 'cable' | 'pipe'
  kind: string // cable: LIGHT | SOCKET | AC | GEYSER | KITCHEN | WASHER | FEEDER | SUBMAIN | EARTH ; pipe: COLD | HOT | SOIL | WASTE | VENT | RAIN
  spec: string // wire sqmm or pipe diameter+type e.g. "PPR-20"
  floorNumber: number
  roomId?: string
  points: Array<{ x: number; y: number }> // meters (real coordinates)
}

export interface DrawingDocData {
  version: number
  pxPerMeter: number
  calibrated: boolean
  backgroundImage?: string | null
  rooms: DrawingRoom[]
  symbols: DrawingSymbol[]
  routes: DrawingRoute[]
}

export interface EngineContext {
  rules: DesignRules
  drawing?: DrawingDocData | null
}
