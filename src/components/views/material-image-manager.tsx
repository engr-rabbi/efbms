
// Material Image Manager — upload / replace / delete / set-primary product
// photos for one material (Task 12-a). Seeded sample images (generic TYPE
// illustrations) are always badged "Sample" so they are never presented as
// real brand/product photos.
import { SmartImg } from '@/components/common/smart-img'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Info, Loader2, RefreshCcw, Star, Trash2, Upload,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { fmtBDT } from '@/lib/export-utils'
import { useApi, useAppStore } from '@/lib/store'

// ------------------------------ types ----------------------------------------

export interface MaterialImageManagerMaterial {
  id: string
  name: string
  code: string
  category: string
  brand?: string
  model?: string
  specification?: string
  size?: string
  unit?: string
  purchasePrice?: number
  sellingPrice?: number
  stockQty?: number
}

interface ManagerImage {
  id: string
  url: string
  isSample: boolean
  isPrimary: boolean
  caption?: string | null
}

interface MaterialImageManagerProps {
  material: MaterialImageManagerMaterial | null
  open: boolean
  onOpenChange(o: boolean): void
  onChanged?(): void
  readOnly?: boolean
}

const SAMPLE_WARNING = 'Generic type sample — not an actual brand product photo'
const ACCEPT = 'image/jpeg,image/png,image/webp'

// ------------------------------ helpers --------------------------------------

/** Client-side resize: longest edge → maxDim, returns JPEG data URL. */
export async function resizeImageFile(file: File, maxDim = 1000, quality = 0.82): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unsupported')
  ctx.drawImage(bitmap, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', quality)
}

// ------------------------------ component ------------------------------------

export function MaterialImageManager({
  material, open, onOpenChange, onChanged, readOnly = false,
}: MaterialImageManagerProps) {
  const apiList = useApi<{ images: ManagerImage[] }>()
  const apiImg = useApi<{ image: ManagerImage }>()
  const apiDel = useApi<{ success: boolean }>()
  const userName = useAppStore((s) => s.user?.name ?? 'admin')

  const [images, setImages] = useState<ManagerImage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null)
  const [captionDraft, setCaptionDraft] = useState('')
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null)

  const addInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)

  const selected = images.find((i) => i.id === selectedId) ?? null

  // Reload the image list for the current material (after mutations).
  const refresh = useCallback(async (preferId?: string) => {
    if (!material) return
    const res = await apiList(`/api/materials/${material.id}/images`)
    setImages(res.images)
    setSelectedId((cur) => {
      if (preferId && res.images.some((i) => i.id === preferId)) return preferId
      if (cur && res.images.some((i) => i.id === cur)) return cur
      return res.images.find((i) => i.isPrimary)?.id ?? res.images[0]?.id ?? null
    })
  }, [apiList, material])

  // Initial load when the dialog opens.
  useEffect(() => {
    if (!open || !material) return
    let cancelled = false
    setLoading(true)
    setConfirmDelId(null)
    setCaptionDraft('')
    setUploading(null)
    apiList(`/api/materials/${material.id}/images`)
      .then((res) => {
        if (cancelled) return
        setImages(res.images)
        setSelectedId(res.images.find((i) => i.isPrimary)?.id ?? res.images[0]?.id ?? null)
      })
      .catch((e) => { if (!cancelled) toast.error((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, material, apiList])

  const selectImage = (img: ManagerImage) => {
    setSelectedId(img.id)
    setCaptionDraft(img.caption ?? '')
    setConfirmDelId(null)
  }

  // ------------------------------ mutations ----------------------------------

  const handleUpload = async (files: FileList | null) => {
    if (!material || !files || files.length === 0) return
    const list = Array.from(files).slice(0, 10)
    setUploading({ done: 0, total: list.length })
    let okCount = 0
    let lastId: string | null = null
    for (let i = 0; i < list.length; i++) {
      try {
        const dataUrl = await resizeImageFile(list[i])
        const res = await apiImg(`/api/materials/${material.id}/images`, {
          method: 'POST',
          body: JSON.stringify({ url: dataUrl, userName }),
        })
        okCount++
        lastId = res.image.id
      } catch (e) {
        toast.error(`${list[i].name}: ${(e as Error).message}`)
      }
      setUploading({ done: i + 1, total: list.length })
    }
    setUploading(null)
    if (addInputRef.current) addInputRef.current.value = ''
    if (okCount > 0) {
      toast.success(`${okCount} photo${okCount > 1 ? 's' : ''} uploaded`)
      try {
        await refresh(lastId ?? undefined)
      } catch (e) {
        toast.error((e as Error).message)
      }
      onChanged?.()
    }
  }

  const handleReplace = async (files: FileList | null) => {
    const imgId = replaceTargetId
    setReplaceTargetId(null)
    if (!material || !imgId || !files || files.length === 0) return
    setBusyId(imgId)
    try {
      const dataUrl = await resizeImageFile(files[0])
      await apiImg(`/api/materials/${material.id}/images/${imgId}`, {
        method: 'PATCH',
        body: JSON.stringify({ url: dataUrl, userName }),
      })
      toast.success('Photo replaced')
      if (replaceInputRef.current) replaceInputRef.current.value = ''
      await refresh(imgId)
      onChanged?.()
    } catch (e) {
      toast.error((e as Error).message)
      if (replaceInputRef.current) replaceInputRef.current.value = ''
    } finally {
      setBusyId(null)
    }
  }

  const setPrimary = async (img: ManagerImage) => {
    if (!material || img.isPrimary || busyId) return
    setBusyId(img.id)
    try {
      await apiImg(`/api/materials/${material.id}/images/${img.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isPrimary: true, userName }),
      })
      toast.success('Primary photo updated')
      await refresh(img.id)
      onChanged?.()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const saveCaption = async () => {
    if (!material || !selected || readOnly || busyId) return
    const v = captionDraft.trim()
    if ((selected.caption ?? '') === v) return
    setBusyId(selected.id)
    try {
      await apiImg(`/api/materials/${material.id}/images/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ caption: v, userName }),
      })
      toast.success('Caption saved')
      await refresh(selected.id)
      onChanged?.()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const doDelete = async (imgId: string) => {
    if (!material || busyId) return
    setBusyId(imgId)
    try {
      await apiDel(`/api/materials/${material.id}/images/${imgId}?userName=${encodeURIComponent(userName)}`, {
        method: 'DELETE',
      })
      toast.success('Photo deleted')
      setConfirmDelId(null)
      await refresh()
      onChanged?.()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  // ------------------------------ render -------------------------------------

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full">
        <DialogHeader>
          <DialogTitle>Product photos — {material?.name ?? ''}</DialogTitle>
          <DialogDescription>
            Upload real photos of this exact product. The primary photo is shown in the Material Library and Inventory.
          </DialogDescription>
        </DialogHeader>

        {material && (
          <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
            {/* Left — large preview + per-image actions */}
            <div className="space-y-3">
              <div className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                {loading ? (
                  <div className="flex h-full items-center justify-center text-slate-400">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : selected ? (
                  <>
                    <SmartImg src={selected.url} alt={material.name} className="h-full w-full object-contain" />
                    <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
                      {selected.isPrimary && (
                        <Badge className="border-emerald-200 bg-emerald-100/95 text-emerald-800">
                          <Star className="h-3 w-3" />Primary
                        </Badge>
                      )}
                      {selected.isSample ? (
                        <Badge className="border-amber-300 bg-amber-100/95 text-amber-800" title={SAMPLE_WARNING}>
                          <Info className="h-3 w-3" />Sample
                        </Badge>
                      ) : (
                        <Badge className="border-slate-300 bg-slate-200/95 text-slate-700">Uploaded</Badge>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-1 text-slate-400">
                    <Upload className="h-6 w-6" />
                    <p className="text-xs">No photos yet</p>
                  </div>
                )}
              </div>

              {selected?.caption ? <p className="text-xs text-slate-500">{selected.caption}</p> : null}

              {/* Material meta — only provided fields */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-[11px] text-slate-600">
                <span><span className="text-slate-400">Code: </span><span className="font-mono">{material.code}</span></span>
                {material.brand ? <span><span className="text-slate-400">Brand: </span>{material.brand}</span> : null}
                {material.model ? <span><span className="text-slate-400">Model: </span>{material.model}</span> : null}
                {material.specification ? <span><span className="text-slate-400">Spec: </span>{material.specification}</span> : null}
                {material.size ? <span><span className="text-slate-400">Size: </span>{material.size}</span> : null}
                {material.unit ? <span><span className="text-slate-400">Unit: </span>{material.unit}</span> : null}
                {typeof material.stockQty === 'number' ? (
                  <span><span className="text-slate-400">Stock: </span>{material.stockQty} {material.unit ?? ''}</span>
                ) : null}
                {typeof material.purchasePrice === 'number' ? (
                  <span><span className="text-slate-400">Purchase: </span>৳{fmtBDT(material.purchasePrice)}</span>
                ) : null}
                {typeof material.sellingPrice === 'number' ? (
                  <span><span className="text-slate-400">Selling: </span>৳{fmtBDT(material.sellingPrice)}</span>
                ) : null}
              </div>

              {/* Per-image actions + caption */}
              {!readOnly && selected && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline" size="sm" className="h-8 border-slate-200 text-xs"
                      disabled={selected.isPrimary || busyId === selected.id}
                      title={selected.isPrimary ? 'Already the primary photo' : 'Show this photo everywhere'}
                      onClick={() => void setPrimary(selected)}
                    >
                      <Star className="h-3.5 w-3.5" />Set primary
                    </Button>
                    <Button
                      variant="outline" size="sm" className="h-8 border-slate-200 text-xs"
                      disabled={busyId === selected.id || uploading !== null}
                      title="Replace this photo with a new file"
                      onClick={() => { setReplaceTargetId(selected.id); replaceInputRef.current?.click() }}
                    >
                      {busyId === selected.id && replaceTargetId === null ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCcw className="h-3.5 w-3.5" />
                      )}
                      Replace
                    </Button>
                    {confirmDelId === selected.id ? (
                      <span className="flex items-center gap-1.5 text-xs font-medium text-rose-600">
                        Sure?
                        <Button
                          size="sm" className="h-7 bg-rose-600 px-2 text-xs text-white hover:bg-rose-700"
                          disabled={busyId === selected.id}
                          onClick={() => void doDelete(selected.id)}
                        >
                          {busyId === selected.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Yes, delete'}
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setConfirmDelId(null)}>
                          No
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="outline" size="sm"
                        className="h-8 border-rose-200 text-xs text-rose-600 hover:bg-rose-50"
                        disabled={busyId === selected.id || uploading !== null}
                        onClick={() => setConfirmDelId(selected.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />Delete
                      </Button>
                    )}
                  </div>
                  <Input
                    value={captionDraft}
                    onChange={(e) => setCaptionDraft(e.target.value)}
                    onBlur={() => void saveCaption()}
                    placeholder="Caption — e.g. actual product photo (saved on blur)"
                    className="h-8 text-xs"
                    aria-label="Photo caption"
                  />
                </div>
              )}

              {/* Upload */}
              {!readOnly && (
                <div className="flex items-center gap-2">
                  <input
                    ref={addInputRef} type="file" accept={ACCEPT} multiple className="hidden"
                    onChange={(e) => void handleUpload(e.target.files)}
                  />
                  <input
                    ref={replaceInputRef} type="file" accept={ACCEPT} className="hidden"
                    onChange={(e) => void handleReplace(e.target.files)}
                  />
                  <Button
                    size="sm" className="h-8 text-xs" disabled={uploading !== null}
                    onClick={() => addInputRef.current?.click()}
                  >
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    {uploading ? `Uploading ${uploading.done}/${uploading.total}…` : 'Upload photos'}
                  </Button>
                  <span className="text-[11px] text-slate-400">JPEG / PNG / WebP · auto-resized to max 1000px</span>
                </div>
              )}
            </div>

            {/* Right — thumbnail strip */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500">All photos ({images.length})</p>
              <div className="grid grid-cols-5 gap-2 lg:grid-cols-4">
                {images.map((img) => (
                  <button
                    key={img.id} type="button"
                    className={`relative aspect-square overflow-hidden rounded-md border bg-slate-100 transition ${
                      selectedId === img.id
                        ? 'border-slate-800 ring-2 ring-slate-800'
                        : 'border-slate-200 hover:border-slate-400'
                    }`}
                    title={img.isSample ? SAMPLE_WARNING : (img.caption || 'Photo')}
                    onClick={() => selectImage(img)}
                  >
                    <SmartImg src={img.url} alt={img.caption || 'Material photo'} loading="lazy" className="h-full w-full object-cover" />
                    {img.isPrimary && (
                      <Star className="absolute left-0.5 top-0.5 h-3.5 w-3.5 fill-emerald-500 text-white drop-shadow" />
                    )}
                    {img.isSample && (
                      <span className="absolute bottom-0 right-0 rounded-tl bg-amber-400 px-[3px] text-[8px] font-bold leading-[12px] text-amber-900">S</span>
                    )}
                  </button>
                ))}
                {images.length === 0 && !loading && (
                  <p className="col-span-full text-xs text-slate-400">
                    No photos yet — upload real product photos; a generic sample is shown until then.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <p className="flex items-start gap-1.5 text-[11px] text-slate-400">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          Sample images are generic type illustrations, not actual brand product photos.
        </p>
      </DialogContent>
    </Dialog>
  )
}
