// Fork listings: cache-first reads, forced refetch, and rate-limit fallback.
import assert from 'node:assert/strict'
import { ensureSchema, listForks } from '../lib/index.js'

const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync(':memory:')
ensureSchema(db)

const forkPayload = (name, stars) => ({
  id: name.length + stars, full_name: name, owner: { login: name.split('/')[0], avatar_url: 'https://avatars/x' },
  html_url: 'https://github.com/' + name, description: 'a fork', stargazers_count: stars, forks_count: 0,
  language: 'JavaScript', archived: false, default_branch: 'main', pushed_at: '2026-04-01T00:00:00Z',
})

let calls = 0
let mode = 'ok'
const realFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  calls += 1
  assert.match(String(url), /^https:\/\/api\.github\.com\/repos\/acme\/trader\/forks\?/)
  if (mode === 'ratelimited') {
    return { ok: false, status: 403, headers: { get: (h) => (h === 'x-ratelimit-remaining' ? '0' : String(Math.floor(Date.now() / 1000) + 600)) }, json: async () => ({}) }
  }
  if (mode === 'notfound') {
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }
  }
  return {
    ok: true, status: 200, headers: { get: () => '55' },
    json: async () => (mode === 'second' ? [forkPayload('carol/trader', 9)] : [forkPayload('bob/trader', 3)]),
  }
}

// 1. First read hits GitHub and trims the payload to what the browser renders.
let res = await listForks(db, 'acme/trader', false)
assert.equal(calls, 1)
assert.equal(res.ok, true)
assert.equal(res.cached, false)
assert.deepEqual(res.items.map((f) => f.full_name), ['bob/trader'])
assert.equal(res.items[0].stargazers, 3)
assert.equal(res.items[0].default_branch, 'main', 'default branch is kept for the compare link')
assert.equal(res.items[0].owner, 'bob')

// 2. A repeat read inside the TTL is served from SQLite — no second request.
mode = 'second'
res = await listForks(db, 'acme/trader', false)
assert.equal(calls, 1, 'cached listing does not spend a core rate-limit request')
assert.equal(res.cached, true)
assert.deepEqual(res.items.map((f) => f.full_name), ['bob/trader'])

// 3. force refetches and replaces the cached listing.
res = await listForks(db, 'acme/trader', true)
assert.equal(calls, 2)
assert.deepEqual(res.items.map((f) => f.full_name), ['carol/trader'])
res = await listForks(db, 'acme/trader', false)
assert.equal(calls, 2, 'the forced fetch reset the cache clock')
assert.deepEqual(res.items.map((f) => f.full_name), ['carol/trader'])

// 4. A rate-limited refetch falls back to the cached listing, flagged stale.
mode = 'ratelimited'
res = await listForks(db, 'acme/trader', true)
assert.equal(res.ok, true)
assert.equal(res.stale, true)
assert.equal(res.rateLimited, true)
assert.deepEqual(res.items.map((f) => f.full_name), ['carol/trader'])

// 5. While rate-limited, an uncached repo reports the limit instead of fetching.
const before = calls
res = await listForks(db, 'acme/unknown', false)
assert.equal(calls, before, 'no request is made while the core limit is exhausted')
assert.equal(res.ok, false)
assert.equal(res.rateLimited, true)

globalThis.fetch = realFetch
db.close()
console.log('forks: cache-first listing, forced refetch, rate-limit fallback')
