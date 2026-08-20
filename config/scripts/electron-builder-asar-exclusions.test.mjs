import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const electronBuilderConfig = require('../electron-builder.config.cjs')
const { FileMatcher } = require('app-builder-lib/out/fileMatcher')

/** Drives the real matcher: pinning a pattern string cannot prove it excludes a tree. */
function createPackFilter() {
  const matcher = new FileMatcher('/app', '/dest', (value) => value, electronBuilderConfig.files)
  // copyFiles() prepends this itself once the pattern list is all-negation.
  matcher.prependPattern('**/*')
  const isPacked = matcher.createFilter()
  return (repoPath) => isPacked(join('/app', repoPath), { isDirectory: () => false })
}

// Why: `files` is an all-negation list, so electron-builder's default `**/*` packs
// anything without an explicit `!` entry. Local-only trees that slip through end up
// in a shipped app.asar, which is how examples/ shipped hostile-panel in 1.4.160-rc.3.
describe('electron-builder app.asar exclusions', () => {
  it('keeps the dev Electron bundle out of app.asar', () => {
    const packs = createPackFilter()

    // `pnpm dev` stages a full dev Electron.app under out/electron-dev/<hash>/, so
    // packaging after a dev run buried a second ~275 MB Electron inside app.asar
    // (120 MB grew to 404 MB, observed on 1.4.174-rc.0).
    for (const devOnly of [
      'out/electron-dev/ecd228106ba3/Orca dev.app/Contents/MacOS/Electron',
      'out/electron-dev/ecd228106ba3/Orca dev.app/Contents/Info.plist',
      'out/electron-dev/ecd228106ba3/orca-dev-electron-app.json'
    ]) {
      expect(packs(devOnly)).toBe(false)
    }
    // The compiled main/renderer output next to it still ships.
    expect(packs('out/main/index.js')).toBe(true)
    expect(packs('out/renderer/index.html')).toBe(true)
  })
})
