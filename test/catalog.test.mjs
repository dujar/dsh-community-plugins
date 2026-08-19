import assert from 'node:assert/strict'
import { ensureSchema, upsertRepos, listCatalog, listLocalPlugins, rowToRepo } from '../lib/index.js'

const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync(':memory:')
ensureSchema(db)

const FAKE = [
  { id: 1, full_name: 'acme/trader', owner: { login: 'acme', avatar_url: null }, html_url: 'https://github.com/acme/trader', description: 'Trading bot plugin', stargazers_count: 42, forks_count: 5, default_branch: 'main', language: 'TypeScript', archived: false, fork: false, pushed_at: '2026-01-01T00:00:00Z', created_at: '2025-03-01T00:00:00Z', updated_at: '2026-04-15T00:00:00Z', topics: ['dsh-plugin', 'trading', 'dsh'] },
  { id: 2, full_name: 'acme/archive', owner: { login: 'acme', avatar_url: null }, html_url: 'https://github.com/acme/archive', description: 'Archive panel', stargazers_count: 7, forks_count: 12, language: 'JavaScript', archived: false, fork: false, pushed_at: '2026-02-01T00:00:00Z', created_at: '2025-11-20T00:00:00Z', updated_at: '2026-06-01T00:00:00Z', topics: ['dsh-plugin', 'dsh'] },
  { id: 3, full_name: 'deepseek-ai/deepseek-harness', owner: { login: 'deepseek-ai', avatar_url: null }, html_url: 'https://github.com/deepseek-ai/deepseek-harness', description: 'The harness', stargazers_count: 128000, forks_count: 900, language: 'TypeScript', archived: false, fork: false, pushed_at: '2026-03-01T00:00:00Z', created_at: '2024-06-01T00:00:00Z', updated_at: '2026-02-20T00:00:00Z', topics: ['dsh-plugin', 'deepseek-harness', 'cordis'] },
]
upsertRepos(db, FAKE)

// upsert is idempotent on the repo id
upsertRepos(db, [{ ...FAKE[0], stargazers_count: 99, description: 'updated' }])
let res = listCatalog(db, { q: '', tag: '', sort: 'stars', limit: 100, offset: 0 })
assert.equal(res.total, 3)
assert.equal(res.items.find((r) => r.full_name === 'acme/trader').stargazers, 99)
assert.equal(res.items.find((r) => r.full_name === 'acme/trader').description, 'updated')

// default sort stars desc
res = listCatalog(db, { q: '', tag: '', sort: 'stars', limit: 100, offset: 0 })
assert.deepEqual(res.items.map((r) => r.full_name), ['deepseek-ai/deepseek-harness', 'acme/trader', 'acme/archive'])
assert.equal(res.allCount, 3)

// tag aggregation excludes umbrella topics and sorts by count desc then name
assert.deepEqual(res.tags, [
  { tag: 'dsh', count: 2 },
  { tag: 'cordis', count: 1 },
  { tag: 'trading', count: 1 },
])

// text search matches name / description / topic
res = listCatalog(db, { q: 'trading', tag: '', sort: 'stars', limit: 100, offset: 0 })
assert.deepEqual(res.items.map((r) => r.full_name), ['acme/trader'])

// tag filter (allCount ignores the tag, total respects it)
res = listCatalog(db, { q: '', tag: 'dsh', sort: 'stars', limit: 100, offset: 0 })
assert.deepEqual(res.items.map((r) => r.full_name).sort(), ['acme/archive', 'acme/trader'])
assert.equal(res.total, 2)
assert.equal(res.allCount, 3)

// sort by forks desc
res = listCatalog(db, { q: '', tag: '', sort: 'forks', limit: 100, offset: 0 })
assert.equal(res.items[0].full_name, 'deepseek-ai/deepseek-harness', 'most forked first')
assert.equal(res.items[1].full_name, 'acme/archive')

// sort by created desc (newest repos first)
res = listCatalog(db, { q: '', tag: '', sort: 'created', limit: 100, offset: 0 })
assert.equal(res.items[0].full_name, 'acme/archive', 'newest creation first')
assert.equal(res.items[2].full_name, 'deepseek-ai/deepseek-harness', 'oldest creation last')

// sort by updated desc — real updated_at, not push time: archive (2026-06-01)
// was pushed earlier but updated later than trader (2026-04-15)
res = listCatalog(db, { q: '', tag: '', sort: 'updated', limit: 100, offset: 0 })
assert.equal(res.items[0].full_name, 'acme/archive', 'real update time, not push time')
assert.equal(res.items[1].full_name, 'acme/trader')

// sort by pushed (the displayed Updated column) desc still works
res = listCatalog(db, { q: '', tag: '', sort: 'updated', limit: 100, offset: 0 })
assert.equal(res.items[2].full_name, 'deepseek-ai/deepseek-harness')

// sort by name asc
res = listCatalog(db, { q: '', tag: '', sort: 'name', limit: 100, offset: 0 })
assert.equal(res.items[0].full_name, 'acme/archive')

// pagination
res = listCatalog(db, { q: '', tag: '', sort: 'stars', limit: 2, offset: 0 })
assert.equal(res.items.length, 2)
assert.equal(res.total, 3)
res = listCatalog(db, { q: '', tag: '', sort: 'stars', limit: 2, offset: 2 })
assert.equal(res.items.length, 1)

// rowToRepo shape
const repo = rowToRepo(db.prepare('SELECT * FROM repos WHERE id = 1').get())
assert.equal(repo.archived, false)
assert.equal(repo.fork, false)
assert.equal(repo.forks, 5, 'fork count round-trips through the catalog')
assert.equal(repo.created_at, '2025-03-01T00:00:00Z', 'creation time round-trips')
assert.equal(repo.updated_at, '2026-04-15T00:00:00Z', 'update time round-trips')
assert.equal(repo.default_branch, 'main', 'default branch is kept for compare links')
assert.equal(rowToRepo(db.prepare('SELECT * FROM repos WHERE id = 2').get()).forks, 12, 'fork count round-trips for every repo')
assert.deepEqual(repo.topics, ['dsh-plugin', 'trading', 'dsh'])

// installed filter: a catalog row matches by resolved repo or package name
res = listCatalog(db, { q: '', tag: '', sort: 'stars', limit: 100, offset: 0, filter: 'installed', plugins: [{ name: 'archive', spec: null, repo: null }] })
assert.deepEqual(res.items.map((r) => r.full_name), ['acme/archive'], 'name match without a repo is counted as installed')
res = listCatalog(db, { q: '', tag: '', sort: 'stars', limit: 100, offset: 0, filter: 'installed', plugins: [{ name: 'trader', spec: 'github:acme/trader', repo: 'acme/trader' }] })
assert.deepEqual(res.items.map((r) => r.full_name), ['acme/trader'], 'repo match is counted as installed')
assert.equal(res.total, 1, 'installed filter shrinks the total')
assert.equal(res.allCount, 1, 'and the allCount')

// Rename: same id, different full_name updates in place (no UNIQUE violation)
upsertRepos(db, [{ ...FAKE[0], full_name: 'acme/trader-renamed' }])
res = listCatalog(db, { q: '', tag: '', sort: 'stars', limit: 100, offset: 0 })
assert.equal(res.total, 3)
assert.ok(res.items.some((r) => r.full_name === 'acme/trader-renamed'))
assert.ok(!res.items.some((r) => r.full_name === 'acme/trader'))

// local plugins: only the ones the catalog does not know about.
// (the earlier rename case moved acme/trader -> acme/trader-renamed, so the
// plugin 'trader' is NOT in the catalog under its original repo anymore)
const local = listLocalPlugins(db, [
  { name: 'trader', spec: 'github:acme/trader', repo: 'acme/trader', enabled: true },
  { name: 'archive', spec: null, repo: null, enabled: false },
  { name: 'my-local-plugin', spec: 'file:../my-local-plugin', repo: null, enabled: true },
], { q: '' })
assert.ok(local.items.some((i) => i.name === 'my-local-plugin'), 'local-only plugin is listed')
assert.ok(!local.items.some((i) => i.name === 'archive'), 'a catalog-known plugin by name drops out of the local list')
assert.equal(local.items.find((i) => i.name === 'my-local-plugin').local, true)
assert.equal(local.items.find((i) => i.name === 'my-local-plugin').enabled, true)
// The trader rename moved the repo out of the catalog, so it now surfaces as
// local — correct, but its name no longer appears as a catalog entry.
assert.equal(local.total, 2)
// the local query filters by name / spec
assert.equal(listLocalPlugins(db, [{ name: 'my-local-plugin', spec: 'file:x', repo: null }], { q: 'local' }).total, 1)
assert.equal(listLocalPlugins(db, [{ name: 'my-local-plugin', spec: 'file:x', repo: null }], { q: 'nope' }).total, 0)

db.close()
console.log('catalog: all assertions passed')
