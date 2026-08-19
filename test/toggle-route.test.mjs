// Enable/disable: bundle membership is edited in the profile manifest, and
// the route only ever touches plugins that are actually installed.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const tmp = mkdtempSync(join(tmpdir(), 'dshcp-toggle-test-'))
process.env.DSH_HOME = tmp
process.env.DSH_COMMUNITY_MIN_FETCH_INTERVAL_MS = '0'
mkdirSync(join(tmp, 'profiles', 'web'), { recursive: true })

const manifestPath = join(tmp, 'profiles', 'web', 'package.json')
const writeManifest = (bundles) => writeFileSync(manifestPath, JSON.stringify({
  dependencies: {
    'dsh-community-plugins': 'github:dujar/dsh-community-plugins',
    'dsh-trader': 'github:someone/dsh-trader',
  },
  dsh: { profile: { bundles } },
}, null, 2))
const readBundles = () => JSON.parse(readFileSync(manifestPath, 'utf8')).dsh.profile.bundles

writeManifest(['dsh-community-plugins', 'dsh-trader'])

globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => '9' }, json: async () => ({ items: [] }) })

const mod = await import('../lib/index.js')
const routes = {}
mod.apply({ effect: (fn) => { fn(); return () => {} }, webServer: { register: (def) => { routes[def.path] = def; return () => {} } } })

function fakeReq(bodyObj) {
  const body = JSON.stringify(bodyObj)
  return { method: 'POST', headers: { host: '127.0.0.1:3080', 'content-type': 'application/json' }, url: '/', on(event, cb) { if (event === 'data') cb(Buffer.from(body)); else if (event === 'end') cb() } }
}
function fakeRes() { const r = { status: 0, body: '' }; r.writeHead = (s) => { r.status = s }; r.end = (b) => { r.body = b }; return r }

const toggle = async (name, enabled) => {
  const res = fakeRes()
  await routes['/community-plugins/plugin'].handler(fakeReq({ name, enabled }), res)
  return { status: res.status, body: JSON.parse(res.body) }
}

// 1. Disable removes the name from the bundle list.
let out = await toggle('dsh-trader', false)
assert.equal(out.status, 200)
assert.equal(out.body.ok, true)
assert.equal(out.body.enabled, false)
assert.equal(out.body.needsRestart, true)
assert.deepEqual(readBundles(), ['dsh-community-plugins'], 'the name left dsh.profile.bundles')

// 2. Disabling again is a no-op but still succeeds.
out = await toggle('dsh-trader', false)
assert.equal(out.status, 200)
assert.equal(out.body.already, true)

// 3. Enable adds it back.
out = await toggle('dsh-trader', true)
assert.equal(out.status, 200)
assert.deepEqual(readBundles(), ['dsh-community-plugins', 'dsh-trader'])

// 4. Only installed plugins can be toggled — an unknown name is rejected and
// the manifest is untouched.
out = await toggle('dsh-not-installed', true)
assert.equal(out.status, 400)
assert.match(out.body.error, /no installed plugin/)
assert.deepEqual(readBundles(), ['dsh-community-plugins', 'dsh-trader'])

// 5. A missing name is a 400 too.
out = await toggle('', true)
assert.equal(out.status, 400)

await new Promise((r) => setTimeout(r, 50))
rmSync(tmp, { recursive: true, force: true })
console.log('toggle route: enable/disable edits bundle membership, guarded to installed plugins')
