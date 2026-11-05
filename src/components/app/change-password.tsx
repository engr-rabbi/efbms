import { useState } from 'react'
import { toast } from 'sonner'
import { gasCall, setToken } from '@/lib/backend'
import { useAppStore, useT } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** `forced` = the account still has an administrator-issued password; the dialog cannot be dismissed. */
export function ChangePasswordDialog({ open, forced, onClose }: { open: boolean; forced?: boolean; onClose: () => void }) {
  const t = useT()
  const setUser = useAppStore((s) => s.setUser)
  const user = useAppStore((s) => s.user)
  const [oldPw, setOld] = useState('')
  const [newPw, setNew] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')
    if (newPw.length < 8) return setError('New password must be at least 8 characters')
    if (newPw !== again) return setError('The two new passwords do not match')
    setBusy(true)
    try {
      const d = await gasCall<{ token: string; user: NonNullable<typeof user> }>('auth.changePassword', { oldPassword: oldPw, newPassword: newPw }, { write: true, queue: false })
      setToken(d.token)
      useAppStore.setState({ user: { ...d.user, mustChange: false } })
      void setUser
      toast.success('Password changed')
      setOld(''); setNew(''); setAgain('')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change password')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !forced) onClose() }}>
      <DialogContent onInteractOutside={(e) => { if (forced) e.preventDefault() }} onEscapeKeyDown={(e) => { if (forced) e.preventDefault() }}>
        <DialogHeader>
          <DialogTitle>{t('changePassword')}</DialogTitle>
          <DialogDescription>{forced ? 'Your password was set by an administrator. Choose your own password to continue.' : 'Use at least 8 characters.'}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit() }}>
          <div className="space-y-1.5"><Label>Current password</Label><Input type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOld(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>New password</Label><Input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNew(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Repeat new password</Label><Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></div>
          {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
          <DialogFooter>
            {!forced && <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>}
            <Button type="submit" disabled={busy || !oldPw || !newPw} className="bg-amber-500 hover:bg-amber-600 text-white">{busy ? t('loading') : t('save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
