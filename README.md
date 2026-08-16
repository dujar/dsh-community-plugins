# dsh-community-plugins

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) web-GUI plugin that adds a **Community plugins** tab to **Settings → Plugins**. It discovers the plugins published under GitHub's [dsh-plugin topic](https://github.com/topics/dsh-plugin), keeps a **local SQLite catalog** of their metadata, refreshes it in the background, and lets you **search, browse, aggregate by tag, and install/uninstall** with one click.

The tab sits alongside the built-in *Plugin configuration* and *Plugin list* tabs. The built-in *Plugin list* only shows what is already installed; this tab makes the rest of the community discoverable.

## Features

- **Two views** — **List** (rich cards) and **Grid** (compact cards), with a view switcher in the toolbar; the choice persists per browser.
- **Categorized tags** — topic tags are grouped into labeled categories (DSH & DeepSeek, AI & Agents, Languages, Web & UI, Data & Storage, Tooling, Trading, Security, and Other) and shown in a compact, scrollable area with its own **filter box**; click a tag to drill into that category, click *All* (or the active-tag ×) to clear it. The umbrella `dsh-plugin` and `deepseek-harness` tags are omitted.
- **Local SQLite catalog** — plugin metadata is cached in `$DSH_HOME/dsh-community-plugins/catalog.db` (`node:sqlite`). Browsing, searching, sorting and tag aggregation all read this local file, so they are instant and offline.
- **Background refresh** — the catalog seeds itself at `dsh web` startup (top repos by stars and by recent update) and refreshes again in the background as you search, so the cache grows with what you look for. A `Refresh` button forces an immediate update; the status row shows *Updating…* while a fetch is in flight.
- **Search** by name, owner, description, or topic, with **sort by stars / recently updated / name**.
- **Install** — one click runs the real `dsh plugin --profile <profile> add github:owner/name` on the host (pnpm under the hood) and reconciles `dsh.profile.bundles`.
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
3. Type to search — results come from the local cache instantly, and the host refreshes that query from GitHub in the background.
4. Click **Install** on a plugin. When it finishes, **restart `dsh web`** and refresh the page (the note under the result explains this). Newly installed plugins appear in the built-in *Plugin list* tab after the restart.

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
  LICENSE
  README.md
```

## Host routes

| Route | Method | Description |
| --- | --- | --- |
| `/community-plugins/catalog` | GET | Local catalog query. Params `q`, `tag`, `sort` (stars/updated/name), `limit`, `offset`. Returns `{ items, total, allCount, tags, refreshing, refreshedAt }`. |
| `/community-plugins/refresh` | POST | Body `{ q }`; schedules a background GitHub fetch. |
| `/community-plugins/state` | GET | Returns `{ profile, plugins: [{ name, spec, repo }] }` — the profile name and installed out-of-tree plugins. |
| `/community-plugins/install` | POST | Body `{ repo: "owner/name" }`; runs `dsh plugin --profile <p> add github:owner/name`. |
| `/community-plugins/uninstall` | POST | Body `{ repo: "owner/name" }`; resolves the package name and runs `dsh plugin --profile <p> remove <name>`. |

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
