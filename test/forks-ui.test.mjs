// The fork count on a card opens a fork browser you can install from.
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { installClock, advance, flush, createRenderer } from './mini-react.mjs'

const store = new Map()
let captured = null
globalThis.window = {
  __ModuleLoader__: { load: (definition) => { captured = definition } },
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
  },
}
installClock()
const ui = createRenderer()
const { React } = ui

const clientPath = fileURLToPath(new URL('../lib/client.js', import.meta.url))
await import(clientPath + '?forks-ui=' + Date.now())
const mod = captured.factory((name) => { if (name === 'react') return React; throw new Error('unexpected require: ' + name) })

let registered = null
mod.apply({
  get: (service) => (service === 'locale'
    ? { register: () => () => {}, bind: () => (key) => key }
    : { inject: (_slot, factory) => factory(), register: (options, component) => { registered = component; return () => {} } }),
  effect: (fn) => { fn(); return () => {} },
})

const CATALOG = [
  { full_name: 'acme/trader', owner: 'acme', html_url: 'https://github.com/acme/trader', description: 'trader', stargazers: 42, forks: 3, default_branch: 'main', topics: ['dsh'], pushed_at: '2026-01-01T00:00:00Z' },
  { full_name: 'acme/lonely', owner: 'acme', html_url: 'https://github.com/acme/lonely', description: 'no forks', stargazers: 1, forks: 0, default_branch: 'main', topics: ['dsh'], pushed_at: '2026-01-01T00:00:00Z' },
]
const FORKS = [
  { full_name: 'bob/trader', owner: 'bob', owner_avatar: null, html_url: 'https://github.com/bob/trader', description: 'patched trader', stargazers: 5, forks: 0, default_branch: 'main', pushed_at: '2026-05-01T00:00:00Z', archived: false },
]

const calls = { forks: [], install: [], catalog: 0 }
let plugins = []
const api = {
  lang: () => 'en',
  state: () => Promise.resolve({ plugins, profile: 'web' }),
  catalog: () => { calls.catalog += 1; return Promise.resolve({ ok: true, items: CATALOG, total: 2, allCount: 2, tags: [{ tag: 'dsh', count: 2 }], refreshing: false }) },
  refresh: () => Promise.resolve({ ok: true }),
  forks: (repo, force) => { calls.forks.push([repo, !!force]); return Promise.resolve({ ok: true, items: FORKS, stale: false }) },
  install: (repo) => { calls.install.push(repo); plugins = [{ name: 'trader', spec: 'github:' + repo, repo }]; return Promise.resolve({ ok: true }) },
  uninstall: () => Promise.resolve({ ok: true }),
}
ui.setComponent(registered, { t: (key) => key, api })

const dialog = () => ui.findAll((n) => n.props && n.props.role === 'dialog')[0] || null
function within(node, predicate) {
  const out = []
  ui.walk((n) => { if (predicate(n)) out.push(n) }, node)
  return out
}
const forkButtons = () => ui.findAll((n) => n.type === 'button' && n.props.title === 'forksHint')

ui.mount()
await flush()
assert.equal(calls.catalog, 1)

// 1. Only the repo that has forks gets a clickable count; both counts render.
assert.equal(forkButtons().length, 1, 'a repo with zero forks is not clickable')
assert.ok(ui.findByText('3'), 'the fork count is rendered on the card')
assert.equal(dialog(), null, 'no dialog before the count is clicked')

// 2. Clicking it fetches that repo's forks and opens the browser.
forkButtons()[0].props.onClick()
await flush()
assert.deepEqual(calls.forks, [['acme/trader', false]])
const open = dialog()
assert.ok(open, 'fork dialog is open')
assert.ok(within(open, (n) => n.children.includes('bob/trader')).length, 'the fork is listed')
assert.ok(within(open, (n) => n.children.includes('forksOf acme/trader')).length, 'dialog is titled with the parent repo')

// 3. Each fork links to a compare against the parent's default branch.
const compare = within(dialog(), (n) => n.type === 'a' && n.props.title === 'compare')[0]
assert.ok(compare, 'compare link is present')
assert.equal(compare.props.href, 'https://github.com/acme/trader/compare/main...bob:main')

// 4. Installing from the dialog installs the fork, not the upstream repo.
const installBtn = within(dialog(), (n) => n.type === 'button' && n.props.title === 'installHint')[0]
assert.ok(installBtn, 'the fork row offers Install')
installBtn.props.onClick()
await flush()
assert.deepEqual(calls.install, ['bob/trader'], 'install targets the fork')
assert.ok(
  within(dialog(), (n) => n.children.includes('installedOk')).length,
  'the install result is reported inside the dialog, not hidden behind it',
)

// 5. Close, then reopen: the cached listing renders without another request.
within(dialog(), (n) => n.type === 'button' && n.props.title === 'close')[0].props.onClick()
await flush()
assert.equal(dialog(), null, 'dialog closed')
forkButtons()[0].props.onClick()
await flush()
assert.equal(calls.forks.length, 1, 'reopening reuses the cached fork listing')
assert.ok(within(dialog(), (n) => n.children.includes('bob/trader')).length, 'cached fork still listed')

// 6. Refresh inside the dialog forces a fresh fetch.
within(dialog(), (n) => n.type === 'button' && n.props.title === 'refresh')[0].props.onClick()
await flush()
assert.deepEqual(calls.forks[1], ['acme/trader', true], 'Refresh bypasses the cache')

// 7. Nothing about the fork browser puts the catalog on a timer.
await advance(120000)
assert.equal(calls.catalog, 1, 'the catalog is not re-read while browsing forks')

// 8. When the upstream is the installed one, the fork says what it replaces.
plugins = [{ name: 'trader', spec: 'github:acme/trader', repo: 'acme/trader' }]
ui.unmount()
ui.mount()
await flush()
forkButtons()[0].props.onClick()
await flush()
assert.ok(
  within(dialog(), (n) => n.children.includes('replaces acme/trader')).length,
  'a fork that would replace the installed upstream says so',
)

console.log('forks UI: fork count opens a browsable, installable fork list')
