import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

// Hermetic environment + network stub before importing the host module.
const tmp = mkdtempSync(join(tmpdir(), 'dshcp-smoke-'))
process.env.DSH_HOME = tmp
process.env.DSH_COMMUNITY_MIN_FETCH_INTERVAL_MS = '0'
globalThis.fetch = async () => ({
  ok: false, status: 500,
  headers: { get: (name) => (name === 'x-ratelimit-remaining' ? '9' : null) },
  json: async () => ({}),
})

const mod = await import('../lib/index.js')

const routes = {}
const ctx = {
  effect: (fn) => { fn(); return () => {} },
  webServer: { register: (def) => { routes[def.path] = def; return () => {} } },
}
mod.apply(ctx)

assert.equal(mod.name, 'community-plugins')
assert.ok(mod.inject.includes('webServer'), 'host inject includes webServer')
assert.deepEqual(Object.keys(routes).sort(), [
  '/community-plugins/catalog',
  '/community-plugins/forks',
  '/community-plugins/install',
  '/community-plugins/plugin',
  '/community-plugins/refresh',
  '/community-plugins/restart',
  '/community-plugins/state',
  '/community-plugins/uninstall',
])
for (const route of Object.values(routes)) {
  assert.equal(route.kind, 'exact')
  assert.equal(typeof route.handler, 'function')
}

// Let the background seed settle (temp dir + stubbed fetch) before cleanup.
await new Promise((resolve) => setTimeout(resolve, 80))
rmSync(tmp, { recursive: true, force: true })

console.log('host smoke: apply registered ' + Object.keys(routes).length + ' routes')
