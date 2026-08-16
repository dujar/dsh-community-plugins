import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Capture the bundle definition the client registers with the ModuleLoader.
let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load: (definition) => { captured = definition },
  },
}

const clientPath = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const code = readFileSync(clientPath, 'utf8')

// Execute the client bundle as a script (ESM has no exports; it only calls
// window.__ModuleLoader__.load at the top level).
await import(clientPath + '?smoke=' + Date.now())

assert.ok(captured, 'client registered a bundle')
assert.equal(captured.id, 'dsh-community-plugins')

// Invoke the factory with a minimal React + no other module dependencies.
const fakeReact = { createElement: () => ({}) }
const mod = captured.factory((moduleName) => {
  if (moduleName === 'react') return fakeReact
  throw new Error('unexpected require: ' + moduleName)
})

assert.equal(mod.name, 'dsh-community-plugins')
assert.deepEqual(mod.inject, ['slots', 'locale'])
assert.equal(typeof mod.apply, 'function')

// Apply against fake locale/slots services and verify the slot wiring.
let registeredNamespace = null
let boundNamespace = null
let injectedSlot = null
let registeredOptions = null
let registeredComponent = null

const locale = {
  register: (ns, dict) => { registeredNamespace = ns; assert.equal(typeof dict.en, 'object'); assert.equal(typeof dict.zh, 'object') },
  bind: (ns) => { boundNamespace = ns; return (key) => key },
}
const slots = {
  inject: (slot, factory) => {
    injectedSlot = slot
    return factory() // returns the disposer from slots.register
  },
  register: (options, component) => {
    registeredOptions = options
    registeredComponent = component
    return () => {}
  },
}
const ctx = {
  get: (service) => (service === 'locale' ? locale : service === 'slots' ? slots : undefined),
  effect: (fn) => { fn(); return () => {} },
}

mod.apply(ctx)

assert.equal(registeredNamespace, 'community.plugins')
assert.equal(boundNamespace, 'community.plugins')
assert.equal(injectedSlot, 'settings.plugins.tab')
assert.equal(registeredOptions.name, 'settings.plugins.tab')
assert.equal(registeredOptions.id, 'community')
assert.equal(registeredOptions.order, 20)
assert.equal(registeredOptions.locale, 'community.plugins')
assert.equal(typeof registeredOptions.label, 'function')
assert.equal(typeof registeredOptions.inject, 'function')
assert.equal(typeof registeredComponent, 'function')
assert.equal(typeof registeredOptions.inject(), 'object')

console.log('client smoke: tab registered into settings.plugins.tab (id=community)')
