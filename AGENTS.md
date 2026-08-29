# AGENTS.md — LOOM

> Context file for AI agents working on this project. Read this fully before making changes.
> There is **no build step**: plain HTML + CSS + JS, served statically.

---

## 1. What this is

**LOOM** is a meditative browser puzzle about pattern-making. The player operates a loom: vertical **warp** threads and horizontal **weft** threads each carry a dye. Where a warp and weft cross, their dyes **blend** into one square of cloth. A short warp sequence repeats across the loom; a short weft sequence repeats down it. The player must reproduce a target "sample" cloth by discovering the small repeat hidden inside it.

It is a genuine 2D constraint puzzle: the visible cloth is the outer product (under color-mixing) of two short 1D sequences.

### Core rule (the one invariant — never break this)

```
cloth[y][x] = mix(warpSeq[x % W], weftSeq[y % H])
mix(a, b)   = per-channel floor((a + b) / 2)   // midpoint blend in RGB
```

Everything else (levels, hints, par) derives from this rule. The sample target is always generated the same way from a hidden solution: `target[y][x] = mix(solutionWarp[x % solW], solutionWeft[y % solH])`.

---

## 2. File map

| File | Role |
| --- | --- |
| `index.html` | Single page: topbar HUD, sample swatch, loom frame (thread strips + player grid), control console, intro/win overlays, confetti canvas, toast, `[data-ad-slot]` containers inside a `.page-columns` wrapper. Loads `app.js` then `ads.js` at the end of `<body>`. |
| `style.css` | All styling. Design tokens in `:root` custom properties. No CSS-in-JS; JS only sets inline `backgroundColor` and toggles classes. Ad-slot sizing lives in the `.ad-*` rules. |
| `app.js` | Entire game logic (~1,150 lines, one file, no modules). `'use strict'`, IIFE-free top-level script. Sections: constants/state/DOM/color helpers, **Solver**, level generation, **Endless generator**, board/paint/undo/interactions/hint/timer/win/sound/toast/persistence, **Daily Weave**, library/wiring. |
| `capture.js` | Playwright script: serves the folder on port 3456 and saves `screenshots/{intro,gameplay,solved}.png`. |
| `verify.js` | Playwright script: serves on port 3457 and runs ~96 automated checks (layout, counts, moves, undo, hint, reveal→win, level advance, persistence, keyboard, console errors, **solver proofs + uniqueness/ambiguity/reduction cases, generator & daily determinism, endless-level quality gates, Daily Weave UI flow incl. share grid + `loom.daily.v1` persistence**). **Run this after any gameplay change.** |
| `ads.js` | Ad slots: fills every `[data-ad-slot]` container (footer leaderboard, intro/win banners, side rails ≥1420px). Renders house placeholders until `ADSENSE_CLIENT` is set at the top, then injects the AdSense loader once and mounts `<ins>` units. Isolated from `app.js`, all try/catch — ads must never break gameplay. |
| `ads.txt` | Ad-network authorization file at the site root. Ships fully commented out; uncomment + insert the real pub id when AdSense is approved. |
| `README.md` | Product narrative + how to play; references the three screenshots. |
| `screenshots/*.png` | Real captures (2x device scale). Regenerate with `capture.js`. |
| `logos/` | Brand assets. `loom-looped.svg` = animated logo shown on the intro splash (`.intro-logo` in `index.html`, wordmark included — keep the `<text>` block if editing it); `Loom-interactable.svg` = hover-interactive variant (unused in-app); `logo-banner.jpg` (2752×1536) = `og:image`/`twitter:image` link-preview image; `logo-banner-sm.jpg` (1376×768) = README header banner; `logo-180.png` = `apple-touch-icon`; `logo-1024.jpg` / `logo-2048.jpg` = square logo sources; `github-social-preview.png` (1280×640) = upload manually in GitHub repo Settings → Social preview. |
| `Test_idea.md` | Original design brainstorm transcript. Historical only — do not treat as spec. |
| `.gitignore` | Excludes `node_modules/`, `.pw-browsers/`, `.npm-cache/`, `.gh-config/`, `.DS_Store`. |

---

## 3. Game rules & systems

### Board
- Cloth is **12 columns × 10 rows** (`COLS`, `ROWS` in `app.js`). Both sample and player grids are this size.
- Cells get an `over`/`under` class by `(x + y) % 2` for the woven texture (purely visual).

### Dyes
- `DYES` array in `app.js` — **order matters**: it is the cycle order for clicking.
  `Indigo #3D5A80 → Madder #C1440E → Ochre #E0A32E → Sage #7C8B6F → Cream #F2E8CF`.
- `CREAM` is the starting color of every player thread.
- Clicking a thread cycles forward through `DYES`; **Shift-click cycles backward**.

### Repeats
- `state.W` / `state.H` = player's warp/weft repeat lengths, clamped to `MIN_REPEAT=1 … MAX_REPEAT=8`.
- Changing a repeat resizes the sequence, preserving existing colors and padding new slots with `CREAM`.
- The hidden solution uses `solW`/`solH` (from the level spec). The player may solve with *any* W/H that reproduces the cloth — only the cloth is checked.

### Levels
- `LEVELS` table: 10 hand-tuned entries `{ w, h, dyes, name }` (Tabby → Jacquard), ramping repeat size and dye count.
- **Levels are deterministic**: `solveLevel(n, variation)` is a pure function that computes the hidden solution + target cloth from a seeded PRNG (`mulberry32`, seed = `levelSeed(n, variation)`). Same level number → same pattern. This is what makes previews and stats meaningful. For `n > LEVELS.length` it delegates to the endless generator (see below).
- `variation` (default 0) offsets the seed. The **Shuffle** button increments it for fresh colors on the same level; stats are only recorded for `variation === 0` (the canonical pattern). Shuffle is refused while a Daily is active (the Daily must stay identical for everyone).
- Hand-tuned levels reroll random sequences (up to 40 attempts) until the cloth is non-trivial: ≥ `min(3, w*h)` distinct shades and not both sequences monochrome.
- Player always starts on an all-cream loom with a 1×1 repeat.

### Solver (`solvePuzzle`)
- Pure brute-force proof engine in `app.js`. For every repeat shape `(w, h)` in `1…MAX_REPEAT²`: first a residue-consistency test (all cells with the same `x%w, y%h` must share one color), then an exhaustive warp enumeration pruned by per-weft-slot candidate bitmasks built from `BLEND_WARP_MASK`.
- Returns **every** distinct solution, canonicalised: each sequence collapsed to its minimal period (`[A,B,A,B]` → `[A,B]`) and duplicates deduped. `unique === true` ⇔ exactly one canonical solution reproduces the cloth. Note: `mix()` is symmetric, so a flat cloth of any off-diagonal blend has ≥2 solutions (warp/weft swap) — correctly reported as non-unique.
- Each solution carries `moves` = dye dips from Cream (cheapest cycle direction per thread, `CYCLE_DIST`) **plus `w + h`** repeat-discovery slack — the same formula as `parMoves()`. Puzzle-level `minMoves` is the cheapest solution's count; `hypotheses` counts repeat shapes surviving step 1 (a decoy measure).
- `weaveCloth(warp, weft)` and `verifySolution(warp, weft, target)` are the shared pure helpers (hex comparison is case-insensitive).

### Endless generator
- Levels past the 10 named ones are **sampled + solver-filtered**: `getGeneratedLevel(n, variation)` seeds `mulberry32(levelSeed(n, variation))`, samples random warps/wefts/repeats/dye-counts from tier windows (`GEN_TIERS`), rejects uninteresting boards, runs `solvePuzzle()`, and keeps a board only if it is **uniquely solvable**, *irreducible* (canonical repeat equals the sampled repeat), and lands on the requested difficulty tier. No `Math.random` anywhere on this path → fully deterministic per (level, variation); results memoised in `GENERATED_CACHE`.
- Difficulty is graded by the solver's minimum move count (`GRADES`: ≤12 Gentle, ≤18 Medium, ≤24 Hard, else Expert). Endless levels ramp two-per-tier (`endlessTierFor`): 11–12 Gentle … 17+ Expert. The grade shows as a badge (`.level-grade`) on library cards.
- The **Daily Weave** reuses the same sampler: `generateDailyPuzzle(dateKey)` seeds from the UTC date string so every player gets the identical puzzle.

### Daily Weave
- HUD **📅 button** or intro "Daily weave" button → `startDaily()` builds today's puzzle into the normal board (campaign `state.level` is untouched). Level chip shows `📅 Daily · Mon D`; Shuffle is disabled there.
- On a genuine win (not Reveal): best result persists per date under `loom.daily.v1` — `{ [YYYY-MM-DD]: { stars, moves, time, ms, grade, plays } }`, keeping max stars, then fewest moves, then fastest time; replays never lower a record.
- The win modal gains a share card: a 6×5 downsample of the cloth (`#share-grid`) plus "⧉ Copy result". A Wordle-style emoji grid (`buildDailyShare()`: title line, 5 rows of 🟦🟥🟨🟩⬜ via nearest-dye quantisation, stats line) is auto-copied to the clipboard on winning (`copyTextToClipboard`, with `execCommand` fallback; all failures degrade to a toast).
- "↩ Back to patterns" exits to the saved campaign level; "Weave again" replays today's daily.

### Level select (Pattern Library)
- Opened via the **▦ HUD button** or the **"Browse patterns"** button on the intro. Rendered by `renderLevelSelect()` into `#levels-grid`.
- Shows `LIBRARY_COUNT` (16) cards: mini cloth preview (6×5 downsample of the target), level number, name, difficulty grade for generated levels (11+), earned stars, and best time/moves if completed.
- **Unlock rule**: level `n` is unlocked if `n === 1`, or the previous level has ≥1 star, or `n ≤ state.level` (reached before). Locked cards are disabled and show 🔒.
- Picking a card closes the library + intro, and calls `generateLevel(n, 0)`.
- Header shows total stars collected (`#levels-summary`).

### Interactions
- **Thread strips**: one `<button class="thread">` per cloth column (warp, top) and per row (weft, left), *tiled* from the repeat — button `dataset.idx = position % W` (or `% H`). Clicking any tile edits that repeat slot. Hovering a thread lights every cloth cell it passes through (`thread-lit` class).
- **Cloth cells**: click = cycle that cell's warp thread; Shift-click = cycle its weft thread (backward).
- **Repeat steppers**: ± buttons in the console; disabled at bounds.
- **Keyboard**: `Z` = undo, `H` = hint (ignored while overlays are open).
- **Touch / long-press**: phones have no Shift key, so `wireLongPress()` (pointer events, touch only) makes a **450ms hold** perform the backward/weft cycle on both cloth cells and threads, with a 12px drift tolerance and `navigator.vibrate` feedback. The click that follows a completed long-press is swallowed via `consumeLongPressClick()`. `contextmenu` is prevented on the board so the OS long-press menu never fires.

### Undo
- Every mutating action calls `pushUndo()` first (snapshot of `W, H, warpSeq, weftSeq, moves`; capped at 200). `undo()` restores and rebuilds strips if structure changed. Undo is disabled after a win.

### Hints
- 3 per level (`HINTS_PER_LEVEL`). `useHint()` finds the first mismatched cell `(x, y)` and:
  1. If some dye `d` satisfies `mix(d, currentWeft) === target` → suggest that warp thread + dye.
  2. Else if some `d` satisfies `mix(currentWarp, d) === target` → suggest weft thread + dye.
  3. Else → structural hint naming the solution's warp/weft dyes ("check your repeat lengths").
- The cell pulses (`hint-target`), the relevant thread tiles glow (`lit`), and a toast shows the message. Both clear after ~3.2s.

### Scoring & win
- Match % = matching cells / 120, shown in HUD meter. At 100%, `paint()` triggers the win once (`hasWon` guard).
- `parMoves()` = sum of minimal cycle distances from Cream for every solution thread, **plus `solW + solH`** slack for discovering the repeat.
- Stars: `moves ≤ par` → 3; `≤ ceil(par × 1.8)` → 2; else 1. **Reveal = 0 stars, no confetti/chime.**
- Win modal shows time, moves, par, animated stars; "Next pattern" / "Weave again".

### Persistence
- `localStorage` key **`loom.save.v3`** → `{ level, sound, best: { [level]: { stars, time, moves, ms } } }`. Saved on level generate, win, and sound toggle. Loaded on boot; intro button becomes "Continue · Pattern Nº N" if `level > 1`.
- **Legacy migration**: `loadGame()` reads the old `loom.save.v2` key (where `best` was a plain star count) and migrates it to `v3` on first load.
- **Daily key** **`loom.daily.v1`** → `{ [YYYY-MM-DD]: { stars, moves, time, ms, grade, plays } }`, one entry per UTC date, best result kept (see Daily Weave). Loaded at boot into `state.dailyResults`; if today's entry exists, the intro daily button shows `Daily ✓ N★`.
- `bestStarsFor(level)` is the safe accessor for a level's star count (returns 0 if absent).

### Sound
- Tiny WebAudio blips (`blip(freq, dur, type, gain)`), created lazily on first user gesture. Mute toggle in HUD, persisted. All sound calls are wrapped in try/catch — sound must never break gameplay.

---

## 4. Architecture notes (how `app.js` is organized)

Top-to-bottom sections, each marked with a banner comment:

1. **Constants** — grid size, dyes, level table, tuning knobs.
2. **State** — single mutable `state` object (no framework, no reactivity).
3. **DOM refs** — `el` object filled by `cacheDom()` on `DOMContentLoaded`; `sampleCells` / `playerCells` are flat arrays of 120 cell elements (index `y * COLS + x`).
4. **Color helpers** — `hexToRgb`, `rgbToHex`, `mix`, `dyeNameOf`.
5. **Solver** — `CYCLE_DIST`, `BLEND_WARP_MASK`, `minimalPeriod`, `weaveCloth`, `verifySolution`, `solvePuzzle` (pure, no DOM).
6. **Level generation** — `mulberry32`, `levelSeed`, `randomSeq`, `solveLevel`, `generateLevel`.
7. **Endless generator** — `GRADES`, `GEN_TIERS`, `endlessTierFor`, `sampleBoard`, `boardIsInteresting`, `packGenerated`, `sampleUniqueLevel`, `getGeneratedLevel`.
8. **Board construction** — `buildFabric` (cells, once at boot), `buildStrips` (thread buttons, rebuilt whenever W/H changes).
9. **Painting** — `paint()` is the **single render pass**: colors sample + player cells, toggles `matched`, paints thread tiles, updates every HUD element, and runs the win check. There is no virtual DOM; call `paint()` after any state change.
10. **Undo / Interactions / Hint / Timer / Win / Confetti / Sound / Toast / Persistence / Daily Weave / Library / Wiring** — self-explanatory sections.

Boot sequence (`DOMContentLoaded`): `cacheDom()` → `buildFabric()` ×2 → `wireControls()` → `loadGame()` (+ daily store) → `generateLevel(state.level)`.

### Invariants to respect when editing
- `paint()` must stay idempotent and the only place that writes to the DOM from state.
- Thread tiles are rebuilt by `buildStrips()`; never cache tile references across a repeat change.
- All event handling is delegated on containers (`player-grid`, `warp-strip`, `weft-strip`) — don't attach per-cell listeners.
- Keep the file dependency-free (no imports, no bundler).

---

## 5. Visual design system (`style.css`)

- **Tokens** in `:root`: dye colors (`--indigo`, `--madder`, `--ochre`, `--sage`, `--cream`), surfaces (`--bg` linen `#F6F1E7`, `--paper`, `--ink`), wood (`--wood*`), sizes (`--cell: 30px`, `--cell-sm: 21px`, `--gap: 2px`), shadows, fonts.
- **Fonts**: Fraunces (display) + Inter (UI) via Google Fonts.
- **Aesthetic**: warm linen background with a faint woven grid (two repeating-linear-gradients), wooden loom frame with grain (`::before` overlay), sample shown as a pinned paper swatch card (slight rotation, brass pin).
- **Cloth texture**: `.cell.over` / `.cell.under` alternate 2px stripe gradients (vertical/horizontal) to fake over-under weaving.
- **Threads**: `.thread.warp` = 12px-wide vertical pill; `.thread.weft` = 12px-tall horizontal pill; both have lengthwise fiber stripes.
- **Responsive / mobile**: cell sizes shrink at 900px; at ≤640px cells become fluid — `--cell: clamp(15px, calc((100vw - 122px) / 12), 24px)` — so the loom always fits the viewport width (the 122px constant = gaps + `--strip` + frame padding + main padding; keep it in sync if those change). Thread strips use the `--strip` token (26px desktop, 30px on touch). Modals become bottom-anchored scrollable sheets with `env(safe-area-inset-bottom)` padding; the viewport meta uses `viewport-fit=cover`. A `(hover: none), (pointer: coarse)` block disables sticky hover states on touch, and `touch-action: manipulation` kills double-tap zoom on game controls. `prefers-reduced-motion` disables animation.
- **Layout gotcha (fixed bug — don't regress)**: `.loom-inner` is a 2×2 grid (`corner | warp strip` / `weft strip | player grid`) with `width: fit-content; margin-inline: auto`. The `.loom-hint` caption has a `max-width` tied to the loom width (uses `var(--strip)`) — without it, the long caption inflates the frame and CSS grid stretch silently widens the weft-strip column, pushing threads away from the cloth. Keep both.

---

## 6. Tooling & environment

### Running the game
```bash
python3 -m http.server 8000   # any static server works; open http://localhost:8000
```

### Screenshots & tests (Playwright)
```bash
node capture.js    # regenerates screenshots/*.png
node verify.js     # automated playthrough; must end with "ALL CHECKS PASSED"
```

**Environment constraints (important):**
- This machine runs **macOS 12.7.6**. Playwright ≥ 1.46 refuses to install Chromium here ("does not support chromium on mac12"). The project is pinned to **`playwright@1.45.1`** — do not upgrade it.
- Tooling lives **outside the repo**, in `../../Do not delete folder/` (i.e. `~/Documents/Projects/Do not delete folder/`): shared `.pw-browsers/` (Chromium 1124), shared `node_modules/` (playwright 1.45.1), and `.npm-cache/`. Both scripts set `process.env.PLAYWRIGHT_BROWSERS_PATH` to the shared browsers; the project's `node_modules` is a **symlink** to the shared one (Node resolves `require('playwright')` through it). Playwright is also installed globally (`~/.npm-global`) with `PLAYWRIGHT_BROWSERS_PATH` exported in `~/.zshrc`.
- If the shared `chromium-1124` is missing: `npm install --cache "$PWD/../../Do not delete folder/.npm-cache"` then `PLAYWRIGHT_BROWSERS_PATH="$PWD/../../Do not delete folder/.pw-browsers" npx playwright install chromium`. (The `--cache` flag avoids a non-writable `~/.npm`.)
- The local agent model **cannot view images** — verify visual changes via `verify.js` measurements (bounding boxes, computed styles), not by "looking" at screenshots.

### Git
- Repo initialized on branch `main`; one commit; caches gitignored. Remote/upload is handled by the user.

---

## 7. Recipes for common changes

**Add a level**: append `{ w, h, dyes, name }` to `LEVELS` (keep `w, h ≤ 8`, `dyes ≤ 5`). Nothing else needed — par, hints, and save adapt automatically.

**Add a dye**: append `{ name, hex }` to `DYES`. Note: cycle distance (used by `parMoves()`) and all hint logic derive from array position automatically. Choose a hex whose midpoint blends with existing dyes stay distinguishable.

**Change difficulty**: edit `LEVELS`, or the reroll criteria in `generateLevel()` (the `interesting` predicate), or star thresholds in `starsFor()`. For generated endless levels and the Daily, tune the sampling windows in `GEN_TIERS`, the move-count buckets in `GRADES`, and the ramp in `endlessTierFor()` — verify.js asserts levels 11–16 stay unique + graded, so rerun it.

**Add a control/button**: add markup in `index.html`, style in `style.css`, then register the element id in `cacheDom()`'s `ids` map and wire it in `wireControls()`. If it mutates state, call `pushUndo()` first and `paint()` after.

**Add a new HUD stat**: add a `.chip` in the header, register it in `cacheDom()`, update it inside `paint()`.

**Change board size**: edit `COLS`/`ROWS` and the matching `repeat(...)` counts in `style.css` (`#sample-grid`, `#player-grid`, `#warp-strip`, `#weft-strip`) plus the `.loom-hint` max-width formula. Update `verify.js` cell-count expectations (currently 120).

**Enable / change ads**: slot containers are `[data-ad-slot]` elements in `index.html` (`footer`, `intro`, `win`, `railLeft`, `railRight`); their reserved sizes live in `style.css` `.ad-*` rules; filling logic and the AdSense config live at the top of `ads.js`. To go live: set `ADSENSE_CLIENT` + unit ids there, uncomment `ads.txt`, redeploy. Deleting a container is enough to remove a slot.

---

## 8. Definition of done for any change

1. `node --check app.js` passes.
2. `node verify.js` ends with **ALL CHECKS PASSED** (extend it when you add behavior).
3. `node capture.js` run if visuals changed, so README screenshots stay honest.
4. No new runtime dependencies; no build step introduced.
