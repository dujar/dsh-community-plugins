# dsh-community-plugins GIF Presentation Plan

## Overview
A synthetic demo GIF that showcases the key features of the Community Plugins tab in the DeepSeek Harness web GUI. Since we cannot run the actual DSH app, we build an HTML/CSS mockup that mirrors the real UI and record it with ffmpeg.

## Target Specs
- **Dimensions**: 900×600 (scales well in GitHub markdown, fits README width)
- **FPS**: 24
- **Duration**: ~25-30 seconds
- **Format**: GIF with dithering (gifski preferred; fall back to ffmpeg palettegen)
- **Loop**: infinite

## Scene Breakdown

### Scene 1 — Tab Selection (0:00–0:03)
- Show the DSH Settings → Plugins page with three tabs: "Plugin configuration", "Plugin list", "Community plugins"
- Cursor highlights the "Community plugins" tab (the third one)
- Transition: tab content fades/slides in

### Scene 2 — List View / Toolbar (0:03–0:06)
- The tab content appears: toolbar with search box, sort dropdown (Stars ← default), view switcher (List/Grid icons), filter chips (All / Installed / Local only with counts)
- Subtle "Updating…" indicator that changes to "Updated just now" with a timestamp
- Tag category strip visible below: "DSH & DeepSeek · AI & Agents · Languages · Web & UI · …"

### Scene 3 — Search & Sort (0:06–0:10)
- Type "trader" into the search box → results instantly filter (the local SQLite catalog fires immediately)
- Sort dropdown animates from "Stars" → "Recently updated" → back to "Stars"
- Result count updates dynamically (e.g., "12 plugins")

### Scene 4 — Tag Filtering (0:10–0:14)
- Hover over "AI & Agents" category chip
- Click "react" tag → list filters to only React-related plugins
- Show the × clear button appearing on the active tag
- Click × → all tags cleared, full list restored

### Scene 5 — Card Detail / Fork Browser (0:14–0:19)
- Hover over a card showing its star/fork count, description, topics
- Click the fork count badge → Forks dialog opens as an overlay
- Dialog shows: fork list with stars, last push date, "Compare with upstream" link
- Close dialog (Escape or click outside)

### Scene 6 — Install Flow (0:19–0:24)
- Click "Install" on a card
- Button morphs to "Installing…" with spinner
- Success state: green banner "Installed. Restart dsh web to activate it." + Restart button
- Click "Remove" on an already-installed card → "Removed. Restart dsh web to apply."

### Scene 7 — Status Filters (0:24–0:27)
- Click "Installed" chip → list narrows to only installed plugins with green badges
- Click "Local only" chip → shows private/local plugins with their manifests
- Return to "All"

### Scene 8 — Closing Shot (0:27–0:30)
- Full unfiltered list in grid view (switch view mode one last time)
- Logo/text overlay: "dsh-community-plugins · Search · Browse · Install"
- Fade to DSH logo / plugin name

## UI Design Notes (matches real client.js)
- Cards: avatar (repo octocat), owner/name link, description (truncated), topics as colored chips, star/fork counts, Install/Remove/Enable buttons
- Color scheme: follows DSW design tokens (light/dark aware); use a dark theme for visual appeal
- Tags: categorized with section headers (DSH & DeepSeek, AI & Agents, etc.)
- View switcher: List (wide cards) ↔ Grid (compact cards)

## Technical Approach
1. Build a self-contained `demo.html` with inline CSS + minimal JS (no build step)
2. Use static mock data that represents realistic GitHub repos
3. Animate with CSS transitions + a simple timeline controller
4. Record with `ffmpeg -f x11grab` or headless Chromium → MP4 → GIF

## Step-by-step Execution Plan

### Phase 1: Create the HTML Demo
- Mock up the full UI with ~12 realistic plugin cards
- Implement interactive behaviors (search, sort, tag filter, fork dialog, install)
- Dark theme by default (looks best in GIFs)

### Phase 2: Record
- Option A: Playwright/Puppeteer headless browser → screenshot sequence → assemble GIF
- Option B: `ffmpeg` + `xvfb-run` + chromium for screen capture
- Option C: Direct canvas-based animation exported as GIF

### Phase 3: Optimize
- Generate palette with ffmpeg's `palettegen`
- Dither to 256 colors for crisp GIF
- Target file size < 5MB for GitHub README compatibility

## File Output
- `/home/bitslicer/dev/2026_work/projects/hermes/dsh-community-plugins/demo.html`
- `/home/bitslicer/dev/2026_work/projects/hermes/dsh-community-plugins/docs/demo.gif` (or `assets/demo.gif`)
