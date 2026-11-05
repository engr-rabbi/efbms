// =============================================================================
// unit-store.ts — Global & project-scoped measurement-unit state.
//
//   * GLOBAL prefs (length/area unit, precision, rounding) are the software
//     default. Persisted locally for instant paint AND synced to the DB
//     (AppSetting rows via /api/settings/units) so the default is shared.
//   * PROJECT override: a project may pin its own length/area unit. When a
//     project with an override is open, useUnitPrefs() returns the effective
//     (project-wins) prefs — Drawing, Estimation, BOQ & Reports for that
//     project then display in the project unit.
//   * This store only ever changes DISPLAY preferences. It never touches
//     drawing geometry, scale, positions, quantities or persisted records.
// =============================================================================

import { callApi } from '@/lib/backend'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useMemo, useCallback } from 'react'
import { useAppStore } from '@/lib/store'
import {
  DEFAULT_UNIT_PREFS, LENGTH_UNITS, AREA_UNITS,
  fmtLen, fmtLenS, fmtArea, fmtAreaS, lengthSymbol, areaSymbol,
  mToLen, lenToM, sqmToArea, areaToSqm,
  type UnitPrefs, type LengthUnit, type AreaUnit, type RoundingMode,
} from '@/lib/units'

export interface ProjectUnitOverride {
  lengthUnit: LengthUnit | '' // '' = follow global
  areaUnit: AreaUnit | ''
}

interface UnitState {
  prefs: UnitPrefs // global defaults (persisted + DB-synced)
  serverSynced: boolean
  projectId: string | null
  projectUnits: ProjectUnitOverride | null
  setPrefs: (p: Partial<UnitPrefs>) => void
  hydrateFromServer: () => Promise<void>
  loadProject: (projectId: string | null, project?: { unitLength?: string; unitArea?: string } | null) => void
  setProjectUnits: (projectId: string, u: ProjectUnitOverride, opts?: { persist?: boolean }) => void
}

function sanitizePrefs(p: Partial<UnitPrefs>, base: UnitPrefs): UnitPrefs {
  const lengthUnit = p.lengthUnit && p.lengthUnit in LENGTH_UNITS ? p.lengthUnit : base.lengthUnit
  const areaUnit = p.areaUnit && p.areaUnit in AREA_UNITS ? p.areaUnit : base.areaUnit
  const lp = p.lengthPrecision
  const ap = p.areaPrecision
  const precision = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 6 ? Math.round(v) : null
  return {
    lengthUnit,
    areaUnit,
    lengthPrecision: lp === undefined ? base.lengthPrecision : precision(lp),
    areaPrecision: ap === undefined ? base.areaPrecision : precision(ap),
    rounding: p.rounding === 'NEAREST' || p.rounding === 'UP' || p.rounding === 'DOWN' ? p.rounding : base.rounding,
  }
}

export const useUnitStore = create<UnitState>()(
  persist(
    (set, get) => ({
      prefs: DEFAULT_UNIT_PREFS,
      serverSynced: false,
      projectId: null,
      projectUnits: null,

      /** Change GLOBAL prefs: optimistic local update + DB sync (shared default). */
      setPrefs: (p) => {
        const next = sanitizePrefs(p, get().prefs)
        set({ prefs: next })
        // roles without permission (e.g. VIEWER) keep the change locally; the server refuses to store it
        void callApi('/api/settings/units', { method: 'PUT', body: JSON.stringify(next) }).catch(() => undefined)
      },

      /** Pull shared global defaults from the DB (called once after login). */
      hydrateFromServer: async () => {
        try {
          const body = await callApi<{ units?: Partial<UnitPrefs> } & Partial<UnitPrefs>>('/api/settings/units')
          const d = body.units ?? body
          set({ prefs: sanitizePrefs(d, get().prefs), serverSynced: true })
        } catch {
          // offline / API down → keep local prefs
        }
      },

      /** Call when a project opens/closes. project.unitLength/'' → override or null. */
      loadProject: (projectId, project) => {
        if (!projectId || !project) {
          set({ projectId: null, projectUnits: null })
          return
        }
        const lu = project.unitLength && project.unitLength in LENGTH_UNITS ? (project.unitLength as LengthUnit) : ''
        const au = project.unitArea && project.unitArea in AREA_UNITS ? (project.unitArea as AreaUnit) : ''
        set({
          projectId,
          projectUnits: lu || au ? { lengthUnit: lu, areaUnit: au } : null,
        })
      },

      /** Set/clear the current project's unit override (local + DB persist). */
      setProjectUnits: (projectId, u, opts) => {
        const cur = get()
        if (cur.projectId !== projectId) return
        const lu = u.lengthUnit && u.lengthUnit in LENGTH_UNITS ? u.lengthUnit : ''
        const au = u.areaUnit && u.areaUnit in AREA_UNITS ? u.areaUnit : ''
        set({ projectUnits: lu || au ? { lengthUnit: lu, areaUnit: au } : null })
        if (opts?.persist !== false) {
          void callApi(`/api/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ unitLength: lu, unitArea: au }) }).catch(() => undefined)
        }
      },
    }),
    {
      name: 'efbms-units',
      partialize: (s) => ({ prefs: s.prefs }),
    },
  ),
)

/** Effective prefs: project override (when set) wins over global defaults. */
export function useUnitPrefs(): UnitPrefs {
  const prefs = useUnitStore((s) => s.prefs)
  const projectId = useUnitStore((s) => s.projectId)
  const projectUnits = useUnitStore((s) => s.projectUnits)
  return useMemo(() => {
    if (projectId && projectUnits) {
      return {
        ...prefs,
        lengthUnit: (projectUnits.lengthUnit || prefs.lengthUnit) as LengthUnit,
        areaUnit: (projectUnits.areaUnit || prefs.areaUnit) as AreaUnit,
      }
    }
    return prefs
  }, [prefs, projectId, projectUnits])
}

export interface Fmt {
  prefs: UnitPrefs
  isProjectOverride: boolean
  lenSym: string
  areaSym: string
  /** meters → display value string */
  len: (m: number, precision?: number | null) => string
  /** meters → "value symbol" */
  lenS: (m: number, precision?: number | null) => string
  /** m² → display value string */
  area: (sqm: number, precision?: number | null) => string
  /** m² → "value symbol" */
  areaS: (sqm: number, precision?: number | null) => string
  /** internal meters → number in the active length unit (for inputs) */
  toLen: (m: number) => number
  /** active length unit number → internal meters (input commit) */
  fromLen: (v: number) => number
  /** internal m² → number in the active area unit (for inputs) */
  toArea: (sqm: number) => number
  /** active area unit number → internal m² (input commit) */
  fromArea: (v: number) => number
}

/** Bound formatting/conversion helpers for the ACTIVE (effective) prefs. */
export function useFmt(): Fmt {
  const prefs = useUnitPrefs()
  const projectId = useUnitStore((s) => s.projectId)
  const projectUnits = useUnitStore((s) => s.projectUnits)
  return useMemo<Fmt>(
    () => ({
      prefs,
      isProjectOverride: Boolean(projectId && projectUnits && (projectUnits.lengthUnit || projectUnits.areaUnit)),
      lenSym: lengthSymbol(prefs.lengthUnit),
      areaSym: areaSymbol(prefs.areaUnit),
      len: (m, precision) => fmtLen(m, prefs, precision),
      lenS: (m, precision) => fmtLenS(m, prefs, precision),
      area: (sqm, precision) => fmtArea(sqm, prefs, precision),
      areaS: (sqm, precision) => fmtAreaS(sqm, prefs, precision),
      toLen: (m) => mToLen(m, prefs.lengthUnit),
      fromLen: (v) => lenToM(v, prefs.lengthUnit),
      toArea: (sqm) => sqmToArea(sqm, prefs.areaUnit),
      fromArea: (v) => areaToSqm(v, prefs.areaUnit),
    }),
    [prefs, projectId, projectUnits],
  )
}

/** Imperative helpers for non-React contexts (API layers etc.). */
export function getActivePrefs(): UnitPrefs {
  const s = useUnitStore.getState()
  if (s.projectId && s.projectUnits) {
    return {
      ...s.prefs,
      lengthUnit: (s.projectUnits.lengthUnit || s.prefs.lengthUnit) as LengthUnit,
      areaUnit: (s.projectUnits.areaUnit || s.prefs.areaUnit) as AreaUnit,
    }
  }
  return s.prefs
}

/** Convenience hook: change a single global pref (unit dropdowns). */
export function useSetUnitPref(): (p: Partial<UnitPrefs>) => void {
  return useCallback((p) => useUnitStore.getState().setPrefs(p), [])
}

export type { LengthUnit, AreaUnit, RoundingMode }
