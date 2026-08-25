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
 *    profile that mounted this plugin, plus a per-repo fork listing (cached in
 *    the same database) so a fork carrying unmerged changes can be inspected
 *    and installed in place of its upstream.
 *
 *   GET  /community-plugins/catalog    -> ?filter=all|installed|local ;
 *                                        { items, total, tags, counts, refreshing, refreshedAt }
 *   POST /community-plugins/refresh    -> body { q } ; schedules a background fetch
 *   GET  /community-plugins/forks      -> ?repo=owner/name ; cached fork listing
 *   GET  /community-plugins/state      -> { profile, plugins: [{name,spec,repo,enabled}] }
 *   GET  /community-plugins/browse     -> ?path=&hidden=1 ; subdirs, for the folder picker
 *   POST /community-plugins/validate   -> body { path } ; dry-checks a local fs path
 *   POST /community-plugins/install    -> body { repo } | { path, dryRun? }
 *   POST /community-plugins/uninstall  -> body { repo: "owner/name" }
 *   POST /community-plugins/plugin     -> body { name, enabled } ; bundle membership
 *   POST /community-plugins/restart    -> respawns this dsh web process
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
import { dirname, join, resolve } from 'node:path'
import { mkdir, open, readdir, readFile, stat, writeFile } from 'node:fs/promises'
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
const SCHEMA_VERSION = 4
/** How long a cached fork listing stays fresh before GitHub is asked again. */
const FORKS_TTL_MS = (() => {
  const value = Number(process.env.DSH_COMMUNITY_FORKS_TTL_MS)
  return Number.isFinite(value) && value >= 0 ? value : 10 * 60 * 1000
})()
/** Forks fetched per repo (one page of the REST forks endpoint). */
const FORKS_PER_PAGE = 50
/** How much of a plugin README the local view carries, in characters. */
const README_LIMIT = 12000
/** Display names for common README language suffixes. */
const README_LABELS = {
  en: 'English', zh: '中文', 'zh-cn': '中文', 'zh-hans': '中文', 'zh-tw': '繁體中文',
  ja: '日本語', ko: '한국어', fr: 'Français', de: 'Deutsch', es: 'Español',
  pt: 'Português', 'pt-br': 'Português (BR)', ru: 'Русский', it: 'Italiano',
  ar: 'العربية', hi: 'हिन्दी', tr: 'Türkçe', id: 'Bahasa Indonesia',
}

function readmeLabel(filename) {
  const m = /^readme[._-]([^.]+)[.](?:md|markdown|txt)$/i.exec(filename)
  if (!m) return 'English'
  const code = m[1].toLowerCase()
  return README_LABELS[code] || m[1]
}

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
export async function collectInstalled(profile) {
  const manifest = await readProfileManifest(profile)
  const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
  const deps = manifest !== null && typeof manifest.dependencies === 'object' && manifest.dependencies !== null
    ? manifest.dependencies
    : {}
  const plugins = []
  const seen = new Set()
  // dsh.profile.bundles is the mounted (enabled) list; a dependency that is not
  // in it is installed but never loaded, which the browser reports separately.
  for (const name of bundles) {
    if (name.startsWith('@deepseek-ai/') || name.startsWith('cordis:') || name.startsWith('cordis-plugin-')) continue
    seen.add(name)
    const spec = deps[name] ?? null
    plugins.push({ name, spec, repo: repoFromSpec(spec), enabled: true })
  }
  for (const [name, spec] of Object.entries(deps)) {
    if (seen.has(name)) continue
    seen.add(name)
    plugins.push({ name, spec, repo: repoFromSpec(spec), enabled: false })
  }
  return plugins
}

/**
 * Add or remove a package name from the profile's dsh.profile.bundles list —
 * that membership is what mounts (or stops mounting) a plugin. Returns null
 * when the name is not actually installed in the profile.
 */
export async function setBundleEnabled(profile, name, enabled) {
  const path = join(dshHome(), 'profiles', profile, 'package.json')
  const raw = await readFile(path, 'utf8')
  const manifest = JSON.parse(raw)
  if (!manifest.dsh || typeof manifest.dsh !== 'object') manifest.dsh = {}
  if (!manifest.dsh.profile || typeof manifest.dsh.profile !== 'object') manifest.dsh.profile = {}
  const bundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : []
  manifest.dsh.profile.bundles = bundles
  const idx = bundles.indexOf(name)
  if (enabled && idx === -1) bundles.push(name)
  if (!enabled && idx !== -1) bundles.splice(idx, 1)
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n')
  return true
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
    db.exec('DROP TABLE IF EXISTS forks')
    db.exec('PRAGMA user_version = ' + SCHEMA_VERSION)
  }
  db.exec("CREATE TABLE IF NOT EXISTS repos (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, owner TEXT NOT NULL, owner_avatar TEXT, html_url TEXT NOT NULL, description TEXT, stargazers INTEGER NOT NULL DEFAULT 0, forks INTEGER NOT NULL DEFAULT 0, default_branch TEXT, language TEXT, archived INTEGER NOT NULL DEFAULT 0, fork INTEGER NOT NULL DEFAULT 0, pushed_at TEXT, created_at TEXT, updated_at TEXT, topics TEXT NOT NULL DEFAULT '[]', fetched_at INTEGER NOT NULL DEFAULT 0)")
  // Fork listings are cached per parent repo: the REST forks endpoint lives on
  // GitHub's core rate limit (60/hr unauthenticated), so a repeat click must
  // not cost a request. Repo metadata for local plugins is cached the same way.
  db.exec("CREATE TABLE IF NOT EXISTS forks (repo TEXT PRIMARY KEY, items TEXT NOT NULL DEFAULT '[]', fetched_at INTEGER NOT NULL DEFAULT 0)")
  db.exec("CREATE TABLE IF NOT EXISTS repo_meta (repo TEXT PRIMARY KEY, meta TEXT NOT NULL DEFAULT '{}', fetched_at INTEGER NOT NULL DEFAULT 0)")
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
    forks: row.forks,
    default_branch: row.default_branch,
    language: row.language,
    archived: row.archived === 1,
    fork: row.fork === 1,
    pushed_at: row.pushed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
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
function compareForks(a, b) {
  return b.forks - a.forks || a.full_name.localeCompare(b.full_name)
}
function compareCreated(a, b) {
  return String(b.created_at || '').localeCompare(String(a.created_at || '')) || a.full_name.localeCompare(b.full_name)
}
function compareUpdated(a, b) {
  const timeA = a.updated_at || a.pushed_at || ''
  const timeB = b.updated_at || b.pushed_at || ''
  return String(timeB).localeCompare(String(timeA)) || a.full_name.localeCompare(b.full_name)
}
function comparePushed(a, b) {
  return String(b.pushed_at || '').localeCompare(String(a.pushed_at || '')) || a.full_name.localeCompare(b.full_name)
}
function compareName(a, b) {
  return a.full_name.toLowerCase().localeCompare(b.full_name.toLowerCase())
}

/** Read the local catalog: filter by text and tag, sort, paginate, and aggregate tags. */
/**
 * Index the installed plugins for catalog matching: a catalog row counts as
 * installed when an installed plugin resolves to the same GitHub repo, or
 * (for registry installs, which carry no repo) when its package name equals
 * the repo's slug. This mirrors the browser's own isInstalled() rule.
 */
export function installedIndex(plugins) {
  const repos = new Set()
  const names = new Set()
  for (const plugin of plugins || []) {
    if (typeof plugin.repo === 'string' && plugin.repo !== '') repos.add(plugin.repo.toLowerCase())
    if (typeof plugin.name === 'string' && plugin.name !== '') names.add(plugin.name.toLowerCase())
  }
  return { repos, names }
}

/** Whether a catalog repo is one of the installed plugins. */
export function isInstalledRepo(index, fullName) {
  const lower = String(fullName).toLowerCase()
  return index.repos.has(lower) || index.names.has(repoSlug(lower))
}

/**
 * Installed plugins with no row in the community catalog — local or private
 * plugins the dsh-plugin topic does not know about. Shaped like catalog items
 * so the browser can render them in the same list, flagged with local: true.
 */
export function listLocalPlugins(db, plugins, opts) {
  const catalog = db.prepare('SELECT full_name FROM repos').all()
  const known = installedIndex(catalog.map((row) => ({ repo: row.full_name, name: repoSlug(row.full_name) })))
  let items = (plugins || [])
    .filter((plugin) => {
      const repo = typeof plugin.repo === 'string' && plugin.repo !== '' ? plugin.repo.toLowerCase() : null
      if (repo !== null && known.repos.has(repo)) return false
      return !known.names.has(String(plugin.name || '').toLowerCase())
    })
    .map((plugin) => ({
      local: true,
      name: plugin.name,
      spec: plugin.spec,
      enabled: plugin.enabled !== false,
      full_name: plugin.repo || plugin.name,
      owner: plugin.repo ? plugin.repo.slice(0, plugin.repo.indexOf('/')) : '',
      html_url: plugin.repo ? 'https://github.com/' + plugin.repo : null,
      description: null,
      stargazers: 0,
      forks: 0,
      topics: [],
      archived: false,
      fork: false,
      pushed_at: null,
    }))
  const q = String(opts?.q || '').trim().toLowerCase()
  if (q !== '') {
    items = items.filter((item) =>
      String(item.name).toLowerCase().includes(q)
      || String(item.full_name).toLowerCase().includes(q)
      || String(item.spec || '').toLowerCase().includes(q))
  }
  items = items.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return { items, total: items.length, allCount: items.length, tags: [] }
}

/**
 * Candidate package.json paths for one installed plugin, relative to the
 * profile directory: file:/link: specs resolve against it, and anything else
 * falls back to the profile's node_modules (pnpm symlinks resolve fine).
 */
function localManifestCandidates(profile, name, spec) {
  const profileDir = join(dshHome(), 'profiles', profile)
  const out = []
  const m = /^(?:file:|link:)?(.*)$/.exec(String(spec || '').trim())
  if (m && m[1] !== '') out.push(join(profileDir, m[1], 'package.json'))
  out.push(join(profileDir, 'node_modules', name, 'package.json'))
  return out
}

/**
 * Every README variant a package ships: the plain README(.md/.markdown/.txt)
 * plus language variants like README.zh-CN.md or readme_ja.md. Each entry is
 * capped at README_LIMIT and labeled with its language (or the raw suffix).
 */
async function findReadmes(dir) {
  let entries
  try {
    entries = await readdir(dir)
  } catch {
    return null
  }
  const isPlain = (entry) => /^readme(?:[.](?:md|markdown|txt))?$/i.test(entry)
  const hits = entries
    .filter((entry) => isPlain(entry) || /^readme[._-][^.]+[.](?:md|markdown|txt)$/i.test(entry))
    .sort((a, b) => Number(isPlain(b)) - Number(isPlain(a)) || a.localeCompare(b))
  if (hits.length === 0) return null
  const out = []
  for (const hit of hits) {
    try {
      const text = await readFile(join(dir, hit), 'utf8')
      out.push({
        key: hit,
        label: isPlain(hit) ? 'English' : readmeLabel(hit),
        text: text.slice(0, README_LIMIT),
        truncated: text.length > README_LIMIT,
      })
    } catch { /* unreadable variant */ }
  }
  return out.length ? out : null
}

/**
 * Fill a local plugin item with what its installed manifest says about it —
 * description, version, author and (when the package ships one) its README.
 * Reads fail quietly, leaving nulls; the card simply shows less.
 */
export async function enrichLocal(profile, item) {
  let manifest = null
  let readmes = null
  for (const candidate of localManifestCandidates(profile, item.name, item.spec)) {
    try {
      manifest = JSON.parse(await readFile(candidate, 'utf8'))
      readmes = await findReadmes(dirname(candidate))
      break
    } catch { /* next candidate */ }
  }
  const author = manifest !== null && typeof manifest.author === 'string'
    ? manifest.author
    : (manifest !== null && manifest.author && typeof manifest.author.name === 'string' ? manifest.author.name : null)
  return {
    ...item,
    version: manifest !== null && typeof manifest.version === 'string' ? manifest.version : null,
    description: manifest !== null && typeof manifest.description === 'string' ? manifest.description : null,
    author: author || null,
    readmes: readmes || [],
  }
}

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
  // The installed filter runs before tag aggregation, so the tag chips
  // describe the subset actually on screen.
  if (opts.filter === 'installed') {
    const index = installedIndex(opts.plugins)
    items = items.filter((repo) => isInstalledRepo(index, repo.full_name))
  }
  const tags = aggregateTags(items)
  const allCount = items.length
  if (opts.tag) items = items.filter((repo) => repo.topics.includes(opts.tag))
  const sort = opts.sort || 'stars'
  items = items.slice().sort(sort === 'forks' ? compareForks
    : sort === 'created' ? compareCreated
    : sort === 'updated' ? compareUpdated
    : sort === 'name' ? compareName
    : compareStars)
  const total = items.length
  const offset = opts.offset || 0
  const paged = items.slice(offset, offset + (opts.limit || 100))
  return { items: paged, total, allCount, tags }
}

function upsertRepos(db, repos) {
  const upsert = db.prepare('INSERT INTO repos (id, full_name, owner, owner_avatar, html_url, description, stargazers, forks, default_branch, language, archived, fork, pushed_at, created_at, updated_at, topics, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET full_name = excluded.full_name, owner = excluded.owner, owner_avatar = excluded.owner_avatar, html_url = excluded.html_url, description = excluded.description, stargazers = excluded.stargazers, forks = excluded.forks, default_branch = excluded.default_branch, language = excluded.language, archived = excluded.archived, fork = excluded.fork, pushed_at = excluded.pushed_at, created_at = excluded.created_at, updated_at = excluded.updated_at, topics = excluded.topics, fetched_at = excluded.fetched_at')
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
        typeof repo.forks_count === 'number' ? repo.forks_count : (typeof repo.forks === 'number' ? repo.forks : 0),
        typeof repo.default_branch === 'string' ? repo.default_branch : null,
        repo.language || null,
        repo.archived ? 1 : 0,
        repo.fork ? 1 : 0,
        repo.pushed_at || repo.updated_at || null,
        repo.created_at || null,
        repo.updated_at || repo.pushed_at || null,
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

function githubHeaders() {
  const token = process.env.DSH_COMMUNITY_GITHUB_TOKEN || process.env.GITHUB_TOKEN || ''
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-community-plugins' }
  if (token !== '') headers.Authorization = 'Bearer ' + token
  return headers
}

async function githubSearch(q, sort, page, perPage) {
  const url = 'https://api.github.com/search/repositories?q=' + encodeURIComponent(q) + '&sort=' + sort + '&order=desc&per_page=' + perPage + '&page=' + page
  let res
  try {
    res = await fetch(url, { headers: githubHeaders() })
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

// ---------------------------------------------------------------------------
// Fork listings (GitHub core REST limit, cached per parent repo)
// ---------------------------------------------------------------------------

/** Core-REST backoff, tracked separately from the search API's own limit. */
let coreLimitedUntil = 0

function readForkCache(db, repo) {
  const row = db.prepare('SELECT items, fetched_at FROM forks WHERE repo = ?').get(repo)
  if (!row) return null
  try {
    const items = JSON.parse(row.items || '[]')
    return { items: Array.isArray(items) ? items : [], fetchedAt: row.fetched_at || 0 }
  } catch {
    return null
  }
}

function writeForkCache(db, repo, items) {
  db.prepare('INSERT INTO forks (repo, items, fetched_at) VALUES (?, ?, ?) ON CONFLICT(repo) DO UPDATE SET items = excluded.items, fetched_at = excluded.fetched_at')
    .run(repo, JSON.stringify(items), Date.now())
}

/** Trim a GitHub fork payload down to what the browser renders. */
function toForkSummary(repo) {
  if (!repo || typeof repo.full_name !== 'string') return null
  return {
    id: typeof repo.id === 'number' ? repo.id : 0,
    full_name: repo.full_name,
    owner: repo.owner && typeof repo.owner.login === 'string' ? repo.owner.login : '',
    owner_avatar: repo.owner && repo.owner.avatar_url ? repo.owner.avatar_url : null,
    html_url: repo.html_url || ('https://github.com/' + repo.full_name),
    description: repo.description || null,
    stargazers: typeof repo.stargazers_count === 'number' ? repo.stargazers_count : 0,
    forks: typeof repo.forks_count === 'number' ? repo.forks_count : 0,
    language: repo.language || null,
    archived: !!repo.archived,
    default_branch: typeof repo.default_branch === 'string' ? repo.default_branch : 'HEAD',
    pushed_at: repo.pushed_at || repo.updated_at || null,
  }
}

async function fetchForks(repo) {
  const url = 'https://api.github.com/repos/' + repo + '/forks?sort=stargazers&per_page=' + FORKS_PER_PAGE
  let res
  try {
    res = await fetch(url, { headers: githubHeaders() })
  } catch {
    return { ok: false, networkError: true }
  }
  const remaining = Number(res.headers.get('x-ratelimit-remaining'))
  const resetEpoch = Number(res.headers.get('x-ratelimit-reset'))
  if (res.status === 403 || res.status === 429 || (Number.isFinite(remaining) && remaining <= 0)) {
    coreLimitedUntil = Number.isFinite(resetEpoch) && resetEpoch > 0 ? resetEpoch * 1000 : Date.now() + 60000
    return { ok: false, rateLimited: true, resetAt: coreLimitedUntil }
  }
  if (res.status === 404) return { ok: false, notFound: true }
  if (!res.ok) return { ok: false, status: res.status }
  let body
  try {
    body = await res.json()
  } catch {
    return { ok: false, status: res.status }
  }
  const items = (Array.isArray(body) ? body : []).map(toForkSummary).filter(Boolean)
  return { ok: true, items }
}

/**
 * Fork listing for one repo: cache-first, with GitHub consulted only when the
 * cached copy is older than FORKS_TTL_MS (or `force` is set). A rate limit or
 * network failure falls back to whatever is cached, flagged `stale`.
 */
export async function listForks(db, repo, force) {
  const cached = readForkCache(db, repo)
  const fresh = cached !== null && !force && (Date.now() - cached.fetchedAt) < FORKS_TTL_MS
  if (fresh) return { ok: true, items: cached.items, fetchedAt: cached.fetchedAt, cached: true }
  if (Date.now() < coreLimitedUntil) {
    if (cached) return { ok: true, items: cached.items, fetchedAt: cached.fetchedAt, cached: true, stale: true, rateLimited: true, resetAt: coreLimitedUntil }
    return { ok: false, error: 'GitHub rate limit reached', rateLimited: true, resetAt: coreLimitedUntil }
  }
  const result = await fetchForks(repo)
  if (result.ok) {
    writeForkCache(db, repo, result.items)
    return { ok: true, items: result.items, fetchedAt: Date.now(), cached: false }
  }
  if (cached) {
    return { ok: true, items: cached.items, fetchedAt: cached.fetchedAt, cached: true, stale: true, rateLimited: !!result.rateLimited, resetAt: result.resetAt }
  }
  if (result.notFound) return { ok: false, error: 'repository not found on GitHub' }
  if (result.rateLimited) return { ok: false, error: 'GitHub rate limit reached', rateLimited: true, resetAt: result.resetAt }
  return { ok: false, error: result.networkError ? 'could not reach GitHub' : ('GitHub returned ' + (result.status || 'an error')) }
}

/** Normalize a GitHub repo payload to the catalog item shape. */
function toRepoSummary(repo) {
  if (!repo || typeof repo.full_name !== 'string') return null
  return {
    full_name: repo.full_name,
    owner: repo.owner && typeof repo.owner.login === 'string' ? repo.owner.login : '',
    owner_avatar: repo.owner && repo.owner.avatar_url ? repo.owner.avatar_url : null,
    html_url: repo.html_url || ('https://github.com/' + repo.full_name),
    description: repo.description || null,
    stargazers: typeof repo.stargazers_count === 'number' ? repo.stargazers_count : 0,
    forks: typeof repo.forks_count === 'number' ? repo.forks_count : 0,
    language: repo.language || null,
    archived: !!repo.archived,
    fork: !!repo.fork,
    pushed_at: repo.pushed_at || repo.updated_at || null,
    created_at: repo.created_at || null,
    updated_at: repo.updated_at || repo.pushed_at || null,
    default_branch: typeof repo.default_branch === 'string' ? repo.default_branch : null,
    topics: Array.isArray(repo.topics) ? repo.topics : [],
  }
}

function readMetaCache(db, repo) {
  const row = db.prepare('SELECT meta, fetched_at FROM repo_meta WHERE repo = ?').get(repo)
  if (!row) return null
  try {
    const meta = JSON.parse(row.meta || '{}')
    return { meta, fetchedAt: row.fetched_at || 0 }
  } catch {
    return null
  }
}

function writeMetaCache(db, repo, meta) {
  db.prepare('INSERT INTO repo_meta (repo, meta, fetched_at) VALUES (?, ?, ?) ON CONFLICT(repo) DO UPDATE SET meta = excluded.meta, fetched_at = excluded.fetched_at')
    .run(repo, JSON.stringify(meta), Date.now())
}

async function fetchRepoMeta(repo) {
  const url = 'https://api.github.com/repos/' + repo
  let res
  try {
    res = await fetch(url, { headers: githubHeaders() })
  } catch {
    return { ok: false, networkError: true }
  }
  const remaining = Number(res.headers.get('x-ratelimit-remaining'))
  const resetEpoch = Number(res.headers.get('x-ratelimit-reset'))
  if (res.status === 403 || res.status === 429 || (Number.isFinite(remaining) && remaining <= 0)) {
    coreLimitedUntil = Number.isFinite(resetEpoch) && resetEpoch > 0 ? resetEpoch * 1000 : Date.now() + 60000
    return { ok: false, rateLimited: true }
  }
  if (!res.ok) return { ok: false, status: res.status }
  let body
  try {
    body = await res.json()
  } catch {
    return { ok: false, status: res.status }
  }
  const meta = toRepoSummary(body)
  return meta ? { ok: true, meta } : { ok: false, status: res.status }
}

/**
 * Local plugins whose repo lives on GitHub get the same card the catalog
 * rows get: fetch (once per FORKS_TTL_MS, cached in SQLite) the repo
 * metadata so the browser can render the rich card. Failures leave the item
 * untouched and the plain local card is shown instead.
 */
export async function enrichLocalGithub(db, item) {
  if (typeof item.repo !== 'string' || item.repo === '') return item
  const cached = readMetaCache(db, item.repo)
  if (cached && Date.now() - cached.fetchedAt < FORKS_TTL_MS) {
    return { ...item, github: true, ...cached.meta }
  }
  if (Date.now() < coreLimitedUntil) {
    return cached ? { ...item, github: true, ...cached.meta } : item
  }
  const result = await fetchRepoMeta(item.repo)
  if (result.ok) {
    writeMetaCache(db, item.repo, result.meta)
    return { ...item, github: true, ...result.meta }
  }
  return cached ? { ...item, github: true, ...cached.meta } : item
}

// ---------------------------------------------------------------------------
// dsh web self-restart
// ---------------------------------------------------------------------------

function shellQuote(arg) {
  return "'" + String(arg).replace(/'/g, "'\\''") + "'"
}

/**
 * Schedule a restart of the dsh web process this plugin runs inside.
 *
 * The restarter is spawned detached so it survives our own exit: it waits for
 * the port to be released, then re-execs the exact command line this process
 * was launched with (node <dsh-bin> web ...). stdio is inherited, so the new
 * instance keeps writing to the same terminal. DSH_COMMUNITY_RESTART_CMD
 * overrides the re-exec — e.g. "systemctl restart dsh-web" for supervised
 * setups.
 */
function scheduleDshWebRestart() {
  const custom = process.env.DSH_COMMUNITY_RESTART_CMD
  const command = typeof custom === 'string' && custom.trim() !== ''
    ? custom.trim()
    : shellQuote(process.execPath) + ' ' + process.argv.slice(1).map(shellQuote).join(' ')
  try {
    const child = spawn('sh', ['-c', 'sleep 1.5 && exec ' + command], {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: 'inherit',
    })
    child.unref()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) }
  }
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

const SORTS = ['stars', 'forks', 'created', 'updated', 'name']
const FILTERS = ['all', 'installed', 'local']

/** Totals behind the All / Installed / Local filter chips. */
function countsByFilter(db, plugins) {
  const all = db.prepare('SELECT COUNT(*) AS n FROM repos').get().n
  const index = installedIndex(plugins)
  const rows = db.prepare('SELECT full_name FROM repos').all()
  const installed = rows.filter((row) => isInstalledRepo(index, row.full_name)).length
  const local = listLocalPlugins(db, plugins, {}).total
  return { all, installed, local }
}

/** Whether a package.json declares a DSH bundle (the CLI's own installability marker). */
export function isInstallableManifest(manifest) {
  if (manifest === null || typeof manifest !== 'object') return false
  const patch = manifest.dsh?.bundle?.patch
  return typeof patch === 'string' && patch !== ''
}

/**
 * Validate a local filesystem path as a DSH plugin candidate.
 * Reads package.json from the path, checks it parses and declares dsh.bundle.patch.
 * Returns { ok, installable, name, version, description, author, reason }.
 */
export async function validateLocalPlugin(path) {
  if (typeof path !== 'string' || path.trim() === '') {
    return { ok: false, installable: false, name: null, version: null, description: null, author: null, reason: 'path is required' }
  }
  const pkgJson = join(path.trim(), 'package.json')
  let raw
  try {
    raw = await readFile(pkgJson, 'utf8')
  } catch {
    return { ok: false, installable: false, name: null, version: null, description: null, author: null, reason: 'not a DSH plugin — package.json not found at that path' }
  }
  let manifest
  try {
    manifest = JSON.parse(raw)
  } catch {
    return { ok: false, installable: false, name: null, version: null, description: null, author: null, reason: 'not a DSH plugin — package.json is not valid JSON' }
  }
  if (!isInstallableManifest(manifest)) {
    return { ok: false, installable: false, name: null, version: null, description: null, author: null, reason: 'not a DSH plugin — its package.json has no dsh.bundle manifest' }
  }
  const name = typeof manifest.name === 'string' && manifest.name !== '' ? manifest.name : null
  const version = typeof manifest.version === 'string' ? manifest.version : null
  const description = typeof manifest.description === 'string' ? manifest.description : null
  const author = manifest.author && typeof manifest.author === 'string' ? manifest.author
    : (manifest.author && typeof manifest.author === 'object' && typeof manifest.author.name === 'string' ? manifest.author.name : null)
  return { ok: true, installable: true, name, version, description, author, reason: null }
}

/** Hard ceiling on the entries one directory listing returns. */
const BROWSE_LIMIT = 400

/**
 * List the subdirectories of one filesystem path, for the folder picker.
 *
 * The browser cannot hand us an absolute path from a folder chooser without
 * going through a file-upload dialog, so the picker walks the disk through
 * this route instead: the host already runs on the user's machine with their
 * privileges, and the same trust check that guards install guards this.
 *
 * Each entry is probed for a DSH manifest so the picker can mark plugin
 * folders inline, and `self` reports whether the listed directory is itself
 * installable — that is what "Select this folder" acts on.
 */
export async function listDirectory(path, opts) {
  const hidden = !!(opts && opts.hidden)
  const raw = typeof path === 'string' ? path.trim() : ''
  const target = raw === '' ? homedir() : resolve(raw.startsWith('~') ? join(homedir(), raw.slice(1)) : raw)
  let dirents
  try {
    dirents = await readdir(target, { withFileTypes: true })
  } catch (error) {
    const code = error && error.code
    return {
      ok: false,
      path: target,
      parent: null,
      entries: [],
      truncated: false,
      self: null,
      home: homedir(),
      reason: code === 'ENOENT' ? 'no such directory'
        : code === 'ENOTDIR' ? 'not a directory'
        : code === 'EACCES' ? 'permission denied'
        : String(error && error.message ? error.message : error),
    }
  }
  const dirs = []
  for (const dirent of dirents) {
    if (!hidden && dirent.name.startsWith('.')) continue
    if (dirent.isDirectory()) {
      dirs.push(dirent.name)
      continue
    }
    // A symlinked checkout is a normal way to keep a plugin outside its
    // working tree, so resolve links rather than hiding them.
    if (!dirent.isSymbolicLink()) continue
    try {
      if ((await stat(join(target, dirent.name))).isDirectory()) dirs.push(dirent.name)
    } catch { /* dangling link */ }
  }
  dirs.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  const truncated = dirs.length > BROWSE_LIMIT
  const names = truncated ? dirs.slice(0, BROWSE_LIMIT) : dirs
  const entries = await Promise.all(names.map(async (name) => {
    const full = join(target, name)
    return { name, path: full, plugin: (await validateLocalPlugin(full)).installable }
  }))
  const parent = dirname(target)
  const self = await validateLocalPlugin(target)
  return {
    ok: true,
    path: target,
    parent: parent === target ? null : parent,
    entries,
    truncated,
    self: { installable: self.installable, name: self.name, version: self.version, reason: self.reason },
    home: homedir(),
    reason: null,
  }
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
        const filterParam = url.searchParams.get('filter')
        const filter = FILTERS.includes(filterParam) ? filterParam : 'all'
        const db = await getDb()
        // Installed/local both need the profile's plugin list, and the counts
        // shown on the filter chips need it regardless of the active filter.
        const profile = await resolveProfile()
        const plugins = await collectInstalled(profile)
        const q = url.searchParams.get('q') || ''
        let result
        if (filter === 'local') {
          const local = listLocalPlugins(db, plugins, { q })
          // What the plugin is about comes from its installed manifest, not
          // GitHub — read each one and attach version/description/author.
          result = {
            ...local,
            items: await Promise.all(local.items.map(async (item) => enrichLocalGithub(db, await enrichLocal(profile, item)))),
          }
        } else {
          result = listCatalog(db, {
            q,
            tag: url.searchParams.get('tag') || '',
            sort: SORTS.includes(sortParam) ? sortParam : 'stars',
            limit: clampInt(url.searchParams.get('limit'), 1, 500, 100),
            offset: clampInt(url.searchParams.get('offset'), 0, 100000, 0),
            filter,
            plugins,
          })
        }
        sendJson(res, 200, {
          ok: true,
          ...result,
          filter,
          counts: countsByFilter(db, plugins),
          refreshing: isRefreshing(),
          refreshedAt: lastRefreshedAt,
        })
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

  // GET /community-plugins/forks?repo=owner/name — cached fork listing for one
  // repo, so a user can inspect (and install from) a fork that carries changes
  // the upstream has not merged.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/community-plugins/forks',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'untrusted request' })
      const url = new URL(req.url, 'http://x')
      const repo = url.searchParams.get('repo') || ''
      if (!isValidRepo(repo)) return sendJson(res, 400, { error: 'invalid repo' })
      try {
        const db = await getDb()
        const result = await listForks(db, repo, url.searchParams.get('force') === '1')
        sendJson(res, result.ok ? 200 : 502, { repo, ...result })
      } catch (error) {
        sendJson(res, 500, { error: String(error && error.message ? error.message : error) })
      }
    },
  }), 'community-plugins: /community-plugins/forks route')

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

  // GET /community-plugins/browse?path=&hidden=1 — subdirectories of one path,
  // so the client can render a folder picker that yields real absolute paths.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/community-plugins/browse',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'untrusted request' })
      try {
        const url = new URL(req.url, 'http://x')
        const result = await listDirectory(url.searchParams.get('path') || '', {
          hidden: url.searchParams.get('hidden') === '1',
        })
        sendJson(res, result.ok ? 200 : 400, result)
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
      }
    },
  }), 'community-plugins: /community-plugins/browse route')

  // POST /community-plugins/validate — pre-check a local filesystem path as a DSH plugin.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/community-plugins/validate',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'untrusted request' })
      let body
      try {
        body = await readJsonBody(req)
      } catch {
        return sendJson(res, 400, { error: 'invalid body' })
      }
      const path = typeof body?.path === 'string' ? body.path.trim() : ''
      try {
        const result = await validateLocalPlugin(path)
        sendJson(res, result.ok ? 200 : 400, result)
      } catch (error) {
        sendJson(res, 500, { error: String(error && error.message ? error.message : error), ok: false, installable: false })
      }
    },
  }), 'community-plugins: /community-plugins/validate route')

  // POST /community-plugins/install — run "dsh plugin --profile <p> add <spec>".
  // Accepts either { repo: "owner/name" } for GitHub installs or
  // { path: "/local/path", dryRun?: bool } for local filesystem installs.
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
      const localPath = typeof body?.path === 'string' ? body.path.trim() : ''
      const dryRun = body?.dryRun === true
      // GitHub repo path.
      if (repo !== undefined) {
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
        return
      }
      // Local filesystem path.
      if (localPath === '') return sendJson(res, 400, { error: 'path is required for local installs' })
      try {
        const check = await validateLocalPlugin(localPath)
        if (!check.ok) return sendJson(res, 400, { ok: false, path: localPath, installable: false, error: check.reason, output: '' })
        if (dryRun) {
          return sendJson(res, 200, {
            ok: true,
            dryRun: true,
            path: localPath,
            name: check.name,
            version: check.version,
            description: check.description,
            author: check.author,
            installable: true,
          })
        }
        const profile = await resolveProfile()
        const result = await runDshPlugin(profile, ['add', localPath])
        sendJson(res, result.ok ? 200 : 400, {
          ok: result.ok,
          profile,
          path: localPath,
          name: check.name,
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
      // Local plugins may have no GitHub repo at all, so a package name is
      // accepted too — but only one that is actually installed in the profile.
      const byName = typeof body?.name === 'string' ? body.name : null
      if (!isValidRepo(repo) && byName === null) return sendJson(res, 400, { error: 'repo must be an owner/name reference' })
      try {
        const profile = await resolveProfile()
        const plugins = await collectInstalled(profile)
        if (!isValidRepo(repo)) {
          const installed = plugins.find((plugin) => plugin.name === byName)
          if (!installed) return sendJson(res, 400, { error: 'no installed plugin named ' + byName })
          const result = await runDshPlugin(profile, ['remove', installed.name])
          return sendJson(res, result.ok ? 200 : 400, {
            ok: result.ok,
            profile,
            name: installed.name,
            output: result.output,
            error: result.error,
            needsRestart: result.ok,
          })
        }
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

  // POST /community-plugins/plugin — enable/disable an installed plugin by
  // adding or removing its name from dsh.profile.bundles. The change shows up
  // immediately in this tab; the harness loads it after a restart.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/community-plugins/plugin',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'untrusted request' })
      let body
      try {
        body = await readJsonBody(req)
      } catch {
        return sendJson(res, 400, { error: 'invalid body' })
      }
      const name = typeof body?.name === 'string' ? body.name.trim() : ''
      const enabled = !!body?.enabled
      if (name === '' || name.length > 200) return sendJson(res, 400, { error: 'name must be a package name' })
      try {
        const profile = await resolveProfile()
        const plugins = await collectInstalled(profile)
        const plugin = plugins.find((candidate) => candidate.name === name)
        if (!plugin) return sendJson(res, 400, { error: 'no installed plugin named ' + name })
        const changed = await setBundleEnabled(profile, name, enabled)
        sendJson(res, changed ? 200 : 400, {
          ok: changed,
          profile,
          name,
          enabled,
          already: plugin.enabled === enabled,
          needsRestart: changed,
        })
      } catch (error) {
        sendJson(res, 500, { error: String(error && error.message ? error.message : error) })
      }
    },
  }), 'community-plugins: /community-plugins/plugin route')

  // POST /community-plugins/restart — respawn this dsh web instance with the
  // same command line, then exit once the response has flushed.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/community-plugins/restart',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'untrusted request' })
      const result = scheduleDshWebRestart()
      sendJson(res, result.ok ? 200 : 500, { ok: result.ok, restarting: result.ok, error: result.error })
      if (result.ok) {
        // Give the response time to reach the browser, then release the port.
        setTimeout(() => process.exit(0), 400)
      }
    },
  }), 'community-plugins: /community-plugins/restart route')

  // Seed the catalog in the background once at boot.
  ctx.effect(() => {
    scheduleRefresh('').catch(() => {})
    return () => {}
  }, 'community-plugins: background seed')

  console.log('[dsh-community-plugins] host routes ready')
}

export { ensureSchema, rowToRepo, aggregateTags, listCatalog, upsertRepos }
