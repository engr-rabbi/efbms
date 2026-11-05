// =============================================================================
// Engine: main entry — run full estimation for a project
// =============================================================================
import type { DesignRules } from './catalog'
import { estimateElectrical } from './electrical'
import { estimatePlumbing, estimatePlumbingFromDrawing } from './plumbing'
import { estimateElectricalFromDrawing } from './electrical'
import type {
  EngProject, EngineContext, EstimationResult, RawEstimateItem,
} from './types'

export * from './types'
export * from './catalog'
export * from './boq'
export { estimateElectrical, voltageDropPct } from './electrical'
export { estimatePlumbing, estimatePlumbingFromDrawing } from './plumbing'

export function runEstimation(project: EngProject, ctx: EngineContext): EstimationResult {
  const warnings: string[] = []

  const elec = estimateElectrical(project, ctx, warnings)
  const plumb = estimatePlumbing(project, ctx, warnings)

  // Mode B: drawing-based quantities (kept separate; BOQ merges with precedence)
  const drawingRoutes = ctx.drawing?.routes ?? []
  const drawingSymbols = ctx.drawing?.symbols ?? []
  const elecDrawing = ctx.drawing?.calibrated
    ? estimateElectricalFromDrawing(drawingRoutes, drawingSymbols, ctx, warnings)
    : []
  const plumbDrawing = ctx.drawing?.calibrated
    ? estimatePlumbingFromDrawing(drawingRoutes, drawingSymbols, ctx)
    : []
  if (ctx.drawing?.calibrated && drawingRoutes.length === 0) {
    warnings.push('Drawing is calibrated but no cable/pipe routes drawn yet — Mode B quantities pending.')
  }

  const items: RawEstimateItem[] = [...elec.items, ...plumb.items, ...elecDrawing, ...plumbDrawing]

  return {
    items,
    circuits: elec.circuits,
    summary: { ...elec.summary, totalFixtures: plumb.items.filter((i) => i.category === 'Sanitary').length },
    plumbingSummary: plumb.plumbing,
  }
}

export function rulesFromMap(map: Record<string, string>, defaults: DesignRules): DesignRules {
  const out = { ...defaults } as unknown as Record<string, unknown>
  for (const [k, v] of Object.entries(map)) {
    if (k in out) {
      const defVal = defaults[k as keyof DesignRules]
      if (typeof defVal === 'number') {
        const n = Number(v)
        if (!Number.isNaN(n)) out[k] = n
      } else if (typeof defVal === 'string') {
        out[k] = v
      } else if (typeof defVal === 'boolean') {
        out[k] = v === 'true'
      }
    }
  }
  return out as unknown as DesignRules
}
