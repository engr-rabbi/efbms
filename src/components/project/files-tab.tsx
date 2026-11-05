import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileText, FileImage, FileSpreadsheet, File as FileIcon, Upload, Download, Trash2, Loader2, FolderOpen, ShieldCheck } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { ensure, where, byCreatedDesc, invalidate, type Row } from '@/lib/backend/repo'
import { gasCall } from '@/lib/backend'
import { uploadFile, validateUpload, fetchFileBlob, ALLOWED_EXT, MAX_UPLOAD_BYTES, shrinkImage } from '@/lib/backend/files'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

const CATS = ['Drawings', 'Images', 'Documents', 'Reports'] as const
type Cat = (typeof CATS)[number]
const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

function iconFor(mime: string) {
  if (mime.startsWith('image/')) return FileImage
  if (mime.includes('sheet') || mime.includes('csv') || mime.includes('excel')) return FileSpreadsheet
  if (mime.includes('pdf') || mime.includes('word') || mime.startsWith('text')) return FileText
  return FileIcon
}

/** Files of one project kept in Google Drive (private; opened only through the authenticated gateway). */
export function ProjectFilesTab({ projectId }: { projectId: string }) {
  const role = useAppStore((s) => s.user?.role ?? '')
  const canUpload = role === 'SUPER_ADMIN' || role === 'ENGINEER'
  const [cat, setCat] = useState<Cat>('Documents')
  const [list, setList] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | Cat>('all')
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(async (force = false) => {
    try {
      await ensure(['files'], { force })
      setList(where('files', (f) => f.projectId === projectId && f.status === 'ACTIVE').sort(byCreatedDesc))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not load files') }
    finally { setLoading(false) }
  }, [projectId])
  useEffect(() => { void load() }, [load])

  const onPick = async (files: FileList | null) => {
    if (!files?.length) return
    for (const f of Array.from(files)) {
      const problem = validateUpload(f)
      if (problem) { toast.error(`${f.name}: ${problem}`); continue }
      setBusy(f.name)
      try {
        const body = cat === 'Images' ? await shrinkImage(f) : f
        await uploadFile({ category: cat, projectId, file: body, name: f.name })
        toast.success(`${f.name} saved to Drive › ${cat}`)
      } catch (e) {
        toast.error(`${f.name}: ${e instanceof Error ? e.message : 'upload failed'}`)
      }
    }
    setBusy(null); invalidate(['files']); await load(true)
    if (input.current) input.current.value = ''
  }

  const download = async (f: Row) => {
    setBusy(f.name)
    try {
      const { blob, name } = await fetchFileBlob(f.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Download failed') }
    finally { setBusy(null) }
  }

  const remove = async (f: Row) => {
    if (!confirm(`Delete "${f.name}"? It is moved to the Drive trash.`)) return
    try {
      await gasCall('file.delete', { id: f.id }, { write: true, label: `Delete ${f.name}` })
      toast.success('File deleted'); invalidate(['files']); await load(true)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Delete failed') }
  }

  const shown = list.filter((f) => filter === 'all' || f.category === filter)
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><FolderOpen className="w-4 h-4 text-amber-600" /> Project files (Google Drive)</CardTitle>
          <CardDescription className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />Stored privately in Drive › Projects. Only members of this project can open them.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {canUpload ? (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={cat} onValueChange={(v) => setCat(v as Cat)}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>{CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
              <input ref={input} type="file" multiple hidden accept={ALLOWED_EXT.map((e) => '.' + e).join(',')} onChange={(e) => void onPick(e.target.files)} />
              <Button onClick={() => input.current?.click()} disabled={!!busy} className="bg-amber-500 hover:bg-amber-600 text-white">
                {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />}{busy ? `Working: ${busy}` : 'Upload file'}
              </Button>
              <span className="text-[11px] text-slate-500">PDF, DXF, DWG, JPG/PNG/WebP, Excel, CSV, DOCX — max {MAX_UPLOAD_BYTES / 1048576} MB each</span>
            </div>
          ) : <p className="text-xs text-slate-500">Your role can view and download files but not upload them.</p>}
          <div className="flex gap-1.5 flex-wrap">
            {(['all', ...CATS] as const).map((c) => (
              <Button key={c} size="sm" variant={filter === c ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setFilter(c)}>
                {c === 'all' ? 'All' : c} {c !== 'all' && <Badge variant="secondary" className="ml-1 text-[9px]">{list.filter((f) => f.category === c).length}</Badge>}
              </Button>
            ))}
          </div>
          {loading ? <div className="py-8 text-center text-sm text-slate-500"><Loader2 className="w-4 h-4 inline animate-spin mr-1" />Loading…</div>
            : shown.length === 0 ? <div className="py-8 text-center text-sm text-slate-500">No files yet.</div>
            : (
              <div className="divide-y rounded-lg border">
                {shown.map((f) => {
                  const Ico = iconFor(f.mime)
                  return (
                    <div key={f.id} className="flex items-center gap-3 px-3 py-2">
                      <Ico className="w-5 h-5 text-slate-500 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{f.name}</div>
                        <div className="text-[11px] text-slate-500">{f.category} · {fmtSize(f.sizeBytes)} · {String(f.createdAt).slice(0, 10)} · {f.uploadedBy}</div>
                      </div>
                      <Button size="icon" variant="ghost" onClick={() => void download(f)} disabled={busy === f.name} aria-label="Download"><Download className="w-4 h-4" /></Button>
                      {canUpload && !String(f.entityType).startsWith('drawing') && <Button size="icon" variant="ghost" className="text-rose-600" onClick={() => void remove(f)} aria-label="Delete"><Trash2 className="w-4 h-4" /></Button>}
                    </div>
                  )
                })}
              </div>
            )}
        </CardContent>
      </Card>
    </div>
  )
}
