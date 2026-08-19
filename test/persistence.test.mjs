// The community tab must not reload on its own: results survive a tab switch
// (module-level cache) and only a filter edit or Refresh hits the catalog.
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { installClock, advance, flush, intervalCount, createRenderer } from './mini-react.mjs'

// ---- fake browser ----
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
const mount = () => ui.mount()
const unmount = () => ui.unmount()
const findByText = (text) => ui.findByText(text)
const searchInput = () => ui.findInput('searchPlaceholder')
const buttonsByText = (text) => ui.findAll((n) => n.type === 'button' && n.children.includes(text))
const findChip = (label) => ui.findAll((n) => n.type === 'button' && (n.props.title === label || n.props.title === label + 'filterLocalHint'))[0] || ui.findAll((n) => n.type === 'button' && n.props.title === label)[0] || null
const refreshButton = () => buttonsByText('refresh')[0]

// ---- load the client bundle and grab the tab component ----
const clientPath = fileURLToPath(new URL('../lib/client.js', import.meta.url))
await import(clientPath + '?persistence=' + Date.now())
const mod = captured.factory((name) => { if (name === 'react') return React; throw new Error('unexpected require: ' + name) })

let registered = null
const ctx = {
  get: (service) => (service === 'locale'
    ? { register: () => () => {}, bind: () => (key) => key }
    : { inject: (_slot, factory) => factory(), register: (options, component) => { registered = component; return () => {} } }),
  effect: (fn) => { fn(); return () => {} },
}
mod.apply(ctx)
const Component = registered

// ---- fake host API ----
const calls = { catalog: [], refresh: [], state: 0, uninstall: [] }
let refreshingFlag = false
let installedPlugins = []
const api = {
  lang: () => 'en',
  state: () => { calls.state += 1; return Promise.resolve({ plugins: installedPlugins, profile: 'web' }) },
  catalog: (qs) => {
    calls.catalog.push(qs)
    const local = qs.indexOf('filter=local') !== -1
    return Promise.resolve({
      ok: true, refreshing: refreshingFlag,
      items: local
        ? [{ local: true, name: 'my-local-plugin', spec: 'file:../my-local-plugin', repo: null, enabled: true, version: '1.4.2', author: 'me', description: 'Does local things', readme: '# Hello World\n\n**Bold** and `code`. [bad](javascript:alert(1)) <script>x</script>' }]
        : [{ full_name: 'owner/repo', owner: 'owner', stargazers: 3, forks: 0, topics: ['dsh'], description: 'x', pushed_at: '2026-01-01T00:00:00Z' }],
      total: 1, allCount: 1, tags: local ? [] : [{ tag: 'dsh', count: 1 }],
      counts: { all: 1, installed: installedPlugins.length ? 1 : 0, local: 1 },
    })
  },
  refresh: (q) => { calls.refresh.push(q); return Promise.resolve({ ok: true, refreshing: true }) },
  install: () => Promise.resolve({ ok: true }),
  uninstall: (body) => { calls.uninstall.push(body); return Promise.resolve({ ok: true }) },
}
ui.setComponent(Component, { t: (key) => key, api })

// 1. First mount fetches once, with no polling timer.
mount()
await flush()
assert.equal(calls.catalog.length, 1, 'one catalog read on first mount')
assert.equal(intervalCount(), 0, 'no setInterval polling')
assert.equal(calls.refresh.length, 0, 'mount does not hit GitHub')

// 2. Sitting idle never re-reads the catalog.
await advance(120000)
assert.equal(calls.catalog.length, 1, 'idle tab does not re-fetch')

// 3. Editing the search box refetches (debounced) and asks for a GitHub refresh.
searchInput().props.onChange({ target: { value: 'trader' } })
await flush()
assert.equal(calls.catalog.length, 1, 'still debouncing at 0ms')
await advance(400)
assert.equal(calls.catalog.length, 2, 'filter edit re-reads the catalog')
assert.match(calls.catalog[1], /q=trader/)
await advance(1000)
assert.deepEqual(calls.refresh, ['trader'], 'query change schedules a GitHub refresh')

// 4. The follow-up poll runs only while the host reports refreshing, then stops.
refreshingFlag = true
await advance(2000)
const duringRefresh = calls.catalog.length
assert.ok(duringRefresh > 2, 'polls once the refresh is in flight')
refreshingFlag = false
await advance(3000)
const settled = calls.catalog.length
await advance(120000)
assert.equal(calls.catalog.length, settled, 'poll stops when the host finishes refreshing')

// 5. Switching away and back restores the search without re-fetching.
unmount()
await advance(5000)
const beforeRemount = calls.catalog.length
mount()
await advance(30000)
assert.equal(calls.catalog.length, beforeRemount, 'remount reuses the cached results')
assert.equal(searchInput().props.value, 'trader', 'search text survives the tab switch')
assert.ok(findByText('1 results'), 'cached result count is rendered on remount')

// 6. Clear filters resets everything and refetches unfiltered.
const clear = findByText('clearFilters')
assert.ok(clear, 'clear filters button shows while a filter is active')
clear.props.onClick()
await advance(400)
assert.equal(searchInput().props.value, '', 'query cleared')
assert.ok(!/q=/.test(calls.catalog[calls.catalog.length - 1]), 'refetch drops the query')
assert.ok(!findByText('clearFilters'), 'button hides once nothing is filtered')
assert.equal(JSON.parse(store.get('dsh-community-plugins:filters')).query, '', 'cleared filters persist')

// 7. An already-installed plugin is shown as installed; one that is installed
// but missing from dsh.profile.bundles is flagged as not enabled. Refresh is
// what picks up a change made with the dsh CLI while the tab is open.
assert.ok(!findByText('✓ installed'), 'nothing is marked installed yet')
installedPlugins = [{ name: 'repo', spec: 'github:owner/repo', repo: 'owner/repo', enabled: true }]
const stateReads = calls.state
refreshButton().props.onClick()
await advance(3000)
assert.ok(calls.state > stateReads, 'Refresh re-reads the installed set')
assert.ok(findByText('✓ installed'), 'an already-installed plugin shows the Installed badge')
assert.ok(!findByText('notEnabled'), 'an enabled plugin carries no extra badge')

installedPlugins = [{ name: 'repo', spec: 'github:owner/repo', repo: 'owner/repo', enabled: false }]
refreshButton().props.onClick()
await advance(3000)
assert.ok(findByText('✓ installed'), 'still reported as installed')
assert.ok(findByText('notEnabled'), 'installed but unmounted plugins are flagged')

// 8. The status filter row is rendered with counts, and switching filter
// re-reads the catalog with filter= installed / local (no GitHub refresh).
installedPlugins = [{ name: 'repo', spec: 'github:owner/repo', repo: 'owner/repo', enabled: true }]
const beforeChip = calls.catalog.length
const refreshesBeforeChip = calls.refresh.length
findChip('filterInstalled').props.onClick()
await advance(400)
assert.equal(calls.catalog.length, beforeChip + 1, 'switching to Installed re-reads the catalog')
assert.match(calls.catalog[calls.catalog.length - 1], /filter=installed/, 'the request carries the filter')
assert.equal(calls.refresh.length, refreshesBeforeChip, 'filter switches never ask GitHub for a refresh')
const chip = findChip('filterInstalled')
assert.ok(chip, 'the installed chip is present')
// The chip renders label + count; count is a React text child (string) or a span.
const chipText = chip.children.map((c) => (typeof c === 'string' ? c : c && c.children && c.children.join(''))).join('')
assert.ok(chipText.indexOf('1') !== -1, 'the installed chip shows its count: ' + JSON.stringify(chipText))

// 9. Clear filters returns to All.
findByText('clearFilters').props.onClick()
await advance(400)
assert.match(calls.catalog[calls.catalog.length - 1], /filter=all/, 'clear filters resets to All')

// 10. Local only lists installed plugins the catalog does not know, with
// removal by package name — and no GitHub refresh from typing there.
const localChip = ui.findAll((n) => n.type === 'button' && n.props && (n.props.title === 'filterLocalHint' || n.props.title === 'filterLocal'))[0]
assert.ok(localChip, 'the Local chip is rendered')
localChip.props.onClick()
await advance(400)
assert.match(calls.catalog[calls.catalog.length - 1], /filter=local/, 'Local chip fetches the local list')
assert.ok(findByText('my-local-plugin'), 'the local plugin is listed')
assert.ok(findByText('Does local things'), 'the manifest description tells what it is about')
assert.ok(findByText('v1.4.2'), 'the version is shown')
assert.ok(findByText('me'), 'the author is shown')
assert.ok(findByText('localNote'), 'the local note explains the entry')

// 11b. The README is showcased directly, rendered from markdown.
assert.ok(findByText('Hello World'), 'the README heading renders')
assert.ok(findByText('Bold'), 'bold renders as content')
assert.ok(findByText('code'), 'inline code renders as content')
assert.ok(!findByText('# Hello World'), 'raw heading syntax is not shown')
assert.ok(!findByText('readmeTruncated'), 'no truncation note for a short README')
// hostile content from a package README never becomes markup
assert.ok(!ui.findAll((n) => n.type === 'script').length, 'script tags are not created')
assert.ok(!ui.findAll((n) => n.type === 'a' && String(n.props.href).indexOf('javascript:') !== -1).length, 'javascript: links are not made clickable')
const refBeforeLocal = calls.refresh.length
findByText('uninstall').props.onClick()
await flush()
assert.ok(calls.uninstall.some((u) => u && u.name === 'my-local-plugin'), 'removal goes by package name')
assert.equal(calls.refresh.length, refBeforeLocal, 'local removal never asks GitHub')

// 11. Switching back to All re-reads the catalog; a local item does not leak
// into the community list.
ui.findAll((n) => n.type === 'button' && n.props && n.props.title === 'filterAll')[0].props.onClick()
await advance(400)
assert.match(calls.catalog[calls.catalog.length - 1], /filter=all/, 'back to All')
assert.ok(!findByText('my-local-plugin'), 'local items do not leak into the catalog view')

console.log('persistence: cached results survive remounts; only filter edits refetch')
