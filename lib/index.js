/**
 * dsh-community-plugins host half.
 *
 * Adds a "Community plugins" tab to the DeepSeek Harness web GUI's Plugins
 * settings section. This half owns three concerns:
 *
 * 1. A local SQLite catalog (node:sqlite) of GitHub dsh-plugin repos, stored
 *    at $DSH_HOME/dsh-community-plugins/catalog.db. The catalog is the
 *    browser's read model: it serves list/grid/table views and tag
 *    aggregation without round-tripping GitHub on every keystroke.
 * 2. A background refresh worker that fetches the topic from the GitHub
 *    search API (top by stars and by updated at boot, plus whatever the user
 *    searches) and upserts the results into the catalog. Fetches are
 *    rate-limited and coalesced, and a 403/429 backs off until the reset
 *    time GitHub reports.
 * 3. Install/uninstall routes that run the real "dsh plugin" command in the
 *    profile that mounted this plugin.
 *
 *   GET  /community-plugins/catalog    -> { items, total, tags, refreshing, refreshedAt }
 *   POST /community-plugins/refresh    -> body { q } ; schedules a background fetch
 *   GET  /community-plugins/state      -> { profile, plugins: [{name,spec,repo}] }
 *   POST /community-plugins/install    -> body { repo: "owner/name" }
 *   POST /community-plugins/uninstall  -> body { repo: "owner/name" }
 *
 * The profile is auto-detected as the one whose bundle list contains this
 * package; DSH_COMMUNITY_PROFILE (then DSH_PROFILE) overrides, and "web" is
 * the last-resort default. The dsh binary is resolved from DSH_BIN when set,
 * otherwise from PATH. DSH_COMMUNITY_INCLUDE_FORKS (any non-empty value)
 * includes GitHub forks in the catalog; forks are excluded by default.
 *
 * Routes are guarded by the same fail-closed same-origin/localhost trust
 * check as dsh-trader: a cross-origin or malformed Origin/Referer rejects,
 * a CORS-simple content type rejects, and only then does a localhost Host
 * count as trusted.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, open, readdir, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'

export const name = 'community-plugins'

/** Package name used to detect which profile mounted this plugin. */
const NAME = 'dsh-community-plugins'

/** Host services required before mounting. */
export const inject = ['webServer']

/** Hard ceiling for one install/uninstall invocation (env-overridable). */
const RUN_TIMEOUT_MS = (() => {
  const value = Number(process.env.DSH_COMMUNITY_INSTALL_TIMEOUT_MS)
  return Number.isFinite(value) && value > 0 ? value : 5 * 60 * 1000
})()
/** Tail of process output returned to the browser, in bytes. */
const OUTPUT_TAIL = 8192

/** Minimum wall-clock gap between GitHub fetches (stays under the 10/min limit). */
const MIN_FETCH_INTERVAL_MS = (() => {
  const value = Number(process.env.DSH_COMMUNITY_MIN_FETCH_INTERVAL_MS)
  return Number.isFinite(value) && value >= 0 ? value : 6000
})()
/** Results fetched per seed page (stars / updated) at boot. */
const SEED_PER_PAGE = 100
/** Results fetched per on-demand search refresh. */
const SEARCH_PER_PAGE = 50
/** SQLite catalog schema version; bump to recreate the derived cache on incompatible changes. */
const SCHEMA_VERSION = 2

// ---------------------------------------------------------------------------
// Repo / profile helpers
// ---------------------------------------------------------------------------

/** Resolve the harness home the way dsh-home-paths does: $DSH_HOME, else ~/.dsh. */
export function dshHome() {
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim() !== '') return env
  return join(homedir(), '.dsh')
}

/** Strict owner/name repository reference. */
export function isValidRepo(repo) {
  return typeof repo === 'string'
    && repo.length <= 200
    && /^[A-Za-z0-9][A-Za-z0-9_.-]*[/][A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repo)
}

/** The trailing path segment of an owner/name reference. */
export function repoSlug(repo) {
  const idx = String(repo).indexOf('/')
  return idx === -1 ? String(repo) : String(repo).slice(idx + 1)
}

/**
 * Extract an "owner/name" GitHub reference from a package spec, or null when
 * the spec is not a GitHub repo (registry names, versions, file:/link:/npm:
 * specs, and workspace refs all yield null).
 */
export function repoFromSpec(spec) {
  if (typeof spec !== 'string') return null
  const s = spec.trim()
  if (s === '') return null
  let m
  if ((m = /^github:([^#/]+[/][^#/]+)/.exec(s))) return m[1]
  if ((m = /^(?:git[+]|git:)?(?:(?:https?:[/][/]|ssh:[/][/])[^@/]*@?|git@)github[.]com[:/]([^/.#]+)[/]([^/.#]+)/.exec(s))) return m[1] + '/' + m[2]
  if ((m = /^https?:[/][/]github[.]com[/]([^/.#]+)[/]([^/.#]+?)(?:[.]git)?(?:#.*)?$/.exec(s))) return m[1] + '/' + m[2]
  if (!/^[a-z][a-z0-9+.-]*:/.test(s) && !s.startsWith('/') && !s.startsWith('.') && !s.startsWith('~')) {
    const bare = s.split('#')[0]
    if ((m = /^([A-Za-z0-9_.-]+)[/]([A-Za-z0-9_.-]+?)(?:[.]git)?$/.exec(bare))) return m[1] + '/' + m[2]
  }
  return null
}

/** Read and parse a profile's package.json, or null when unavailable. */
async function readProfileManifest(profile) {
  try {
    const raw = await readFile(join(dshHome(), 'profiles', profile, 'package.json'), 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Find the profile whose bundle list includes this plugin; null when none does. */
async function detectProfile() {
  let names = []
  try {
    names = await readdir(join(dshHome(), 'profiles'))
  } catch {
    return null
  }
  for (const candidate of names) {
    if (candidate.startsWith('.')) continue
    const manifest = await readProfileManifest(candidate)
    const bundles = manifest?.dsh?.profile?.bundles
    if (Array.isArray(bundles) && bundles.includes(NAME)) return candidate
  }
  return null
}

/** Resolve the profile this plugin is mounted in. */
async function resolveProfile() {
  const explicit = process.env.DSH_COMMUNITY_PROFILE || process.env.DSH_PROFILE
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim()
  const detected = await detectProfile()
  return detected || 'web'
}

/**
 * The installed out-of-tree plugins of one profile, as the union of the
 * non-shipped dsh.profile.bundles entries and the dependency manifest.
 */
async function collectInstalled(profile) {
  const manifest = await readProfileManifest(profile)
  const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
  const deps = manifest !== null && typeof manifest.dependencies === 'object' && manifest.dependencies !== null
    ? manifest.dependencies
    : {}
  const plugins = []
  const seen = new Set()
  for (const name of bundles) {
    if (name.startsWith('@deepseek-ai/') || name.startsWith('cordis:') || name.startsWith('cordis-plugin-')) continue
    seen.add(name)
    const spec = deps[name] ?? null
    plugins.push({ name, spec, repo: repoFromSpec(spec) })
  }
  for (const [name, spec] of Object.entries(deps)) {
    if (seen.has(name)) continue
    seen.add(name)
    plugins.push({ name, spec, repo: repoFromSpec(spec) })
  }
  return plugins
}

/**
 * Run "dsh plugin --profile <profile> <args...>", capturing a bounded tail
 * of its output. Resolves with { ok, code, output, error }.
 */
function runDshPlugin(profile, args) {
  return new Promise((resolve) => {
    const envBin = process.env.DSH_BIN
    const bin = typeof envBin === 'string' && envBin.trim() !== '' ? envBin.trim() : 'dsh'
    let child
    try {
      child = spawn(bin, ['plugin', '--profile', profile, ...args], {
        cwd: dshHome(),
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        env: process.env,
      })
    } catch (error) {
      resolve({ ok: false, code: null, output: '', error: String(error && error.message ? error.message : error) })
      return
    }
    let stdout = ''
    let stderr = ''
    const cap = (current, chunk) => {
      const next = current + chunk
      return next.length > OUTPUT_TAIL ? next.slice(next.length - OUTPUT_TAIL) : next
    }
    let settled = false
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* already gone */ }
      finish({ ok: false, code: null, output: (stdout + stderr).slice(-OUTPUT_TAIL), error: 'timed out after ' + (RUN_TIMEOUT_MS / 60000) + ' minutes' })
    }, RUN_TIMEOUT_MS)
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    child.stdout?.on('data', (chunk) => { stdout = cap(stdout, chunk.toString()) })
    child.stderr?.on('data', (chunk) => { stderr = cap(stderr, chunk.toString()) })
    child.on('error', (error) => {
      finish({
        ok: false,
        code: null,
        output: (stdout + stderr).slice(-OUTPUT_TAIL),
        error: error && error.code === 'ENOENT'
          ? 'dsh not found on PATH — set DSH_BIN to its full path'
          : String(error && error.message ? error.message : error),
      })
    })
    child.on('close', (code) => {
      finish({
        ok: code === 0,
        code: code ?? null,
        output: (stdout + stderr).slice(-OUTPUT_TAIL),
        error: code === 0 ? undefined : ('dsh plugin exited with code ' + (code ?? 'null')),
      })
    })
  })
}

// ---------------------------------------------------------------------------
// SQLite catalog
// ---------------------------------------------------------------------------

let dbPromise = null

function getDb() {
  if (dbPromise === null) dbPromise = openCatalog()
  return dbPromise
}

function ensureSchema(db) {
  const { user_version } = db.prepare('PRAGMA user_version').get()
  if (user_version !== SCHEMA_VERSION) {
    // Derived cache: recreate rather than migrate. Renames keep the same GitHub
    // id, so the table is keyed on id (full_name is mutable display data).
    db.exec('DROP TABLE IF EXISTS repos')
    db.exec('PRAGMA user_version = ' + SCHEMA_VERSION)
  }
  db.exec("CREATE TABLE IF NOT EXISTS repos (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, owner TEXT NOT NULL, owner_avatar TEXT, html_url TEXT NOT NULL, description TEXT, stargazers INTEGER NOT NULL DEFAULT 0, language TEXT, archived INTEGER NOT NULL DEFAULT 0, fork INTEGER NOT NULL DEFAULT 0, pushed_at TEXT, topics TEXT NOT NULL DEFAULT '[]', fetched_at INTEGER NOT NULL DEFAULT 0)")
  db.exec('CREATE INDEX IF NOT EXISTS idx_repos_stars ON repos(stargazers DESC)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_repos_pushed ON repos(pushed_at DESC)')
}

async function openCatalog() {
  const dir = join(dshHome(), 'dsh-community-plugins')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, 'catalog.db')
  try {
    await (await open(path, 'wx', 0o600)).close()
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  ensureSchema(db)
  return db
}

function rowToRepo(row) {
  let topics = []
  try {
    topics = JSON.parse(row.topics || '[]')
  } catch {
    topics = []
  }
  return {
    id: row.id,
    full_name: row.full_name,
    owner: row.owner,
    owner_avatar: row.owner_avatar,
    html_url: row.html_url,
    description: row.description,
    stargazers: row.stargazers,
    language: row.language,
    archived: row.archived === 1,
    fork: row.fork === 1,
    pushed_at: row.pushed_at,
    topics,
  }
}

/** Topic counts over the given repos, minus the umbrella topic tags. */
function aggregateTags(items) {
  const excluded = new Set(['dsh-plugin', 'deepseek-harness'])
  const counts = new Map()
  for (const repo of items) {
    for (const topic of repo.topics) {
      if (excluded.has(topic)) continue
      counts.set(topic, (counts.get(topic) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

function compareStars(a, b) {
  return b.stargazers - a.stargazers || a.full_name.localeCompare(b.full_name)
}
function comparePushed(a, b) {
  return String(b.pushed_at || '').localeCompare(String(a.pushed_at || '')) || a.full_name.localeCompare(b.full_name)
}
function compareName(a, b) {
  return a.full_name.toLowerCase().localeCompare(b.full_name.toLowerCase())
}

/** Read the local catalog: filter by text and tag, sort, paginate, and aggregate tags. */
function listCatalog(db, opts) {
  const rows = db.prepare('SELECT * FROM repos').all()
  let items = rows.map(rowToRepo)
  const q = String(opts.q || '').trim().toLowerCase()
  if (q !== '') {
    items = items.filter((repo) =>
      repo.full_name.toLowerCase().includes(q)
      || repo.owner.toLowerCase().includes(q)
      || String(repo.description || '').toLowerCase().includes(q)
      || repo.topics.some((topic) => topic.toLowerCase().includes(q)))
  }
  const tags = aggregateTags(items)
  const allCount = items.length
  if (opts.tag) items = items.filter((repo) => repo.topics.includes(opts.tag))
  const sort = opts.sort || 'stars'
  items = items.slice().sort(sort === 'updated' ? comparePushed : sort === 'name' ? compareName : compareStars)
  const total = items.length
  const offset = opts.offset || 0
  const paged = items.slice(offset, offset + (opts.limit || 100))
  return { items: paged, total, allCount, tags }
}

function upsertRepos(db, repos) {
  const upsert = db.prepare('INSERT INTO repos (id, full_name, owner, owner_avatar, html_url, description, stargazers, language, archived, fork, pushed_at, topics, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET full_name = excluded.full_name, owner = excluded.owner, owner_avatar = excluded.owner_avatar, html_url = excluded.html_url, description = excluded.description, stargazers = excluded.stargazers, language = excluded.language, archived = excluded.archived, fork = excluded.fork, pushed_at = excluded.pushed_at, topics = excluded.topics, fetched_at = excluded.fetched_at')
  const now = Date.now()
  db.exec('BEGIN')
  try {
    for (const repo of repos) {
      if (!repo || typeof repo.id !== 'number' || typeof repo.full_name !== 'string') continue
      const owner = repo.owner && typeof repo.owner.login === 'string' ? repo.owner.login : (typeof repo.owner === 'string' ? repo.owner : '')
      upsert.run(
        repo.id,
        repo.full_name,
        owner,
        repo.owner && repo.owner.avatar_url ? repo.owner.avatar_url : null,
        repo.html_url || ('https://github.com/' + repo.full_name),
        repo.description || null,
        typeof repo.stargazers_count === 'number' ? repo.stargazers_count : 0,
        repo.language || null,
        repo.archived ? 1 : 0,
        repo.fork ? 1 : 0,
        repo.pushed_at || repo.updated_at || null,
        JSON.stringify(Array.isArray(repo.topics) ? repo.topics : []),
        now,
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* no transaction to roll back */ }
    throw error
  }
}

// ---------------------------------------------------------------------------
// GitHub fetch + background refresh worker
// ---------------------------------------------------------------------------

let refreshing = false
let pendingQuery = ''
let refreshQueued = false
let lastFetchAt = 0
let rateLimitedUntil = 0
let lastRefreshedAt = 0

function isRefreshing() {
  return refreshing
}

function topicQuery() {
  const includeForks = (process.env.DSH_COMMUNITY_INCLUDE_FORKS ?? '') !== ''
  return includeForks ? 'topic:dsh-plugin' : 'topic:dsh-plugin fork:false'
}

function buildSpecs(query) {
  if (query === '') {
    return [
      { q: topicQuery(), sort: 'stars' },
      { q: topicQuery(), sort: 'updated' },
    ]
  }
  return [{ q: topicQuery() + ' ' + query, sort: 'stars' }]
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function githubSearch(q, sort, page, perPage) {
  const url = 'https://api.github.com/search/repositories?q=' + encodeURIComponent(q) + '&sort=' + sort + '&order=desc&per_page=' + perPage + '&page=' + page
  let res
  try {
    res = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-community-plugins' } })
  } catch (error) {
    return { ok: false, networkError: true, items: [] }
  }
  const remaining = Number(res.headers.get('x-ratelimit-remaining'))
  const resetEpoch = Number(res.headers.get('x-ratelimit-reset'))
  if (res.status === 403 || res.status === 429 || (Number.isFinite(remaining) && remaining <= 0)) {
    const resetAt = Number.isFinite(resetEpoch) && resetEpoch > 0 ? resetEpoch * 1000 : Date.now() + 60000
    return { ok: false, rateLimited: true, resetAt, items: [] }
  }
  if (!res.ok) return { ok: false, status: res.status, items: [] }
  let body
  try {
    body = await res.json()
  } catch {
    return { ok: false, status: res.status, items: [] }
  }
  return { ok: true, items: Array.isArray(body.items) ? body.items : [], total: body.total_count }
}

async function refreshOnce(query) {
  const now = Date.now()
  const wait = Math.max(rateLimitedUntil - now, lastFetchAt + MIN_FETCH_INTERVAL_MS - now, 0)
  if (wait > 0) await sleep(wait)
  if (Date.now() < rateLimitedUntil) return
  const db = await getDb()
  const specs = buildSpecs(query)
  for (const spec of specs) {
    if (Date.now() < rateLimitedUntil) break
    lastFetchAt = Date.now()
    const result = await githubSearch(spec.q, spec.sort, 1, query === '' ? SEED_PER_PAGE : SEARCH_PER_PAGE)
    if (result.rateLimited) {
      rateLimitedUntil = result.resetAt || Date.now() + 60000
      break
    }
    if (result.ok && result.items.length > 0) upsertRepos(db, result.items)
  }
  lastRefreshedAt = Date.now()
}

function scheduleRefresh(query) {
  if (query !== undefined && query !== null) pendingQuery = query
  refreshQueued = true
  return runRefreshLoop()
}

async function runRefreshLoop() {
  if (refreshing) return
  refreshing = true
  try {
    while (refreshQueued) {
      refreshQueued = false
      const query = pendingQuery
      pendingQuery = ''
      await refreshOnce(query)
    }
  } catch (error) {
    console.warn('[dsh-community-plugins] refresh failed:', String(error && error.message ? error.message : error))
  } finally {
    refreshing = false
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers (trust check mirroring dsh-trader)
// ---------------------------------------------------------------------------

function headerHost(value) {
  try {
    return new URL(value).host
  } catch {
    return null
  }
}

function simpleContentType(value) {
  if (typeof value !== 'string' || value === '') return false
  const type = value.split(';')[0].trim().toLowerCase()
  return type === 'text/plain' || type === 'application/x-www-form-urlencoded' || type === 'multipart/form-data'
}

function isTrustedRequest(req) {
  const headers = req.headers ?? {}
  const host = headers.host ?? ''
  for (const header of [headers.origin, headers.referer]) {
    if (header === undefined || header === null || header === '') continue
    if (header === 'null') return false
    const sourceHost = headerHost(header)
    if (sourceHost === null || sourceHost !== host) return false
  }
  if (simpleContentType(headers['content-type'])) return false
  return host.startsWith('127.0.0.1') || host.startsWith('localhost') || host.startsWith('::1')
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw === '' ? {} : JSON.parse(raw))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function clampInt(value, min, max, dflt) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : dflt
}

const SORTS = ['stars', 'updated', 'name']

/** Whether a package.json declares a DSH bundle (the CLI's own installability marker). */
export function isInstallableManifest(manifest) {
  if (manifest === null || typeof manifest !== 'object') return false
  const patch = manifest.dsh?.bundle?.patch
  return typeof patch === 'string' && patch !== ''
}

/**
 * Pre-flight installability check: fetch the repo's root package.json from
 * GitHub and require a dsh.bundle.patch declaration, so repos that merely
 * carry the dsh-plugin topic (the harness itself, apps, demos) fail fast with
 * a clear reason instead of a confusing pnpm error or a long hang. A
 * network/parse failure returns { ok: true } so a transient fetch problem
 * never blocks an otherwise valid install.
 */
async function checkInstallable(repo) {
  const url = 'https://raw.githubusercontent.com/' + repo + '/HEAD/package.json'
  let res
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'dsh-community-plugins' } })
  } catch {
    return { ok: true, reason: null }
  }
  if (!res.ok) {
    return { ok: false, reason: 'not a DSH plugin — no package.json at the repo root (GitHub returned ' + res.status + ')' }
  }
  let manifest
  try {
    manifest = await res.json()
  } catch {
    return { ok: false, reason: 'not a DSH plugin — its package.json is not valid JSON' }
  }
  if (!isInstallableManifest(manifest)) {
    return { ok: false, reason: 'not a DSH plugin — its package.json has no dsh.bundle manifest' }
  }
  return { ok: true, reason: null }
}

export function apply(ctx) {
  // GET /community-plugins/catalog — the local read model + tag aggregation.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/community-plugins/catalog',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'untrusted request' })
      try {
        const url = new URL(req.url, 'http://x')
        const sortParam = url.searchParams.get('sort')
        const db = await getDb()
        const result = listCatalog(db, {
          q: url.searchParams.get('q') || '',
          tag: url.searchParams.get('tag') || '',
          sort: SORTS.includes(sortParam) ? sortParam : 'stars',
          limit: clampInt(url.searchParams.get('limit'), 1, 500, 100),
          offset: clampInt(url.searchParams.get('offset'), 0, 100000, 0),
        })
        sendJson(res, 200, { ok: true, ...result, refreshing: isRefreshing(), refreshedAt: lastRefreshedAt })
      } catch (error) {
        sendJson(res, 500, { error: String(error && error.message ? error.message : error) })
      }
    },
  }), 'community-plugins: /community-plugins/catalog route')

  // POST /community-plugins/refresh — schedule a background GitHub fetch.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/community-plugins/refresh',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'untrusted request' })
      let body = {}
      try {
        body = await readJsonBody(req)
      } catch {
        body = {}
      }
      const q = typeof body.q === 'string' ? body.q.trim().slice(0, 200) : ''
      scheduleRefresh(q).catch(() => {})
      sendJson(res, 200, { ok: true, refreshing: isRefreshing() })
    },
  }), 'community-plugins: /community-plugins/refresh route')

  // GET /community-plugins/state — profile name + installed out-of-tree plugins.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/community-plugins/state',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'untrusted request' })
      try {
        const profile = await resolveProfile()
        const plugins = await collectInstalled(profile)
        sendJson(res, 200, { ok: true, profile, plugins })
      } catch (error) {
        sendJson(res, 500, { error: String(error && error.message ? error.message : error) })
      }
    },
  }), 'community-plugins: /community-plugins/state route')

  // POST /community-plugins/install — run "dsh plugin --profile <p> add github:<repo>".
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/community-plugins/install',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'untrusted request' })
      let body
      try {
        body = await readJsonBody(req)
      } catch {
        return sendJson(res, 400, { error: 'invalid body' })
      }
      const repo = body?.repo
      if (!isValidRepo(repo)) return sendJson(res, 400, { error: 'repo must be an owner/name reference' })
      try {
        const check = await checkInstallable(repo)
        if (!check.ok) return sendJson(res, 400, { ok: false, repo, installable: false, error: check.reason, output: '' })
        const profile = await resolveProfile()
        const result = await runDshPlugin(profile, ['add', 'github:' + repo])
        sendJson(res, result.ok ? 200 : 400, {
          ok: result.ok,
          profile,
          repo,
          installable: true,
          output: result.output,
          error: result.error,
          needsRestart: result.ok,
        })
      } catch (error) {
        sendJson(res, 500, { error: String(error && error.message ? error.message : error) })
      }
    },
  }), 'community-plugins: /community-plugins/install route')

  // POST /community-plugins/uninstall — run "dsh plugin --profile <p> remove <pkg>".
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/community-plugins/uninstall',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'untrusted request' })
      let body
      try {
        body = await readJsonBody(req)
      } catch {
        return sendJson(res, 400, { error: 'invalid body' })
      }
      const repo = body?.repo
      if (!isValidRepo(repo)) return sendJson(res, 400, { error: 'repo must be an owner/name reference' })
      try {
        const profile = await resolveProfile()
        const plugins = await collectInstalled(profile)
        const slug = repoSlug(repo)
        const match = plugins.find((plugin) => plugin.repo === repo || plugin.name === slug)
        const target = match?.name ?? slug
        const result = await runDshPlugin(profile, ['remove', target])
        sendJson(res, result.ok ? 200 : 400, {
          ok: result.ok,
          profile,
          repo,
          name: target,
          output: result.output,
          error: result.error,
          needsRestart: result.ok,
        })
      } catch (error) {
        sendJson(res, 500, { error: String(error && error.message ? error.message : error) })
      }
    },
  }), 'community-plugins: /community-plugins/uninstall route')

  // Seed the catalog in the background once at boot.
  ctx.effect(() => {
    scheduleRefresh('').catch(() => {})
    return () => {}
  }, 'community-plugins: background seed')

  console.log('[dsh-community-plugins] host routes ready')
}

export { ensureSchema, rowToRepo, aggregateTags, listCatalog, upsertRepos }
