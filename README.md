# dsh-community-plugins

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) web-GUI plugin that adds a **Community plugins** tab to **Settings → Plugins**. It discovers the plugins published under GitHub's [dsh-plugin topic](https://github.com/topics/dsh-plugin), keeps a **local SQLite catalog** of their metadata, refreshes it in the background, and lets you **search, browse, aggregate by tag, and install/uninstall** with one click.

The tab sits alongside the built-in *Plugin configuration* and *Plugin list* tabs. The built-in *Plugin list* only shows what is already installed; this tab makes the rest of the community discoverable.

## Features

- **Two views** — **List** (rich cards) and **Grid** (compact cards), with a view switcher in the toolbar; the choice persists per browser.
- **Categorized tags** — topic tags are grouped into labeled categories (DSH & DeepSeek, AI & Agents, Languages, Web & UI, Data & Storage, Tooling, Trading, Security, and Other) and shown in a compact, scrollable area with its own **filter box**; click a tag to drill into that category, click *All* (or the active-tag ×) to clear it. The umbrella `dsh-plugin` and `deepseek-harness` tags are omitted.
- **Local SQLite catalog** — plugin metadata is cached in `$DSH_HOME/dsh-community-plugins/catalog.db` (`node:sqlite`). Browsing, searching, sorting and tag aggregation all read this local file, so they are instant and offline.
- **Stable results** — the result list never reloads on its own. It is re-read only when you change a filter (search text, sort, tag, status filter) or press `Refresh`, and the filters plus the last result set survive switching settings tabs and reloading the page. **Clear filters** in the status row resets search, sort, tags and the status filter in one click.
- **Status filter** — **All / Installed / Local only** chips, each with a count. *Installed* narrows the community list to plugins that are in this profile (by resolved GitHub repo or package name); *Local only* lists the installed plugins that are **not** in the community catalog at all — private repos, local checkouts, registry packages outside the dsh-plugin topic — each with its **description, version and author read from the installed package's manifest** (`file:`/`link:` specs resolve relative to the profile directory, anything else through the profile's `node_modules`), its install spec, an **Uninstall** button that removes by package name, and — when the package ships one — its **README rendered inline** (a safe minimal markdown subset: headings, bullets, fenced code, bold/italic, http(s) links; everything else is escaped, truncated at 12k chars). **Multiple README variants** (`README.md`, `README.zh-CN.md`, …) become language tabs on the card, so each reader can pick their preferred language. A local plugin whose repo exists on GitHub additionally renders with the **same rich card as catalog rows** (avatar, stars, forks + fork browser, topics, remove/open actions) — metadata is fetched once per repo and cached in SQLite.
- **Background refresh** — the catalog seeds itself at `dsh web` startup (top repos by stars and by recent update) and refreshes again in the background when you change the search term, so the cache grows with what you look for. A `Refresh` button forces an immediate update; the status row shows *Updating…* while a fetch is in flight, and the list picks up the new rows once that fetch lands.
- **Search** by name, owner, description, or topic, with **sort by stars / forks / recently created / recently updated / name**. *Recently updated* uses GitHub's real `updated_at` (any repo change), not the push time the cards display.
- **Fork browser** — each card shows the repo's **fork count**; click it to list the forks (stars, last push, description, archived state) in a dialog. Every fork has a **Compare with upstream** link (`github.com/<upstream>/compare/<branch>...<forkOwner>:<branch>`) so you can see what it carries that upstream has not merged, and an **Install** button that installs *that fork* instead of the original. When a fork would displace an already-installed plugin of the same name, the row says `replaces <owner/name>`. Listings are cached per repo (10 min, `DSH_COMMUNITY_FORKS_TTL_MS`); `Refresh` in the dialog forces a fresh fetch.
- **Install** — one click runs the real `dsh plugin --profile <profile> add github:owner/name` on the host (pnpm under the hood) and reconciles `dsh.profile.bundles`. A pre-flight check fetches the repo's `package.json` and rejects repos that do not declare a `dsh.bundle` manifest, so repos that merely carry the `dsh-plugin` topic (the harness itself, apps, demos) fail fast with a clear reason instead of a confusing pnpm error or a hang.
- **Already-installed plugins are marked** — the tab reads the active profile's `package.json`, so anything you installed earlier (here or with `dsh plugin add`) shows a green **Installed** badge and a **Remove** button instead of *Install*. A plugin that is installed but missing from `dsh.profile.bundles` — installed, not loaded — additionally shows a **Not enabled** badge. Matching is by resolved GitHub repo, falling back to package name, so a plugin installed from the npm registry under a name that differs from its repo is not detected.
- **Enable / disable** — every installed plugin (community, local, or in the fork browser) gets an **Enable** or **Disable** button that adds or removes its name from `dsh.profile.bundles` in the profile manifest. The badge and button flip immediately; the harness itself loads or unloads the plugin after you **restart `dsh web`**. Only names that are actually installed can be toggled, so the manifest can't be polluted with unknown entries. Every notice that needs one carries a **Restart dsh web** button: it respawns the server with the exact command line it was launched with, and the page reloads itself once the new instance answers.
- **Uninstall** — one click runs `dsh plugin --profile <profile> remove <package>`, resolving the actual package name from the profile manifest.
- **Copy install command** — for terminal users, every list card offers a copy-to-clipboard button with the exact command.
- **Internationalization** — English and Simplified Chinese, following the DSH language setting and switching live when it changes.
- **Theme-aware** — all styling rides the DSH design tokens (`--dsw-alias-*`), so it follows the light/dark theme automatically.

## Install

> Requires Node.js 22.19+ and pnpm (`dsh plugin` installs through pnpm under the hood).

```sh
# local checkout (development)
dsh plugin --profile web add /path/to/dsh-community-plugins

# from a git remote (after publishing)
dsh plugin --profile web add github:<you>/dsh-community-plugins
```

Then **restart `dsh web`** and refresh the browser page. The install adds `dsh-community-plugins` to the profile's `dsh.profile.bundles` automatically; if it is not added, append `"dsh-community-plugins"` to that array in `$DSH_HOME/profiles/web/package.json` and restart.

## Usage

1. Open **Settings → Plugins → Community plugins**.
2. Browse the top plugins (by stars), switch between **List / Grid**, and use the **category tags** to drill into a topic.
3. Type to search — results come from the local cache instantly, and the host refreshes that query from GitHub in the background. Results then stay put until you edit a filter again; **Clear filters** puts you back at the unfiltered list.
4. Click a card's **fork count** to browse that repo's forks, compare one against upstream on GitHub, and install from it if it carries changes you want.
5. Click **Install** on a plugin. When it finishes, **restart `dsh web`** and refresh the page (the note under the result explains this). Newly installed plugins appear in the built-in *Plugin list* tab after the restart.

## How the cache works

- The host fetches the topic with the GitHub search API and upserts each repo (name, owner, description, stars, language, topics, archived/fork flags, last push) into the SQLite catalog.
- At boot it fetches the top 100 by **stars** and the top 100 by **updated**; each search fetches the top 50 for that query. Fetching is coalesced and rate-limited (one fetch per 6s by default) so it stays under GitHub's unauthenticated search limit (10/min). On a 403/429 the worker backs off until the reset time GitHub reports.
- GitHub's search API caps unauthenticated results at 1000 per query, so the local cache is a **curated, accumulating subset** of the full topic (popular + recently active + whatever you search), not a complete mirror of all ~5000 tagged repos. Searching is the way to pull more of the topic into the cache.

## Structure

```
dsh-community-plugins/
  package.json         # manifest + dsh.bundle.patch / dsh.client declarations
  cordis.patch.yml     # host-half mount line (applied by the profile bundle mechanism)
  lib/
    index.js           # host half: SQLite catalog + background refresh + install/uninstall routes
    client.js          # browser half: list/grid/table views + tag aggregation (React, zero-build, i18n)
  test/
    helpers.test.mjs   # repo/spec parsing helpers
    catalog.test.mjs   # SQLite upsert / query / tag aggregation
    host-smoke.test.mjs# route registration
    client-smoke.test.mjs # slot wiring
    install-route.test.mjs # install pre-flight + responses
    forks.test.mjs     # fork listing cache, forced refetch, rate-limit fallback
    installed-state.test.mjs # profile manifest -> installed / enabled reporting
    toggle-route.test.mjs  # enable/disable edits dsh.profile.bundles, guarded
    restart-route.test.mjs # restart responds, schedules restarter, exits; untrusted rejected
    mini-react.mjs     # React stub + fake clock shared by the client tests
    persistence.test.mjs # cached results / filter-driven refetch / clear filters
    forks-ui.test.mjs  # fork count -> fork browser -> install from a fork
  LICENSE
  README.md
```

## Host routes

| Route | Method | Description |
| --- | --- | --- |
| `/community-plugins/catalog` | GET | Local catalog query. Params `q`, `tag`, `sort` (stars/forks/created/updated/name), `filter` (`all`/`installed`/`local`), `limit`, `offset`. `filter=local` returns the profile's installed plugins with no catalog row (flagged `local: true`). Returns `{ items, total, allCount, tags, counts, filter, refreshing, refreshedAt }`. |
| `/community-plugins/refresh` | POST | Body `{ q }`; schedules a background GitHub fetch. |
| `/community-plugins/forks` | GET | Params `repo` (`owner/name`), `force` (`1` to bypass the cache). Returns `{ ok, items, fetchedAt, cached, stale?, rateLimited? }` — one page of forks (up to 50, by stars), cached in SQLite. |
| `/community-plugins/state` | GET | Returns `{ profile, plugins: [{ name, spec, repo, enabled }] }` — the profile name and installed out-of-tree plugins. `enabled` is `true` when the package is listed in `dsh.profile.bundles` (i.e. actually mounted). |
| `/community-plugins/install` | POST | Body `{ repo: "owner/name" }`; runs `dsh plugin --profile <p> add github:owner/name`. |
| `/community-plugins/uninstall` | POST | Body `{ repo: "owner/name" }`, or `{ name }` for a local plugin with no GitHub repo (the name must be actually installed). Runs `dsh plugin --profile <p> remove <name>`. |
| `/community-plugins/plugin` | POST | Body `{ name, enabled }`; adds or removes the name from `dsh.profile.bundles` in the profile manifest. Guarded to installed plugin names. |
| `/community-plugins/restart` | POST | Respawns this `dsh web` process (detached restarter re-execs the original command line after a 1.5s port-release wait), responds `{ ok, restarting }`, then exits. `DSH_COMMUNITY_RESTART_CMD` overrides the re-exec command for supervised setups. |

All routes are guarded by the same fail-closed same-origin/localhost trust check as dsh-trader: a cross-origin or malformed `Origin`/`Referer` rejects, a CORS-simple content type rejects, and only then does a localhost host count as trusted.

## Configuration

Environment variables (all optional):

| Variable | Default | Purpose |
| --- | --- | --- |
| `DSH_COMMUNITY_PROFILE` | auto-detected | The profile to install into. Falls back to `DSH_PROFILE`, then auto-detection, then `web`. |
| `DSH_PROFILE` | — | Fallback profile name when `DSH_COMMUNITY_PROFILE` is unset. |
| `DSH_BIN` | `dsh` on PATH | Full path to the `dsh` executable used for install/uninstall. |
| `DSH_COMMUNITY_INCLUDE_FORKS` | unset | Any non-empty value includes GitHub forks in the catalog (forks are excluded by default). |
| `DSH_COMMUNITY_MIN_FETCH_INTERVAL_MS` | `6000` | Minimum gap between GitHub fetches, to stay under the search rate limit. |
| `DSH_COMMUNITY_FORKS_TTL_MS` | `600000` | How long cached fork listings and GitHub repo metadata are served before GitHub is asked again. The REST endpoints use GitHub's core limit (60/hr unauthenticated), separate from search. |
| `DSH_COMMUNITY_GITHUB_TOKEN` | — | Optional bearer token (falls back to `GITHUB_TOKEN`) sent with GitHub API requests — lets the fork browser and local-plugin metadata reach **private repos** you have access to. |
| `DSH_COMMUNITY_RESTART_CMD` | — | Overrides the restart command (e.g. `systemctl restart dsh-web`). Default: re-exec this process's own command line. |

Profile auto-detection finds the profile whose `dsh.profile.bundles` includes this plugin, so a custom profile hosting the web GUI works without any configuration.

## Development

```sh
node --check lib/index.js
node --check lib/client.js
npm test
npm pack --dry-run   # package validation before publishing
```

## License

[MIT](./LICENSE)
