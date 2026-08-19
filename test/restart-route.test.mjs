// The restart route schedules a detached restarter and exits the process once
// the response has flushed. The restarter command is overridden here so the
// test never spawns a real dsh web, and process.exit is stubbed so the test
// runner survives.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const tmp = mkdtempSync(join(tmpdir(), 'dshcp-restart-test-'))
process.env.DSH_HOME = tmp
process.env.DSH_COMMUNITY_MIN_FETCH_INTERVAL_MS = '0'
process.env.DSH_COMMUNITY_RESTART_CMD = 'sh -c "exit 0"'

globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => '9' }, json: async () => ({ items: [] }) })

const mod = await import('../lib/index.js')
const routes = {}
mod.apply({ effect: (fn) => { fn(); return () => {} }, webServer: { register: (def) => { routes[def.path] = def; return () => {} } } })

function fakeReq() {
  return { method: 'POST', headers: { host: '127.0.0.1:3080' }, url: '/', on(event, cb) { if (event === 'end') cb() } }
}
function fakeRes() { const r = { status: 0, body: '' }; r.writeHead = (s) => { r.status = s }; r.end = (b) => { r.body = b }; return r }

// A restart succeeds, responds before dying, and exits the process afterwards.
let exits = 0
const realExit = process.exit
process.exit = () => { exits += 1 }

const res = fakeRes()
await routes['/community-plugins/restart'].handler(fakeReq(), res)
const body = JSON.parse(res.body)
assert.equal(res.status, 200)
assert.equal(body.ok, true)
assert.equal(body.restarting, true)
assert.equal(exits, 0, 'the response lands before the process exits')

await new Promise((r) => setTimeout(r, 500))
assert.equal(exits, 1, 'the process exits shortly after the response')
process.exit = realExit

// Untrusted requests never trigger a restart.
exits = 0
process.exit = () => { exits += 1 }
const badRes = fakeRes()
await routes['/community-plugins/restart'].handler({ method: 'POST', headers: { host: 'evil.example', origin: 'https://evil.example' }, url: '/', on() {} }, badRes)
assert.equal(badRes.status, 403)
await new Promise((r) => setTimeout(r, 500))
assert.equal(exits, 0)
process.exit = realExit

await new Promise((r) => setTimeout(r, 50))
rmSync(tmp, { recursive: true, force: true })
console.log('restart route: responds, schedules a restarter, exits — untrusted rejected')
