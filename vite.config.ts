import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// `base: './'` makes every asset URL relative, so the build works unchanged on
// https://<user>.github.io/<repo>/ , on a custom domain, or when opened from any
// sub-path. Navigation uses the URL hash (#/...), so a refresh or a deep link
// never reaches GitHub's server as an unknown path and cannot 404.
// GitHub Pages cannot send HTTP headers, so the Content-Security-Policy is injected as a <meta> tag
// into the production build only (the dev server needs inline scripts for hot reload).
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://script.google.com https://script.googleusercontent.com",
  "object-src 'none'", "base-uri 'self'", "form-action 'self'",
].join('; ')
const cspPlugin = {
  name: 'efbms-csp',
  apply: 'build' as const,
  transformIndexHtml: (html: string) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />\n    <meta name="referrer" content="no-referrer" />`),
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), cspPlugin],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
})
