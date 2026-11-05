import { useEffect, useState, type ImgHTMLAttributes } from 'react'
import { ImageOff, Loader2 } from 'lucide-react'
import { fetchFileDataUrl } from '@/lib/backend/files'

/**
 * <img> that also understands `drive:<fileId>` sources. Drive files are private, so the
 * browser cannot load them by URL; they are fetched through the authenticated gateway.
 */
export function SmartImg({ src, alt = '', ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src?: string }) {
  const isDrive = typeof src === 'string' && src.startsWith('drive:')
  const [state, setState] = useState<{ key: string; url?: string; failed?: boolean }>({ key: '' })

  useEffect(() => {
    if (!isDrive || !src) return
    let alive = true
    fetchFileDataUrl(src.slice(6))
      .then((url) => { if (alive) setState({ key: src, url }) })
      .catch(() => { if (alive) setState({ key: src, failed: true }) })
    return () => { alive = false }
  }, [src, isDrive])

  if (!isDrive) return <img src={src} alt={alt} {...rest} />
  if (state.key === src && state.url) return <img src={state.url} alt={alt} {...rest} />
  return (
    <div className={`${rest.className ?? ''} flex items-center justify-center bg-slate-100 text-slate-400`} role="img" aria-label={alt}>
      {state.key === src && state.failed ? <ImageOff className="w-5 h-5" /> : <Loader2 className="w-5 h-5 animate-spin" />}
    </div>
  )
}
