import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const tmp = mkdtempSync(join(tmpdir(), 'dshcp-install-test-'))
process.env.DSH_HOME = tmp
process.env.DSH_COMMUNITY_MIN_FETCH_INTERVAL_MS = '0'

// Fake dsh binary: exits 0 without touching pnpm/git/network.
const fakeBin = join(tmp, 'fake-dsh')
writeFileSync(fakeBin, '#!/bin/sh\nexit 0\n')
chmodSync(fakeBin, 0o755)
process.env.DSH_BIN = fakeBin

// Stub fetch for both checkInstallable (repo package.json) and the background
// seed's githubSearch (gets { ok:true, items:[] } since json has no items).
function fetchStub(jsonBody) {
  return async () => ({
    ok: true, status: 200,
    headers: { get: (name) => (name === 'x-ratelimit-remaining' ? '9' : null) },
    json: async () => jsonBody,
  })
}
globalThis.fetch = fetchStub({ name: 'plugin', dsh: { bundle: { patch: './cordis.patch.yml' } } })

const mod = await import('../lib/index.js')
const routes = {}
const ctx = { effect: (fn) => { fn(); return () => {} }, webServer: { register: (def) => { routes[def.path] = def; return () => {} } } }
mod.apply(ctx)

function fakeReq(bodyObj) {
  const body = JSON.stringify(bodyObj)
  return { method: 'POST', headers: { host: '127.0.0.1:3080', 'content-type': 'application/json' }, url: '/', on(event, cb) { if (event === 'data') cb(Buffer.from(body)); else if (event === 'end') cb() } }
}
function fakeRes() { const r = { status: 0, body: '' }; r.writeHead = (s) => { r.status = s }; r.end = (b) => { r.body = b }; return r }

// Success path regression: the handler must send a 200 (was missing the res arg).
let res = fakeRes()
await routes['/community-plugins/install'].handler(fakeReq({ repo: 'owner/plugin' }), res)
let body = JSON.parse(res.body)
assert.equal(res.status, 200)
assert.equal(body.ok, true)
assert.equal(body.installable, true)

// Non-installable manifest -> 400 with a clear reason.
globalThis.fetch = fetchStub({ name: 'app' })
res = fakeRes()
await routes['/community-plugins/install'].handler(fakeReq({ repo: 'owner/app' }), res)
body = JSON.parse(res.body)
assert.equal(res.status, 400)
assert.equal(body.installable, false)
assert.match(body.error, /no dsh\.bundle manifest/)

// Let the background seed settle before cleanup.
await new Promise((r) => setTimeout(r, 50))
rmSync(tmp, { recursive: true, force: true })
console.log('install route: all assertions passed')
