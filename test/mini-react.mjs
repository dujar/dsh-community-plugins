// A tiny React stand-in plus a fake clock, shared by the client tests.
//
// The client bundle is hand-written React with no build step, so its behaviour
// (which effects run, when a fetch is issued) can be exercised directly with a
// hook-compatible stub: useState/useRef/useEffect over a single component, a
// synchronous re-render on setState, and a controllable timer queue.

const realTimeout = globalThis.setTimeout

const clock = { now: 0, seq: 0, timers: [], intervals: 0 }

export function installClock() {
  clock.now = 0
  clock.seq = 0
  clock.timers = []
  clock.intervals = 0
  globalThis.setTimeout = (fn, ms) => {
    const id = ++clock.seq
    clock.timers.push({ id, at: clock.now + (ms || 0), fn })
    return id
  }
  globalThis.clearTimeout = (id) => { clock.timers = clock.timers.filter((tm) => tm.id !== id) }
  globalThis.setInterval = () => { clock.intervals += 1; return ++clock.seq }
  globalThis.clearInterval = () => {}
}

/** Let queued promise callbacks run (real macrotask turn). */
export const flush = () => new Promise((resolve) => realTimeout(resolve, 0))

/** Run every timer due within `ms`, flushing promises between each. */
export async function advance(ms) {
  const target = clock.now + ms
  for (;;) {
    const due = clock.timers.filter((tm) => tm.at <= target).sort((a, b) => a.at - b.at)[0]
    if (!due) break
    clock.timers = clock.timers.filter((tm) => tm !== due)
    clock.now = due.at
    due.fn()
    await flush()
  }
  clock.now = target
  await flush()
}

/** How many setInterval timers the component has installed. */
export const intervalCount = () => clock.intervals

export function createRenderer() {
  let host = null
  let Component = null
  let props = null

  const newHost = () => ({ hooks: [], idx: 0, pending: [], rendering: false, dirty: false, tree: null })

  const React = {
    createElement: (type, elProps, ...children) => ({
      type,
      props: elProps || {},
      children: children.flat(9).filter((c) => c !== null && c !== undefined && c !== false),
    }),
    useState(init) {
      const i = host.idx++
      if (!host.hooks[i]) host.hooks[i] = { value: typeof init === 'function' ? init() : init }
      const slot = host.hooks[i]
      return [slot.value, (v) => { slot.value = typeof v === 'function' ? v(slot.value) : v; render() }]
    },
    useRef(init) {
      const i = host.idx++
      if (!host.hooks[i]) host.hooks[i] = { current: init }
      return host.hooks[i]
    },
    useEffect(fn, deps) {
      const i = host.idx++
      const prev = host.hooks[i]
      const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length
        || deps.some((d, k) => !Object.is(d, prev.deps[k]))
      if (!prev) host.hooks[i] = { deps, cleanup: null }
      host.hooks[i].deps = deps
      if (changed) host.pending.push({ i, fn })
    },
  }

  function render() {
    if (host.rendering) { host.dirty = true; return }
    host.rendering = true
    do {
      host.dirty = false
      host.idx = 0
      host.pending = []
      host.tree = Component(props)
      for (const { i, fn } of host.pending) {
        const slot = host.hooks[i]
        if (typeof slot.cleanup === 'function') slot.cleanup()
        const out = fn()
        slot.cleanup = typeof out === 'function' ? out : null
      }
    } while (host.dirty)
    host.rendering = false
  }

  function walk(visit, node) {
    const start = node === undefined ? host.tree : node
    if (!start || typeof start !== 'object') return
    // Child components are rendered eagerly so the whole tree is inspectable.
    // They render against a throwaway hook store, so inspecting the tree never
    // disturbs the mounted component's own hooks or effects.
    if (typeof start.type === 'function') {
      const saved = host
      host = newHost()
      let rendered = null
      try {
        rendered = start.type({ ...start.props, children: start.children })
      } catch { rendered = null }
      host = saved
      walk(visit, rendered)
      return
    }
    visit(start)
    for (const child of start.children || []) walk(visit, child)
  }

  function findAll(predicate) {
    const out = []
    walk((n) => { if (predicate(n)) out.push(n) })
    return out
  }

  return {
    React,
    setComponent(component, componentProps) { Component = component; props = componentProps },
    mount() { host = newHost(); render() },
    unmount() { for (const slot of host.hooks) if (slot && typeof slot.cleanup === 'function') slot.cleanup() },
    rerender: render,
    walk,
    findAll,
    findByText: (text) => findAll((n) => n.children.includes(text))[0] || null,
    findInput: (placeholder) => findAll((n) => n.type === 'input' && n.props.placeholder === placeholder)[0] || null,
  }
}
