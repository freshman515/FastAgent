import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'assets', 'icons', 'fastagents-1024.png')
const output = join(root, 'build', 'icon.icns')
const iconset = join(root, 'build', 'icon.iconset')

if (process.platform !== 'darwin') {
  if (!existsSync(output)) {
    console.log('Skipping macOS icon generation outside macOS; build/icon.icns will be generated in macOS CI.')
  }
  process.exit(0)
}

if (!existsSync(source)) {
  throw new Error(`Missing source icon: ${source}`)
}

rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset, { recursive: true })

const sizes = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
]

for (const [size, name] of sizes) {
  execFileSync('sips', ['-z', String(size), String(size), source, '--out', join(iconset, name)], {
    stdio: 'inherit',
  })
}

execFileSync('iconutil', ['-c', 'icns', iconset, '-o', output], {
  stdio: 'inherit',
})

rmSync(iconset, { recursive: true, force: true })
console.log(`Generated ${output}`)
