import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs'
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

function fakeGetReq(url) {
  return { method: 'GET', headers: { host: '127.0.0.1:3080' }, url, on() {} }
}

// ── Folder picker listing ─────────────────────────────────────────────────────

// The picker walks the disk through the host, so a listing must come back with
// absolute paths and mark the folders that are actually installable.
{
  const parent = join(tmp, 'workspace')
  const plugin = join(parent, 'a-plugin')
  const plain = join(parent, 'b-notes')
  mkdirSync(plugin, { recursive: true })
  mkdirSync(plain, { recursive: true })
  writeFileSync(join(plugin, 'package.json'), JSON.stringify({
    name: 'a-plugin', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))

  let res = fakeRes()
  await routes['/community-plugins/browse'].handler(fakeGetReq('/community-plugins/browse?path=' + encodeURIComponent(parent)), res)
  assert.equal(res.status, 200)
  let body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.equal(body.path, parent)
  assert.deepEqual(body.entries.map((e) => e.name), ['a-plugin', 'b-notes'])
  assert.deepEqual(body.entries.map((e) => e.path), [plugin, plain])
  assert.deepEqual(body.entries.map((e) => e.plugin), [true, false])

  // Standing inside the plugin is what enables "select this folder".
  res = fakeRes()
  await routes['/community-plugins/browse'].handler(fakeGetReq('/community-plugins/browse?path=' + encodeURIComponent(plugin)), res)
  body = JSON.parse(res.body)
  assert.equal(body.self.installable, true)
  assert.equal(body.self.name, 'a-plugin')
  assert.equal(body.parent, parent)

  // A bad path is a 400 with a reason, not a 500 or an empty listing.
  res = fakeRes()
  await routes['/community-plugins/browse'].handler(fakeGetReq('/community-plugins/browse?path=' + encodeURIComponent(join(tmp, 'nope'))), res)
  assert.equal(res.status, 400)
  assert.match(JSON.parse(res.body).reason, /no such directory/)

  // Same fail-closed guard as every other route.
  res = fakeRes()
  await routes['/community-plugins/browse'].handler({ method: 'GET', headers: { host: 'evil.example' }, url: '/community-plugins/browse', on() {} }, res)
  assert.equal(res.status, 403)

  res = fakeRes()
  await routes['/community-plugins/browse'].handler({ method: 'POST', headers: { host: '127.0.0.1:3080' }, url: '/community-plugins/browse', on() {} }, res)
  assert.equal(res.status, 405)
}

// ── GitHub repo install (existing behaviour) ──────────────────────────────────

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

// ── Local path validation route ───────────────────────────────────────────────

// Missing path.
res = fakeRes()
await routes['/community-plugins/validate'].handler(fakeReq({}), res)
body = JSON.parse(res.body)
assert.equal(res.status, 400)
assert.equal(body.ok, false)

// Non-existent path.
res = fakeRes()
await routes['/community-plugins/validate'].handler(fakeReq({ path: '/no/such/dir' }), res)
body = JSON.parse(res.body)
assert.equal(res.status, 400)
assert.equal(body.ok, false)
assert.match(body.reason, /package\.json not found/)

// Path with a non-JSON package.json.
const badPkgDir = join(tmp, 'bad-pkg')
mkdirSync(badPkgDir, { recursive: true })
writeFileSync(join(badPkgDir, 'package.json'), 'not-json')
res = fakeRes()
await routes['/community-plugins/validate'].handler(fakeReq({ path: badPkgDir }), res)
body = JSON.parse(res.body)
assert.equal(res.status, 400)
assert.equal(body.ok, false)
assert.match(body.reason, /not valid JSON/)

// Path with a package.json but no dsh.bundle.
const noBundleDir = join(tmp, 'no-bundle')
mkdirSync(noBundleDir, { recursive: true })
writeFileSync(join(noBundleDir, 'package.json'), JSON.stringify({ name: 'my-app', version: '1.0.0' }))
res = fakeRes()
await routes['/community-plugins/validate'].handler(fakeReq({ path: noBundleDir }), res)
body = JSON.parse(res.body)
assert.equal(res.status, 400)
assert.equal(body.ok, false)
assert.match(body.reason, /no dsh\.bundle manifest/)

// Valid DSH plugin path.
const goodPluginDir = join(tmp, 'good-plugin')
mkdirSync(goodPluginDir, { recursive: true })
writeFileSync(join(goodPluginDir, 'package.json'), JSON.stringify({
  name: 'my-local-plugin',
  version: '2.3.1',
  description: 'A local test plugin',
  author: 'test-author',
  dsh: { bundle: { patch: './cordis.patch.yml' } },
}))
res = fakeRes()
await routes['/community-plugins/validate'].handler(fakeReq({ path: goodPluginDir }), res)
body = JSON.parse(res.body)
assert.equal(res.status, 200)
assert.equal(body.ok, true)
assert.equal(body.installable, true)
assert.equal(body.name, 'my-local-plugin')
assert.equal(body.version, '2.3.1')
assert.equal(body.description, 'A local test plugin')
assert.equal(body.author, 'test-author')

// ── Local path install route ──────────────────────────────────────────────────

// Missing path param.
res = fakeRes()
await routes['/community-plugins/install'].handler(fakeReq({}), res)
body = JSON.parse(res.body)
assert.equal(res.status, 400)
assert.equal(body.error, 'path is required for local installs')

// Non-existent local path.
res = fakeRes()
await routes['/community-plugins/install'].handler(fakeReq({ path: '/no/such/dir' }), res)
body = JSON.parse(res.body)
assert.equal(res.status, 400)
assert.equal(body.ok, false)

// Dry run on a valid local plugin.
res = fakeRes()
await routes['/community-plugins/install'].handler(fakeReq({ path: goodPluginDir, dryRun: true }), res)
body = JSON.parse(res.body)
assert.equal(res.status, 200)
assert.equal(body.ok, true)
assert.equal(body.dryRun, true)
assert.equal(body.name, 'my-local-plugin')
assert.equal(body.version, '2.3.1')
assert.equal(body.installable, true)

// Real install of a valid local plugin (fake dsh binary exits 0).
res = fakeRes()
await routes['/community-plugins/install'].handler(fakeReq({ path: goodPluginDir, dryRun: false }), res)
body = JSON.parse(res.body)
assert.equal(res.status, 200)
assert.equal(body.ok, true)
assert.equal(body.name, 'my-local-plugin')
assert.equal(body.installable, true)
assert.equal(body.needsRestart, true)

// Let the background seed settle before cleanup.
await new Promise((r) => setTimeout(r, 50))
rmSync(tmp, { recursive: true, force: true })
console.log('install route: all assertions passed')
