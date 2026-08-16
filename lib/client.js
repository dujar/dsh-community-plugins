// dsh-community-plugins browser half.
//
// Zero-build hand-written client bundle (same pattern as dsh-better-archive):
// a CJS factory wrapped in the ModuleLoader call. React comes from
// require("react"). The tab registers into the Plugins settings section's
// "settings.plugins.tab" list slot, alongside the built-in "Plugin
// configuration" and "Plugin list" tabs.
//
// The host half owns a local SQLite catalog of the GitHub dsh-plugin topic
// and refreshes it in the background (at boot and while the user searches).
// This half reads that catalog through GET /community-plugins/catalog and
// renders list and grid views plus a tag (category) aggregation row.
// Install/uninstall go through the host routes, which run the real
// "dsh plugin" command in the profile.
window.__ModuleLoader__.load({
  id: 'dsh-community-plugins',
  factory: (require) => {
    'use strict'
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var createElement = React.createElement

    // Skeleton pulse animation (injected once, guarded for HMR).
    if (typeof document !== 'undefined' && !document.querySelector('style[data-dshcp-skeleton]')) {
      var skeletonStyle = document.createElement('style')
      skeletonStyle.setAttribute('data-dshcp-skeleton', '1')
      skeletonStyle.textContent = '@keyframes dshcpSkPulse { 0%, 100% { opacity: 0.5 } 50% { opacity: 1 } } .dshcp-sk { animation: dshcpSkPulse 1.3s ease-in-out infinite; background: var(--dsw-alias-bg-layer-3); }'
      document.head.appendChild(skeletonStyle)
    }

    // Dictionary namespace owned by this plugin.
    var NS = 'community.plugins'

    var STRINGS = {
      en: {
        tab: 'Community plugins',
        intro: 'Search and install plugins published under the dsh-plugin topic on GitHub.',
        searchPlaceholder: 'Search cached plugins…',
        sortLabel: 'Sort by',
        sortStars: 'Stars',
        sortUpdated: 'Recently updated',
        sortName: 'Name',
        viewList: 'List view',
        viewGrid: 'Grid view',
        allTag: 'All',
        filterTags: 'Filter tags…',
        noMatches: 'No tags match.',
        loading: 'Loading plugins…',
        refreshing: 'Updating…',
        cachedNote: 'Browsing a local cache; refreshed in the background from GitHub.',
        results: 'results',
        showingTruncated: 'showing the first',
        emptyCatalog: 'Nothing cached yet — the background refresh is still running, or click Refresh.',
        catalogError: 'Could not read the local plugin catalog.',
        retry: 'Retry',
        refresh: 'Refresh',
        install: 'Install',
        installing: 'Installing…',
        installHint: 'Runs dsh plugin add on the host. Only repos that publish a DSH plugin (a dsh.bundle manifest in package.json) install cleanly.',
        installed: 'Installed',
        uninstall: 'Remove',
        uninstalling: 'Removing…',
        openRepo: 'Open repository',
        copyCommand: 'Copy install command',
        copied: 'Copied',
        installedOk: 'Installed. Restart dsh web to activate it.',
        uninstalledOk: 'Removed. Restart dsh web to apply.',
        installFailed: 'Install failed.',
        uninstallFailed: 'Remove failed.',
        restartNote: 'Restart dsh web, then refresh this page to load the change.',
        archived: 'Archived',
        fork: 'Fork',
        colUpdated: 'Updated',
      },
      zh: {
        tab: '社区插件',
        intro: '搜索并安装 GitHub dsh-plugin 主题下发布的插件。',
        searchPlaceholder: '搜索已缓存的插件…',
        sortLabel: '排序方式',
        sortStars: '星标数',
        sortUpdated: '最近更新',
        sortName: '名称',
        viewList: '列表视图',
        viewGrid: '网格视图',
        allTag: '全部',
        filterTags: '筛选标签…',
        noMatches: '没有匹配的标签。',
        loading: '正在加载插件…',
        refreshing: '更新中…',
        cachedNote: '正在浏览本地缓存，后台会从 GitHub 自动刷新。',
        results: '个结果',
        showingTruncated: '仅显示前',
        emptyCatalog: '尚无缓存，后台刷新仍在进行，或点击“刷新”。',
        catalogError: '无法读取本地插件目录。',
        retry: '重试',
        refresh: '刷新',
        install: '安装',
        installing: '安装中…',
        installHint: '在主机上运行 dsh plugin add。只有发布为 DSH 插件（package.json 含 dsh.bundle）的仓库才能正常安装。',
        installed: '已安装',
        uninstall: '卸载',
        uninstalling: '卸载中…',
        openRepo: '打开仓库',
        copyCommand: '复制安装命令',
        copied: '已复制',
        installedOk: '安装完成，重启 dsh web 生效。',
        uninstalledOk: '已卸载，重启 dsh web 生效。',
        installFailed: '安装失败。',
        uninstallFailed: '卸载失败。',
        restartNote: '请重启 dsh web 并刷新页面以应用更改。',
        archived: '已归档',
        fork: 'Fork',
        colUpdated: '更新时间',
      },
    }

    // ---- small pure helpers ----

    function repoSlug(repo) {
      var idx = String(repo).indexOf('/')
      return idx === -1 ? String(repo) : String(repo).slice(idx + 1)
    }

    function fmtStars(n) {
      var num = Number(n)
      if (!isFinite(num)) return String(n || 0)
      try {
        if (typeof Intl !== 'undefined' && Intl.NumberFormat) {
          return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(num)
        }
      } catch (e) { /* fall through */ }
      if (num >= 1000) return (num / 1000).toFixed(1).replace(/[.]0$/, '') + 'k'
      return String(num)
    }

    function fmtDate(iso, lang) {
      if (!iso) return ''
      var d = new Date(iso)
      if (isNaN(d.getTime())) return ''
      try {
        if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
          return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(d)
        }
      } catch (e) { /* fall through */ }
      return String(iso).slice(0, 10)
    }

    function installCommand(profile, repo) {
      return 'dsh plugin --profile ' + (profile || 'web') + ' add github:' + repo
    }

    function isInstalled(plugins, repo) {
      var slug = repoSlug(repo)
      for (var i = 0; i < plugins.length; i++) {
        var p = plugins[i]
        if (p.name === slug || p.repo === repo) return p
      }
      return null
    }

    // ---- tag categorization ----
    // Ordered category buckets: a tag lands in the FIRST category whose key
    // matches (substring for keys of length >= 3, exact for short keys), and
    // "Other" when nothing matches. Keys are lowercased GitHub topics.
    var TAG_CATEGORIES = [
      { id: 'dsh', en: 'DSH & DeepSeek', zh: 'DSH 与 DeepSeek', keys: ['dsh', 'deepseek', 'cordis', 'harness', 'hermes'] },
      { id: 'trading', en: 'Trading & Finance', zh: '交易与金融', keys: ['trading', 'trade', 'hyperliquid', 'crypto', 'bitcoin', 'finance', 'market', 'chart', 'candlestick', 'quant', 'order'] },
      { id: 'security', en: 'Security', zh: '安全', keys: ['security', 'auth', 'encryption', 'wallet', 'privacy', 'key'] },
      { id: 'data', en: 'Data & Storage', zh: '数据与存储', keys: ['sqlite', 'database', 'postgres', 'redis', 'storage', 'vector', 'embedding', 'json', 'cache', 'data'] },
      { id: 'lang', en: 'Languages & Runtimes', zh: '语言与运行时', keys: ['javascript', 'typescript', 'python', 'rust', 'golang', 'node', 'deno', 'bun', 'ruby', 'php', 'kotlin', 'swift', 'csharp', 'java', 'cpp', 'zig', 'lua'] },
      { id: 'web', en: 'Web & UI', zh: 'Web 与界面', keys: ['react', 'vue', 'svelte', 'angular', 'tailwind', 'css', 'html', 'frontend', 'design', 'vibe-coding', 'prototyping', 'figma', 'desktop-app', 'theme', 'component', 'resume'] },
      { id: 'tooling', en: 'Tooling & CLI', zh: '工具与命令行', keys: ['cli', 'terminal', 'devtools', 'vscode', 'editor', 'automation', 'workflow', 'scheduler', 'docker', 'shell', 'tmux', 'test', 'server', 'self-hosted'] },
      { id: 'ai', en: 'AI & Agents', zh: 'AI 与智能体', keys: ['agent', 'llm', 'rag', 'mcp', 'codex', 'claude', 'cursor', 'copilot', 'gpt', 'openai', 'openclaw', 'prompt', 'skill', 'model', 'inference', 'memory', 'context', 'byok', 'self-evolving', 'knowledge', 'ai-'] },
    ]

    function categoryOf(tag) {
      for (var i = 0; i < TAG_CATEGORIES.length; i++) {
        var keys = TAG_CATEGORIES[i].keys
        for (var j = 0; j < keys.length; j++) {
          var k = keys[j]
          if (k.length >= 3 ? tag.indexOf(k) !== -1 : tag === k) return TAG_CATEGORIES[i]
        }
      }
      return null
    }

    function groupTags(tags, lang) {
      var groups = []
      var byId = {}
      for (var i = 0; i < TAG_CATEGORIES.length; i++) {
        var c = TAG_CATEGORIES[i]
        var g = { id: c.id, label: lang === 'zh' ? c.zh : c.en, tags: [] }
        byId[c.id] = g
        groups.push(g)
      }
      var other = { id: 'other', label: lang === 'zh' ? '其他' : 'Other', tags: [] }
      groups.push(other)
      for (var j = 0; j < tags.length; j++) {
        var cat = categoryOf(tags[j].tag)
        ;(byId[cat ? cat.id : null] || other).tags.push(tags[j])
      }
      return groups.filter(function (g) { return g.tags.length > 0 })
    }

    // ---- tiny presentational pieces ----

    function SearchIcon() {
      return createElement('svg', {
        width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        createElement('circle', { cx: 11, cy: 11, r: 7 }),
        createElement('path', { d: 'M21 21l-4.35-4.35' }),
      )
    }

    function ViewIcon(kind) {
      var style = { fill: 'currentColor' }
      if (kind === 'list') {
        return createElement('svg', { width: 15, height: 15, viewBox: '0 0 24 24', 'aria-hidden': 'true', style: style },
          createElement('rect', { x: 3, y: 4, width: 18, height: 3, rx: 1 }),
          createElement('rect', { x: 3, y: 10.5, width: 18, height: 3, rx: 1 }),
          createElement('rect', { x: 3, y: 17, width: 18, height: 3, rx: 1 }),
        )
      }
      if (kind === 'grid') {
        return createElement('svg', { width: 15, height: 15, viewBox: '0 0 24 24', 'aria-hidden': 'true', style: style },
          createElement('rect', { x: 3, y: 3, width: 8, height: 8, rx: 1.5 }),
          createElement('rect', { x: 13, y: 3, width: 8, height: 8, rx: 1.5 }),
          createElement('rect', { x: 3, y: 13, width: 8, height: 8, rx: 1.5 }),
          createElement('rect', { x: 13, y: 13, width: 8, height: 8, rx: 1.5 }),
        )
      }
    }

    function StarGlyph() {
      return createElement('span', { style: { color: '#e3b341', fontSize: 12, lineHeight: 1 } }, '★')
    }

    function chipStyle(bg, fg) {
      return {
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '1px 8px', borderRadius: 999,
        fontSize: 11, lineHeight: '17px', fontWeight: 500,
        background: bg, color: fg, whiteSpace: 'nowrap',
      }
    }

    function NameLink(props) {
      return createElement('a', {
        href: props.item.html_url, target: '_blank', rel: 'noreferrer noopener',
        title: props.item.full_name,
        style: {
          color: 'var(--dsw-alias-label-primary)', fontWeight: 600, fontSize: 14,
          textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        },
      }, props.item.full_name)
    }

    function Avatar(props) {
      if (!props.item.owner_avatar) return null
      return createElement('img', {
        src: props.item.owner_avatar, alt: '', width: props.size || 28, height: props.size || 28,
        style: { borderRadius: 6, flexShrink: 0, background: 'rgba(128,128,128,0.2)' },
      })
    }

    // Install / remove / open / copy actions, shared across the list and grid views.
    function RepoActions(props) {
      var t = props.t
      var item = props.item
      var repo = item.full_name
      var busy = props.busy
      var copied = props.copied
      var installed = props.installed

      var small = {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
        fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 5,
        background: 'rgba(128,128,128,0.08)', color: 'var(--dsw-alias-label-primary)',
      }
      var primaryStyle = {
        border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer',
        fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 5,
        background: 'var(--dsw-alias-state-business-primary)', color: '#ffffff', fontWeight: 500,
      }
      var dangerStyle = {
        border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer',
        fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 5,
        background: 'rgba(229,83,75,0.14)', color: '#e5534b',
      }
      var disabledStyle = { opacity: 0.55, cursor: 'default' }

      var primary
      if (installed) {
        primary = createElement('button', {
          type: 'button', onClick: function () { props.onUninstall(repo) },
          disabled: !!busy,
          style: busy ? { ...dangerStyle, ...disabledStyle } : dangerStyle,
        }, busy ? t('uninstalling') : t('uninstall'))
      } else if (busy) {
        primary = createElement('button', { type: 'button', disabled: true, style: { ...primaryStyle, ...disabledStyle } }, t('installing'))
      } else {
        primary = createElement('button', { type: 'button', onClick: function () { props.onInstall(repo) }, title: t('installHint'), style: primaryStyle }, t('install'))
      }

      var copy = props.compact ? null : createElement('button', {
        type: 'button', onClick: function () { props.onCopy(repo) },
        title: t('copyCommand'), style: small,
      }, copied ? ('✓ ' + t('copied')) : t('copyCommand'))

      var open = createElement('a', {
        href: item.html_url, target: '_blank', rel: 'noreferrer noopener',
        title: t('openRepo'),
        style: { ...small, textDecoration: 'none', padding: '4px 8px' },
      }, props.compact ? '↗' : (t('openRepo') + ' ↗'))

      return createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
        primary, copy, open,
      )
    }

    function Badges(props) {
      var t = props.t
      var item = props.item
      return createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
        props.installed ? createElement('span', { style: chipStyle('rgba(46,160,67,0.16)', '#2ea043') }, '✓ ' + t('installed')) : null,
        item.archived ? createElement('span', { style: chipStyle('rgba(128,128,128,0.16)', 'var(--dsw-alias-label-tertiary)') }, t('archived')) : null,
        item.fork ? createElement('span', { style: chipStyle('rgba(128,128,128,0.16)', 'var(--dsw-alias-label-tertiary)') }, t('fork')) : null,
      )
    }

    function TopicChips(props) {
      var topics = props.topics || []
      if (!topics.length) return null
      return createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
        topics.map(function (topic) {
          return createElement('span', { key: topic, style: chipStyle('var(--dsw-alias-bg-module-platform)', 'var(--dsw-alias-label-secondary)') }, topic)
        }),
      )
    }

    // ---- list view (rich card) ----

    function ListCard(props) {
      var t = props.t
      var item = props.item
      var lang = props.lang
      return createElement('div', {
        style: {
          display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px',
          border: '1px solid var(--dsw-alias-border-l2)',
          background: 'var(--dsw-alias-bg-layer-3)', borderRadius: 10,
        },
      },
        createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          createElement(Avatar, { item: item }),
          createElement('div', { style: { flex: '1 1 auto', minWidth: 0 } },
            createElement(NameLink, { item: item }),
            createElement('div', {
              style: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 2, color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 },
            },
              createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, StarGlyph(), fmtStars(item.stargazers)),
              item.language ? createElement('span', null, item.language) : null,
              createElement('span', null, t('colUpdated') + ' ' + fmtDate(item.pushed_at, lang)),
            ),
          ),
          createElement(Badges, { t: t, item: item, installed: props.installed }),
        ),
        item.description ? createElement('p', {
          style: { margin: 0, fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)', overflowWrap: 'anywhere' },
        }, item.description) : null,
        createElement(TopicChips, { topics: item.topics }),
        createElement(RepoActions, { t: t, item: item, installed: props.installed, busy: props.busy, copied: props.copied, onInstall: props.onInstall, onUninstall: props.onUninstall, onCopy: props.onCopy }),
      )
    }

    // ---- grid view (compact card) ----

    function GridCard(props) {
      var t = props.t
      var item = props.item
      var lang = props.lang
      return createElement('div', {
        style: {
          display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px',
          border: '1px solid var(--dsw-alias-border-l2)',
          background: 'var(--dsw-alias-bg-layer-3)', borderRadius: 10, minWidth: 0,
        },
      },
        createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
          createElement(Avatar, { item: item, size: 24 }),
          createElement('div', { style: { flex: '1 1 auto', minWidth: 0 } },
            createElement(NameLink, { item: item }),
            createElement('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.owner),
          ),
        ),
        createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } },
          createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, StarGlyph(), fmtStars(item.stargazers)),
          item.language ? createElement('span', null, item.language) : null,
          createElement('span', { style: { marginLeft: 'auto' } }, fmtDate(item.pushed_at, lang)),
          createElement(Badges, { t: t, item: item, installed: props.installed }),
        ),
        item.description ? createElement('p', {
          style: {
            margin: 0, fontSize: 12, lineHeight: '17px', color: 'var(--dsw-alias-label-secondary)',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          },
        }, item.description) : null,
        createElement(RepoActions, { t: t, item: item, compact: true, installed: props.installed, busy: props.busy, copied: props.copied, onInstall: props.onInstall, onUninstall: props.onUninstall, onCopy: props.onCopy }),
      )
    }

    // ---- loading skeleton ----

    function Sk(props) {
      return createElement('div', {
        className: 'dshcp-sk',
        style: {
          height: props.h || 12,
          width: props.w || '100%',
          borderRadius: props.round ? 999 : 6,
          opacity: props.dim ? 0.6 : undefined,
        },
      })
    }

    function SkeletonListCard() {
      return createElement('div', {
        style: { display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10 },
      },
        createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          createElement('div', { className: 'dshcp-sk', style: { width: 28, height: 28, borderRadius: 6, flexShrink: 0 } }),
          createElement('div', { style: { flex: '1 1 auto', display: 'flex', flexDirection: 'column', gap: 6 } },
            createElement(Sk, { w: '55%', h: 13 }),
            createElement(Sk, { w: '32%', h: 10, dim: true }),
          ),
        ),
        createElement(Sk, { w: '82%', h: 12 }),
        createElement('div', { style: { display: 'flex', gap: 6 } },
          createElement(Sk, { w: 56, h: 18, round: true }),
          createElement(Sk, { w: 72, h: 18, round: true }),
          createElement(Sk, { w: 48, h: 18, round: true }),
        ),
        createElement(Sk, { w: 84, h: 26 }),
      )
    }

    function SkeletonGridCard() {
      return createElement('div', {
        style: { display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10 },
      },
        createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          createElement('div', { className: 'dshcp-sk', style: { width: 24, height: 24, borderRadius: 6, flexShrink: 0 } }),
          createElement(Sk, { w: '60%', h: 13 }),
        ),
        createElement(Sk, { w: '40%', h: 10, dim: true }),
        createElement(Sk, { w: '90%', h: 11 }),
        createElement(Sk, { w: '70%', h: 11 }),
        createElement(Sk, { w: 80, h: 24 }),
      )
    }

    function SkeletonView(props) {
      var count = props.view === 'grid' ? 8 : 5
      var cards = []
      for (var i = 0; i < count; i++) {
        cards.push(props.view === 'grid' ? createElement(SkeletonGridCard, { key: i }) : createElement(SkeletonListCard, { key: i }))
      }
      return createElement('div', {
        role: 'status', 'aria-label': props.label,
        style: props.view === 'grid'
          ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10, alignItems: 'start' }
          : { display: 'flex', flexDirection: 'column', gap: 10 },
      }, cards)
    }

    // ---- main tab ----

    var VIEW_KEY = 'dsh-community-plugins:view'
    function storedView() {
      try {
        var v = window.localStorage.getItem(VIEW_KEY)
        return v === 'grid' ? v : 'list'
      } catch (e) { return 'list' }
    }

    function CommunityPluginsTab(props) {
      var t = props.t
      var api = props.api

      var queryState = React.useState('')
      var query = queryState[0]; var setQuery = queryState[1]
      var sortState = React.useState('stars')
      var sort = sortState[0]; var setSort = sortState[1]
      var viewState = React.useState(storedView())
      var view = viewState[0]; var setViewState = viewState[1]
      var tagState = React.useState('')
      var tag = tagState[0]; var setTag = tagState[1]
      var tagQueryState = React.useState('')
      var tagQuery = tagQueryState[0]; var setTagQuery = tagQueryState[1]
      var itemsState = React.useState([])
      var items = itemsState[0]; var setItems = itemsState[1]
      var totalState = React.useState(0)
      var total = totalState[0]; var setTotal = totalState[1]
      var allCountState = React.useState(0)
      var allCount = allCountState[0]; var setAllCount = allCountState[1]
      var tagsState = React.useState([])
      var tags = tagsState[0]; var setTags = tagsState[1]
      var loadingState = React.useState(true)
      var loading = loadingState[0]; var setLoading = loadingState[1]
      var refreshingState = React.useState(false)
      var refreshing = refreshingState[0]; var setRefreshing = refreshingState[1]
      var errorState = React.useState('')
      var error = errorState[0]; var setError = errorState[1]
      var pluginsState = React.useState([])
      var plugins = pluginsState[0]; var setPlugins = pluginsState[1]
      var profileState = React.useState('web')
      var profile = profileState[0]; var setProfile = profileState[1]
      var busyState = React.useState(null)
      var busy = busyState[0]; var setBusy = busyState[1]
      var noticeState = React.useState(null)
      var notice = noticeState[0]; var setNotice = noticeState[1]
      var copiedState = React.useState('')
      var copied = copiedState[0]; var setCopied = copiedState[1]

      var lang = typeof api.lang === 'function' ? api.lang() : 'en'

      function loadState() {
        api.state().then(function (s) {
          if (s && Array.isArray(s.plugins)) setPlugins(s.plugins)
          if (s && typeof s.profile === 'string' && s.profile !== '') setProfile(s.profile)
        }).catch(function () {})
      }

      function buildQueryString() {
        var parts = ['sort=' + encodeURIComponent(sort), 'limit=500']
        if (query) parts.push('q=' + encodeURIComponent(query))
        if (tag) parts.push('tag=' + encodeURIComponent(tag))
        return parts.join('&')
      }

      function fetchCatalog(silent) {
        if (!silent) setLoading(true)
        api.catalog(buildQueryString()).then(function (res) {
          if (res && res.ok) {
            setItems(res.items || [])
            setTotal(res.total || 0)
            setAllCount(res.allCount || 0)
            setTags(res.tags || [])
            setRefreshing(!!res.refreshing)
            setError('')
          } else {
            setError('catalog')
          }
          setLoading(false)
        }).catch(function () {
          setError('catalog')
          setLoading(false)
        })
      }

      function manualRefresh() {
        api.refresh(query).catch(function () {})
        setRefreshing(true)
        setTimeout(function () { fetchCatalog(true) }, 1500)
      }

      // Mount: load installed state + catalog, poll for background refreshes.
      React.useEffect(function () {
        loadState()
        fetchCatalog(false)
        var interval = setInterval(function () { fetchCatalog(true) }, 6000)
        return function () { clearInterval(interval) }
      }, [])

      // Query / sort / tag changes re-read the local catalog (debounced).
      React.useEffect(function () {
        var id = setTimeout(function () { fetchCatalog(false) }, 300)
        return function () { clearTimeout(id) }
      }, [query, sort, tag])

      // Query changes also trigger a background GitHub refresh (slower debounce).
      React.useEffect(function () {
        var id = setTimeout(function () { api.refresh(query).catch(function () {}) }, 1200)
        return function () { clearTimeout(id) }
      }, [query])

      function setView(v) {
        setViewState(v)
        try { window.localStorage.setItem(VIEW_KEY, v) } catch (e) { /* ignore */ }
      }

      function copyText(text) {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(function () { copyTextFallback(text) })
            return
          }
        } catch (e) { /* fall through */ }
        copyTextFallback(text)
      }
      function copyTextFallback(text) {
        try {
          var ta = document.createElement('textarea')
          ta.value = text
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
        } catch (e) { /* ignore */ }
      }
      function onCopy(repo) {
        copyText(installCommand(profile, repo))
        setCopied(repo)
        setTimeout(function () { setCopied('') }, 1600)
      }
      function onInstall(repo) {
        setBusy(repo)
        setNotice(null)
        api.install(repo).then(function (res) {
          setBusy(null)
          if (res && res.ok) {
            setNotice({ kind: 'ok', text: t('installedOk'), detail: t('restartNote') })
            loadState()
          } else {
            setNotice({ kind: 'err', text: t('installFailed'), detail: [(res && res.error) || '', (res && res.output) || ''].filter(Boolean).join('\n\n') })
          }
        }).catch(function (e) {
          setBusy(null)
          setNotice({ kind: 'err', text: t('installFailed'), detail: String(e && e.message ? e.message : e) })
        })
      }
      function onUninstall(repo) {
        setBusy(repo)
        setNotice(null)
        api.uninstall(repo).then(function (res) {
          setBusy(null)
          if (res && res.ok) {
            setNotice({ kind: 'ok', text: t('uninstalledOk'), detail: t('restartNote') })
            loadState()
          } else {
            setNotice({ kind: 'err', text: t('uninstallFailed'), detail: [(res && res.error) || '', (res && res.output) || ''].filter(Boolean).join('\n\n') })
          }
        }).catch(function (e) {
          setBusy(null)
          setNotice({ kind: 'err', text: t('uninstallFailed'), detail: String(e && e.message ? e.message : e) })
        })
      }

      var controlStyle = {
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 8, font: 'inherit', fontSize: 13,
      }

      function viewButton(v, title, icon) {
        var active = view === v
        return createElement('button', {
          type: 'button', title: title, 'aria-label': title, 'aria-pressed': active ? 'true' : 'false',
          onClick: function () { setView(v) },
          style: {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            height: 36, minWidth: 36, padding: '0 10px', cursor: 'pointer',
            border: '1px solid ' + (active ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l2)'),
            background: active ? 'rgba(128,128,128,0.14)' : 'var(--dsw-alias-bg-layer-1)',
            color: active ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-secondary)',
            borderRadius: 8, fontSize: 13, fontFamily: 'inherit',
          },
        }, icon)
      }

      function tagChip(c, selected) {
        return createElement('button', {
          type: 'button', onClick: function () { setTag(selected ? '' : c.tag) },
          style: {
            display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
            border: '1px solid ' + (selected ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l2)'),
            background: selected ? 'rgba(128,128,128,0.14)' : 'var(--dsw-alias-bg-layer-3)',
            color: selected ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-primary)',
            borderRadius: 999, padding: '3px 11px', fontSize: 12, fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          },
        }, c.tag, createElement('span', { style: { opacity: 0.65, fontVariantNumeric: 'tabular-nums' } }, String(c.count)))
      }

      function content() {
        if (error === 'catalog') {
          return createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--dsw-alias-state-error-primary)' } },
            createElement('span', null, t('catalogError')),
            createElement('button', { type: 'button', onClick: manualRefresh, style: { ...controlStyle, padding: '4px 10px', cursor: 'pointer', color: 'inherit' } }, t('retry')),
          )
        }
        if (items.length === 0) {
          return createElement('p', { style: { margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' } }, t('emptyCatalog'))
        }
        var cardProps = function (item) {
          var repo = item.full_name
          return {
            key: repo, item: item, t: t, lang: lang,
            installed: isInstalled(plugins, repo),
            busy: busy === repo, copied: copied === repo,
            onInstall: onInstall, onUninstall: onUninstall, onCopy: onCopy,
          }
        }
        if (view === 'grid') {
          return createElement('div', {
            style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10, alignItems: 'start' },
          }, items.map(function (item) { return createElement(GridCard, cardProps(item)) }))
        }
        return createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          items.map(function (item) { return createElement(ListCard, cardProps(item)) }),
        )
      }

      var grouped = groupTags(tags, lang)
      var tagQ = tagQuery.trim().toLowerCase()
      if (tagQ !== '') {
        grouped = grouped.map(function (g) {
          return { id: g.id, label: g.label, tags: g.tags.filter(function (c) { return c.tag.toLowerCase().indexOf(tagQ) !== -1 }) }
        }).filter(function (g) { return g.tags.length > 0 })
      }

      return createElement('div', {
        style: { display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 760 },
      },
        // toolbar
        createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          createElement('div', {
            style: { position: 'relative', flex: '1 1 220px', minWidth: 180, display: 'flex', alignItems: 'center' },
          },
            createElement('span', { style: { position: 'absolute', left: 12, color: 'var(--dsw-alias-label-tertiary)', display: 'inline-flex' } }, SearchIcon()),
            createElement('input', {
              type: 'search', value: query, placeholder: t('searchPlaceholder'),
              onChange: function (e) { setQuery(e.target.value) },
              style: { ...controlStyle, width: '100%', height: 36, padding: '0 12px 0 36px', outline: 'none' },
            }),
          ),
          createElement('select', {
            value: sort, onChange: function (e) { setSort(e.target.value) },
            'aria-label': t('sortLabel'),
            style: { ...controlStyle, height: 36, padding: '0 8px', cursor: 'pointer' },
          },
            createElement('option', { value: 'stars' }, t('sortStars')),
            createElement('option', { value: 'updated' }, t('sortUpdated')),
            createElement('option', { value: 'name' }, t('sortName')),
          ),
          createElement('div', { style: { display: 'inline-flex', gap: 6 } },
            viewButton('list', t('viewList'), ViewIcon('list')),
            viewButton('grid', t('viewGrid'), ViewIcon('grid')),
          ),
        ),
        // notice banner
        notice ? createElement('div', {
          style: {
            display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', borderRadius: 8, fontSize: 13,
            border: '1px solid ' + (notice.kind === 'ok' ? 'rgba(46,160,67,0.4)' : 'var(--dsw-alias-state-error-primary)'),
            background: notice.kind === 'ok' ? 'rgba(46,160,67,0.1)' : 'rgba(229,83,75,0.1)',
            color: 'var(--dsw-alias-label-primary)',
          },
        },
          createElement('span', { style: { fontWeight: 600, color: notice.kind === 'ok' ? '#2ea043' : '#e5534b' } }, notice.text),
          notice.detail ? createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, notice.detail) : null,
        ) : null,
        // status / count row
        createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } },
          createElement('span', null, t('cachedNote')),
          refreshing ? createElement('span', { style: { color: 'var(--dsw-alias-state-business-primary)' } }, t('refreshing')) : null,
          createElement('span', { style: { marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' } }, (loading ? '' : total + ' ' + t('results'))),
          createElement('button', {
            type: 'button', onClick: manualRefresh, title: t('refresh'),
            style: { ...controlStyle, padding: '2px 10px', cursor: 'pointer', fontSize: 12 },
          }, t('refresh')),
        ),
        // categorized tag area: All + active tag + tag filter, then grouped chips
        tags.length || tag ? createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            createElement('button', {
              type: 'button', onClick: function () { setTag('') },
              style: {
                display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                border: '1px solid ' + (tag === '' ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l2)'),
                background: tag === '' ? 'rgba(128,128,128,0.14)' : 'var(--dsw-alias-bg-layer-3)',
                color: tag === '' ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-primary)',
                borderRadius: 999, padding: '3px 11px', fontSize: 12, fontFamily: 'inherit', whiteSpace: 'nowrap',
              },
            }, t('allTag'), createElement('span', { style: { opacity: 0.65, fontVariantNumeric: 'tabular-nums' } }, String(allCount))),
            tag ? createElement('button', {
              type: 'button', onClick: function () { setTag('') },
              title: t('allTag'),
              style: {
                display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                border: '1px solid var(--dsw-alias-state-business-primary)',
                background: 'rgba(128,128,128,0.14)', color: 'var(--dsw-alias-state-business-primary)',
                borderRadius: 999, padding: '3px 11px', fontSize: 12, fontFamily: 'inherit', whiteSpace: 'nowrap',
              },
            }, tag, ' ×') : null,
            createElement('input', {
              type: 'search', value: tagQuery, placeholder: t('filterTags'), 'aria-label': t('filterTags'),
              onChange: function (e) { setTagQuery(e.target.value) },
              style: {
                flex: '1 1 140px', minWidth: 120, height: 28,
                background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
                border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
                fontSize: 12, fontFamily: 'inherit', padding: '0 10px', outline: 'none',
              },
            }),
          ),
          createElement('div', {
            style: {
              maxHeight: 160, overflowY: 'auto', paddingRight: 4,
              display: 'flex', flexDirection: 'column', gap: 8,
            },
          },
            grouped.length ? grouped.map(function (g) {
              return createElement('div', { key: g.id, style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                createElement('div', { style: { fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 2px' } }, g.label),
                createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
                  g.tags.map(function (c) { return tagChip(c, tag === c.tag) }),
                ),
              )
            }) : createElement('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, t('noMatches')),
          ),
        ) : null,
        loading && items.length === 0 ? createElement(SkeletonView, { view: view, label: t('loading') }) : content(),
        total > items.length ? createElement('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, t('showingTruncated') + ' ' + items.length + ' ' + t('results')) : null,
      )
    }

    function apply(ctx) {
      var locale = ctx.get('locale')
      var slots = ctx.get('slots')

      // Return the disposer so an HMR re-activation unregisters the dictionary
      // before re-registering it — locale.register throws on a duplicate locale.
      ctx.effect(function () { return locale.register(NS, STRINGS) }, 'community-plugins: dictionaries')
      var t = locale.bind(NS)

      function activeLang() {
        try {
          if (locale && typeof locale.getLocale === 'function') {
            var snap = locale.getLocale()
            var id = snap && snap.active
            if (id === 'zh' || id === 'en') return id
          }
        } catch (e) { /* locale service unavailable */ }
        try {
          return String(navigator.language || '').toLowerCase().slice(0, 2) === 'zh' ? 'zh' : 'en'
        } catch (e) { return 'en' }
      }

      function post(path, repo) {
        return fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ repo: repo }),
        }).then(function (r) { return r.json().catch(function () { return {} }) })
      }

      var face = {
        state: function () {
          return fetch('/community-plugins/state').then(function (r) { return r.json() })
        },
        catalog: function (qs) {
          return fetch('/community-plugins/catalog?' + qs).then(function (r) { return r.json() })
        },
        refresh: function (q) {
          return fetch('/community-plugins/refresh', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ q: q || '' }),
          }).then(function (r) { return r.json().catch(function () { return {} }) })
        },
        install: function (repo) { return post('/community-plugins/install', repo) },
        uninstall: function (repo) { return post('/community-plugins/uninstall', repo) },
        lang: activeLang,
      }

      slots.inject('settings.plugins.tab', function () {
        return slots.register({
          name: 'settings.plugins.tab',
          id: 'community',
          order: 20,
          label: function () { return t('tab') },
          locale: NS,
          inject: function () { return { api: face } },
        }, CommunityPluginsTab)
      })
    }

    exports.name = 'dsh-community-plugins'
    exports.inject = ['slots', 'locale']
    exports.apply = apply

    return module.exports
  },
})
