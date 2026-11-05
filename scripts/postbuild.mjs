// After `vite build`: make GitHub Pages friendly output.
//  - .nojekyll  : stop Jekyll from ignoring files/folders that start with "_"
//  - 404.html   : copy of index.html so even an unknown path loads the app (hash routing then takes over)
import fs from 'node:fs'
import path from 'node:path'
const dist = path.resolve('dist')
if (!fs.existsSync(path.join(dist, 'index.html'))) { console.error('dist/index.html missing — run vite build first'); process.exit(1) }
fs.writeFileSync(path.join(dist, '.nojekyll'), '')
fs.copyFileSync(path.join(dist, 'index.html'), path.join(dist, '404.html'))
console.log('postbuild: .nojekyll + 404.html written')
