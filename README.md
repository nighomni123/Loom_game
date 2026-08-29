<p align="center">
  <img src="logos/logo-banner-sm.jpg" alt="LOOM — a puzzle of warp and weft" width="688">
</p>

# LOOM

A meditative puzzle of warp, weft and color. Find the hidden repeat and weave the cloth to match the sample.

**Play it live:** [loom-game.vercel.app](https://loom-game.vercel.app/)

## Screenshots

![Intro Screen](screenshots/intro.png)
*The welcome screen: tap threads, colors blend, match the sample.*

![Pattern Library](screenshots/library.png)
*The Pattern Library: browse every level, see previews, stars and best stats.*

![Main Game Loop](screenshots/gameplay.png)
*The loom: dye the warp and weft threads, tune the repeat, and watch the cloth change.*

![Solved Puzzle](screenshots/solved.png)
*A finished weave — stars, time and move count on the win card.*

![Mobile](screenshots/mobile.png)
*Fully playable on a phone — the loom scales to fit, and long-press replaces Shift-tap.*

## The Idea

People rarely notice how small, intentional choices create ordered beauty — in textiles, music, or systems. LOOM makes that instinct playable.

Every vertical **warp** thread and horizontal **weft** thread carries a dye. Where they cross, the two dyes **blend** into a square of cloth. A short warp sequence repeats across the loom; a short weft sequence repeats down it. Your job: reproduce the sample cloth by discovering the small repeat hidden inside the surface.

It's a genuine 2D constraint puzzle that quietly teaches the "see the repeat" instinct behind weaving, design, and modular arithmetic.

## How to Play

- **Dye a thread** — click a warp or weft thread to cycle it through the dyes (Indigo → Madder → Ochre → Sage → Cream). <kbd>Shift</kbd>-click cycles backward.
- **Tap the cloth** — clicking a cloth cell changes the warp thread running through it (<kbd>Shift</kbd>-click changes the weft).
- **Set the repeat** — use the warp/weft repeat steppers to change how many distinct threads run through the loom.
- **Hover a thread** to see exactly which cloth cells it passes through.
- **Browse patterns** — open the Pattern Library (▦ in the header, or "Browse patterns" on the start screen) to see previews, your stars and best stats, and jump to any unlocked level.
- **Match 100%** of the sample to win.

## Features

- **Hand-tuned difficulty curve** — 10 named patterns (Tabby → Jacquard) with growing repeats and dye counts.
- **Endless patterns, proven fair** — every level past the named ten is sampled by a seeded generator and kept only if a built-in brute-force solver *proves* it has exactly one solution; each card is graded Gentle / Medium / Hard / Expert by the solver's minimum move count.
- **Daily Weave** — one seeded puzzle per day (📅 in the header): the same cloth for everyone, everywhere. Finish it to get a Wordle-style emoji-grid result copied to your clipboard, ready to paste. Best stars/moves/time per day are saved.
- **Pattern Library** — browse all levels from the intro or the ▦ button: live cloth previews, lock/unlock progression, earned stars, difficulty grades and best time/moves per level. Jump straight to any unlocked pattern.
- **Star scoring** — finish under par moves for ★★★; best stars, times and move counts are saved per level.
- **Hints** — 3 per level; a hint names the exact thread and dye to try, and lights the crossing.
- **Undo** — full history, including repeat changes (<kbd>Z</kbd>).
- **Timer & move counter** in the HUD.
- **Progress saving** — level, sound preference, best stats and daily records persist in `localStorage`.
- **Polish** — woven cloth texture, wooden loom frame, thread-scrap confetti, gentle WebAudio chimes, keyboard shortcuts, reduced-motion support.
- **Mobile-ready** — fluid layout that fits any phone width, big touch targets, long-press to cycle backward/weft (with haptic feedback), and safe-area support for notched screens.

## Controls

| Action | Input |
| --- | --- |
| Cycle dye forward | Click thread / cloth cell |
| Cycle dye backward | <kbd>Shift</kbd> + click, or long-press (touch) |
| Undo | <kbd>Z</kbd> or Undo button |
| Hint | <kbd>H</kbd> or Hint button |
| Pattern Library | ▦ button (header) or "Browse patterns" |
| Daily Weave | 📅 button (header) or "Daily weave" |
| Sound on/off | 🔊 button |

## Run It

No build step — it's plain HTML/CSS/JS.

```bash
# serve the folder (any static server works), e.g.:
python3 -m http.server 8000
# then open http://localhost:8000
```

To regenerate the README screenshots (uses a workspace-local Playwright + Chromium):

```bash
node capture.js
```

## Monetization (Ad Slots)

The blank spaces around the loom carry labeled banner slots:

| Slot | Where | Size |
| --- | --- | --- |
| Side rails | Left & right margins on screens ≥ 1420px wide | 160×600 |
| Leaderboard | Under the control console | 728×90, fluid on phones |
| Intro banner | Foot of the welcome modal | 468×60, fluid |
| Win banner | Foot of the win modal | 468×60, fluid |

Every slot reserves its space up front and is labeled "Advertisement", so nothing jumps when a creative loads. Until an ad network is connected, the slots show quiet house placeholders and make **zero third-party requests** — the game stays tracker-free and works offline.

To switch on Google AdSense:

1. Set `ADSENSE_CLIENT` (your `ca-pub-…` id) and the per-slot unit ids at the top of `ads.js`.
2. Uncomment the record in `ads.txt` and put the same publisher id in it.
3. Redeploy — the AdSense loader is injected only once the client id is set.

Any other network works the same way: mount your tags into the `[data-ad-slot]` containers from `ads.js`. Don't want a slot? Delete its container in `index.html` — nothing else references it.

## Brand Assets

All logos live in `logos/`:

| File | Use |
| --- | --- |
| `loom-looped.svg` | Animated logo, shown on the intro splash in-app |
| `logo-banner.jpg` (2752×1536) | Link-preview image (`og:image` / `twitter:image`) |
| `logo-banner-sm.jpg` (1376×768) | This README's header banner |
| `logo-180.png` | Apple touch icon (iOS home-screen) |
| `logo-1024.jpg` / `logo-2048.jpg` | Square logo sources (app stores, avatars) |
| `github-social-preview.png` (1280×640) | Upload in GitHub repo **Settings → Social preview** |

## Future Roadmap

- Premium packs: historical textiles (Kente, Kasuri, Tartan…)
- A free-weave mode for designing your own cloth
- Daily streak tracking and a shareable archive of past dailies
