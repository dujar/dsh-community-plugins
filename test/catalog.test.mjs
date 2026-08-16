import assert from 'node:assert/strict'
import { ensureSchema, upsertRepos, listCatalog, rowToRepo } from '../lib/index.js'

const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync(':memory:')
ensureSchema(db)

const FAKE = [
  { id: 1, full_name: 'acme/trader', owner: { login: 'acme', avatar_url: null }, html_url: 'https://github.com/acme/trader', description: 'Trading bot plugin', stargazers_count: 42, language: 'TypeScript', archived: false, fork: false, pushed_at: '2026-01-01T00:00:00Z', topics: ['dsh-plugin', 'trading', 'dsh'] },
  { id: 2, full_name: 'acme/archive', owner: { login: 'acme', avatar_url: null }, html_url: 'https://github.com/acme/archive', description: 'Archive panel', stargazers_count: 7, language: 'JavaScript', archived: false, fork: false, pushed_at: '2026-02-01T00:00:00Z', topics: ['dsh-plugin', 'dsh'] },
  { id: 3, full_name: 'deepseek-ai/deepseek-harness', owner: { login: 'deepseek-ai', avatar_url: null }, html_url: 'https://github.com/deepseek-ai/deepseek-harness', description: 'The harness', stargazers_count: 128000, language: 'TypeScript', archived: false, fork: false, pushed_at: '2026-03-01T00:00:00Z', topics: ['dsh-plugin', 'deepseek-harness', 'cordis'] },
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

// sort by updated desc
res = listCatalog(db, { q: '', tag: '', sort: 'updated', limit: 100, offset: 0 })
assert.equal(res.items[0].full_name, 'deepseek-ai/deepseek-harness')

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
assert.deepEqual(repo.topics, ['dsh-plugin', 'trading', 'dsh'])

// Rename: same id, different full_name updates in place (no UNIQUE violation)
upsertRepos(db, [{ ...FAKE[0], full_name: 'acme/trader-renamed' }])
res = listCatalog(db, { q: '', tag: '', sort: 'stars', limit: 100, offset: 0 })
assert.equal(res.total, 3)
assert.ok(res.items.some((r) => r.full_name === 'acme/trader-renamed'))
assert.ok(!res.items.some((r) => r.full_name === 'acme/trader'))

db.close()
console.log('catalog: all assertions passed')
