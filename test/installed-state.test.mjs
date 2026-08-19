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

const { collectInstalled, enrichLocal } = await import('../lib/index.js')
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
// 1. A registry-style install reads node_modules/<name>/package.json.
mkdirSync(join(home, 'profiles', 'web', 'node_modules', 'my-local-plugin'), { recursive: true })
writeFileSync(join(home, 'profiles', 'web', 'node_modules', 'my-local-plugin', 'package.json'), JSON.stringify({
  name: 'my-local-plugin', version: '1.4.2', description: 'Does local things', author: { name: 'me' },
}))
let enriched = await enrichLocal('web', { name: 'my-local-plugin', spec: '^1.0.0', repo: null })
assert.equal(enriched.version, '1.4.2')
assert.equal(enriched.description, 'Does local things')
assert.equal(enriched.author, 'me')

// 2. A file: spec resolves relative to the profile directory.
mkdirSync(join(home, 'profiles', 'web', 'plugins', 'other'), { recursive: true })
writeFileSync(join(home, 'profiles', 'web', 'plugins', 'other', 'package.json'), JSON.stringify({
  name: 'other', version: '0.3.0', description: 'A checkout plugin', author: 'someone',
}))
enriched = await enrichLocal('web', { name: 'other', spec: 'file:plugins/other', repo: null })
assert.equal(enriched.version, '0.3.0')
assert.equal(enriched.description, 'A checkout plugin')
assert.equal(enriched.author, 'someone')

// 3. No readable manifest anywhere leaves the item untouched.
enriched = await enrichLocal('web', { name: 'ghost', spec: 'link:../ghost', repo: null })
assert.equal(enriched.version ?? null, null)
assert.equal(enriched.description ?? null, null)

rmSync(home, { recursive: true, force: true })
console.log('installed state: bundles membership reported as enabled, local enrichment reads manifests')
