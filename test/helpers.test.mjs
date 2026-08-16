import assert from 'node:assert/strict'
import { isValidRepo, repoSlug, repoFromSpec, dshHome, isInstallableManifest } from '../lib/index.js'

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

console.log('helpers: all assertions passed')
