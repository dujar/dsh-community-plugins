// Browse opens a host-backed folder picker, not a file-upload dialog.
//
// The browser cannot hand back an absolute path from a folder chooser without
// routing the selection through an upload prompt, so the picker walks the disk
// through /community-plugins/browse instead. These assertions pin that: the
// path the user lands on reaches the input, and no <input type=file> is ever
// constructed to get it.
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { installClock, flush, createRenderer } from './mini-react.mjs'

const store = new Map()
let captured = null
globalThis.window = {
  __ModuleLoader__: { load: (definition) => { captured = definition } },
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
  },
}
// The module injects one <style> at load; anything else built out of band —
// specifically an <input type=file> — is the upload dialog coming back.
globalThis.document = {
  querySelector: () => null,
  head: { appendChild: () => {} },
  createElement: (tag) => {
    if (tag !== 'style') throw new Error('picker must not build a <' + tag + '> element')
    return { setAttribute: () => {}, appendChild: () => {}, style: {}, textContent: '' }
  },
  body: { appendChild: () => { throw new Error('picker must not attach elements to the page') }, removeChild: () => {} },
}
installClock()
const ui = createRenderer()
const { React } = ui

const clientPath = fileURLToPath(new URL('../lib/client.js', import.meta.url))
await import(clientPath + '?picker-ui=' + Date.now())
const mod = captured.factory((name) => { if (name === 'react') return React; throw new Error('unexpected require: ' + name) })

let registered = null
mod.apply({
  get: (service) => (service === 'locale'
    ? { register: () => () => {}, bind: () => (key) => key }
    : { inject: (_slot, factory) => factory(), register: (options, component) => { registered = component; return () => {} } }),
  effect: (fn) => { fn(); return () => {} },
})

// A small fake disk. '' means "start at home", the way the host resolves it.
const HOME = '/home/u'
const TREE = {
  [HOME]: { parent: '/', entries: [{ name: 'dev', path: '/home/u/dev', plugin: false }, { name: 'notes', path: '/home/u/notes', plugin: false }], self: false },
  '/home/u/dev': { parent: HOME, entries: [{ name: 'my-plugin', path: '/home/u/dev/my-plugin', plugin: true }, { name: 'scratch', path: '/home/u/dev/scratch', plugin: false }], self: false },
  '/home/u/dev/my-plugin': { parent: '/home/u/dev', entries: [{ name: 'lib', path: '/home/u/dev/my-plugin/lib', plugin: false }], self: true },
}
const HIDDEN = { name: '.config', path: '/home/u/.config', plugin: false }

const calls = { browse: [] }
const api = {
  lang: () => 'en',
  state: () => Promise.resolve({ plugins: [], profile: 'web' }),
  catalog: () => Promise.resolve({ ok: true, items: [], total: 0, allCount: 0, tags: [], refreshing: false }),
  refresh: () => Promise.resolve({ ok: true }),
  forks: () => Promise.resolve({ ok: true, items: [], stale: false }),
  install: () => Promise.resolve({ ok: true }),
  uninstall: () => Promise.resolve({ ok: true }),
  validate: () => Promise.resolve({ ok: true, installable: true }),
  installLocal: () => Promise.resolve({ ok: true }),
  browse: (path, hidden) => {
    calls.browse.push([path, !!hidden])
    const at = path === '' ? HOME : path
    const node = TREE[at]
    if (!node) return Promise.resolve({ ok: false, entries: [], reason: 'no such directory', path: at })
    const entries = hidden && at === HOME ? [HIDDEN].concat(node.entries) : node.entries
    return Promise.resolve({
      ok: true, path: at, parent: node.parent, entries, truncated: false,
      home: HOME, self: { installable: node.self, name: node.self ? 'my-plugin' : null },
    })
  },
}
ui.setComponent(registered, { t: (key) => key, api })

const dialog = () => ui.findAll((n) => n.props && n.props.role === 'dialog')[0] || null
function within(node, predicate) {
  const out = []
  ui.walk((n) => { if (predicate(n)) out.push(n) }, node)
  return out
}
const browseBtn = () => ui.findAll((n) => n.type === 'button' && n.children.includes('browse'))[0]
const pathInput = () => ui.findAll((n) => n.type === 'input' && n.props.type === 'text')[0]
const row = (name) => within(dialog(), (n) => n.props && n.props.role === 'button' && within(n, (c) => c.children.includes(name)).length)[0]
const byLabel = (label) => within(dialog(), (n) => n.type === 'button' && n.children.some((c) => typeof c === 'string' && c.includes(label)))[0]

ui.mount()
await flush()

// 1. The tab offers Browse, and nothing is read from disk until it is clicked.
assert.ok(browseBtn(), 'the local panel has a Browse button')
assert.equal(dialog(), null, 'no picker before Browse is clicked')
assert.deepEqual(calls.browse, [], 'the picker does not read the disk until opened')

// 2. Clicking Browse opens the picker and lists the home directory. An empty
//    input means "start at home" — the host, not the client, decides where.
browseBtn().props.onClick()
await flush()
assert.deepEqual(calls.browse, [['', false]])
assert.ok(dialog(), 'the folder picker is open')
assert.ok(within(dialog(), (n) => n.children.includes('dev')).length, 'subfolders are listed')

// 3. Folders holding a DSH manifest are marked before they are opened, so the
//    right one is findable without walking into each candidate.
row('dev').props.onClick()
await flush()
assert.deepEqual(calls.browse[1], ['/home/u/dev', false])
assert.ok(within(dialog(), (n) => n.children.includes('pickPlugin')).length, 'a plugin folder is badged')
assert.equal(
  within(dialog(), (n) => n.children.includes('pickPlugin')).length, 1,
  'only the folder that is a plugin is badged',
)

// 4. Up walks back toward the root.
byLabel('pickUp').props.onClick()
await flush()
assert.deepEqual(calls.browse[2], [HOME, false])

// 5. Hidden directories are opt-in and refetch rather than filter client-side,
//    since the host is the one that decides what to skip.
const hiddenToggle = within(dialog(), (n) => n.type === 'input' && n.props.type === 'checkbox')[0]
hiddenToggle.props.onChange({ target: { checked: true } })
await flush()
assert.deepEqual(calls.browse[3], [HOME, true])
assert.ok(within(dialog(), (n) => n.children.includes('.config')).length, 'hidden folders appear once enabled')

// 6. A marked plugin's Select takes that path without opening it first.
row('dev').props.onClick()
await flush()
let stopped = false
byLabel('pickSelect').props.onClick({ stopPropagation: () => { stopped = true } })
await flush()
assert.ok(stopped, 'selecting a row does not also navigate into it')
assert.equal(dialog(), null, 'picking closes the picker')
assert.equal(pathInput().props.value, '/home/u/dev/my-plugin', 'the absolute path lands in the input')

// 7. Reopening resumes from the chosen path rather than starting over at home,
//    and keeps the hidden toggle — it was turned on to find something.
browseBtn().props.onClick()
await flush()
assert.deepEqual(calls.browse[calls.browse.length - 1], ['/home/u/dev/my-plugin', true])

// 8. "Select this folder" takes the directory currently being listed.
byLabel('pickHere').props.onClick()
await flush()
assert.equal(pathInput().props.value, '/home/u/dev/my-plugin')

// 9. An unreadable path reports the host's reason instead of an empty list.
TREE['/home/u/gone'] = undefined
ui.findAll((n) => n.type === 'input' && n.props.type === 'text')[0].props.onChange({ target: { value: '/home/u/gone' } })
await flush()
browseBtn().props.onClick()
await flush()
assert.ok(within(dialog(), (n) => n.children.includes('no such directory')).length, 'the failure reason is shown')

console.log('folder picker: Browse walks the disk through the host and returns an absolute path')
