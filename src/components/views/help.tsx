import { useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import { BookOpen, Printer, Search, ChevronRight } from 'lucide-react'
import manual from '../../../docs/USER_MANUAL.md?raw'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// The manual is a static, trusted file bundled with the app (docs/USER_MANUAL.md); it is not user input.
const slug = (s: string, i: number) => `m-${i}-${s.replace(/<[^>]+>/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40)}`

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

function render(md: string): { html: string; toc: Array<{ id: string; text: string; level: number }> } {
  const toc: Array<{ id: string; text: string; level: number }> = []
  const renderer = new marked.Renderer()
  let n = 0
  renderer.heading = (text, level) => {
    const id = slug(text, n++)
    if (level <= 2) toc.push({ id, text: decode(text.replace(/<[^>]+>/g, '')), level })
    return `<h${level} id="${id}">${text}</h${level}>`
  }
  const html = marked.parse(md, { renderer, gfm: true, breaks: false, async: false }) as string
  return { html, toc }
}

export default function HelpView() {
  const { html, toc } = useMemo(() => render(manual), [])
  const box = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<{ count: number; i: number } | null>(null)

  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  // links inside the manual are in-page anchors; keep them from touching the app's #/route hash
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (a && a.getAttribute('href')?.startsWith('#')) { e.preventDefault(); go(a.getAttribute('href')!.slice(1)) }
  }

  const search = () => {
    const root = box.current
    if (!root) return
    root.querySelectorAll('mark.m-hit').forEach((m) => { m.replaceWith(document.createTextNode(m.textContent ?? '')); })
    root.normalize()
    const term = q.trim()
    if (term.length < 2) { setHits(null); return }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    while (walker.nextNode()) { const t = walker.currentNode as Text; if (t.nodeValue && t.nodeValue.toLowerCase().includes(term.toLowerCase()) && !t.parentElement?.closest('script,style')) nodes.push(t) }
    let count = 0
    for (const t of nodes) {
      const text = t.nodeValue!, lower = text.toLowerCase(), tl = term.toLowerCase()
      const frag = document.createDocumentFragment()
      let pos = 0, idx: number
      while ((idx = lower.indexOf(tl, pos)) >= 0) {
        frag.append(text.slice(pos, idx))
        const m = document.createElement('mark'); m.className = 'm-hit'; m.textContent = text.slice(idx, idx + term.length); frag.append(m); count++
        pos = idx + term.length
      }
      frag.append(text.slice(pos)); t.replaceWith(frag)
    }
    setHits({ count, i: 0 })
    root.querySelector('mark.m-hit')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const next = () => {
    const marks = box.current?.querySelectorAll('mark.m-hit'); if (!marks?.length || !hits) return
    const i = (hits.i + 1) % marks.length
    marks[i].scrollIntoView({ behavior: 'smooth', block: 'center' }); setHits({ ...hits, i })
  }

  return (
    <div className="space-y-4 manual-root">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <BookOpen className="h-5 w-5 text-amber-600" />
        <h1 className="text-lg font-semibold">User Manual &amp; Calculation Guideline</h1>
        <div className="ml-auto flex items-center gap-2">
          <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); hits && q.trim() === (box.current?.querySelector('mark.m-hit')?.textContent ?? '') ? next() : search() }}>
            <div className="relative"><Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the manual…" className="w-56 pl-8" aria-label="Search the manual" /></div>
            <Button type="submit" variant="outline" size="sm">{hits ? (hits.count ? `Next (${hits.i + 1}/${hits.count})` : 'No match') : 'Find'}</Button>
          </form>
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="mr-1.5 h-4 w-4" />Print / Save PDF</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="print:hidden lg:sticky lg:top-20 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto rounded-xl border bg-white p-2">
          {toc.map((h) => (
            <button key={h.id} onClick={() => go(h.id)} className="flex w-full items-start gap-1 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-amber-50">
              <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" /><span>{h.text}</span>
            </button>
          ))}
        </aside>
        <article ref={box} onClick={onClick} className="manual min-w-0 rounded-xl border bg-white p-5 sm:p-8" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  )
}
