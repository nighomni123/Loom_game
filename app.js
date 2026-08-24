'use strict';

/* ============================================================
   LOOM — a weaving puzzle
   Warp threads run down, weft threads run across.
   Where they cross, their dyes blend into cloth.
   ============================================================ */

// ---------- Constants ----------

const COLS = 12;
const ROWS = 10;
const MIN_REPEAT = 1;
const MAX_REPEAT = 8;
const HINTS_PER_LEVEL = 3;
const UNDO_CAP = 200;
const SAVE_KEY = 'loom.save.v3';
const SAVE_KEY_LEGACY = 'loom.save.v2';
const DAILY_KEY = 'loom.daily.v1';

const DYES = [
    { name: 'Indigo', hex: '#3D5A80' },
    { name: 'Madder', hex: '#C1440E' },
    { name: 'Ochre',  hex: '#E0A32E' },
    { name: 'Sage',   hex: '#7C8B6F' },
    { name: 'Cream',  hex: '#F2E8CF' },
];
const CREAM = DYES[4].hex;

// Hand-tuned difficulty curve: repeat sizes + dye count per level.
const LEVELS = [
    { w: 2, h: 1, dyes: 2, name: 'Tabby' },
    { w: 2, h: 2, dyes: 2, name: 'Basket' },
    { w: 3, h: 2, dyes: 3, name: 'Twill' },
    { w: 2, h: 3, dyes: 3, name: 'Herringbone' },
    { w: 3, h: 3, dyes: 3, name: 'Houndstooth' },
    { w: 4, h: 2, dyes: 4, name: 'Madras' },
    { w: 4, h: 3, dyes: 4, name: 'Ikat' },
    { w: 3, h: 4, dyes: 4, name: 'Brocade' },
    { w: 4, h: 4, dyes: 4, name: 'Damask' },
    { w: 4, h: 4, dyes: 5, name: 'Jacquard' },
];
const ENDLESS_NAMES = ['Tapestry', 'Jacquard', 'Damask', 'Brocade', 'Ikat'];

const WIN_TITLES = ['Beautifully woven!', 'Splendid cloth!', 'A perfect weave!', 'Masterful!', 'The loom sings!'];

// ---------- State ----------

const state = {
    level: 1,
    name: 'Tabby',
    target: [],
    solutionWarp: [],
    solutionWeft: [],
    solW: 1,
    solH: 1,
    W: 1,
    H: 1,
    warpSeq: [CREAM],
    weftSeq: [CREAM],
    moves: 0,
    hintsLeft: HINTS_PER_LEVEL,
    revealed: false,
    hasWon: false,
    variation: 0,
    startTime: null,
    timerId: null,
    undoStack: [],
    sound: true,
    best: {},
    isDaily: false,
    dailyKey: null,
    dailyLabel: '',
    dailyGrade: '',
    dailyResults: {},
    _shareText: null,
};

// ---------- DOM refs ----------

let el = {};
let sampleCells = [];
let playerCells = [];
let audioCtx = null;
let toastTimer = null;

// ---------- Color helpers ----------

function hexToRgb(hex) {
    return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
    ];
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// The weave: a cell's color is the midpoint of its warp and weft dyes.
function mix(aHex, bHex) {
    const a = hexToRgb(aHex);
    const b = hexToRgb(bHex);
    return rgbToHex(
        Math.floor((a[0] + b[0]) / 2),
        Math.floor((a[1] + b[1]) / 2),
        Math.floor((a[2] + b[2]) / 2)
    );
}

function dyeNameOf(hex) {
    const dye = DYES.find(d => d.hex === hex);
    return dye ? dye.name : 'that shade';
}

// ---------- Solver ----------
// Brute-force proof engine. The warp×weft×repeat space is tiny, so we can
// enumerate EVERY (warp repeat w, weft repeat h, warp seq, weft seq) that
// reproduces a target cloth and prove whether the puzzle has exactly one
// solution — plus the minimum number of moves a perfect player needs.
//
// Pure functions only: no state, no DOM. Used by the endless generator
// (uniqueness filter + difficulty grading), the Daily Weave, and verify.js.

// CYCLE_DIST[a] = clicks to take dye index `a` from Cream (the loom's resting
// dye), allowing Shift-clicks (cheapest direction around the 5-cycle).
const CYCLE_DIST = (() => {
    const creamIdx = DYES.length - 1;
    return DYES.map((_, i) => {
        const fwd = ((i - creamIdx) % DYES.length + DYES.length) % DYES.length;
        return Math.min(fwd, DYES.length - fwd);
    });
})();

// BLEND_WARP_MASK[a][colorHex] = bitmask of weft dyes b with mix(a, b) === color.
// Lets the solver kill whole warp prefixes the moment any weft slot empties.
const BLEND_WARP_MASK = (() => {
    return DYES.map(warpDye => {
        const byColor = {};
        DYES.forEach((weftDye, b) => {
            const c = mix(warpDye.hex, weftDye.hex);
            byColor[c] = (byColor[c] || 0) | (1 << b);
        });
        return byColor;
    });
})();

// Smallest period p of a sequence such that the sequence is p-periodic.
function minimalPeriod(seq) {
    for (let p = 1; p <= seq.length; p++) {
        let periodic = true;
        for (let i = p; i < seq.length; i++) {
            if (seq[i] !== seq[i - p]) { periodic = false; break; }
        }
        if (periodic) return p;
    }
    return seq.length;
}

// The weave rule as a pure cloth builder: hex dye sequences → ROWS×COLS cloth.
function weaveCloth(warp, weft) {
    return Array.from({ length: ROWS }, (_, y) =>
        Array.from({ length: COLS }, (_, x) =>
            mix(warp[x % warp.length], weft[y % weft.length])
        )
    );
}

function verifySolution(warp, weft, target) {
    if (!Array.isArray(target) || target.length !== ROWS || target[0].length !== COLS) return false;
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            // Case-insensitive: hand-built targets may use uppercase hex.
            if (mix(warp[x % warp.length], weft[y % weft.length]) !== String(target[y][x]).toLowerCase()) return false;
        }
    }
    return true;
}

// Minimum moves for one solution: dye dips from Cream (cheapest direction per
// thread) plus repeat-discovery slack, mirroring parMoves().
function solutionMoveCost(warpIdx, weftIdx) {
    let dips = 0;
    for (const a of warpIdx) dips += CYCLE_DIST[a];
    for (const b of weftIdx) dips += CYCLE_DIST[b];
    return dips + warpIdx.length + weftIdx.length;
}

// Solve a target cloth exhaustively. Returns every DISTINCT solution,
// canonicalised: each sequence collapsed to its minimal period (a [A,B,A,B]
// warp is really [A,B]), and duplicate (sequence-identical) solutions deduped.
// Two structurally different solutions that happen to blend to the same cloth
// are counted separately — which only ever makes the uniqueness verdict more
// conservative, never wrong.
function solvePuzzle(target) {
    const N = DYES.length;
    const solutions = [];
    const seen = new Set();
    let hypotheses = 0;

    for (let w = 1; w <= MAX_REPEAT; w++) {
        for (let h = 1; h <= MAX_REPEAT; h++) {
            // 1) Every cell in a (x%w, y%h) residue class must agree on one
            //    color, otherwise this repeat shape is impossible. Colors are
            //    lowercased so hand-built targets (any hex case) work too —
            //    mix() always emits lowercase.
            const B = Array.from({ length: w }, () => new Array(h).fill(null));
            let feasible = true;
            for (let y = 0; y < ROWS && feasible; y++) {
                for (let x = 0; x < COLS; x++) {
                    const c = String(target[y][x]).toLowerCase();
                    const i = x % w, j = y % h;
                    if (B[i][j] === null) B[i][j] = c;
                    else if (B[i][j] !== c) { feasible = false; break; }
                }
            }
            if (!feasible) continue;
            hypotheses++;

            // 2) Enumerate warp dyes slot by slot; keep, per weft slot, the
            //    bitmask of weft dyes still compatible with the prefix. A slot
            //    hitting zero kills the branch instantly.
            const warpIdx = new Array(w).fill(0);
            const FULL = (1 << N) - 1;

            const emit = (masks) => {
                const weftIdx = masks.map(m => {
                    for (let b = 0; b < N; b++) if (m & (1 << b)) return b;
                    return 0;
                });
                const pw = minimalPeriod(warpIdx);
                const ph = minimalPeriod(weftIdx);
                const rw = warpIdx.slice(0, pw);
                const rf = weftIdx.slice(0, ph);
                const key = pw + '|' + ph + '|' + rw.join(',') + '|' + rf.join(',');
                if (!seen.has(key)) {
                    seen.add(key);
                    solutions.push({
                        w: pw, h: ph,
                        warpIdx: rw, weftIdx: rf,
                        warp: rw.map(i => DYES[i].hex),
                        weft: rf.map(i => DYES[i].hex),
                        moves: solutionMoveCost(rw, rf),
                    });
                }
            };

            const walk = (i, masks) => {
                if (i === w) { emit(masks); return; }
                for (let a = 0; a < N; a++) {
                    const row = B[i];
                    const next = new Array(h);
                    let viable = true;
                    for (let j = 0; j < h; j++) {
                        const m = masks[j] & (BLEND_WARP_MASK[a][row[j]] || 0);
                        if (m === 0) { viable = false; break; }
                        next[j] = m;
                    }
                    if (!viable) continue;
                    warpIdx[i] = a;
                    walk(i + 1, next);
                }
            };
            walk(0, new Array(h).fill(FULL));
        }
    }

    solutions.sort((a, b) => a.moves - b.moves);
    return {
        count: solutions.length,
        unique: solutions.length === 1,
        solutions,
        best: solutions[0] || null,
        minMoves: solutions.length ? solutions[0].moves : null,
        hypotheses,
    };
}

// ---------- Level generation ----------

// Deterministic PRNG (mulberry32) so a given level + seed always yields the
// same pattern. This lets the level-select screen show real previews and
// keeps stats tied to a stable puzzle.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function levelSeed(n, variation) {
    // Stable per level; variation (Shuffle) offsets it.
    return (n * 2654435761 + variation * 97) >>> 0;
}

function randomSeq(len, dyeCount, rng) {
    return Array.from({ length: len }, () => DYES[Math.floor(rng() * dyeCount)].hex);
}

function distinctCount(colors) {
    return new Set(colors).size;
}

// Pure: compute the hidden solution + target cloth for a level, without
// touching game state. Deterministic per (level, variation). Used both by
// generateLevel() and by the level-select previews. The first ten levels are
// hand-tuned; everything past them comes from the seeded endless generator,
// which only ever emits boards the solver has PROVED uniquely solvable.
function solveLevel(n, variation = 0) {
    if (n <= LEVELS.length) {
        const spec = { ...LEVELS[n - 1] };
        const rng = mulberry32(levelSeed(n, variation));

        let warp = null;
        let weft = null;
        // Reroll until the cloth is non-trivial (at least 3 visible shades,
        // and the thread sequences themselves aren't monochrome).
        for (let attempt = 0; attempt < 40; attempt++) {
            const w = randomSeq(spec.w, spec.dyes, rng);
            const f = randomSeq(spec.h, spec.dyes, rng);
            const shades = new Set();
            for (let y = 0; y < spec.h; y++) {
                for (let x = 0; x < spec.w; x++) shades.add(mix(w[x], f[y]));
            }
            const interesting = shades.size >= Math.min(3, spec.w * spec.h) &&
                (spec.w === 1 || distinctCount(w) >= 2 || distinctCount(f) >= 2);
            if (interesting || attempt === 39) {
                warp = w;
                weft = f;
                break;
            }
        }

        return { spec, warp, weft, target: weaveCloth(warp, weft) };
    }
    return getGeneratedLevel(n, variation);
}

function generateLevel(n, variation = 0) {
    const solved = solveLevel(n, variation);
    state.level = n;
    state.variation = variation;
    state.name = solved.spec.name;
    state.solW = solved.spec.w;
    state.solH = solved.spec.h;
    state.solutionWarp = solved.warp;
    state.solutionWeft = solved.weft;
    state.target = solved.target;
    state.revealed = false;
    state.hasWon = false;
    state.moves = 0;
    state.hintsLeft = HINTS_PER_LEVEL;
    state.undoStack = [];
    state.isDaily = false;
    state.dailyKey = null;
    state._shareText = null;
    if (el.winDaily) el.winDaily.hidden = true;
    if (el.nextLevelBtn) el.nextLevelBtn.textContent = 'Next pattern →';
    resetTimer();

    // Player starts on a blank cream loom with a 1×1 repeat.
    state.W = 1;
    state.H = 1;
    state.warpSeq = [CREAM];
    state.weftSeq = [CREAM];

    buildStrips();
    paint();
    saveGame();
}

// ---------- Endless generator ----------
// Samples random warps/wefts/repeats/dye-counts from a seeded PRNG, keeps only
// boards the solver has PROVED uniquely solvable, grades difficulty by the
// solver's minimum move count, and feeds the Pattern Library as levels past
// the 10 named ones. Fully deterministic per (level number, variation): no
// Math.random anywhere on this path, so previews and stats stay stable.

const GRADES = [
    { maxMoves: 12, name: 'Gentle' },
    { maxMoves: 18, name: 'Medium' },
    { maxMoves: 24, name: 'Hard' },
    { maxMoves: Infinity, name: 'Expert' },
];

function gradeIndexFor(moves) {
    for (let i = 0; i < GRADES.length; i++) {
        if (moves <= GRADES[i].maxMoves) return i;
    }
    return GRADES.length - 1;
}

// Repeat-size / dye-count windows sampled for each difficulty tier.
const GEN_TIERS = [
    { w: [2, 3], h: [2, 3], dyes: [3, 4] },
    { w: [3, 4], h: [3, 4], dyes: [3, 5] },
    { w: [4, 5], h: [4, 5], dyes: [4, 5] },
    { w: [4, 6], h: [4, 6], dyes: [5, 5] },
];

// Difficulty ramp across endless levels: two levels per tier, then Expert.
function endlessTierFor(n) {
    return Math.min(GEN_TIERS.length - 1, Math.floor((n - LEVELS.length - 1) / 2));
}

const GENERATED_CACHE = new Map();

function sampleBoard(rng, tierIndex) {
    const t = GEN_TIERS[tierIndex];
    const span = ([lo, hi]) => lo + Math.floor(rng() * (hi - lo + 1));
    const w = span(t.w);
    const h = span(t.h);
    const dyes = span(t.dyes);
    return { w, h, dyes, warp: randomSeq(w, dyes, rng), weft: randomSeq(h, dyes, rng) };
}

function boardIsInteresting(board) {
    const shades = new Set();
    for (let y = 0; y < board.h; y++) {
        for (let x = 0; x < board.w; x++) shades.add(mix(board.warp[x], board.weft[y]));
    }
    return shades.size >= Math.min(3, board.w * board.h) &&
        (board.w === 1 || distinctCount(board.warp) >= 2 || distinctCount(board.weft) >= 2);
}

function packGenerated(board, minMoves, name) {
    const gradeIndex = gradeIndexFor(minMoves);
    return {
        spec: {
            w: board.w,
            h: board.h,
            dyes: board.dyes,
            name,
            grade: GRADES[gradeIndex].name,
            gradeIndex,
            minMoves,
        },
        warp: board.warp,
        weft: board.weft,
        target: weaveCloth(board.warp, board.weft),
    };
}

// Sample (seeded) until the solver proves a unique solution whose canonical
// repeat matches the sampled repeat (no reducible boards — keeps par honest)
// and whose grade hits the requested tier. Deterministic for a given rng seed.
function sampleUniqueLevel(rng, tierIndex, name) {
    let fallback = null;
    for (let attempt = 0; attempt < 240; attempt++) {
        const board = sampleBoard(rng, tierIndex);
        if (!boardIsInteresting(board)) continue;
        const result = solvePuzzle(weaveCloth(board.warp, board.weft));
        if (!result.unique) continue;

        const packed = packGenerated(board, result.minMoves, name);
        if (fallback === null ||
            Math.abs(packed.spec.gradeIndex - tierIndex) <
            Math.abs(fallback.spec.gradeIndex - tierIndex)) {
            fallback = packed;
        }

        const sol = result.solutions[0];
        const irreducible = sol.w === board.w && sol.h === board.h;
        if (packed.spec.gradeIndex === tierIndex && irreducible) return packed;
        // Relax the grade-match requirement late in the loop so termination
        // is guaranteed while still preferring on-tier boards.
        if (attempt >= 160 && fallback && irreducible) return fallback;
    }
    if (fallback) return fallback;
    // Statistically unreachable safety net: emit the last sample anyway.
    const board = sampleBoard(rng, tierIndex);
    const result = solvePuzzle(weaveCloth(board.warp, board.weft));
    const moves = Number.isFinite(result.minMoves) ? result.minMoves : 99;
    return packGenerated(board, moves, name);
}

// Cached entry point used by solveLevel() for everything past LEVELS.
function getGeneratedLevel(n, variation) {
    const key = n + '|' + variation;
    if (GENERATED_CACHE.has(key)) return GENERATED_CACHE.get(key);
    const rng = mulberry32(levelSeed(n, variation));
    const name = ENDLESS_NAMES[(n - LEVELS.length - 1) % ENDLESS_NAMES.length];
    const level = sampleUniqueLevel(rng, endlessTierFor(n), name);
    if (GENERATED_CACHE.size > 256) GENERATED_CACHE.clear();
    GENERATED_CACHE.set(key, level);
    return level;
}


// ---------- Board construction ----------

function buildFabric(containerId, store) {
    const container = el[containerId];
    container.innerHTML = '';
    store.length = 0;
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell ' + (((x + y) % 2 === 0) ? 'over' : 'under');
            cell.dataset.x = String(x);
            cell.dataset.y = String(y);
            container.appendChild(cell);
            store.push(cell);
        }
    }
}

// One visible thread per cloth column/row, tiled from the repeat sequence —
// so the player can *see* the repeat run across the loom, like a real warp.
function buildStrips() {
    el.warpStrip.innerHTML = '';
    for (let x = 0; x < COLS; x++) {
        const t = document.createElement('button');
        t.className = 'thread warp';
        t.dataset.kind = 'warp';
        t.dataset.idx = String(x % state.W);
        t.type = 'button';
        el.warpStrip.appendChild(t);
    }

    el.weftStrip.innerHTML = '';
    for (let y = 0; y < ROWS; y++) {
        const t = document.createElement('button');
        t.className = 'thread weft';
        t.dataset.kind = 'weft';
        t.dataset.idx = String(y % state.H);
        t.type = 'button';
        el.weftStrip.appendChild(t);
    }
}

// ---------- Painting ----------

function buildPlayerFabric() {
    return Array.from({ length: ROWS }, (_, y) =>
        Array.from({ length: COLS }, (_, x) =>
            mix(state.warpSeq[x % state.W], state.weftSeq[y % state.H])
        )
    );
}

function paint() {
    // Sample swatch
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const i = y * COLS + x;
            sampleCells[i].style.backgroundColor = state.target[y][x];
        }
    }

    // Player cloth + match marking
    const fabric = buildPlayerFabric();
    let matches = 0;
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const i = y * COLS + x;
            const cell = playerCells[i];
            cell.style.backgroundColor = fabric[y][x];
            const ok = fabric[y][x] === state.target[y][x];
            cell.classList.toggle('matched', ok);
            if (ok) matches++;
        }
    }

    // Threads (tiled across the loom)
    const warpThreads = el.warpStrip.children;
    for (let i = 0; i < warpThreads.length; i++) {
        const idx = i % state.W;
        warpThreads[i].style.backgroundColor = state.warpSeq[idx];
        warpThreads[i].setAttribute('aria-label',
            `Warp thread ${idx + 1}, ${dyeNameOf(state.warpSeq[idx])}. Click to change dye.`);
    }
    const weftThreads = el.weftStrip.children;
    for (let i = 0; i < weftThreads.length; i++) {
        const idx = i % state.H;
        weftThreads[i].style.backgroundColor = state.weftSeq[idx];
        weftThreads[i].setAttribute('aria-label',
            `Weft thread ${idx + 1}, ${dyeNameOf(state.weftSeq[idx])}. Click to change dye.`);
    }

    // HUD
    const total = COLS * ROWS;
    const percent = Math.floor((matches / total) * 100);
    el.meterFill.style.width = percent + '%';
    el.meterFill.classList.toggle('full', percent === 100);
    el.meterFill.parentElement.setAttribute('aria-valuenow', String(percent));
    el.matchPct.textContent = percent + '%';
    el.movesChip.textContent = `Moves ${state.moves}`;
    el.levelChip.textContent = state.isDaily
        ? `📅 Daily · ${state.dailyLabel}`
        : `Nº ${state.level} · ${state.name}`;
    el.patternName.textContent = state.isDaily ? 'Daily Weave' : state.name;
    el.warpVal.textContent = String(state.W);
    el.weftVal.textContent = String(state.H);
    el.hintCount.textContent = String(state.hintsLeft);
    el.warpMinus.disabled = state.W <= MIN_REPEAT;
    el.warpPlus.disabled = state.W >= MAX_REPEAT;
    el.weftMinus.disabled = state.H <= MIN_REPEAT;
    el.weftPlus.disabled = state.H >= MAX_REPEAT;
    el.undoBtn.disabled = state.undoStack.length === 0;
    el.hintBtn.disabled = state.hintsLeft <= 0;

    // Win check
    if (percent === 100 && !state.hasWon) {
        state.hasWon = true;
        stopTimer();
        triggerWin();
    } else if (percent !== 100 && state.hasWon && !state.revealed) {
        state.hasWon = false;
    }
}

// ---------- Undo ----------

function pushUndo() {
    state.undoStack.push({
        W: state.W,
        H: state.H,
        warp: [...state.warpSeq],
        weft: [...state.weftSeq],
        moves: state.moves,
    });
    if (state.undoStack.length > UNDO_CAP) state.undoStack.shift();
}

function undo() {
    if (state.hasWon) return;
    const snap = state.undoStack.pop();
    if (!snap) return;
    const structureChanged = snap.W !== state.W || snap.H !== state.H;
    state.W = snap.W;
    state.H = snap.H;
    state.warpSeq = snap.warp;
    state.weftSeq = snap.weft;
    state.moves = snap.moves;
    if (structureChanged) buildStrips();
    paint();
    blip(220, 0.06, 'sine', 0.04);
}

// ---------- Interactions ----------

function cycleThread(kind, idx, dir) {
    if (state.hasWon) return;
    const seq = kind === 'warp' ? state.warpSeq : state.weftSeq;
    const cur = DYES.findIndex(d => d.hex === seq[idx]);
    const next = ((cur === -1 ? DYES.length - 1 : cur) + dir + DYES.length) % DYES.length;
    pushUndo();
    seq[idx] = DYES[next].hex;
    state.moves++;
    startTimer();
    paint();

    const strip = kind === 'warp' ? el.warpStrip : el.weftStrip;
    for (const t of strip.children) {
        if (Number(t.dataset.idx) !== idx) continue;
        t.classList.remove('pop');
        void t.offsetWidth; // restart animation
        t.classList.add('pop');
    }
    blip(300 + next * 55, 0.07, 'triangle', 0.05);
}

function onClothClick(event) {
    if (consumeLongPressClick()) return;
    const cell = event.target.closest('.cell');
    if (!cell) return;
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    if (event.shiftKey) {
        cycleThread('weft', y % state.H, -1);
    } else {
        cycleThread('warp', x % state.W, 1);
    }
}

function onThreadClick(event) {
    if (consumeLongPressClick()) return;
    const t = event.target.closest('.thread');
    if (!t) return;
    cycleThread(t.dataset.kind, Number(t.dataset.idx), event.shiftKey ? -1 : 1);
}

// ---------- Touch: long-press = Shift-click (weft / backward cycle) ----------
// Phones have no Shift key, so holding a cell or thread for ~450ms performs
// the backward/weft cycle instead of the tap action.

let longPressTimer = null;
let longPressPos = null;
let suppressNextClick = false;

function consumeLongPressClick() {
    if (!suppressNextClick) return false;
    suppressNextClick = false; // the click that follows a long-press is swallowed
    return true;
}

function buzz() {
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* haptics are optional */ }
}

function wireLongPress(container, onLongPress) {
    container.addEventListener('pointerdown', (event) => {
        suppressNextClick = false; // a fresh gesture clears any stale suppression
        if (event.pointerType !== 'touch') return;
        longPressPos = { x: event.clientX, y: event.clientY };
        const target = event.target;
        clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            suppressNextClick = true;
            buzz();
            onLongPress(target);
        }, 450);
    });
    container.addEventListener('pointermove', (event) => {
        if (!longPressTimer || !longPressPos) return;
        const dx = event.clientX - longPressPos.x;
        const dy = event.clientY - longPressPos.y;
        if (dx * dx + dy * dy > 144) { // finger drifted > 12px: it's a scroll, not a press
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });
    const cancel = () => { clearTimeout(longPressTimer); longPressTimer = null; };
    container.addEventListener('pointerup', cancel);
    container.addEventListener('pointercancel', cancel);
    container.addEventListener('pointerleave', cancel);
    container.addEventListener('contextmenu', (event) => event.preventDefault());
}

function onClothLongPress(target) {
    const cell = target.closest('.cell');
    if (!cell) return;
    cycleThread('weft', Number(cell.dataset.y) % state.H, -1);
}

function onThreadLongPress(target) {
    const t = target.closest('.thread');
    if (!t) return;
    cycleThread(t.dataset.kind, Number(t.dataset.idx), -1);
}

// Hovering a thread lights every cloth cell that thread passes through.
function lightThreadCells(kind, idx, on) {
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const hit = kind === 'warp' ? (x % state.W === idx) : (y % state.H === idx);
            if (hit) playerCells[y * COLS + x].classList.toggle('thread-lit', on);
        }
    }
}

function onStripHover(event, on) {
    const t = event.target.closest('.thread');
    if (!t) return;
    lightThreadCells(t.dataset.kind, Number(t.dataset.idx), on);
}

function setRepeat(which, delta) {
    if (state.hasWon) return;
    const key = which === 'warp' ? 'W' : 'H';
    const seqKey = which === 'warp' ? 'warpSeq' : 'weftSeq';
    const next = Math.max(MIN_REPEAT, Math.min(MAX_REPEAT, state[key] + delta));
    if (next === state[key]) return;
    pushUndo();
    const old = state[seqKey];
    state[seqKey] = Array.from({ length: next }, (_, i) => (i < old.length ? old[i] : CREAM));
    state[key] = next;
    startTimer();
    buildStrips();
    paint();
    blip(delta > 0 ? 420 : 260, 0.06, 'sine', 0.045);
}

// ---------- Hint ----------

function useHint() {
    if (state.hintsLeft <= 0 || state.hasWon) return;
    const fabric = buildPlayerFabric();
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (fabric[y][x] === state.target[y][x]) continue;

            state.hintsLeft--;
            const T = state.target[y][x];
            const warpSug = DYES.find(d => mix(d.hex, state.weftSeq[y % state.H]) === T);
            const weftSug = DYES.find(d => mix(state.warpSeq[x % state.W], d.hex) === T);

            let msg;
            if (warpSug) {
                msg = `Try dipping warp thread <b>${(x % state.W) + 1}</b> in <b>${warpSug.name}</b>.`;
            } else if (weftSug) {
                msg = `Try dipping weft thread <b>${(y % state.H) + 1}</b> in <b>${weftSug.name}</b>.`;
            } else {
                const solWarpDye = dyeNameOf(state.solutionWarp[x % state.solW]);
                const solWeftDye = dyeNameOf(state.solutionWeft[y % state.solH]);
                msg = `This crossing wants <b>${solWarpDye}</b> warp over <b>${solWeftDye}</b> weft — check your repeat lengths.`;
            }
            toast(msg, 3800);

            const cell = playerCells[y * COLS + x];
            cell.classList.add('hint-target');
            setTimeout(() => cell.classList.remove('hint-target'), 3200);

            const wt = el.warpStrip.children[x];
            const ft = el.weftStrip.children[y];
            [wt, ft].forEach(t => {
                if (!t) return;
                t.classList.add('lit');
                setTimeout(() => t.classList.remove('lit'), 3200);
            });

            paint();
            blip(520, 0.09, 'sine', 0.05);
            return;
        }
    }
}

// ---------- Timer ----------

function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function startTimer() {
    if (state.startTime) return;
    state.startTime = Date.now();
    state.timerId = setInterval(() => {
        el.timeChip.textContent = fmtTime(Date.now() - state.startTime);
    }, 500);
}

function stopTimer() {
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = null;
}

function resetTimer() {
    stopTimer();
    state.startTime = null;
    if (el.timeChip) el.timeChip.textContent = '0:00';
}

// ---------- Win ----------

function parMoves() {
    // Minimum dye dips from a cream loom (cycle distance), plus slack
    // for the discovery of the repeat itself.
    const dist = hex => {
        const i = DYES.findIndex(d => d.hex === hex);
        const f = (i - (DYES.length - 1) + DYES.length) % DYES.length;
        return Math.min(f, DYES.length - f);
    };
    const dips = [...state.solutionWarp, ...state.solutionWeft]
        .reduce((sum, h) => sum + dist(h), 0);
    return dips + state.solW + state.solH;
}

function starsFor(moves, par) {
    if (moves <= par) return 3;
    if (moves <= Math.ceil(par * 1.8)) return 2;
    return 1;
}

function triggerWin() {
    const par = parMoves();
    const stars = state.revealed ? 0 : starsFor(state.moves, par);
    const elapsedMs = state.startTime ? Date.now() - state.startTime : 0;
    const time = state.startTime ? fmtTime(elapsedMs) : '0:00';

    if (!state.revealed) {
        if (state.isDaily) {
            // Daily: record the best result per date and prepare the
            // Wordle-style shareable emoji grid.
            recordDailyWin(stars, time, elapsedMs);
            state._shareText = buildDailyShare(stars, time);
            renderSharePreview();
            el.winDaily.hidden = false;
            el.nextLevelBtn.textContent = '↩ Back to patterns';
            copyTextToClipboard(state._shareText, true);
        } else {
            // Only record stats for the canonical (un-shuffled) pattern so
            // times/moves stay comparable across plays of the same level.
            if (state.variation === 0) {
                const prev = state.best[state.level];
                const prevStars = prev ? prev.stars : 0;
                if (stars > prevStars) {
                    state.best[state.level] = { stars, time, moves: state.moves, ms: elapsedMs };
                }
            }
            el.winDaily.hidden = true;
            el.nextLevelBtn.textContent = 'Next pattern →';
        }
        saveGame();
        startConfetti();
        winChime();
    } else {
        // A revealed board never earns a share card.
        el.winDaily.hidden = true;
    }

    el.winTitle.textContent = state.revealed
        ? 'Pattern revealed'
        : WIN_TITLES[Math.floor(Math.random() * WIN_TITLES.length)];
    el.winTime.textContent = time;
    el.winMoves.textContent = String(state.moves);
    el.winPar.textContent = String(par);

    el.winStars.innerHTML = '';
    for (let i = 0; i < 3; i++) {
        const s = document.createElement('span');
        s.className = 'star' + (i < stars ? ' earned' : '');
        s.textContent = '★';
        el.winStars.appendChild(s);
    }

    setTimeout(() => { el.winOverlay.hidden = false; }, state.revealed ? 250 : 650);
}

// ---------- Confetti (thread scraps) ----------

function startConfetti() {
    const canvas = el.confetti;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pieces = Array.from({ length: 150 }, () => ({
        x: W / 2 + (Math.random() - 0.5) * W * 0.7,
        y: -20 - Math.random() * H * 0.35,
        w: 3 + Math.random() * 3,
        h: 10 + Math.random() * 12,
        color: DYES[Math.floor(Math.random() * DYES.length)].hex,
        vx: (Math.random() - 0.5) * 2.6,
        vy: 2.2 + Math.random() * 3.6,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.22,
        sway: Math.random() * Math.PI * 2,
    }));

    const t0 = performance.now();
    const DURATION = 4200;

    const draw = (now) => {
        const t = now - t0;
        ctx.clearRect(0, 0, W, H);
        const fade = t > DURATION - 900 ? Math.max(0, (DURATION - t) / 900) : 1;
        for (const p of pieces) {
            p.sway += 0.05;
            p.x += p.vx + Math.sin(p.sway) * 0.6;
            p.y += p.vy;
            p.rot += p.vr;
            if (p.y > H + 20) { p.y = -20; p.x = Math.random() * W; }
            ctx.save();
            ctx.globalAlpha = fade;
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillStyle = p.color;
            if (ctx.roundRect) {
                ctx.beginPath();
                ctx.roundRect(-p.w / 2, -p.h / 2, p.w, p.h, p.w / 2);
                ctx.fill();
            } else {
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            }
            ctx.restore();
        }
        if (t < DURATION) {
            state._confettiRaf = requestAnimationFrame(draw);
        } else {
            ctx.clearRect(0, 0, W, H);
            state._confettiRaf = null;
        }
    };
    state._confettiRaf = requestAnimationFrame(draw);
}

function stopConfetti() {
    if (state._confettiRaf) {
        cancelAnimationFrame(state._confettiRaf);
        state._confettiRaf = null;
    }
    const ctx = el.confetti && el.confetti.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, el.confetti.width, el.confetti.height);
}

// ---------- Sound ----------

function blip(freq, dur = 0.07, type = 'triangle', gain = 0.05) {
    if (!state.sound) return;
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = type;
        o.frequency.value = freq;
        g.gain.setValueAtTime(gain, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
        o.connect(g).connect(audioCtx.destination);
        o.start();
        o.stop(audioCtx.currentTime + dur);
    } catch (e) { /* sound is optional */ }
}

function winChime() {
    [392, 494, 587, 784].forEach((f, i) =>
        setTimeout(() => blip(f, 0.22, 'sine', 0.055), i * 130));
}

// ---------- Toast ----------

function toast(html, ms = 2600) {
    el.toast.innerHTML = html;
    el.toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms);
}

// ---------- Persistence ----------

function saveGame() {
    try {
        localStorage.setItem(SAVE_KEY, JSON.stringify({
            level: state.level,
            sound: state.sound,
            best: state.best,
        }));
    } catch (e) { /* private mode */ }
}

function loadGame() {
    try {
        let raw = localStorage.getItem(SAVE_KEY);
        if (!raw) {
            // Migrate legacy save (best was a plain star count per level).
            const legacy = localStorage.getItem(SAVE_KEY_LEGACY);
            if (legacy) {
                const old = JSON.parse(legacy);
                const migratedBest = {};
                for (const [lvl, val] of Object.entries(old.best || {})) {
                    migratedBest[lvl] = { stars: Number(val) || 0, time: '—', moves: null, ms: null };
                }
                const migrated = { level: old.level, sound: old.sound, best: migratedBest };
                localStorage.setItem(SAVE_KEY, JSON.stringify(migrated));
                raw = JSON.stringify(migrated);
            }
        }
        if (!raw) return;
        const data = JSON.parse(raw);
        if (Number.isInteger(data.level) && data.level >= 1) state.level = data.level;
        if (typeof data.sound === 'boolean') state.sound = data.sound;
        if (data.best && typeof data.best === 'object') state.best = data.best;
    } catch (e) { /* fresh start */ }
}

function bestStarsFor(level) {
    const b = state.best[level];
    return b ? (b.stars || 0) : 0;
}

// ---------- Daily Weave ----------
// One seeded puzzle per UTC calendar date: every player weaves the same cloth.
// Finishing it produces a Wordle-style emoji-grid result that is copied to the
// clipboard, and the best stats persist per day in localStorage.

function todayKey() {
    const d = new Date();
    const pad = v => String(v).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function dailyLabelFor(key) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const [, m, d] = key.split('-').map(Number);
    return `${months[m - 1]} ${d}`;
}

// Same date string → same seed → same puzzle for everyone, everywhere.
function dailySeedFromDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return (Math.imul(y * 372 + m * 31 + d, 2654435761) ^ 0x9E3779B9) >>> 0;
}

function generateDailyPuzzle(dateKey) {
    const rng = mulberry32(dailySeedFromDateKey(dateKey));
    const tier = Math.floor(rng() * GEN_TIERS.length);
    return sampleUniqueLevel(rng, tier, 'Daily Weave');
}

function startDaily() {
    stopConfetti();
    el.introOverlay.hidden = true;
    el.levelsOverlay.hidden = true;
    el.winOverlay.hidden = true;
    const key = todayKey();
    const puzzle = generateDailyPuzzle(key);
    state.isDaily = true;
    state.dailyKey = key;
    state.dailyLabel = dailyLabelFor(key);
    state.dailyGrade = puzzle.spec.grade;
    state.name = puzzle.spec.name;
    state.solW = puzzle.spec.w;
    state.solH = puzzle.spec.h;
    state.solutionWarp = puzzle.warp;
    state.solutionWeft = puzzle.weft;
    state.target = puzzle.target;
    state.revealed = false;
    state.hasWon = false;
    state.moves = 0;
    state.hintsLeft = HINTS_PER_LEVEL;
    state.undoStack = [];
    state._shareText = null;
    resetTimer();
    // Player always starts on a blank cream loom with a 1×1 repeat.
    state.W = 1;
    state.H = 1;
    state.warpSeq = [CREAM];
    state.weftSeq = [CREAM];
    el.winDaily.hidden = true;
    el.nextLevelBtn.textContent = '↩ Back to patterns';
    buildStrips();
    paint();
    const rec = dailyRecordFor(key);
    toast(rec
        ? `Daily Weave · ${state.dailyLabel} — today's best: ${rec.moves} moves · ${'★'.repeat(rec.stars || 0) || '☆'}`
        : `Daily Weave · ${state.dailyLabel} · ${state.dailyGrade} — the same cloth for everyone today`);
    blip(494, 0.09, 'sine', 0.05);
}

function loadDailyStore() {
    try {
        const raw = localStorage.getItem(DAILY_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) { return {}; }
}

function saveDailyStore() {
    try { localStorage.setItem(DAILY_KEY, JSON.stringify(state.dailyResults)); } catch (e) { /* private mode */ }
}

function dailyRecordFor(key) {
    return state.dailyResults[key] || null;
}

// Keep the BEST result per day: most stars, then fewest moves, then fastest.
// Replays never lower a record.
function recordDailyWin(stars, time, ms) {
    const key = state.dailyKey;
    const prev = state.dailyResults[key];
    const prevMoves = prev && prev.moves != null ? prev.moves : Infinity;
    const prevMs = prev && prev.ms != null ? prev.ms : Infinity;
    const better = !prev || stars > prev.stars ||
        (stars === prev.stars && (state.moves < prevMoves ||
            (state.moves === prevMoves && ms < prevMs)));
    state.dailyResults[key] = {
        stars: Math.max(stars, prev ? (prev.stars || 0) : 0),
        moves: better ? state.moves : prev.moves,
        time: better ? time : prev.time,
        ms: better ? ms : prev.ms,
        grade: state.dailyGrade,
        plays: ((prev && prev.plays) || 0) + 1,
    };
    saveDailyStore();
}

// --- Shareable result ---

const SHARE_EMOJI = {
    '#3D5A80': '🟦', // Indigo
    '#C1440E': '🟥', // Madder
    '#E0A32E': '🟨', // Ochre
    '#7C8B6F': '🟩', // Sage
    '#F2E8CF': '⬜', // Cream
};

const SHARE_COLS = 6;
const SHARE_ROWS = 5;

const nearestDyeCache = new Map();

// Blended shades quantise to the closest dye so every cell maps to one emoji.
function nearestDye(hex) {
    if (nearestDyeCache.has(hex)) return nearestDyeCache.get(hex);
    const [r, g, b] = hexToRgb(hex);
    let best = DYES[0];
    let bestDist = Infinity;
    for (const dye of DYES) {
        const [r2, g2, b2] = hexToRgb(dye.hex);
        const dist = (r - r2) * (r - r2) + (g - g2) * (g - g2) + (b - b2) * (b - b2);
        if (dist < bestDist) { bestDist = dist; best = dye; }
    }
    nearestDyeCache.set(hex, best);
    return best;
}

function dailyEmojiRows() {
    const rows = [];
    for (let py = 0; py < SHARE_ROWS; py++) {
        let row = '';
        for (let px = 0; px < SHARE_COLS; px++) {
            const sx = Math.floor(px * COLS / SHARE_COLS);
            const sy = Math.floor(py * ROWS / SHARE_ROWS);
            row += SHARE_EMOJI[nearestDye(state.target[sy][sx]).hex] || '⬜';
        }
        rows.push(row);
    }
    return rows;
}

function buildDailyShare(stars, time) {
    return [
        `LOOM Daily · ${state.dailyLabel} · ${state.dailyGrade}`,
        ...dailyEmojiRows(),
        `${state.moves} moves · ${time} · ${stars}/3 ★`,
    ].join('\n');
}

function renderSharePreview() {
    el.shareGrid.innerHTML = '';
    for (let py = 0; py < SHARE_ROWS; py++) {
        for (let px = 0; px < SHARE_COLS; px++) {
            const sx = Math.floor(px * COLS / SHARE_COLS);
            const sy = Math.floor(py * ROWS / SHARE_ROWS);
            const cell = document.createElement('span');
            cell.className = 'share-cell';
            cell.style.backgroundColor = state.target[sy][sx];
            el.shareGrid.appendChild(cell);
        }
    }
}

function copyTextToClipboard(text, announce) {
    const tell = msg => { if (announce) toast(msg); };
    const fallback = () => {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            tell(ok ? '📋 Daily result copied to clipboard' : 'Copy blocked — share your stars instead');
        } catch (e) { tell('Copy blocked — share your stars instead'); }
    };
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(
                () => tell('📋 Daily result copied to clipboard'),
                fallback
            );
        } else {
            fallback();
        }
    } catch (e) { fallback(); }
}

// ---------- Level select (Pattern Library) ----------

// How many level cards to show. Includes the 10 hand-tuned levels plus a
// handful of endless ones so the library feels alive.
const LIBRARY_COUNT = 16;

function renderLevelSelect() {
    const grid = el.levelsGrid;
    grid.innerHTML = '';

    for (let n = 1; n <= LIBRARY_COUNT; n++) {
        const solved = solveLevel(n, 0);
        const best = state.best[n];
        const stars = best ? (best.stars || 0) : 0;
        const unlocked = n === 1 || bestStarsFor(n - 1) > 0 || n <= state.level;

        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'level-card' + (unlocked ? '' : ' locked');
        card.dataset.level = String(n);
        card.disabled = !unlocked;

        // Mini preview of the target cloth (downsampled to a small grid).
        const preview = document.createElement('div');
        preview.className = 'level-preview';
        const PREVIEW_COLS = 6;
        const PREVIEW_ROWS = 5;
        preview.style.gridTemplateColumns = `repeat(${PREVIEW_COLS}, 1fr)`;
        for (let py = 0; py < PREVIEW_ROWS; py++) {
            for (let px = 0; px < PREVIEW_COLS; px++) {
                const sx = Math.floor(px * COLS / PREVIEW_COLS);
                const sy = Math.floor(py * ROWS / PREVIEW_ROWS);
                const cell = document.createElement('div');
                cell.className = 'preview-cell';
                cell.style.backgroundColor = solved.target[sy][sx];
                preview.appendChild(cell);
            }
        }
        card.appendChild(preview);

        const meta = document.createElement('div');
        meta.className = 'level-meta';

        const num = document.createElement('span');
        num.className = 'level-num';
        num.textContent = unlocked ? String(n) : '🔒';
        meta.appendChild(num);

        const name = document.createElement('span');
        name.className = 'level-name';
        name.textContent = solved.spec.name;
        meta.appendChild(name);

        // Endless levels carry their solver-graded difficulty on the card.
        if (solved.spec.grade) {
            const grade = document.createElement('span');
            grade.className = 'level-grade';
            grade.textContent = solved.spec.grade;
            meta.appendChild(grade);
        }

        const starRow = document.createElement('span');
        starRow.className = 'level-stars';
        starRow.setAttribute('aria-label', stars ? `${stars} of 3 stars` : 'Not completed');
        for (let i = 0; i < 3; i++) {
            const s = document.createElement('i');
            s.className = 'mini-star' + (i < stars ? ' on' : '');
            s.textContent = '★';
            starRow.appendChild(s);
        }
        meta.appendChild(starRow);

        if (best && best.time && best.time !== '—') {
            const stat = document.createElement('span');
            stat.className = 'level-stat';
            stat.textContent = `${best.time} · ${best.moves} moves`;
            meta.appendChild(stat);
        }

        card.appendChild(meta);
        grid.appendChild(card);
    }

    // Summary line: total stars earned.
    let totalStars = 0;
    for (const b of Object.values(state.best)) totalStars += (b.stars || 0);
    el.levelsSummary.textContent = `${totalStars} ★ collected`;
}

function openLevelSelect() {
    renderLevelSelect();
    el.levelsOverlay.hidden = false;
}

function closeLevelSelect() {
    el.levelsOverlay.hidden = true;
}

// ---------- Wiring ----------

function wireControls() {
    el.playerGrid.addEventListener('click', onClothClick);
    el.warpStrip.addEventListener('click', onThreadClick);
    el.weftStrip.addEventListener('click', onThreadClick);
    wireLongPress(el.playerGrid, onClothLongPress);
    wireLongPress(el.warpStrip, onThreadLongPress);
    wireLongPress(el.weftStrip, onThreadLongPress);
    el.warpStrip.addEventListener('mouseover', e => onStripHover(e, true));
    el.warpStrip.addEventListener('mouseout', e => onStripHover(e, false));
    el.weftStrip.addEventListener('mouseover', e => onStripHover(e, true));
    el.weftStrip.addEventListener('mouseout', e => onStripHover(e, false));

    el.warpMinus.addEventListener('click', () => setRepeat('warp', -1));
    el.warpPlus.addEventListener('click', () => setRepeat('warp', 1));
    el.weftMinus.addEventListener('click', () => setRepeat('weft', -1));
    el.weftPlus.addEventListener('click', () => setRepeat('weft', 1));

    el.undoBtn.addEventListener('click', undo);
    el.hintBtn.addEventListener('click', useHint);
    el.shuffleBtn.addEventListener('click', () => {
        if (state.isDaily) {
            toast('The Daily is the same cloth for everyone — no reshuffling.');
            return;
        }
        stopConfetti();
        el.winOverlay.hidden = true;
        // Deterministic levels need a variation offset to get fresh colors.
        generateLevel(state.level, state.variation + 1);
        toast('Fresh dyes, same pattern. Good luck!');
    });
    el.revealBtn.addEventListener('click', () => {
        if (state.hasWon) return;
        state.revealed = true;
        state.W = state.solW;
        state.H = state.solH;
        state.warpSeq = [...state.solutionWarp];
        state.weftSeq = [...state.solutionWeft];
        buildStrips();
        paint();
    });

    el.startBtn.addEventListener('click', () => {
        el.introOverlay.hidden = true;
        blip(440, 0.08, 'sine', 0.04);
    });
    el.dailyBtn.addEventListener('click', startDaily);
    el.dailyIntroBtn.addEventListener('click', startDaily);
    el.copyShareBtn.addEventListener('click', () => {
        if (state._shareText) copyTextToClipboard(state._shareText, true);
    });
    el.helpBtn.addEventListener('click', () => {
        el.startBtn.textContent = 'Back to the loom';
        el.introOverlay.hidden = false;
    });
    el.levelsBtn.addEventListener('click', openLevelSelect);
    el.levelsIntroBtn.addEventListener('click', openLevelSelect);
    el.levelsCloseBtn.addEventListener('click', closeLevelSelect);
    el.levelsGrid.addEventListener('click', (event) => {
        const card = event.target.closest('.level-card');
        if (!card || card.disabled) return;
        const n = Number(card.dataset.level);
        closeLevelSelect();
        el.introOverlay.hidden = true;
        el.winOverlay.hidden = true;
        stopConfetti();
        generateLevel(n, 0);
        blip(440, 0.08, 'sine', 0.04);
    });
    el.soundBtn.addEventListener('click', () => {
        state.sound = !state.sound;
        el.soundBtn.textContent = state.sound ? '🔊' : '🔇';
        el.soundBtn.classList.toggle('muted', !state.sound);
        saveGame();
        if (state.sound) blip(440, 0.08, 'sine', 0.04);
    });

    el.nextLevelBtn.addEventListener('click', () => {
        el.winOverlay.hidden = true;
        stopConfetti();
        if (state.isDaily) {
            // Leave the daily and return to the pattern the player was on.
            generateLevel(state.level, state.variation);
        } else {
            generateLevel(state.level + 1);
        }
    });
    el.replayBtn.addEventListener('click', () => {
        el.winOverlay.hidden = true;
        stopConfetti();
        if (state.isDaily) startDaily();
        else generateLevel(state.level);
    });

    window.addEventListener('keydown', (e) => {
        if (!el.introOverlay.hidden || !el.winOverlay.hidden || !el.levelsOverlay.hidden) return;
        if (e.key === 'z' || e.key === 'Z') undo();
        if (e.key === 'h' || e.key === 'H') useHint();
    });

    window.addEventListener('resize', () => {
        const canvas = el.confetti;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
    });
}

function cacheDom() {
    const ids = {
        levelChip: 'level-chip', meterFill: 'meter-fill', matchPct: 'match-pct',
        movesChip: 'moves-chip', timeChip: 'time-chip', soundBtn: 'sound-btn',
        helpBtn: 'help-btn', sampleGrid: 'sample-grid', playerGrid: 'player-grid',
        warpStrip: 'warp-strip', weftStrip: 'weft-strip', patternName: 'pattern-name',
        warpMinus: 'warp-minus', warpPlus: 'warp-plus', weftMinus: 'weft-minus',
        weftPlus: 'weft-plus', warpVal: 'warp-repeat-val', weftVal: 'weft-repeat-val',
        undoBtn: 'undo-btn', hintBtn: 'hint-btn', hintCount: 'hint-count',
        shuffleBtn: 'shuffle-btn', revealBtn: 'reveal-btn',
        introOverlay: 'intro-overlay', winOverlay: 'win-overlay',
        startBtn: 'start-btn', winTitle: 'win-title', winStars: 'win-stars',
        winTime: 'win-time', winMoves: 'win-moves', winPar: 'win-par',
        nextLevelBtn: 'next-level-btn', replayBtn: 'replay-btn',
        confetti: 'confetti-canvas', toast: 'toast',
        levelsBtn: 'levels-btn', levelsIntroBtn: 'levels-intro-btn',
        levelsOverlay: 'levels-overlay', levelsGrid: 'levels-grid',
        levelsSummary: 'levels-summary', levelsCloseBtn: 'levels-close-btn',
        dailyBtn: 'daily-btn', dailyIntroBtn: 'daily-intro-btn',
        winDaily: 'win-daily', shareGrid: 'share-grid', copyShareBtn: 'copy-share-btn',
    };
    for (const [key, id] of Object.entries(ids)) el[key] = document.getElementById(id);
}

document.addEventListener('DOMContentLoaded', () => {
    cacheDom();
    buildFabric('sampleGrid', sampleCells);
    buildFabric('playerGrid', playerCells);
    wireControls();
    loadGame();
    state.dailyResults = loadDailyStore();
    el.soundBtn.textContent = state.sound ? '🔊' : '🔇';
    el.soundBtn.classList.toggle('muted', !state.sound);
    if (state.level > 1) {
        el.startBtn.textContent = `Continue · Pattern Nº ${state.level}`;
    }
    const todayRecord = dailyRecordFor(todayKey());
    if (todayRecord) {
        el.dailyIntroBtn.textContent = `Daily ✓ ${todayRecord.stars || 0}★`;
    }
    generateLevel(state.level);
});
