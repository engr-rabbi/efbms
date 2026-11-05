import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Users2 } from 'lucide-react'
import { useAppStore, useApi } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface Person { id: string; name: string; role: string }

/** Who may open this project. Enforced by the server: non-members cannot read or change anything in it. */
export function TeamAccessCard({ project, onSaved }: { project: { id: string; ownerId?: string; members?: string }; onSaved: () => void }) {
  const me = useAppStore((s) => s.user)
  const api = useApi<{ users: Person[] }>()
  const patch = useApi<unknown>()
  const [people, setPeople] = useState<Person[]>([])
  const members = (project.members ?? '').split(',').filter(Boolean)
  const canEdit = me?.role === 'SUPER_ADMIN' || project.ownerId === me?.id

  useEffect(() => { api('/api/users').then((d) => setPeople(d.users)).catch(() => undefined) }, [api])

  const toggle = async (id: string) => {
    const next = members.includes(id) ? members.filter((m) => m !== id) : [...members, id]
    try {
      await patch(`/api/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ members: next.join(',') }) })
      toast.success('Team access updated'); onSaved()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }

  const owner = people.find((p) => p.id === project.ownerId)
  const candidates = people.filter((p) => p.id !== project.ownerId && p.role !== 'SUPER_ADMIN')
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-1.5"><Users2 className="w-4 h-4 text-amber-600" />Team access</CardTitle>
        <CardDescription className="text-[11px]">Owner{owner ? `: ${owner.name}` : ''}. Super admins always have access.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-1.5">
        {candidates.length === 0 && <span className="text-xs text-slate-500">No other users.</span>}
        {candidates.map((p) => {
          const on = members.includes(p.id)
          return (
            <button key={p.id} disabled={!canEdit} onClick={() => void toggle(p.id)} aria-pressed={on}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? 'bg-amber-100 border-amber-300 text-amber-900' : 'bg-white text-slate-600 hover:bg-slate-50'} disabled:opacity-60`}>
              {p.name} <Badge variant="outline" className="ml-1 text-[9px]">{p.role}</Badge>
            </button>
          )
        })}
      </CardContent>
    </Card>
  )
}
