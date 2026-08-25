import assert from 'node:assert/strict'
import { isValidRepo, repoSlug, repoFromSpec, dshHome, isInstallableManifest, validateLocalPlugin, listDirectory } from '../lib/index.js'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// repoFromSpec: GitHub references resolve to owner/name; everything else is null.
const cases = [
  ['github:dujar/dsh-better-archive', 'dujar/dsh-better-archive'],
  ['github:owner/repo#main', 'owner/repo'],
  ['git+https://github.com/a/b.git', 'a/b'],
  ['git+ssh://git@github.com/a/b.git', 'a/b'],
  ['git@github.com:a/b.git', 'a/b'],
  ['https://github.com/a/b', 'a/b'],
  ['https://github.com/a/b#readme', 'a/b'],
  ['owner/repo', 'owner/repo'],
  ['npm:@scope/pkg', null],
  ['link:/home/u/dsh-trader', null],
  ['file:../x', null],
  ['1.2.3', null],
  ['workspace:*', null],
  ['@deepseek-ai/dsh-base', null],
]
for (const [spec, want] of cases) {
  assert.equal(repoFromSpec(spec), want, 'repoFromSpec(' + JSON.stringify(spec) + ')')
}

// isValidRepo: strict owner/name, no traversal, no bare names.
assert.equal(isValidRepo('owner/repo'), true)
assert.equal(isValidRepo('Owner_1/repo-name.dot'), true)
assert.equal(isValidRepo('no-slash'), false)
assert.equal(isValidRepo('bad/../x'), false)
assert.equal(isValidRepo('a/b#c'), false)
assert.equal(isValidRepo(''), false)
assert.equal(isValidRepo(null), false)

// repoSlug: the trailing segment.
assert.equal(repoSlug('owner/repo'), 'repo')

// dshHome: honors $DSH_HOME when set (the harness always sets it in-tree).
assert.equal(typeof dshHome(), 'string')
assert.ok(dshHome().length > 0)

// isInstallableManifest: a repo installs as a DSH plugin only when its
// package.json declares dsh.bundle.patch.
assert.equal(isInstallableManifest({ dsh: { bundle: { patch: './cordis.patch.yml' } } }), true)
assert.equal(isInstallableManifest({ dsh: { bundle: {} } }), false)
assert.equal(isInstallableManifest({ dsh: {} }), false)
assert.equal(isInstallableManifest({ name: 'app' }), false)
assert.equal(isInstallableManifest(null), false)
assert.equal(isInstallableManifest('not-an-object'), false)

// validateLocalPlugin: reads a local path and checks for a valid DSH bundle manifest.
const home = mkdtempSync(join(tmpdir(), 'dshcp-helpers-'))

// Missing path.
let r = await validateLocalPlugin('')
assert.equal(r.ok, false)
r = await validateLocalPlugin('/nonexistent/path')
assert.equal(r.ok, false)
assert.match(r.reason, /package\.json not found/)

// No dsh.bundle.
const noBundle = join(home, 'no-bundle')
mkdirSync(noBundle, { recursive: true })
writeFileSync(join(noBundle, 'package.json'), JSON.stringify({ name: 'my-app', version: '1.0.0' }))
r = await validateLocalPlugin(noBundle)
assert.equal(r.ok, false)
assert.match(r.reason, /no dsh\.bundle manifest/)

// Valid DSH plugin.
const good = join(home, 'good')
mkdirSync(good, { recursive: true })
writeFileSync(join(good, 'package.json'), JSON.stringify({
  name: 'my-plugin', version: '2.0.0', description: 'A plugin', author: 'me',
  dsh: { bundle: { patch: './cordis.patch.yml' } },
}))
r = await validateLocalPlugin(good)
assert.equal(r.ok, true)
assert.equal(r.installable, true)
assert.equal(r.name, 'my-plugin')
assert.equal(r.version, '2.0.0')
assert.equal(r.description, 'A plugin')
assert.equal(r.author, 'me')

// Invalid JSON.
const badJson = join(home, 'bad-json')
mkdirSync(badJson, { recursive: true })
writeFileSync(join(badJson, 'package.json'), '{ broken')
r = await validateLocalPlugin(badJson)
assert.equal(r.ok, false)
assert.match(r.reason, /not valid JSON/)

// listDirectory: subdirectories only, plugin folders marked, hidden opt-in.
mkdirSync(join(home, '.hidden'), { recursive: true })
writeFileSync(join(home, 'loose-file.txt'), 'not a directory')
symlinkSync(good, join(home, 'linked-plugin'), 'dir')

let d = await listDirectory(home)
assert.equal(d.ok, true)
assert.equal(d.path, home)
assert.equal(d.parent, dirname(home))
const names = d.entries.map((e) => e.name)
assert.deepEqual(names, ['bad-json', 'good', 'linked-plugin', 'no-bundle'])
// A symlinked checkout is followed and reads as the plugin it points at.
assert.deepEqual(d.entries.filter((e) => e.plugin).map((e) => e.name), ['good', 'linked-plugin'])
// The listed directory itself is not a plugin, so "select this folder" is unmarked.
assert.equal(d.self.installable, false)

// Hidden directories are opt-in.
assert.equal(d.entries.some((e) => e.name === '.hidden'), false)
d = await listDirectory(home, { hidden: true })
assert.equal(d.entries.some((e) => e.name === '.hidden'), true)

// Standing inside a plugin marks self, which is what enables selecting it.
d = await listDirectory(good)
assert.equal(d.ok, true)
assert.equal(d.self.installable, true)
assert.equal(d.self.name, 'my-plugin')

// An empty path means the user's home, not the process cwd.
d = await listDirectory('')
assert.equal(d.ok, true)
assert.equal(d.path, homedir())

// Unreadable targets report a reason instead of throwing.
d = await listDirectory(join(home, 'does-not-exist'))
assert.equal(d.ok, false)
assert.match(d.reason, /no such directory/)
d = await listDirectory(join(home, 'loose-file.txt'))
assert.equal(d.ok, false)
assert.match(d.reason, /not a directory/)

rmSync(home, { recursive: true, force: true })
console.log('helpers: all assertions passed')
