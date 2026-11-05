import { useState } from 'react'
import { useAppStore, useT, useApi } from '@/lib/store'
import type { AppUser } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Zap, TriangleAlert } from 'lucide-react'
import { getGasUrl } from '@/lib/backend'

export function SetupRequired() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
      <Card className="max-w-xl w-full border-amber-300">
        <CardHeader>
          <div className="flex items-center gap-2 text-amber-700"><TriangleAlert className="w-5 h-5" /><CardTitle>Backend is not connected yet</CardTitle></div>
          <CardDescription>
            This site is only the web page. Its data lives in your Google Sheet, reached through a Google Apps Script web app.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-700">
          <p>Open <code className="px-1 rounded bg-slate-100">public/config.js</code> in the repository and set <code className="px-1 rounded bg-slate-100">gasUrl</code> to your deployed web-app URL (it ends with <code>/exec</code>), then redeploy.</p>
          <p>Step-by-step instructions (বাংলা): <code className="px-1 rounded bg-slate-100">docs/SETUP.md</code>.</p>
        </CardContent>
      </Card>
    </div>
  )
}

export function LoginForm() {
  const t = useT()
  const api = useApi<{ user: AppUser }>()
  const setUser = useAppStore((s) => s.setUser)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!getGasUrl()) return <SetupRequired />

  const submit = async () => {
    if (!email || !password) return
    setBusy(true); setError('')
    try {
      const d = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      setPassword('')
      setUser(d.user)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-100 via-white to-amber-50">
      <main className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-xl border-slate-200">
          <CardHeader className="text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-500 flex items-center justify-center mb-2">
              <Zap className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-2xl">{t('appName')}</CardTitle>
            <CardDescription>{t('appTagline')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit() }}>
              <div className="space-y-2">
                <Label htmlFor="em">{t('email')}</Label>
                <Input id="em" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw">{t('password')}</Label>
                <Input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
              <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600 text-white" disabled={busy || !email || !password}>
                {busy ? t('loading') : t('login')}
              </Button>
            </form>
            <p className="text-xs text-center text-slate-500">{t('signInHint')}</p>
          </CardContent>
        </Card>
      </main>
      <footer className="py-3 text-center text-xs text-slate-500 border-t border-slate-200 bg-white/60">
        ElectroFlow BMS — {t('appTagline')}
      </footer>
    </div>
  )
}
