// dsh-community-plugins browser half.
//
// Zero-build hand-written client bundle (same pattern as dsh-better-archive):
// a CJS factory wrapped in the ModuleLoader call. React comes from
// require("react"). The tab registers into the Plugins settings section's
// "settings.plugins.tab" list slot, alongside the built-in "Plugin
// configuration" and "Plugin list" tabs.
//
// The host half owns a local SQLite catalog of the GitHub dsh-plugin topic
// and refreshes it in the background (at boot and when the search term
// changes). This half reads that catalog through GET /community-plugins/catalog
// and renders list and grid views plus a tag (category) aggregation row.
// Reads are deliberately user-driven: the catalog is re-read only when a filter
// changes or Refresh is pressed, and filters plus the last result set are kept
// at module scope so switching settings tabs does not reset the search.
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
        sortForks: 'Forks',
        sortCreated: 'Recently created',
        sortUpdated: 'Recently updated',
        sortName: 'Name',
        viewList: 'List view',
        viewGrid: 'Grid view',
        allTag: 'All',
        filterAll: 'All',
        filterInstalled: 'Installed',
        filterLocal: 'Local only',
        filterLocalHint: 'Plugins installed in this profile that are not published under the dsh-plugin topic.',
        localBadge: 'Local',
        localNote: 'Installed in this profile, not found in the community catalog.',
        readme: 'README',
        readmeTruncated: 'README truncated for display.',
        emptyInstalled: 'No installed plugin matches this filter.',
        emptyLocal: 'Every installed plugin is in the community catalog.',
        clearFilters: 'Clear filters',
        filterTags: 'Filter tags…',
        noMatches: 'No tags match.',
        loading: 'Loading plugins…',
        refreshing: 'Updating…',
        cachedNote: 'Browsing a local cache. Results stay put until you change a filter or press Refresh.',
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
        notEnabled: 'Not enabled',
        notEnabledHint: 'Installed in the profile but missing from dsh.profile.bundles, so it is not loaded. Reinstall it here to add it back.',
        uninstall: 'Remove',
        uninstalling: 'Removing…',
        openRepo: 'Open repository',
        forksHint: 'Forks — click to browse them and install from one',
        forksOf: 'Forks of',
        forksLoading: 'Loading forks…',
        forksEmpty: 'This repository has no forks.',
        forksError: 'Could not load forks from GitHub.',
        forksStale: 'Showing a cached list — GitHub is rate-limited right now.',
        forksNote: 'A fork may carry fixes the upstream has not merged. Compare it first, then install from the fork if you want those changes.',
        compare: 'Compare with upstream',
        replaces: 'replaces',
        close: 'Close',
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
        // Local plugin add flow.
        addLocal: 'Add local plugin',
        addLocalHint: 'Click Browse to pick the folder, or paste the path. Needs a package.json with dsh.bundle.',
        browse: 'Browse…',
        pickFolder: 'Choose plugin folder',
        pickHint: 'Folders are read on this machine — nothing is uploaded.',
        pickHere: 'Select this folder',
        pickUp: 'Up',
        pickHome: 'Home',
        pickEmpty: 'No subfolders here',
        pickHidden: 'Show hidden',
        pickPlugin: 'plugin',
        pickSelect: 'Select',
        pickLoading: 'Reading…',
        pickTruncated: 'Showing the first 400 folders.',
        validate: 'Validate',
        validating: 'Validating…',
        localValid: 'Valid DSH plugin',
        localInvalid: 'Not a valid DSH plugin',
        localValidHint: 'This path has a valid dsh.bundle manifest and can be installed.',
        localInvalidHint: 'No dsh.bundle.patch found — this is not a DSH plugin.',
        dryRun: 'Dry run',
        dryRunHint: 'Check what would happen without actually installing.',
        dryRunOk: 'Dry run passed — ready to install.',
        dryRunFailed: 'Dry run failed.',
        installLocal: 'Install local plugin',
        installingLocal: 'Installing…',
      },
      zh: {
        tab: '社区插件',
        intro: '搜索并安装 GitHub dsh-plugin 主题下发布的插件。',
        searchPlaceholder: '搜索已缓存的插件…',
        sortLabel: '排序方式',
        sortStars: '星标数',
        sortForks: '分支数',
        sortCreated: '最近创建',
        sortUpdated: '最近更新',
        sortName: '名称',
        viewList: '列表视图',
        viewGrid: '网格视图',
        allTag: '全部',
        filterAll: '全部',
        filterInstalled: '已安装',
        filterLocal: '仅本地',
        filterLocalHint: '已安装到该配置档、但未发布在 dsh-plugin 主题下的插件。',
        localBadge: '本地',
        localNote: '已安装到该配置档，社区目录中没有对应条目。',
        readme: 'README',
        readmeTruncated: 'README 过长，已截断显示。',
        emptyInstalled: '没有符合该筛选条件的已安装插件。',
        emptyLocal: '所有已安装插件都在社区目录中。',
        clearFilters: '清除筛选',
        filterTags: '筛选标签…',
        noMatches: '没有匹配的标签。',
        loading: '正在加载插件…',
        refreshing: '更新中…',
        cachedNote: '正在浏览本地缓存；仅在更改筛选条件或点击“刷新”时更新。',
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
        notEnabled: '未启用',
        notEnabledHint: '已安装到配置档，但不在 dsh.profile.bundles 中，因此不会加载。在此重新安装即可加回。',
        uninstall: '卸载',
        uninstalling: '卸载中…',
        openRepo: '打开仓库',
        forksHint: '分支数 — 点击查看并从分支安装',
        forksOf: '分支来源',
        forksLoading: '正在加载分支…',
        forksEmpty: '该仓库暂无分支。',
        forksError: '无法从 GitHub 加载分支。',
        forksStale: '显示的是缓存列表 — GitHub 当前受速率限制。',
        forksNote: '分支可能包含上游尚未合并的修复。建议先比较差异，如需这些改动再从分支安装。',
        compare: '与上游比较',
        replaces: '将替换',
        close: '关闭',
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
        // Local plugin add flow.
        addLocal: '添加本地插件',
        addLocalHint: '点击"浏览"选择文件夹，或粘贴路径。需含 dsh.bundle 的 package.json。',
        browse: '浏览…',
        pickFolder: '选择插件文件夹',
        pickHint: '目录在本机读取，不会上传任何文件。',
        pickHere: '选择此文件夹',
        pickUp: '上一级',
        pickHome: '主目录',
        pickEmpty: '此处没有子文件夹',
        pickHidden: '显示隐藏项',
        pickPlugin: '插件',
        pickSelect: '选择',
        pickLoading: '读取中…',
        pickTruncated: '仅显示前 400 个文件夹。',
        validate: '验证',
        validating: '验证中…',
        localValid: '有效的 DSH 插件',
        localInvalid: '不是有效的 DSH 插件',
        localValidHint: '该路径包含有效的 dsh.bundle 声明，可以安装。',
        localInvalidHint: '未找到 dsh.bundle.patch — 这不是一个 DSH 插件。',
        dryRun: '试运行',
        dryRunHint: '检查将要执行的操作，不实际安装。',
        dryRunOk: '试运行通过 — 可以安装。',
        dryRunFailed: '试运行失败。',
        installLocal: '安装本地插件',
        installingLocal: '安装中…',
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

    function ForkGlyph() {
      return createElement('svg', {
        width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': 'true',
      },
        createElement('circle', { cx: 4, cy: 3, r: 1.6 }),
        createElement('circle', { cx: 12, cy: 3, r: 1.6 }),
        createElement('circle', { cx: 8, cy: 13, r: 1.6 }),
        createElement('path', { d: 'M4 4.6v1.6c0 1 .8 1.8 1.8 1.8h4.4c1 0 1.8-.8 1.8-1.8V4.6M8 8v3.4' }),
      )
    }

    // Fork count that opens the fork browser. Rendered as static text when the
    // repo has no forks, so there is nothing to click through to.
    function ForkCount(props) {
      var count = Number(props.count) || 0
      var body = [ForkGlyph(), createElement('span', { key: 'n' }, fmtStars(count))]
      var base = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, lineHeight: 1 }
      if (count === 0 || !props.onForks) {
        return createElement('span', { style: { ...base, color: 'var(--dsw-alias-label-tertiary)' } }, body)
      }
      return createElement('button', {
        type: 'button', title: props.t('forksHint'), 'aria-label': props.t('forksHint'),
        onClick: function () { props.onForks(props.repo) },
        style: {
          ...base, cursor: 'pointer', padding: '1px 6px', margin: '-1px -6px',
          border: 'none', background: 'none', borderRadius: 6, font: 'inherit', fontSize: 12,
          color: 'var(--dsw-alias-state-business-primary)',
        },
      }, body)
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

      // Enable / disable sits next to Remove for installed plugins: it toggles
      // dsh.profile.bundles membership without uninstalling anything.
      var toggle = props.onToggleEnabled && installed
        ? createElement('button', {
          type: 'button',
          onClick: function () { props.onToggleEnabled(installed) },
          title: installed.enabled === false ? t('enableHint') : t('disableHint'),
          disabled: !!busy,
          style: busy ? { ...small, ...disabledStyle } : small,
        }, installed.enabled === false ? t('enable') : t('disable'))
        : null

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
        primary,
        toggle, copy, open,
      )
    }

    function Badges(props) {
      var t = props.t
      var item = props.item
      return createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
        props.installed ? createElement('span', {
          style: chipStyle('rgba(46,160,67,0.16)', '#2ea043'),
        }, '✓ ' + t('installed')) : null,
        props.installed && props.installed.enabled === false ? createElement('span', {
          title: t('notEnabledHint'),
          style: chipStyle('rgba(210,153,34,0.16)', '#d29922'),
        }, t('notEnabled')) : null,
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
              createElement(ForkCount, { t: t, count: item.forks, repo: item.full_name, onForks: props.onForks }),
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
        createElement(RepoActions, { t: t, item: item, installed: props.installed, busy: props.busy, copied: props.copied, onInstall: props.onInstall, onUninstall: props.onUninstall, onCopy: props.onCopy, onToggleEnabled: props.onToggleEnabled }),
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
          createElement(ForkCount, { t: t, count: item.forks, repo: item.full_name, onForks: props.onForks }),
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
        createElement(RepoActions, { t: t, item: item, compact: true, installed: props.installed, busy: props.busy, copied: props.copied, onInstall: props.onInstall, onUninstall: props.onUninstall, onCopy: props.onCopy, onToggleEnabled: props.onToggleEnabled }),
      )
    }

    // Install / uninstall result banner, shared by the tab and the fork dialog
    // (an install started from the dialog must report back inside it).
    function Notice(props) {
      var notice = props.notice
      if (!notice) return null
      return createElement('div', {
        style: {
          display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', borderRadius: 8, fontSize: 13,
          border: '1px solid ' + (notice.kind === 'ok' ? 'rgba(46,160,67,0.4)' : 'var(--dsw-alias-state-error-primary)'),
          background: notice.kind === 'ok' ? 'rgba(46,160,67,0.1)' : 'rgba(229,83,75,0.1)',
          color: 'var(--dsw-alias-label-primary)',
        },
      },
        createElement('span', { style: { fontWeight: 600, color: notice.kind === 'ok' ? '#2ea043' : '#e5534b' } }, notice.text),
        notice.detail ? createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, notice.detail) : null,
        notice.restart && props.onRestart ? createElement('button', {
          type: 'button', onClick: props.onRestart, title: props.t('restart'),
          style: {
            alignSelf: 'flex-start', marginTop: 4, border: 'none', borderRadius: 6,
            padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            background: 'var(--dsw-alias-state-business-primary)', color: '#ffffff', fontWeight: 500,
          },
        }, props.t('restart')) : null,
      )
    }

    // ---- fork browser ----

    // A fork is "installed" only when the exact repo is the source of an
    // installed plugin; a different repo publishing the same package name is
    // reported as a conflict, since installing this fork would replace it.
    function parentBranchOf(items, repo) {
      for (var i = 0; i < items.length; i++) {
        if (items[i].full_name === repo) return items[i].default_branch || ''
      }
      return ''
    }

    function forkInstallState(plugins, repo) {
      var slug = repoSlug(repo)
      var exact = null
      var conflict = null
      for (var i = 0; i < plugins.length; i++) {
        var p = plugins[i]
        if (p.repo === repo) exact = p
        else if (p.name === slug) conflict = p
      }
      return { exact: exact, conflict: conflict }
    }

    function compareUrl(parent, parentBranch, fork) {
      var head = fork.owner + ':' + (fork.default_branch || 'HEAD')
      if (!parentBranch) return 'https://github.com/' + fork.full_name + '/compare'
      return 'https://github.com/' + parent + '/compare/' + parentBranch + '...' + head
    }

    function ForkRow(props) {
      var t = props.t
      var fork = props.fork
      var state = forkInstallState(props.plugins, fork.full_name)
      return createElement('div', {
        style: {
          display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px',
          border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10,
          background: 'var(--dsw-alias-bg-layer-3)',
        },
      },
        createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 } },
          createElement(Avatar, { item: fork, size: 24 }),
          createElement('div', { style: { flex: '1 1 auto', minWidth: 0 } },
            createElement(NameLink, { item: fork }),
            createElement('div', {
              style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 2, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', flexWrap: 'wrap' },
            },
              createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, StarGlyph(), fmtStars(fork.stargazers)),
              fork.forks ? createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, ForkGlyph(), fmtStars(fork.forks)) : null,
              createElement('span', null, t('colUpdated') + ' ' + fmtDate(fork.pushed_at, props.lang)),
              fork.archived ? createElement('span', { style: chipStyle('rgba(210,153,34,0.16)', '#d29922') }, t('archived')) : null,
            ),
          ),
        ),
        fork.description ? createElement('p', {
          style: {
            margin: 0, fontSize: 12, lineHeight: '17px', color: 'var(--dsw-alias-label-secondary)',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          },
        }, fork.description) : null,
        createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          createElement(RepoActions, {
            t: t, item: fork, compact: true, installed: state.exact,
            busy: props.busy === fork.full_name, copied: props.copied === fork.full_name,
            onInstall: props.onInstall, onUninstall: props.onUninstall, onCopy: props.onCopy,
            onToggleEnabled: props.onToggleEnabled,
          }),
          createElement('a', {
            href: compareUrl(props.parent, props.parentBranch, fork),
            target: '_blank', rel: 'noreferrer noopener', title: t('compare'),
            style: {
              display: 'inline-flex', alignItems: 'center', gap: 5, textDecoration: 'none',
              border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '4px 10px',
              fontSize: 12, background: 'rgba(128,128,128,0.08)', color: 'var(--dsw-alias-label-primary)',
            },
          }, t('compare')),
          !state.exact && state.conflict ? createElement('span', {
            style: chipStyle('rgba(128,128,128,0.16)', 'var(--dsw-alias-label-tertiary)'),
          }, t('replaces') + ' ' + (state.conflict.repo || state.conflict.name)) : null,
        ),
      )
    }

    // Modal fork list for one catalog repo. Rendered inline (no portal) so it
    // works inside whatever container the settings shell gives the tab.
    function ForksDialog(props) {
      var t = props.t
      var data = props.data || {}
      var items = data.items || []

      React.useEffect(function () {
        function onKey(e) { if (e.key === 'Escape') props.onClose() }
        try { document.addEventListener('keydown', onKey) } catch (e) { return undefined }
        return function () { document.removeEventListener('keydown', onKey) }
      }, [props.onClose])

      var body
      if (data.loading && items.length === 0) {
        body = createElement('p', { style: { margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' } }, t('forksLoading'))
      } else if (data.error && items.length === 0) {
        body = createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--dsw-alias-state-error-primary)' } },
          createElement('span', null, t('forksError')),
          data.detail ? createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, data.detail) : null,
        )
      } else if (items.length === 0) {
        body = createElement('p', { style: { margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' } }, t('forksEmpty'))
      } else {
        body = createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          items.map(function (fork) {
            return createElement(ForkRow, {
              key: fork.full_name, t: t, lang: props.lang, fork: fork,
              parent: props.repo, parentBranch: props.parentBranch, plugins: props.plugins,
              busy: props.busy, copied: props.copied,
              onInstall: props.onInstall, onUninstall: props.onUninstall, onCopy: props.onCopy,
            })
          }),
        )
      }

      return createElement('div', {
        onClick: function (e) { if (e.target === e.currentTarget) props.onClose() },
        style: {
          position: 'fixed', inset: 0, zIndex: 4000, display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: 20,
          background: 'rgba(0,0,0,0.42)',
        },
      },
        createElement('div', {
          role: 'dialog', 'aria-modal': 'true', 'aria-label': t('forksOf') + ' ' + props.repo,
          style: {
            display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 640,
            maxHeight: '80vh', padding: '14px 16px', borderRadius: 12,
            border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)',
            boxShadow: '0 18px 48px rgba(0,0,0,0.35)',
          },
        },
          createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--dsw-alias-label-tertiary)' } }, ForkGlyph()),
            createElement('span', { style: { fontWeight: 600, fontSize: 14, color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              t('forksOf') + ' ' + props.repo),
            createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums' } },
              items.length ? String(items.length) : ''),
            createElement('button', {
              type: 'button', onClick: props.onRefresh, title: t('refresh'),
              style: {
                marginLeft: 'auto', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6,
                padding: '3px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-secondary)',
              },
            }, data.loading ? t('refreshing') : t('refresh')),
            createElement('button', {
              type: 'button', onClick: props.onClose, title: t('close'), 'aria-label': t('close'),
              style: {
                border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, width: 28, height: 26,
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, lineHeight: 1,
                background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-secondary)',
              },
            }, '×'),
          ),
          createElement('p', { style: { margin: 0, fontSize: 12, lineHeight: '17px', color: 'var(--dsw-alias-label-tertiary)' } }, t('forksNote')),
          data.stale ? createElement('p', { style: { margin: 0, fontSize: 12, color: '#d29922' } }, t('forksStale')) : null,
          createElement(Notice, { notice: props.notice, t: t, onRestart: props.onRestart }),
          createElement('div', { style: { overflowY: 'auto', paddingRight: 4, display: 'flex', flexDirection: 'column', gap: 8 } }, body),
        ),
      )
    }

    // ---- folder picker ----
    //
    // A browser folder chooser cannot hand back an absolute path without
    // routing the selection through a file-upload dialog, which is the wrong
    // shape entirely: nothing is being uploaded, only a path is wanted. So
    // this walks the disk through the host instead — /community-plugins/browse
    // lists one directory at a time, and the picker returns the path the user
    // lands on. Folders that already hold a DSH manifest are marked inline so
    // the right one is visible without opening it.
    function FolderGlyph(open) {
      return createElement('svg', {
        width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round', 'aria-hidden': 'true',
      }, createElement('path', {
        d: open
          ? 'M2 12.5V4a1 1 0 0 1 1-1h3l1.5 1.6H12a1 1 0 0 1 1 1v1H5.4L2 12.5Z'
          : 'M2 12.4V4.2a1 1 0 0 1 1-1h3.1L7.6 4.8H13a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z',
      }))
    }

    function FolderPicker(props) {
      var t = props.t
      var data = props.data
      // Until the first listing lands there is no resolved path to show: the
      // request may have been sent as '' to mean "start at the user's home".
      var here = data && data.path ? data.path : props.path
      var entries = (data && data.entries) || []
      var selfPlugin = !!(data && data.self && data.self.installable)

      var navBtn = {
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6,
        padding: '3px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
        background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-secondary)',
      }

      var body
      if (props.loading && data === null) {
        body = createElement('p', { style: { margin: '8px 2px', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, t('pickLoading'))
      } else if (data && data.ok === false) {
        body = createElement('p', { style: { margin: '8px 2px', fontSize: 12, color: '#e5534b' } }, data.reason || t('pickEmpty'))
      } else if (entries.length === 0) {
        body = createElement('p', { style: { margin: '8px 2px', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, t('pickEmpty'))
      } else {
        body = entries.map(function (entry) {
          return createElement('div', {
            key: entry.path,
            role: 'button', tabIndex: 0,
            onClick: function () { props.onNavigate(entry.path) },
            onKeyDown: function (e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onNavigate(entry.path) }
            },
            style: {
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
              borderRadius: 8, cursor: 'pointer', fontSize: 13,
              color: 'var(--dsw-alias-label-primary)',
              background: entry.plugin ? 'rgba(46,160,67,0.08)' : 'transparent',
            },
          },
            createElement('span', { style: { display: 'inline-flex', color: 'var(--dsw-alias-label-tertiary)' } }, FolderGlyph(false)),
            createElement('span', {
              style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
            }, entry.name),
            entry.plugin ? createElement('span', {
              style: {
                fontSize: 11, padding: '1px 7px', borderRadius: 999,
                background: 'rgba(46,160,67,0.16)', color: '#2ea043', whiteSpace: 'nowrap',
              },
            }, t('pickPlugin')) : null,
            // A marked folder can be taken without opening it first, which is
            // the whole point of marking it.
            entry.plugin ? createElement('button', {
              type: 'button',
              onClick: function (e) { e.stopPropagation(); props.onPick(entry.path) },
              style: { ...navBtn, padding: '2px 9px' },
            }, t('pickSelect')) : null,
          )
        })
      }

      return createElement('div', {
        onClick: function (e) { if (e.target === e.currentTarget) props.onClose() },
        style: {
          position: 'fixed', inset: 0, zIndex: 4000, display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: 20,
          background: 'rgba(0,0,0,0.42)',
        },
      },
        createElement('div', {
          role: 'dialog', 'aria-modal': 'true', 'aria-label': t('pickFolder'),
          style: {
            display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 560,
            maxHeight: '76vh', padding: '14px 16px', borderRadius: 12,
            border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)',
            boxShadow: '0 18px 48px rgba(0,0,0,0.35)',
          },
        },
          createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            createElement('span', { style: { display: 'inline-flex', color: 'var(--dsw-alias-label-tertiary)' } }, FolderGlyph(true)),
            createElement('span', { style: { fontWeight: 600, fontSize: 14, color: 'var(--dsw-alias-label-primary)', flex: 1 } }, t('pickFolder')),
            createElement('button', {
              type: 'button', onClick: props.onClose, title: t('close'), 'aria-label': t('close'),
              style: {
                border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, width: 28, height: 26,
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, lineHeight: 1,
                background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-secondary)',
              },
            }, '\u00d7'),
          ),
          createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            createElement('button', {
              type: 'button', disabled: !(data && data.parent),
              onClick: function () { if (data && data.parent) props.onNavigate(data.parent) },
              style: { ...navBtn, cursor: data && data.parent ? 'pointer' : 'default', opacity: data && data.parent ? 1 : 0.5 },
            }, '\u2191 ' + t('pickUp')),
            createElement('button', {
              type: 'button',
              onClick: function () { props.onNavigate((data && data.home) || '') },
              style: navBtn,
            }, t('pickHome')),
            createElement('label', {
              style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer' },
            },
              createElement('input', {
                type: 'checkbox', checked: props.hidden,
                onChange: function (e) { props.onToggleHidden(e.target.checked) },
              }),
              t('pickHidden'),
            ),
            props.loading ? createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, t('pickLoading')) : null,
          ),
          createElement('div', {
            title: here,
            style: {
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12,
              padding: '5px 9px', borderRadius: 6, background: 'rgba(128,128,128,0.10)',
              color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left',
            },
          }, here),
          createElement('div', {
            style: { overflowY: 'auto', paddingRight: 4, display: 'flex', flexDirection: 'column', gap: 2, minHeight: 120 },
          }, body),
          data && data.truncated ? createElement('p', { style: { margin: 0, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, t('pickTruncated')) : null,
          createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            createElement('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', flex: 1 } }, t('pickHint')),
            createElement('button', {
              type: 'button', onClick: props.onClose, style: navBtn,
            }, t('close')),
            createElement('button', {
              type: 'button', disabled: !(data && data.ok),
              onClick: function () { if (data && data.ok) props.onPick(here) },
              style: {
                ...navBtn, padding: '4px 12px', fontWeight: 600,
                cursor: data && data.ok ? 'pointer' : 'default',
                opacity: data && data.ok ? 1 : 0.5,
                borderColor: selfPlugin ? 'rgba(46,160,67,0.55)' : 'var(--dsw-alias-border-l2)',
                background: selfPlugin ? 'rgba(46,160,67,0.14)' : 'var(--dsw-alias-bg-layer-1)',
                color: selfPlugin ? '#2ea043' : 'var(--dsw-alias-label-primary)',
              },
            }, t('pickHere')),
          ),
        ),
      )
    }

    // ---- minimal safe markdown (for local READMEs) ----
    //
    // Enough markdown to make a plugin README legible: headings, bullets,
    // fenced code, inline code / bold / italic, and http(s) links. Input is
    // escaped before any markup is applied, so package-authored text cannot
    // inject elements into the page.
    var codeStyle = {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '0.92em', background: 'rgba(128,128,128,0.14)',
      padding: '1px 5px', borderRadius: 4,
    }
    var readmeCodeStyle = {
      ...codeStyle, display: 'block', padding: '8px 10px', overflowX: 'auto',
      fontSize: 11, lineHeight: 1.5, background: 'rgba(128,128,128,0.12)',
    }

    function escapeHtml(text) {
      return String(text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    }

    function renderBoldItalic(text, keyBase) {
      var parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
      var out = []
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i]
        if (!part) continue
        if (/^\*\*[^*]+\*\*$/.test(part)) out.push(createElement('strong', { key: keyBase + '-b' + i }, part.slice(2, -2)))
        else if (/^\*[^*]+\*$/.test(part)) out.push(createElement('em', { key: keyBase + '-i' + i }, part.slice(1, -1)))
        else out.push(part)
      }
      return out
    }

    function inlineMarkdown(text, keyBase) {
      var parts = String(text).split(/(`[^`]*`)/g)
      var out = []
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i]
        if (!part) continue
        if (/^`[^`]*`$/.test(part)) {
          out.push(createElement('code', { key: keyBase + '-c' + i, style: codeStyle }, part.slice(1, -1)))
          continue
        }
        // Links after escaping; only http(s) targets become anchors.
        var chunks = escapeHtml(part).split(/(\[[^\]]+\]\([^)]*\))/g)
        for (var k = 0; k < chunks.length; k++) {
          var chunk = chunks[k]
          if (!chunk) continue
          var m = /^\[([^\]]+)\]\(([^)]*)\)$/.exec(chunk)
          if (m && /^https?:\/\//i.test(m[2].trim())) {
            out.push(createElement('a', {
              key: keyBase + '-l' + k, href: m[2].trim(), target: '_blank', rel: 'noreferrer noopener',
              style: { color: 'var(--dsw-alias-state-business-primary)' },
            }, renderBoldItalic(m[1], keyBase + '-la' + k)))
          } else {
            out.push(renderBoldItalic(chunk, keyBase + '-' + k))
          }
        }
      }
      return out
    }

    function renderMarkdown(src) {
      var lines = String(src).replace(/\r\n?/g, '\n').split('\n')
      var out = []
      var fence = false
      var code = []
      var key = 0
      function flushCode() {
        if (code.length === 0) return
        out.push(createElement('pre', { key: 'code' + (key++), style: readmeCodeStyle }, code.join('\n')))
        code = []
      }
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i]
        var fm = /^```\s*([\w-]*)\s*$/.exec(line)
        if (fm) {
          if (fence) flushCode(); else code = []
          fence = !fence
          continue
        }
        if (fence) { code.push(line); continue }
        if (/^\s*$/.test(line)) continue
        var hm = /^(#{1,4})\s+(.*)$/.exec(line)
        if (hm) {
          flushCode()
          var level = hm[1].length
          out.push(createElement('div', {
            key: 'h' + (key++),
            style: {
              fontWeight: 600, marginTop: level === 1 ? 10 : 6,
              fontSize: Math.max(13, 16 - level * 1.5), lineHeight: 1.35,
              color: 'var(--dsw-alias-label-primary)',
            },
          }, inlineMarkdown(hm[2], 'h' + key)))
          continue
        }
        var bm = /^[-*]\s+(.*)$/.exec(line)
        if (bm) {
          flushCode()
          out.push(createElement('div', { key: 'b' + (key++), style: { paddingLeft: 12, position: 'relative', lineHeight: 1.55 } },
            createElement('span', { style: { position: 'absolute', left: 0 } }, '•'),
            inlineMarkdown(bm[1], 'b' + key)))
          continue
        }
        flushCode()
        out.push(createElement('div', { key: 'p' + (key++), style: { lineHeight: 1.55 } }, inlineMarkdown(line, 'p' + key)))
      }
      flushCode()
      return out
    }

    var readmeBoxStyle = {
      border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
      background: 'var(--dsw-alias-bg-layer-2)', padding: '10px 12px',
      maxHeight: 240, overflowY: 'auto', overflowWrap: 'anywhere',
      fontSize: 12, lineHeight: 1.55, color: 'var(--dsw-alias-label-secondary)',
    }

    // README showcase with language switching. When a package ships several
    // READMEs (README.md, README.zh-CN.md, ...) each becomes a tab; the pick
    // lives in the tab component so it survives card re-renders.
    function ReadmeSection(props) {
      var t = props.t
      var readmes = (props.item && props.item.readmes) || []
      if (!readmes.length) return null
      var active = null
      for (var i = 0; i < readmes.length; i++) {
        if (readmes[i].key === props.pick) { active = readmes[i]; break }
      }
      if (!active) active = readmes[0]
      return createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
          createElement('span', {
            style: { fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' },
          }, t('readme')),
          readmes.length > 1 ? readmes.map(function (r) {
            var selected = r.key === active.key
            return createElement('button', {
              key: r.key, type: 'button', 'aria-pressed': selected ? 'true' : 'false',
              onClick: function () { if (props.onPick) props.onPick(props.item.name, r.key) },
              style: {
                border: '1px solid ' + (selected ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l2)'),
                borderRadius: 999, padding: '2px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                background: selected ? 'rgba(128,128,128,0.14)' : 'var(--dsw-alias-bg-layer-1)',
                color: selected ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-secondary)',
              },
            }, r.label)
          }) : null,
        ),
        createElement('div', { style: readmeBoxStyle }, renderMarkdown(active.text)),
        active.truncated ? createElement('p', { style: { margin: 0, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, t('readmeTruncated')) : null,
      )
    }

    // ---- local plugin card ----
    //
    // Installed plugins with no catalog row: private repos, local checkouts,
    // registry packages outside the dsh-plugin topic. They render in the same
    // list as catalog items, with removal by package name.
    function LocalCard(props) {
      var t = props.t
      var item = props.item
      var name = item.name || item.full_name
      return createElement('div', {
        style: {
          display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px',
          border: '1px dashed var(--dsw-alias-border-l2)',
          background: 'var(--dsw-alias-bg-layer-3)', borderRadius: 10, minWidth: 0,
        },
      },
        createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 } },
          createElement('div', { style: { flex: '1 1 auto', minWidth: 0 } },
            item.html_url
              ? createElement(NameLink, { item: { html_url: item.html_url, full_name: name } })
              : createElement('span', {
                title: name,
                style: { color: 'var(--dsw-alias-label-primary)', fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
              }, name),
            createElement('div', {
              style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', flexWrap: 'wrap' },
            },
              item.version ? createElement('span', {
                style: chipStyle('rgba(128,128,128,0.16)', 'var(--dsw-alias-label-tertiary)'),
              }, 'v' + item.version) : null,
              item.author ? createElement('span', null, item.author) : null,
              item.spec ? createElement('span', {
                title: item.spec,
                style: {
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260,
                },
              }, item.spec) : null,
            ),
          ),
          createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
            createElement('span', { style: chipStyle('rgba(128,128,128,0.16)', 'var(--dsw-alias-label-tertiary)') }, t('localBadge')),
            item.enabled === false
              ? createElement('span', { title: t('notEnabledHint'), style: chipStyle('rgba(210,153,34,0.16)', '#d29922') }, t('notEnabled'))
              : createElement('span', { style: chipStyle('rgba(46,160,67,0.16)', '#2ea043') }, '✓ ' + t('installed')),
          ),
        ),
        // The manifest description is the "what is this" — only reachable
        // locally, which is exactly why this card exists.
        item.description ? createElement('p', {
          style: { margin: 0, fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)', overflowWrap: 'anywhere' },
        }, item.description) : null,
        // The shipped README(s), when there are any — language tabs included.
        createElement(ReadmeSection, { t: t, item: item, pick: props.readmePick, onPick: props.onReadmePick }),
        createElement('p', { style: { margin: 0, fontSize: 12, lineHeight: '17px', color: 'var(--dsw-alias-label-tertiary)' } }, t('localNote')),
        createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          props.onToggleEnabled ? createElement('button', {
            type: 'button', disabled: props.busy,
            onClick: function () { props.onToggleEnabled({ name: name, enabled: item.enabled !== false }) },
            title: item.enabled === false ? t('enableHint') : t('disableHint'),
            style: {
              border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '4px 12px', fontSize: 12,
              cursor: props.busy ? 'default' : 'pointer', fontFamily: 'inherit',
              background: 'rgba(128,128,128,0.08)', color: 'var(--dsw-alias-label-primary)', opacity: props.busy ? 0.6 : 1,
            },
          }, item.enabled === false ? t('enable') : t('disable')) : null,
          createElement('button', {
            type: 'button', disabled: props.busy,
            onClick: function () { props.onRemoveLocal(name) },
            style: {
              border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12,
              cursor: props.busy ? 'default' : 'pointer', fontFamily: 'inherit',
              background: 'rgba(229,83,75,0.14)', color: '#e5534b', opacity: props.busy ? 0.6 : 1,
            },
          }, props.busy ? t('uninstalling') : t('uninstall')),
          item.html_url ? createElement('a', {
            href: item.html_url, target: '_blank', rel: 'noreferrer noopener', title: t('openRepo'),
            style: {
              display: 'inline-flex', alignItems: 'center', gap: 5, textDecoration: 'none',
              border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '4px 10px',
              fontSize: 12, background: 'rgba(128,128,128,0.08)', color: 'var(--dsw-alias-label-primary)',
            },
          }, t('openRepo')) : null,
        ),
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
    var FILTERS_KEY = 'dsh-community-plugins:filters'
    function storedView() {
      try {
        var v = window.localStorage.getItem(VIEW_KEY)
        return v === 'grid' ? v : 'list'
      } catch (e) { return 'list' }
    }

    // ---- filter + result cache ----
    //
    // The settings shell unmounts this tab whenever the user switches tabs, so
    // filters and the last result set live at module scope: coming back shows
    // exactly what was on screen before, with no re-fetch. Nothing reloads on a
    // timer — only a filter edit or the Refresh button hits the catalog route.
    var DEFAULT_FILTERS = { query: '', sort: 'stars', tag: '', tagQuery: '', filter: 'all' }

    function storedFilters() {
      try {
        var raw = window.localStorage.getItem(FILTERS_KEY)
        if (!raw) return { ...DEFAULT_FILTERS }
        var saved = JSON.parse(raw)
        return {
          query: typeof saved.query === 'string' ? saved.query : '',
          sort: ['stars', 'forks', 'created', 'updated', 'name'].indexOf(saved.sort) !== -1 ? saved.sort : 'stars',
          tag: typeof saved.tag === 'string' ? saved.tag : '',
          tagQuery: typeof saved.tagQuery === 'string' ? saved.tagQuery : '',
          filter: saved.filter === 'installed' || saved.filter === 'local' ? saved.filter : 'all',
        }
      } catch (e) { return { ...DEFAULT_FILTERS } }
    }

    function persistFilters(filters) {
      try { window.localStorage.setItem(FILTERS_KEY, JSON.stringify(filters)) } catch (e) { /* ignore */ }
    }

    function isFiltered(filters) {
      return filters.query !== '' || filters.tag !== '' || filters.tagQuery !== '' || filters.sort !== DEFAULT_FILTERS.sort || filters.filter !== DEFAULT_FILTERS.filter
    }

    var cache = {
      filters: storedFilters(),
      loaded: false,
      items: [],
      total: 0,
      allCount: 0,
      tags: [],
      // { all, installed, local } for the filter chips, cached like the rest.
      counts: null,
      // repo -> { items, stale, error, detail }; keeps a reopened fork list
      // instant and off GitHub's core rate limit.
      forks: {},
    }

    function CommunityPluginsTab(props) {
      var t = props.t
      var api = props.api

      // One state object for every filter, seeded from the module cache so a
      // tab switch (or a page reload, via localStorage) restores the search.
      var filtersState = React.useState(cache.filters)
      var filters = filtersState[0]; var setFiltersRaw = filtersState[1]
      // Mount with the values the module cache holds (a tab switch does not
      // reset them) rather than the local defaults the useState call carried.
      if (filters !== cache.filters) { filters = cache.filters; setFiltersRaw(cache.filters) }
      var query = filters.query
      var sort = filters.sort
      var tag = filters.tag
      var tagQuery = filters.tagQuery
      var filter = filters.filter

      function patchFilters(patch) {
        var next = { query: filters.query, sort: filters.sort, tag: filters.tag, tagQuery: filters.tagQuery, filter: filters.filter, ...patch }
        cache.filters = next
        persistFilters(next)
        setFiltersRaw(next)
      }
      function setQuery(v) { patchFilters({ query: v }) }
      function setSort(v) { patchFilters({ sort: v }) }
      function setTag(v) { patchFilters({ tag: v }) }
      function setTagQuery(v) { patchFilters({ tagQuery: v }) }
      function setFilter(v) { patchFilters({ filter: v }) }
      function clearFilters() { patchFilters({ ...DEFAULT_FILTERS }) }

      var viewState = React.useState(storedView())
      var view = viewState[0]; var setViewState = viewState[1]
      var itemsState = React.useState(cache.items)
      var items = itemsState[0]; var setItems = itemsState[1]
      var totalState = React.useState(cache.total)
      var total = totalState[0]; var setTotal = totalState[1]
      var allCountState = React.useState(cache.allCount)
      var allCount = allCountState[0]; var setAllCount = allCountState[1]
      var tagsState = React.useState(cache.tags)
      var tags = tagsState[0]; var setTags = tagsState[1]
      var loadingState = React.useState(!cache.loaded)
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
      // Fork browser: the repo whose forks are open, plus its fetch state.
      var forksRepoState = React.useState('')
      var forksRepo = forksRepoState[0]; var setForksRepo = forksRepoState[1]
      var forksDataState = React.useState(null)
      var forksData = forksDataState[0]; var setForksData = forksDataState[1]
      // Which README language each local plugin card shows (name -> file key).
      var readmePickState = React.useState({})
      var readmePick = readmePickState[0]; var setReadmePick = readmePickState[1]
      // Local plugin add flow.
      var localPathState = React.useState('')
      var localPath = localPathState[0]; var setLocalPath = localPathState[1]
      var localValidateState = React.useState(null)
      var localValidate = localValidateState[0]; var setLocalValidate = localValidateState[1]
      var localValidatingState = React.useState(false)
      var localValidating = localValidatingState[0]; var setLocalValidating = localValidatingState[1]
      var localDryRunState = React.useState(null)
      var localDryRun = localDryRunState[0]; var setLocalDryRun = localDryRunState[1]
      var localDryRunningState = React.useState(false)
      var localDryRunning = localDryRunningState[0]; var setLocalDryRunning = localDryRunningState[1]
      // Folder picker overlay. Its cursor lives here rather than in the
      // dialog, the same way the fork browser's listing does, so the walk
      // survives the re-renders the listing itself causes.
      var pickerOpenState = React.useState(false)
      var pickerOpen = pickerOpenState[0]; var setPickerOpen = pickerOpenState[1]
      var pickerPathState = React.useState('')
      var pickerPath = pickerPathState[0]; var setPickerPath = pickerPathState[1]
      var pickerDataState = React.useState(null)
      var pickerData = pickerDataState[0]; var setPickerData = pickerDataState[1]
      var pickerLoadingState = React.useState(false)
      var pickerLoading = pickerLoadingState[0]; var setPickerLoading = pickerLoadingState[1]
      var pickerHiddenState = React.useState(false)
      var pickerHidden = pickerHiddenState[0]; var setPickerHidden = pickerHiddenState[1]

      function onReadmePick(name, key) {
        var next = {}
        Object.keys(readmePick).forEach(function (k) { next[k] = readmePick[k] })
        next[name] = key
        setReadmePick(next)
      }

      var lang = typeof api.lang === 'function' ? api.lang() : 'en'

      function loadState() {
        api.state().then(function (s) {
          if (s && Array.isArray(s.plugins)) setPlugins(s.plugins)
          if (s && typeof s.profile === 'string' && s.profile !== '') setProfile(s.profile)
        }).catch(function () {})
      }

      function buildQueryString(f) {
        var parts = ['filter=' + encodeURIComponent(f.filter), 'sort=' + encodeURIComponent(f.sort), 'limit=500']
        if (f.query) parts.push('q=' + encodeURIComponent(f.query))
        if (f.tag) parts.push('tag=' + encodeURIComponent(f.tag))
        return parts.join('&')
      }

      // Every catalog read goes through here; results are mirrored into the
      // module cache so the next mount can render them without a round trip.
      function fetchCatalog(f, silent, done) {
        if (!silent) setLoading(true)
        api.catalog(buildQueryString(f)).then(function (res) {
          if (res && res.ok) {
            cache.loaded = true
            cache.items = res.items || []
            cache.total = res.total || 0
            cache.allCount = res.allCount || 0
            cache.tags = res.tags || []
            if (res.counts) cache.counts = res.counts
            setItems(cache.items)
            setTotal(cache.total)
            setAllCount(cache.allCount)
            setTags(cache.tags)
            setRefreshing(!!res.refreshing)
            setError('')
          } else {
            setError('catalog')
          }
          setLoading(false)
          if (done) done(res)
        }).catch(function () {
          setError('catalog')
          setLoading(false)
          if (done) done(null)
        })
      }

      // A GitHub refresh runs in the background on the host, so the one place
      // that re-reads the catalog on its own is this bounded follow-up poll:
      // it starts only after a user-initiated refresh and stops as soon as the
      // host reports it is done (or after a few attempts).
      var pollRef = React.useRef({ timer: null, left: 0, alive: true })

      function stopPolling() {
        var p = pollRef.current
        if (p.timer) { clearTimeout(p.timer); p.timer = null }
        p.left = 0
      }

      function pollUntilRefreshed(f) {
        var p = pollRef.current
        stopPolling()
        p.left = 6
        var tick = function () {
          p.timer = null
          if (!p.alive || p.left <= 0) return
          p.left -= 1
          fetchCatalog(f, true, function (res) {
            if (!p.alive || p.left <= 0) return
            if (res && res.ok && res.refreshing) p.timer = setTimeout(tick, 2000)
          })
        }
        p.timer = setTimeout(tick, 1500)
      }

      function manualRefresh() {
        var f = cache.filters
        // Plugins can also be added or removed with the dsh CLI while this tab
        // is open, so an explicit Refresh re-reads the installed set too.
        loadState()
        setRefreshing(true)
        // Local only has no GitHub query behind it; the catalog re-read that
        // follows is what matters there.
        if (f.filter !== 'local') {
          api.refresh(f.query).catch(function () {})
          pollUntilRefreshed(f)
        }
      }

      // Mount: installed state always, catalog only when nothing is cached yet.
      React.useEffect(function () {
        pollRef.current.alive = true
        loadState()
        if (!cache.loaded) fetchCatalog(cache.filters, false)
        return function () {
          pollRef.current.alive = false
          stopPolling()
        }
      }, [])

      // The only automatic reload: the user edited a filter. Skips the first
      // run so a remount with cached results never re-fetches.
      var firstFilterRun = React.useRef(true)
      React.useEffect(function () {
        if (firstFilterRun.current) { firstFilterRun.current = false; return }
        var f = { query: query, sort: sort, tag: tag, tagQuery: tagQuery, filter: filter }
        var id = setTimeout(function () { fetchCatalog(f, false) }, 300)
        return function () { clearTimeout(id) }
      }, [query, sort, tag, filter])

      // A changed search term also asks the host for fresh GitHub results,
      // then polls until that background fetch lands. The local filter has no
      // GitHub query behind it, so it never triggers this.
      var firstQueryRun = React.useRef(true)
      React.useEffect(function () {
        if (firstQueryRun.current) { firstQueryRun.current = false; return }
        if (filter === 'local') return
        var f = { query: query, sort: sort, tag: tag, tagQuery: tagQuery, filter: filter }
        var id = setTimeout(function () {
          // An edit in the local filter sets query to '' before the effect
          // runs, so never ask GitHub for the cleared search either.
          if (query === '') return
          api.refresh(query).catch(function () {})
          pollUntilRefreshed(f)
        }, 1200)
        return function () { clearTimeout(id) }
      }, [query, filter])

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
      function loadForks(repo, force) {
        var cached = cache.forks[repo]
        setForksData({ loading: true, items: (cached && cached.items) || [], stale: cached ? cached.stale : false })
        api.forks(repo, force).then(function (res) {
          var next = res && res.ok
            ? { loading: false, items: res.items || [], stale: !!res.stale, error: false }
            : { loading: false, items: (cached && cached.items) || [], error: true, detail: (res && res.error) || '' }
          if (res && res.ok) cache.forks[repo] = { items: next.items, stale: next.stale }
          setForksData(next)
        }).catch(function (e) {
          setForksData({ loading: false, items: (cached && cached.items) || [], error: true, detail: String(e && e.message ? e.message : e) })
        })
      }

      function onForks(repo) {
        setForksRepo(repo)
        var cached = cache.forks[repo]
        if (cached && !cached.stale) {
          // Cached listing renders immediately; GitHub is only asked again on Refresh.
          setForksData({ loading: false, items: cached.items, stale: false })
          return
        }
        loadForks(repo, false)
      }

      function closeForks() {
        setForksRepo('')
        setForksData(null)
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
            setNotice({ kind: 'ok', text: t('installedOk'), detail: t('restartNote'), restart: true })
            loadState()
          } else {
            setNotice({ kind: 'err', text: t('installFailed'), detail: [(res && res.error) || '', (res && res.output) || ''].filter(Boolean).join('\n\n') })
          }
        }).catch(function (e) {
          setBusy(null)
          setNotice({ kind: 'err', text: t('installFailed'), detail: String(e && e.message ? e.message : e) })
        })
      }
      function onValidateLocalPath() {
        var p = localPath.trim()
        if (p === '') return
        setLocalValidating(true)
        setLocalValidate(null)
        setLocalDryRun(null)
        api.validate(p).then(function (res) {
          setLocalValidating(false)
          setLocalValidate(res || null)
        }).catch(function (e) {
          setLocalValidating(false)
          setLocalValidate({ ok: false, error: String(e && e.message ? e.message : e) })
        })
      }
      function loadPicker(path, hidden) {
        setPickerPath(path)
        setPickerHidden(hidden)
        setPickerLoading(true)
        api.browse(path, hidden).then(function (res) {
          setPickerLoading(false)
          setPickerData(res && typeof res === 'object' ? res : null)
        }).catch(function (e) {
          setPickerLoading(false)
          setPickerData({ ok: false, entries: [], reason: String(e && e.message ? e.message : e) })
        })
      }
      function onBrowseLocal() {
        // Open where the input already points, so a typed-then-browsed path
        // is refined rather than thrown away. Empty means the host's home.
        setPickerData(null)
        setPickerOpen(true)
        loadPicker(localPath.trim(), pickerHidden)
      }
      // Picking a folder is a new candidate: drop the verdicts the old path
      // earned so nothing stale is shown against it.
      function onPickFolder(picked) {
        setPickerOpen(false)
        setLocalPath(picked || '')
        setLocalValidate(null)
        setLocalDryRun(null)
      }
      function onDryRunLocal() {
        var p = localPath.trim()
        if (p === '') return
        setLocalDryRunning(true)
        setLocalDryRun(null)
        api.installLocal(p, true).then(function (res) {
          setLocalDryRunning(false)
          setLocalDryRun(res || null)
        }).catch(function (e) {
          setLocalDryRunning(false)
          setLocalDryRun({ ok: false, error: String(e && e.message ? e.message : e) })
        })
      }
      function onInstallLocal() {
        var p = localPath.trim()
        if (p === '') return
        setBusy(p)
        setNotice(null)
        api.installLocal(p, false).then(function (res) {
          setBusy(null)
          if (res && res.ok) {
            setNotice({ kind: 'ok', text: t('installedOk'), detail: t('restartNote'), restart: true })
            setLocalPath('')
            setLocalValidate(null)
            setLocalDryRun(null)
            loadState()
          } else {
            setNotice({ kind: 'err', text: t('installFailed'), detail: [(res && res.error) || '', (res && res.output) || ''].filter(Boolean).join('\n\n') })
          }
        }).catch(function (e) {
          setBusy(null)
          setNotice({ kind: 'err', text: t('installFailed'), detail: String(e && e.message ? e.message : e) })
        })
      }
      function onRemoveLocal(name) {
        setBusy(name)
        setNotice(null)
        api.uninstall({ name: name }).then(function (res) {
          setBusy(null)
          if (res && res.ok) {
            setNotice({ kind: 'ok', text: t('uninstalledOk'), detail: t('restartNote'), restart: true })
            loadState()
          } else {
            setNotice({ kind: 'err', text: t('uninstallFailed'), detail: [(res && res.error) || '', (res && res.output) || ''].filter(Boolean).join('\n\n') })
          }
        }).catch(function (e) {
          setBusy(null)
          setNotice({ kind: 'err', text: t('uninstallFailed'), detail: String(e && e.message ? e.message : e) })
        })
      }

      function onToggleEnabled(plugin) {
        var target = plugin && plugin.name
        if (!target) return
        var enabling = plugin.enabled === false
        setBusy(target)
        setNotice(null)
        api.setEnabled(target, enabling).then(function (res) {
          setBusy(null)
          if (res && res.ok) {
            setNotice({ kind: 'ok', text: enabling ? t('enabledOk') : t('disabledOk'), detail: t('restartNote'), restart: true })
            // Re-read the profile manifest so badges and buttons flip now.
            loadState()
          } else {
            setNotice({ kind: 'err', text: t('toggleFailed'), detail: (res && res.error) || '' })
          }
        }).catch(function (e) {
          setBusy(null)
          setNotice({ kind: 'err', text: t('toggleFailed'), detail: String(e && e.message ? e.message : e) })
        })
      }

      // Restart: ask the host to respawn dsh web, then poll the state route
      // until the new instance answers and reload the page.
      function reloadWhenUp() {
        var tries = 0
        function check() {
          tries += 1
          if (tries > 60) return
          api.state().then(function () {
            try { window.location.reload() } catch (e) { /* ignore */ }
          }).catch(function () { setTimeout(check, 2000) })
        }
        setTimeout(check, 2000)
      }

      function onRestart() {
        setNotice({ kind: 'ok', text: t('restarting'), detail: t('restartingNote') })
        api.restart().then(function (res) {
          if (res && res.ok === false) {
            setNotice({ kind: 'err', text: t('restartFailed'), detail: (res && res.error) || '' })
            return
          }
          reloadWhenUp()
        }).catch(function () {
          // The server may die before the response lands — that still counts
          // as a restart in progress.
          reloadWhenUp()
        })
      }

      function onUninstall(repo) {
        setBusy(repo)
        setNotice(null)
        api.uninstall(repo).then(function (res) {
          setBusy(null)
          if (res && res.ok) {
            setNotice({ kind: 'ok', text: t('uninstalledOk'), detail: t('restartNote'), restart: true })
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
          var empty = filter === 'installed' ? t('emptyInstalled') : filter === 'local' ? t('emptyLocal') : t('emptyCatalog')
          return createElement('p', { style: { margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' } }, empty)
        }
        // Installed plugins the community catalog does not know about. A local
        // plugin whose repo is on GitHub (enriched host-side) renders with the
        // same rich card as catalog rows — avatar, stars, topics, fork browser —
        // plus the manifest meta line and the README showcase below it.
        if (filter === 'local') {
          return createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
            items.map(function (item) {
              var name = item.name || item.full_name
              var pick = readmePick[name]
              if (item.github) {
                return createElement('div', {
                  key: name, style: { display: 'flex', flexDirection: 'column', gap: 8 },
                },
                  createElement(ListCard, {
                    t: t, lang: lang, item: item,
                    installed: isInstalled(plugins, item.full_name),
                    busy: busy === item.full_name, copied: copied === item.full_name,
                    onInstall: onInstall, onUninstall: onUninstall, onCopy: onCopy, onForks: onForks,
            onToggleEnabled: onToggleEnabled,
                  }),
                  (item.version || item.author || item.spec) ? createElement('div', {
                    style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', flexWrap: 'wrap', padding: '0 2px' },
                  },
                    item.version ? createElement('span', { style: chipStyle('rgba(128,128,128,0.16)', 'var(--dsw-alias-label-tertiary)') }, 'v' + item.version) : null,
                    item.author ? createElement('span', null, item.author) : null,
                    item.spec ? createElement('span', {
                      title: item.spec,
                      style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
                    }, item.spec) : null,
                  ) : null,
                  createElement(ReadmeSection, { t: t, item: item, pick: pick, onPick: onReadmePick }),
                )
              }
              return createElement(LocalCard, {
                key: name, t: t, item: item,
                busy: busy === name,
                onRemoveLocal: onRemoveLocal,
                onToggleEnabled: onToggleEnabled,
                readmePick: pick, onReadmePick: onReadmePick,
              })
            }),
          )
        }
        var cardProps = function (item) {
          var repo = item.full_name
          return {
            key: repo, item: item, t: t, lang: lang,
            installed: isInstalled(plugins, repo),
            busy: busy === repo, copied: copied === repo,
            onInstall: onInstall, onUninstall: onUninstall, onCopy: onCopy, onForks: onForks,
            onToggleEnabled: onToggleEnabled,
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
        // Local plugin add panel.
        createElement('div', {
          style: {
            display: 'flex', flexDirection: 'column', gap: 8,
            padding: '12px 14px',
            border: '1px solid var(--dsw-alias-border-l2)',
            borderRadius: 10,
            background: 'var(--dsw-alias-bg-layer-3)',
          },
        },
          createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            createElement('span', { style: { fontWeight: 600, fontSize: 13, color: 'var(--dsw-alias-label-primary)' } }, t('addLocal')),
            createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', flex: 1 } }, t('addLocalHint')),
          ),
          createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            createElement('input', {
              type: 'text',
              value: localPath,
              placeholder: 'e.g. /home/user/my-plugin',
              onChange: function (e) { setLocalPath(e.target.value); setLocalValidate(null); setLocalDryRun(null) },
              onKeyDown: function (e) { if (e.key === 'Enter') onValidateLocalPath() },
              style: { flex: '1 1 280px', minWidth: 180, height: 32, padding: '0 10px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, ...controlStyle, outline: 'none' },
            }),
            createElement('button', {
              type: 'button',
              onClick: onBrowseLocal,
              style: { ...controlStyle, padding: '0 12px', height: 32, cursor: 'pointer', whiteSpace: 'nowrap' },
            }, t('browse')),
            createElement('button', {
              type: 'button', disabled: localValidating || localPath.trim() === '',
              onClick: onValidateLocalPath,
              style: { ...controlStyle, padding: '0 12px', cursor: localValidating || localPath.trim() === '' ? 'default' : 'pointer', opacity: localValidating || localPath.trim() === '' ? 0.6 : 1, height: 32 },
            }, localValidating ? t('validating') : t('validate')),
          ),
          localValidate !== null ? createElement('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 12, padding: '6px 10px', borderRadius: 6,
              background: localValidate.installable
                ? 'rgba(46,160,67,0.10)'
                : 'rgba(229,83,75,0.10)',
              color: localValidate.installable ? '#2ea043' : '#e5534b',
            },
          },
            createElement('span', { style: { fontWeight: 600 } }, localValidate.installable ? t('localValid') : t('localInvalid')),
            localValidate.installable
              ? createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', flex: 1 } }, t('localValidHint'))
              : createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', flex: 1 } }, (localValidate.error || t('localInvalidHint'))),
          ) : null,
          localValidate && localValidate.installable ? createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
            localValidate.name ? createElement('span', null, 'name: ', createElement('code', { style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }, localValidate.name)) : null,
            localValidate.version ? createElement('span', null, 'version: ', createElement('code', { style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }, localValidate.version)) : null,
            localValidate.author ? createElement('span', null, 'author: ', localValidate.author) : null,
            localValidate.description ? createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, localValidate.description) : null,
          ) : null,
          localValidate && localValidate.installable ? createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            createElement('button', {
              type: 'button', disabled: localDryRunning,
              onClick: onDryRunLocal,
              style: { ...controlStyle, padding: '0 12px', height: 32, cursor: localDryRunning ? 'default' : 'pointer', opacity: localDryRunning ? 0.6 : 1 },
              title: t('dryRunHint'),
            }, localDryRunning ? t('validating') : t('dryRun')),
            createElement('button', {
              type: 'button', disabled: localDryRun === null || localDryRun.ok !== true || localDryRunning,
              onClick: onInstallLocal,
              style: {
                ...controlStyle, padding: '0 12px', height: 32,
                background: 'rgba(46,160,67,0.12)', color: '#2ea043',
                cursor: localDryRun === null || localDryRun.ok !== true || localDryRunning ? 'default' : 'pointer',
                opacity: localDryRun === null || localDryRun.ok !== true || localDryRunning ? 0.5 : 1,
              },
              title: t('installLocal'),
            }, localDryRunning ? t('installingLocal') : t('installLocal')),
          ) : null,
          localDryRun !== null ? createElement('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 12, padding: '6px 10px', borderRadius: 6,
              background: localDryRun.ok ? 'rgba(46,160,67,0.10)' : 'rgba(229,83,75,0.10)',
              color: localDryRun.ok ? '#2ea043' : '#e5534b',
            },
          },
            createElement('span', { style: { fontWeight: 600 } }, localDryRun.ok ? t('dryRunOk') : t('dryRunFailed')),
            !localDryRun.ok ? createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', flex: 1 } }, (localDryRun.error || '')) : null,
          ) : null,
        ),
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
            createElement('option', { value: 'forks' }, t('sortForks')),
            createElement('option', { value: 'created' }, t('sortCreated')),
            createElement('option', { value: 'updated' }, t('sortUpdated')),
            createElement('option', { value: 'name' }, t('sortName')),
          ),
          createElement('div', { style: { display: 'inline-flex', gap: 6 } },
            viewButton('list', t('viewList'), ViewIcon('list')),
            viewButton('grid', t('viewGrid'), ViewIcon('grid')),
          ),
        ),
        // notice banner
        createElement(Notice, { notice: notice, t: t, onRestart: onRestart }),
        // status / count row
        createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } },
          createElement('span', null, t('cachedNote')),
          refreshing ? createElement('span', { style: { color: 'var(--dsw-alias-state-business-primary)' } }, t('refreshing')) : null,
          createElement('span', { style: { marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' } }, (loading ? '' : total + ' ' + (filter === 'local' ? t('localBadge') : t('results')))),
          isFiltered(filters) ? createElement('button', {
            type: 'button', onClick: clearFilters, title: t('clearFilters'),
            style: { ...controlStyle, padding: '2px 10px', cursor: 'pointer', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
          }, t('clearFilters')) : null,
          createElement('button', {
            type: 'button', onClick: manualRefresh, title: t('refresh'),
            style: { ...controlStyle, padding: '2px 10px', cursor: 'pointer', fontSize: 12 },
          }, t('refresh')),
        ),
        // status filter row: All / Installed / Local only, with cached counts.
        // (the tag area below stays separate, and hidden entirely in Local only)
        createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          (function () {
            var counts = cache.counts || {}
            var defs = [
              { id: 'all', label: t('filterAll'), count: counts.all },
              { id: 'installed', label: t('filterInstalled'), count: counts.installed },
              { id: 'local', label: t('filterLocal'), count: counts.local, title: t('filterLocalHint') },
            ]
            return defs.map(function (d) {
              var active = filter === d.id
              return createElement('button', {
                key: d.id, type: 'button', title: d.title || d.label,
                'aria-pressed': active ? 'true' : 'false',
                onClick: function () { setFilter(d.id) },
                style: {
                  display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                  border: '1px solid ' + (active ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l2)'),
                  background: active ? 'rgba(128,128,128,0.14)' : 'var(--dsw-alias-bg-layer-3)',
                  color: active ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-primary)',
                  borderRadius: 999, padding: '3px 11px', fontSize: 12, fontFamily: 'inherit', whiteSpace: 'nowrap',
                },
              }, d.label, typeof d.count === 'number' ? createElement('span', { style: { opacity: 0.65, fontVariantNumeric: 'tabular-nums' } }, String(d.count)) : null)
            })
          })(),
        ),
        // categorized tag area: All + active tag + tag filter, then grouped chips
        filter !== 'local' && (tags.length || tag) ? createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
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
        loading && items.length === 0 && filter !== 'local' ? createElement(SkeletonView, { view: view, label: t('loading') }) : content(),
        filter !== 'local' && total > items.length ? createElement('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, t('showingTruncated') + ' ' + items.length + ' ' + t('results')) : null,
        forksRepo ? createElement(ForksDialog, {
          t: t, lang: lang, repo: forksRepo, parentBranch: parentBranchOf(items, forksRepo),
          data: forksData, plugins: plugins, busy: busy, copied: copied, notice: notice,
          onInstall: onInstall, onUninstall: onUninstall, onCopy: onCopy,
          onToggleEnabled: onToggleEnabled, onRestart: onRestart,
          onRefresh: function () { loadForks(forksRepo, true) },
          onClose: closeForks,
        }) : null,
        pickerOpen ? createElement(FolderPicker, {
          t: t, path: pickerPath, data: pickerData, loading: pickerLoading, hidden: pickerHidden,
          onNavigate: function (next) { loadPicker(next, pickerHidden) },
          onToggleHidden: function (next) { loadPicker(pickerPath, next) },
          onPick: onPickFolder,
          onClose: function () { setPickerOpen(false) },
        }) : null,
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

      function post(path, body) {
        return fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
        }).then(function (r) { return r.json().catch(function () { return {} }) })
      }

      function postRepo(path, repo) {
        return post(path, typeof repo === 'string' ? { repo: repo } : repo)
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
        restart: function () {
          return fetch('/community-plugins/restart', { method: 'POST' })
            .then(function (r) { return r.json().catch(function () { return {} }) })
        },
        setEnabled: function (name, enabled) {
          return postRepo('/community-plugins/plugin', { name: name, enabled: enabled })
        },
        forks: function (repo, force) {
          return fetch('/community-plugins/forks?repo=' + encodeURIComponent(repo) + (force ? '&force=1' : ''))
            .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'bad response' } }) })
        },
        install: function (repo) { return postRepo('/community-plugins/install', repo) },
        installLocal: function (path, dryRun) { return post('/community-plugins/install', typeof dryRun === 'boolean' ? { path: path, dryRun: dryRun } : { path: path }) },
        browse: function (path, hidden) {
          return fetch('/community-plugins/browse?path=' + encodeURIComponent(path || '') + (hidden ? '&hidden=1' : ''))
            .then(function (r) { return r.json().catch(function () { return { ok: false, entries: [], reason: 'bad response' } }) })
        },
        validate: function (path) { return post('/community-plugins/validate', { path: path }) },
        uninstall: function (repo) { return postRepo('/community-plugins/uninstall', repo) },
        lang: activeLang,
      }

      slots.inject('settings.plugins.tab', function () {
        return slots.register({
          name: 'settings.plugins.tab',
          id: 'community-plugins',
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
