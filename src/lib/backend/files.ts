// Google Drive access from the browser. Files are never public: every download goes
// through the gateway, which checks the signed-in user's project membership first.
import { gasCall } from './gas'
import type { Row } from './repo'

export interface DriveFileData { id: string; name: string; mime: string; sizeBytes: number; data: string }

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
export const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'dxf', 'dwg', 'xlsx', 'xls', 'docx', 'csv', 'json', 'txt']

export function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('Could not read the file'))
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.readAsDataURL(b)
  })
}
export function dataUrlParts(url: string): { mime: string; b64: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url)
  return m ? { mime: m[1], b64: m[2] } : null
}
export function extForMime(mime: string): string {
  return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
}

const dataUrlCache = new Map<string, Promise<string>>()
const MAX_CACHED = 80

/** Download a Drive file (as a data: URL, ready for <img src>). Results are memoised for the session. */
export function fetchFileDataUrl(fileId: string): Promise<string> {
  const hit = dataUrlCache.get(fileId)
  if (hit) { dataUrlCache.delete(fileId); dataUrlCache.set(fileId, hit); return hit }
  const p = gasCall<DriveFileData>('file.get', { id: fileId }).then((f) => `data:${f.mime};base64,${f.data}`)
  p.catch(() => dataUrlCache.delete(fileId))
  dataUrlCache.set(fileId, p)
  if (dataUrlCache.size > MAX_CACHED) dataUrlCache.delete(dataUrlCache.keys().next().value as string)
  return p
}
export function forgetFile(fileId: string) { dataUrlCache.delete(fileId) }
export function clearFileCache() { dataUrlCache.clear() }

export async function fetchFileBlob(fileId: string): Promise<{ blob: Blob; name: string }> {
  const f = await gasCall<DriveFileData>('file.get', { id: fileId })
  const bin = atob(f.data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { blob: new Blob([bytes], { type: f.mime }), name: f.name }
}

export function validateUpload(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!ALLOWED_EXT.includes(ext)) return `.${ext || '?'} files are not allowed (allowed: ${ALLOWED_EXT.join(', ')})`
  if (file.size === 0) return 'The file is empty'
  if (file.size > MAX_UPLOAD_BYTES) return `The file is larger than ${MAX_UPLOAD_BYTES / 1048576} MB`
  return null
}

export interface UploadArgs {
  category: 'Drawings' | 'Images' | 'Documents' | 'Reports' | 'Material_Images'
  file: File | Blob
  name?: string
  projectId?: string
  floorId?: string
  roomId?: string
  entityType?: string
  entityId?: string
}
export async function uploadFile(a: UploadArgs): Promise<Row> {
  const name = a.name ?? (a.file as File).name
  const data = await blobToBase64(a.file)
  const res = await gasCall<{ file: Row }>('file.upload', {
    category: a.category, projectId: a.projectId, floorId: a.floorId, roomId: a.roomId, entityType: a.entityType, entityId: a.entityId, name, data,
  }, { write: true, label: `Upload ${name}` })
  return res.file
}

/** Down-scale big photos before upload (keeps Drive small and uploads fast). */
export async function shrinkImage(file: File, maxDim = 1600, quality = 0.85): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400 * 1024) return file
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height))
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  const type = file.type === 'image/png' && file.size < 2 * 1024 * 1024 ? 'image/png' : 'image/jpeg'
  return await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? file), type, quality))
}
