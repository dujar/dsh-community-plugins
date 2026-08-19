// What the browser is told about already-installed plugins: everything in the
// profile manifest, with dsh.profile.bundles membership reported as "enabled".
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dshcp-state-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'profiles', 'web'), { recursive: true })
writeFileSync(join(home, 'profiles', 'web', 'package.json'), JSON.stringify({
  dependencies: {
    '@deepseek-ai/dsh-base': '^1.0.0',
    'dsh-community-plugins': 'github:dujar/dsh-community-plugins',
    'dsh-better-archive': 'github:dujar/dsh-better-archive',
    'dsh-trader': 'github:someone/dsh-trader',
    'dsh-registry-plugin': '^2.1.0',
  },
  dsh: {
    profile: {
      bundles: [
        '@deepseek-ai/dsh-web',
        'dsh-community-plugins',
        'dsh-better-archive',
        'dsh-registry-plugin',
      ],
    },
  },
}))

const { collectInstalled, enrichLocal, enrichLocalGithub, ensureSchema } = await import('../lib/index.js')
const plugins = await collectInstalled('web')
const byName = Object.fromEntries(plugins.map((p) => [p.name, p]))

// Harness-owned bundles are not community plugins and are left out.
assert.ok(!('@deepseek-ai/dsh-web' in byName), 'harness bundles are filtered out')

// Enabled: installed AND listed in dsh.profile.bundles — the card shows Installed.
assert.equal(byName['dsh-better-archive'].enabled, true)
assert.equal(byName['dsh-better-archive'].repo, 'dujar/dsh-better-archive', 'github spec resolves to owner/name')

// Installed but not mounted: present in dependencies, absent from bundles.
assert.equal(byName['dsh-trader'].enabled, false, 'a dependency outside bundles is not enabled')
assert.equal(byName['dsh-trader'].repo, 'someone/dsh-trader')

// A registry install has no repo to match on; the card falls back to the name.
assert.equal(byName['dsh-registry-plugin'].enabled, true)
assert.equal(byName['dsh-registry-plugin'].repo, null, 'a version spec resolves to no repo')

// enrichLocal: the "about" info comes from the installed manifest.
// 1. A registry-style install reads node_modules/<name>/package.json and the
// README shipped next to it.
mkdirSync(join(home, 'profiles', 'web', 'node_modules', 'my-local-plugin'), { recursive: true })
writeFileSync(join(home, 'profiles', 'web', 'node_modules', 'my-local-plugin', 'package.json'), JSON.stringify({
  name: 'my-local-plugin', version: '1.4.2', description: 'Does local things', author: { name: 'me' },
}))
writeFileSync(join(home, 'profiles', 'web', 'node_modules', 'my-local-plugin', 'README.md'), '# Local Plugin\n\n**Does local things.** `dsh plugin` compatible.\n')
writeFileSync(join(home, 'profiles', 'web', 'node_modules', 'my-local-plugin', 'README.zh-CN.md'), '# 本地插件\n\n中文说明。\n')
let enriched = await enrichLocal('web', { name: 'my-local-plugin', spec: '^1.0.0', repo: null })
assert.equal(enriched.version, '1.4.2')
assert.equal(enriched.description, 'Does local things')
assert.equal(enriched.author, 'me')
assert.equal(enriched.readmes.length, 2, 'every README variant is attached')
assert.equal(enriched.readmes[0].key, 'README.md', 'the plain README comes first')
assert.equal(enriched.readmes[0].label, 'English')
assert.equal(enriched.readmes[1].label, '中文', 'language suffixes get display labels')
assert.ok(enriched.readmes[1].text.includes('# 本地插件'), 'the zh README text is attached')
assert.equal(enriched.readmes[0].truncated, false)

// 2. A file: spec resolves relative to the profile directory.
mkdirSync(join(home, 'profiles', 'web', 'plugins', 'other'), { recursive: true })
writeFileSync(join(home, 'profiles', 'web', 'plugins', 'other', 'package.json'), JSON.stringify({
  name: 'other', version: '0.3.0', description: 'A checkout plugin', author: 'someone',
}))
enriched = await enrichLocal('web', { name: 'other', spec: 'file:plugins/other', repo: null })
assert.equal(enriched.version, '0.3.0')
assert.equal(enriched.description, 'A checkout plugin')
assert.equal(enriched.author, 'someone')

// 3. A README beyond the display limit is truncated and flagged.
writeFileSync(join(home, 'profiles', 'web', 'node_modules', 'my-local-plugin', 'README.md'), 'x'.repeat(20000))
enriched = await enrichLocal('web', { name: 'my-local-plugin', spec: '^1.0.0', repo: null })
assert.equal(enriched.readmes[0].text.length, 12000)
assert.equal(enriched.readmes[0].truncated, true)

// 4. No readable manifest anywhere leaves the item untouched.
enriched = await enrichLocal('web', { name: 'ghost', spec: 'link:../ghost', repo: null })
assert.equal(enriched.version ?? null, null)
assert.equal(enriched.description ?? null, null)
assert.equal(enriched.readmes.length, 0)

// 5. enrichLocalGithub: a local plugin whose repo is on GitHub gets the same
// metadata the catalog rows carry, cached so one fetch serves many reads.
const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync(':memory:')
ensureSchema(db)
let metaCalls = 0
const realFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  assert.match(String(url), /^https:\/\/api\.github\.com\/repos\/acme\/private-plugin$/)
  metaCalls += 1
  return {
    ok: true, status: 200, headers: { get: () => '55' },
    json: async () => ({
      full_name: 'acme/private-plugin', owner: { login: 'acme', avatar_url: 'https://av/x' },
      html_url: 'https://github.com/acme/private-plugin', description: 'Private trading plugin',
      stargazers_count: 12, forks_count: 2, language: 'TypeScript', archived: false, fork: false,
      default_branch: 'main', pushed_at: '2026-05-01T00:00:00Z', created_at: '2025-01-01T00:00:00Z',
      updated_at: '2026-05-10T00:00:00Z', topics: ['trading'],
    }),
  }
}
let withMeta = await enrichLocalGithub(db, { name: 'private-plugin', repo: 'acme/private-plugin', spec: 'github:acme/private-plugin' })
assert.equal(withMeta.github, true, 'github-backed local plugins are flagged')
assert.equal(withMeta.full_name, 'acme/private-plugin')
assert.equal(withMeta.stargazers, 12)
assert.deepEqual(withMeta.topics, ['trading'])
assert.equal(metaCalls, 1)
withMeta = await enrichLocalGithub(db, { name: 'private-plugin', repo: 'acme/private-plugin' })
assert.equal(metaCalls, 1, 'the repo metadata is cached')
// a repo GitHub does not know (or a private one without a token) stays plain
globalThis.fetch = async () => ({ ok: false, status: 404, headers: { get: () => '55' }, json: async () => ({}) })
const plain = await enrichLocalGithub(db, { name: 'nope', repo: 'acme/absent' })
assert.ok(!('github' in plain), 'an unfetchable repo keeps the plain local card')
globalThis.fetch = realFetch
db.close()

rmSync(home, { recursive: true, force: true })
console.log('installed state: bundles membership reported as enabled, local enrichment reads manifests')
