import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const appRoot = path.resolve(import.meta.dirname, '..')
const appPackagePath = path.join(appRoot, 'package.json')
const packagedAppRoot = path.join(appRoot, 'dist', 'win-unpacked', 'resources', 'app.asar.unpacked')
const packagedPlatformPackage = path.join(
  packagedAppRoot,
  'node_modules',
  '@lydell',
  'node-pty-win32-x64',
  'package.json',
)

test('packaged Windows app includes node-pty win32-x64 optional dependency', () => {
  assert.equal(fs.existsSync(appPackagePath), true)
  assert.equal(
    fs.existsSync(packagedPlatformPackage),
    true,
    `Missing packaged optional dependency: ${packagedPlatformPackage}`,
  )
})
