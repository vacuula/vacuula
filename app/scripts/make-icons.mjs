// Generates the home-screen / PWA icons for every mascot from the SVGs in public/.
// Run with: pnpm icons   (re-run whenever a mascot SVG changes or a mascot is added)
//
// Output (public/icons/):
//   icon-<mascot>-192.png, icon-<mascot>-512.png   any-purpose icons (manifest)
//   icon-<mascot>-maskable-512.png                 maskable icon, mascot inside the safe zone
//   apple-touch-icon-<mascot>.png                  180 px, opaque (iOS ignores manifest icons)
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(root, '..', 'public')
const outDir = path.join(publicDir, 'icons')

// Must match MASCOTS in src/mascot/index.ts and --bg (dark) in src/theme/theme.css
const MASCOTS = ['vacuula', 'robot', 'D7_vacuula']
const BACKGROUND = 'transparent' // '#0f1113'

// mascot size relative to the canvas: "any" icons fill most of it, maskable icons
// keep the mascot inside the 80% safe circle that launchers may crop to
const SCALE_ANY = 0.82
const SCALE_MASKABLE = 0.60

async function render(svg, size, scale, file, background = BACKGROUND) {
    const inner = Math.round(size * scale)
    const mascot = await sharp(svg).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    await sharp({ create: { width: size, height: size, channels: 4, background } })
        .composite([{ input: mascot, gravity: 'centre' }])
        .png()
        .toFile(path.join(outDir, file))
    console.log('wrote', file)
}

for (const mascot of MASCOTS) {
    const svg = await readFile(path.join(publicDir, `favicon-${mascot}.svg`))
    await render(svg, 192, SCALE_ANY, `icon-${mascot}-192.png`)
    await render(svg, 512, SCALE_ANY, `icon-${mascot}-512.png`)
    await render(svg, 512, SCALE_MASKABLE, `icon-${mascot}-maskable-512.png`)
    await render(svg, 180, SCALE_ANY, `apple-touch-icon-${mascot}.png`)
}
