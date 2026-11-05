
import { useCallback, useEffect, useState } from 'react'
import { useT, useApi, useAppStore } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AdminDataPanel } from '@/components/admin/admin-panel'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Building2, SlidersHorizontal, Users, Save, Ruler, DatabaseBackup, KeyRound } from 'lucide-react'
import { useFmt, useUnitPrefs, useUnitStore } from '@/lib/unit-store'
import { UnitSelect } from '@/components/units/unit-controls'
import { LENGTH_UNITS, AREA_UNITS, mToLen, sqmToArea, type LengthUnit, type AreaUnit, type RoundingMode } from '@/lib/units'

interface Company {
  id: string; name: string; logoText: string; address: string; phone: string; email: string
  licenseNo: string; vatRegNo: string; quotationTerms: string; paymentTerms: string; deliveryTerms: string
}
interface Rule { id: string; key: string; value: string; label: string; system: string }
function genPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const r = crypto.getRandomValues(new Uint32Array(12))
  return Array.from(r, (n) => chars[n % chars.length]).join('') + '#7'
}

interface UserRow { id: string; email: string; name: string; role: string; active: boolean }

/** The dashboard backup banner asks for the "data" tab via sessionStorage (one-shot). */
function initialTab(): string {
  try {
    const t = sessionStorage.getItem('efbms-settings-tab')
    if (t) { sessionStorage.removeItem('efbms-settings-tab'); return t }
  } catch { /* ignore */ }
  return 'company'
}

export default function SettingsView() {
  const t = useT()
  const isAdmin = useAppStore((s) => s.user?.role === 'SUPER_ADMIN')
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t('settings')}</h1>
      <Tabs defaultValue={initialTab()}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="units" className="text-xs sm:text-sm"><Ruler className="w-3.5 h-3.5 mr-1" />{t('unitsMeasurement')}</TabsTrigger>
          <TabsTrigger value="company" className="text-xs sm:text-sm"><Building2 className="w-3.5 h-3.5 mr-1" />{t('companyInfo')}</TabsTrigger>
          <TabsTrigger value="rules" className="text-xs sm:text-sm"><SlidersHorizontal className="w-3.5 h-3.5 mr-1" />{t('designRules')}</TabsTrigger>
          <TabsTrigger value="users" className="text-xs sm:text-sm"><Users className="w-3.5 h-3.5 mr-1" />{t('users')}</TabsTrigger>
          {isAdmin && <TabsTrigger value="data" className="text-xs sm:text-sm"><DatabaseBackup className="w-3.5 h-3.5 mr-1" />Backup &amp; Data</TabsTrigger>}
        </TabsList>
        <TabsContent value="units"><UnitsTab /></TabsContent>
        <TabsContent value="company"><CompanyTab /></TabsContent>
        <TabsContent value="rules"><RulesTab /></TabsContent>
        <TabsContent value="users"><UsersTab /></TabsContent>
        {isAdmin && <TabsContent value="data"><AdminDataPanel /></TabsContent>}
      </Tabs>
    </div>
  )
}

const UNIT_PRECISIONS = [0, 1, 2, 3, 4]

function UnitsTab() {
  const t = useT()
  const prefs = useUnitPrefs()
  const setPrefs = useUnitStore((s) => s.setPrefs)
  const fmt = useFmt()
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-1.5"><Ruler className="w-4 h-4 text-amber-600" />{t('globalUnitSettings')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">{t('lengthUnit')}</Label>
              <UnitSelect kind="length" value={prefs.lengthUnit} onChange={(v) => setPrefs({ lengthUnit: v as LengthUnit })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">{t('areaUnit')}</Label>
              <UnitSelect kind="area" value={prefs.areaUnit} onChange={(v) => setPrefs({ areaUnit: v as AreaUnit })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">{t('lengthUnit')} — {t('decimalPrecision')}</Label>
              <Select
                value={prefs.lengthPrecision == null ? 'default' : String(prefs.lengthPrecision)}
                onValueChange={(v) => setPrefs({ lengthPrecision: v === 'default' ? null : Number(v) })}
              >
                <SelectTrigger className="h-9 w-full text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{t('unitDefault')}</SelectItem>
                  {UNIT_PRECISIONS.map((n) => <SelectItem key={n} value={String(n)}>{String(n)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">{t('areaUnit')} — {t('decimalPrecision')}</Label>
              <Select
                value={prefs.areaPrecision == null ? 'default' : String(prefs.areaPrecision)}
                onValueChange={(v) => setPrefs({ areaPrecision: v === 'default' ? null : Number(v) })}
              >
                <SelectTrigger className="h-9 w-full text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{t('unitDefault')}</SelectItem>
                  {UNIT_PRECISIONS.map((n) => <SelectItem key={n} value={String(n)}>{String(n)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">{t('roundingMode')}</Label>
              <Select value={prefs.rounding} onValueChange={(v) => setPrefs({ rounding: v as RoundingMode })}>
                <SelectTrigger className="h-9 w-full text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NEAREST">{t('roundingNearest')}</SelectItem>
                  <SelectItem value="UP">{t('roundingUp')}</SelectItem>
                  <SelectItem value="DOWN">{t('roundingDown')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-[11px] text-slate-400">Changes apply immediately across the whole app and are saved automatically — no save button needed.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('unitPreview')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-slate-500">Live preview of how measurements will be displayed with the current settings — values update instantly when the units change.</p>
          <div className="rounded-lg border border-slate-100 text-xs">
            <div className="grid grid-cols-3 gap-2 px-3 py-1.5 bg-slate-50 rounded-t-lg text-[10px] font-medium uppercase tracking-wide text-slate-400">
              <span>Input</span><span>Displayed now</span><span>Reference</span>
            </div>
            <div className="divide-y divide-slate-100 tabular-nums">
              <div className="grid grid-cols-3 gap-2 px-3 py-2">
                <span className="font-medium">10 {LENGTH_UNITS.m.symbol}</span>
                <span className="text-slate-600">= {mToLen(10, prefs.lengthUnit).toFixed(4)} {fmt.lenSym}</span>
                <span className="text-slate-400">= 1000 cm</span>
              </div>
              <div className="grid grid-cols-3 gap-2 px-3 py-2">
                <span className="font-medium">1 {AREA_UNITS.m2.symbol}</span>
                <span className="text-slate-600">= {sqmToArea(1, prefs.areaUnit).toFixed(4)} {fmt.areaSym}</span>
                <span className="text-slate-400">= 10.7639 ft²</span>
              </div>
              <div className="grid grid-cols-3 gap-2 px-3 py-2">
                <span className="font-medium">Room 4.6 m × 3.4 m</span>
                <span className="col-span-2 text-slate-600">{fmt.len(4.6)} × {fmt.len(3.4)} {fmt.lenSym} · Area: {fmt.areaS(4.6 * 3.4)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Alert>
        <AlertDescription className="text-xs">{t('unitNote')}</AlertDescription>
      </Alert>
      <Alert>
        <AlertDescription className="text-xs">{t('unitCommercialNote')}</AlertDescription>
      </Alert>

      <p className="text-xs text-slate-500">
        Project-specific units: open a project → Overview tab → Project Units to override the global default for that project.
      </p>
    </div>
  )
}

function CompanyTab() {
  const t = useT()
  const api = useApi<{ company: Company }>()
  const [c, setC] = useState<Company | null>(null)
  useEffect(() => {
    let cancelled = false
    api('/api/company').then((d) => { if (!cancelled) setC(d.company) }).catch((e) => { if (!cancelled) toast.error(e.message) })
    return () => { cancelled = true }
  }, [api])
  if (!c) return <Skeleton className="h-72 rounded-xl" />
  const set = (k: keyof Company, v: string) => setC({ ...c, [k]: v })
  const renderField = (k: keyof Company, label: string, area?: boolean) => (
    <div className="space-y-1.5" key={k}>
      <Label>{label}</Label>
      {area
        ? <Textarea rows={3} value={String(c[k] ?? '')} onChange={(e) => set(k, e.target.value)} />
        : <Input value={String(c[k] ?? '')} onChange={(e) => set(k, e.target.value)} />}
    </div>
  )
  const save = async () => {
    try {
      await api('/api/company', { method: 'PUT', body: JSON.stringify(c) })
      toast.success(t('save') + ' ✓')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t('companyInfo')} — {t('quotations')}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          {renderField('name', t('name'))}
          {renderField('logoText', 'Logo Text')}
          {renderField('phone', 'Phone')}
          {renderField('email', 'Email')}
          {renderField('licenseNo', 'Trade License')}
          {renderField('vatRegNo', 'VAT Reg. No')}
          <div className="sm:col-span-2">{renderField('address', 'Address')}</div>
          <div className="sm:col-span-2">{renderField('paymentTerms', t('paymentTerms'), true)}</div>
          <div className="sm:col-span-2">{renderField('deliveryTerms', t('deliveryTerms'), true)}</div>
          <div className="sm:col-span-2">{renderField('quotationTerms', t('termsConditions'), true)}</div>
        </div>
        <Button className="bg-amber-500 hover:bg-amber-600 text-white" onClick={save}><Save className="w-4 h-4 mr-1" />{t('save')}</Button>
      </CardContent>
    </Card>
  )
}

function RulesTab() {
  const t = useT()
  const api = useApi<{ rules: Rule[] }>()
  const [rules, setRules] = useState<Rule[]>([])
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let cancelled = false
    api('/api/design-rules').then((d) => { if (!cancelled) setRules(d.rules) }).catch((e) => { if (!cancelled) toast.error(e.message) })
    return () => { cancelled = true }
  }, [api])
  if (rules.length === 0) return <Skeleton className="h-72 rounded-xl" />

  const groups: Array<{ key: string; label: string; color: string }> = [
    { key: 'electrical', label: t('electricalDesign'), color: 'text-amber-700' },
    { key: 'plumbing', label: t('plumbingDesign'), color: 'text-cyan-700' },
    { key: 'general', label: 'General', color: 'text-slate-600' },
  ]

  const save = async () => {
    setSaving(true)
    try {
      const updates: Record<string, string> = {}
      for (const r of rules) updates[r.key] = r.value
      const d = await api('/api/design-rules', { method: 'PUT', body: JSON.stringify({ rules: updates }) })
      setRules((d as { rules: Rule[] }).rules)
      toast.success(t('designRules') + ' ✓')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <Alert>
        <AlertDescription className="text-xs">
          Design Rules drive all Mode A calculations (circuit grouping, breaker sizing, wastage, water demand).
          Changes apply on next estimation run. Formulas remain transparent and are shown per-item in the Estimation tab.
        </AlertDescription>
      </Alert>
      {groups.map((g) => {
        const list = rules.filter((r) => r.system === g.key)
        if (!list.length) return null
        return (
          <Card key={g.key}>
            <CardHeader className="pb-2"><CardTitle className={`text-sm ${g.color}`}>{g.label}</CardTitle></CardHeader>
            <CardContent className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {list.map((r) => (
                <div key={r.key} className="space-y-1">
                  <Label className="text-[11px] text-slate-500" title={r.key}>{r.label || r.key}</Label>
                  <Input
                    className="h-8 text-xs"
                    value={r.value}
                    onChange={(e) => setRules((rs) => rs.map((x) => (x.key === r.key ? { ...x, value: e.target.value } : x)))}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        )
      })}
      <Button className="bg-amber-500 hover:bg-amber-600 text-white" onClick={save} disabled={saving}>
        <Save className="w-4 h-4 mr-1" />{saving ? t('loading') : t('save')}
      </Button>
    </div>
  )
}

function UsersTab() {
  const t = useT()
  const api = useApi<{ users: UserRow[] }>()
  const { user: me } = useAppStore()
  const [users, setUsers] = useState<UserRow[]>([])
  const [dialog, setDialog] = useState(false)
  const [form, setForm] = useState(() => ({ name: '', email: '', role: 'VIEWER', password: genPassword() }))
  const isAdmin = me?.role === 'SUPER_ADMIN'

  useEffect(() => {
    let cancelled = false
    api('/api/users').then((d) => { if (!cancelled) setUsers(d.users) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [api])

  if (!isAdmin) {
    return (
      <Card><CardContent className="p-8 text-center text-sm text-slate-500">
        {t('users')} — SUPER_ADMIN only.
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {users.map((u) => (
            <Badge key={u.id} variant="outline" className="text-[10px]">{u.name} · {u.role}</Badge>
          ))}
        </div>
      </CardContent></Card>
    )
  }

  const create = async () => {
    try {
      await api('/api/users', { method: 'POST', body: JSON.stringify(form) })
      toast.success(`${t('save')} ✓ — give the user this temporary password: ${form.password}`, { duration: 15000 }); setDialog(false)
      setForm({ name: '', email: '', role: 'VIEWER', password: genPassword() })
      api('/api/users').then((d) => setUsers(d.users)).catch(() => undefined)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }
  const changeRole = async (u: UserRow, role: string) => {
    try {
      await api('/api/users', { method: 'PATCH', body: JSON.stringify({ id: u.id, role }) })
      api('/api/users').then((d) => setUsers(d.users)).catch(() => undefined)
      toast.success('Role updated')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }

  const reload = () => api('/api/users').then((d) => setUsers(d.users)).catch(() => undefined)
  const toggleActive = async (u: UserRow) => {
    try { await api('/api/users', { method: 'PATCH', body: JSON.stringify({ id: u.id, active: !u.active }) }); toast.success(u.active ? 'User disabled' : 'User enabled'); reload() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }
  const resetPw = async (u: UserRow) => {
    const pw = genPassword()
    if (!confirm(`Reset the password of ${u.name}? A new temporary password will be generated and the user is signed out.`)) return
    try { await api('/api/users', { method: 'PATCH', body: JSON.stringify({ id: u.id, password: pw }) }); toast.success(`New temporary password for ${u.name}: ${pw}`, { duration: 20000 }) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">{t('users')} & Roles (RBAC)</CardTitle>
        <Button size="sm" onClick={() => setDialog(true)} className="bg-amber-500 hover:bg-amber-600 text-white">+ {t('add')}</Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-slate-100">
            <div className="min-w-0">
              <div className="text-sm font-medium">{u.name} {u.id === me?.id && <span className="text-[10px] text-slate-400">(you)</span>}</div>
              <div className="text-[11px] text-slate-500">{u.email}</div>
            </div>
            <div className="flex items-center gap-2">
              {!u.active && <Badge variant="outline" className="text-[10px] text-rose-600">disabled</Badge>}
              <Button size="icon" variant="ghost" className="h-8 w-8" title="Reset password" aria-label="Reset password" onClick={() => resetPw(u)}><KeyRound className="w-4 h-4" /></Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={u.id === me?.id} onClick={() => toggleActive(u)}>{u.active ? 'Disable' : 'Enable'}</Button>
            <Select value={u.role} onValueChange={(v) => changeRole(u, v)}>
              <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['SUPER_ADMIN', 'ENGINEER', 'SALES', 'INVENTORY', 'VIEWER'].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
            </div>
          </div>
        ))}
        <p className="text-[10px] text-slate-400 pt-2">
          Role permissions: SUPER_ADMIN (all) · ENGINEER (design, estimation, BOQ) · SALES (quotations) · INVENTORY (stock, suppliers) · VIEWER (read-only).
          Enforced by the server (Apps Script gateway), not only in the UI. Users only see projects they own or are a member of.
        </p>
      </CardContent>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('add')} User</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>{t('name')} *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Email *</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{['SUPER_ADMIN', 'ENGINEER', 'SALES', 'INVENTORY', 'VIEWER'].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="space-y-1.5"><Label>Temporary password (user must change it at first sign-in)</Label><Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>{t('cancel')}</Button>
            <Button className="bg-amber-500 hover:bg-amber-600 text-white" onClick={create} disabled={!form.name || !form.email}>{t('save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
