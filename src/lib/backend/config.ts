// Runtime configuration. The Apps Script web-app URL is NOT a secret (it is only a
// public entry point; every call still needs a signed session token), so it may live
// in public/config.js or in a build-time variable. Credentials never belong here.
declare global {
  interface Window { EFBMS_CONFIG?: { gasUrl?: string } }
}

export function getGasUrl(): string {
  const runtime = typeof window !== 'undefined' ? window.EFBMS_CONFIG?.gasUrl : ''
  const build = (import.meta.env.VITE_GAS_URL as string | undefined) ?? ''
  const url = (runtime || build || '').trim()
  return /^https:\/\/script\.google(usercontent)?\.com\//.test(url) ? url : ''
}

/** Base path the app is served from (works on /<repo>/ and on custom domains). */
export const BASE_URL: string = import.meta.env.BASE_URL || './'

/** Bundled static assets (material sample photos). Stored paths look like /images/materials/x.jpg. */
export function assetUrl(p: string): string {
  if (!p) return p
  if (/^(https?:|data:|blob:|drive:)/.test(p)) return p
  return BASE_URL.replace(/\/?$/, '/') + p.replace(/^\.?\//, '')
}
