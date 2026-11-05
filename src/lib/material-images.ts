// =============================================================================
// Material sample image mapping — generic TYPE sample photos (not real brand
// product photos). Used by the seed (to attach static samples) and by the UI
// (as fallback when a material has no images). Samples are always displayed
// with a "Sample" badge so they are never presented as a real brand photo.
// =============================================================================

export interface MaterialLike {
  category: string
  name: string
  specification?: string | null
  size?: string | null
}

export interface SampleImageDef {
  src: string
  label: string
  /** match only when material.category is one of these (undefined = any) */
  cats?: string[]
  /** case-insensitive keyword test against name + specification + size */
  keys: string[]
}

const B = '/images/materials'

export const SAMPLE_IMAGES: SampleImageDef[] = [
  // ---- specific (most precise) rules first ----
  { src: `${B}/bib-cock.jpg`, label: 'Water Tap / Bib Cock', keys: ['bib cock', 'bibcock', 'faucet', 'water tap'] },
  { src: `${B}/floor-drain.jpg`, label: 'Floor Drain', keys: ['floor drain'] },
  { src: `${B}/pvc-fittings.jpg`, label: 'PVC Traps & Fittings', keys: ['floor trap', 'p-trap', 'bottle trap', 'cleanout', 'inspection cover'] },
  { src: `${B}/commode.jpg`, label: 'Water Closet', keys: ['water closet', 'commode', 'long pan'] },
  { src: `${B}/wash-basin.jpg`, label: 'Wash Basin', keys: ['wash basin', 'basin'] },
  { src: `${B}/kitchen-sink.jpg`, label: 'Kitchen Sink', keys: ['kitchen sink', 'sink'] },
  { src: `${B}/shower-set.jpg`, label: 'Shower Set', keys: ['shower'] },
  { src: `${B}/geyser.jpg`, label: 'Water Heater / Geyser', keys: ['geyser', 'water heater'] },
  { src: `${B}/water-tank.jpg`, label: 'Water Tank', keys: ['water tank', 'tank'] },
  { src: `${B}/water-pump.jpg`, label: 'Water Pump', keys: ['pump'] },
  { src: `${B}/ceiling-fan.jpg`, label: 'Ceiling Fan', cats: ['Fan'], keys: ['ceiling fan'] },
  { src: `${B}/exhaust-fan.jpg`, label: 'Exhaust Fan', cats: ['Fan'], keys: ['exhaust', 'ventilating'] },
  { src: `${B}/ppr-pipe.jpg`, label: 'PPR Pipe', cats: ['Pipe'], keys: ['ppr', 'ppc'] },
  { src: `${B}/pvc-pipe.jpg`, label: 'uPVC / PVC Pipe', cats: ['Pipe'], keys: ['upvc', 'pvc'] },
  { src: `${B}/ppr-fittings.jpg`, label: 'PPR Fittings', cats: ['Fitting'], keys: ['ppr', 'ppc'] },
  { src: `${B}/pvc-fittings.jpg`, label: 'PVC Fittings & Bends', cats: ['Fitting'], keys: ['upvc', 'pvc', 'bend', 'tee', 'reducer', 'clamp', 'support'] },
  // ---- category-wide rules ----
  { src: `${B}/conduit-pipe.jpg`, label: 'Conduit Pipe', cats: ['Conduit'], keys: [] },
  { src: `${B}/junction-box.jpg`, label: 'Junction / Switch Box', cats: ['Accessories'], keys: ['junction box', 'switch box', 'faceplate', 'ceiling rose'] },
  { src: `${B}/wiring-accessories.jpg`, label: 'Wiring Accessories', cats: ['Accessories'], keys: [] },
  { src: `${B}/circuit-breaker.jpg`, label: 'Circuit Breaker (MCB/RCCB)', cats: ['Protection'], keys: [] },
  { src: `${B}/db-box.jpg`, label: 'Distribution Board', cats: ['Distribution Board'], keys: [] },
  { src: `${B}/earthing-rod.jpg`, label: 'Earthing Accessories', cats: ['Earthing'], keys: [] },
  { src: `${B}/switch.jpg`, label: 'Switch', cats: ['Switch'], keys: [] },
  { src: `${B}/socket.jpg`, label: 'Socket', cats: ['Socket'], keys: [] },
  { src: `${B}/led-light.jpg`, label: 'Light / Lamp', cats: ['Light'], keys: [] },
  { src: `${B}/ball-valve.jpg`, label: 'Valve', cats: ['Valve'], keys: [] },
  { src: `${B}/cable.jpg`, label: 'Cable / Wire', cats: ['Cable'], keys: [] },
  { src: `${B}/plumbing-consumables.jpg`, label: 'Plumbing Consumables', cats: ['Consumable'], keys: [] },
]

/** Best static sample image for a material (first matching rule wins). */
export function sampleImageFor(m: MaterialLike): { src: string; label: string } {
  const hay = `${m.name} ${m.specification ?? ''} ${m.size ?? ''}`.toLowerCase()
  for (const r of SAMPLE_IMAGES) {
    if (r.cats && !r.cats.includes(m.category)) continue
    if (r.keys.length && !r.keys.some((k) => hay.includes(k))) continue
    return { src: r.src, label: r.label }
  }
  return { src: `${B}/wiring-accessories.jpg`, label: 'Sample' }
}

export interface MaterialImageView {
  url: string
  isSample: boolean
  isPrimary: boolean
  caption?: string | null
}

export interface DisplayImage {
  src: string | null
  /** true when the shown picture is a generic type sample, not a real product photo */
  isSample: boolean
  hasUploaded: boolean
  uploadedCount: number
  sampleCount: number
}

/**
 * What to display for a material:
 * 1. primary uploaded (real) photo → isSample=false
 * 2. any uploaded photo → isSample=false
 * 3. attached sample image (seeded) → isSample=true
 * 4. static fallback by type rules → isSample=true
 */
export function displayImage(m: MaterialLike & { images?: MaterialImageView[] | null }): DisplayImage {
  const imgs = m.images ?? []
  const uploaded = imgs.filter((i) => !i.isSample)
  if (uploaded.length > 0) {
    const pick = uploaded.find((i) => i.isPrimary) ?? uploaded[0]
    return {
      src: pick.url, isSample: false, hasUploaded: true,
      uploadedCount: uploaded.length, sampleCount: imgs.length - uploaded.length,
    }
  }
  const samples = imgs.filter((i) => i.isSample)
  if (samples.length > 0) {
    const pick = samples.find((i) => i.isPrimary) ?? samples[0]
    return { src: pick.url, isSample: true, hasUploaded: false, uploadedCount: 0, sampleCount: samples.length }
  }
  const s = sampleImageFor(m)
  return { src: s.src, isSample: true, hasUploaded: false, uploadedCount: 0, sampleCount: 0 }
}
