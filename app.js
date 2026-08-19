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
const SAVE_KEY = 'loom.save.v2';

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
    startTime: null,
    timerId: null,
    undoStack: [],
    sound: true,
    best: {},
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

// ---------- Level generation ----------

function levelSpec(n) {
    if (n <= LEVELS.length) return { ...LEVELS[n - 1] };
    const w = 3 + Math.floor(Math.random() * 2);
    const h = 3 + Math.floor(Math.random() * 2);
    return { w, h, dyes: 5, name: ENDLESS_NAMES[(n - 1) % ENDLESS_NAMES.length] };
}

function randomSeq(len, dyeCount) {
    return Array.from({ length: len }, () => DYES[Math.floor(Math.random() * dyeCount)].hex);
}

function distinctCount(colors) {
    return new Set(colors).size;
}

function generateLevel(n) {
    const spec = levelSpec(n);
    state.level = n;
    state.name = spec.name;
    state.solW = spec.w;
    state.solH = spec.h;
    state.revealed = false;
    state.hasWon = false;
    state.moves = 0;
    state.hintsLeft = HINTS_PER_LEVEL;
    state.undoStack = [];
    resetTimer();

    // Reroll until the cloth is non-trivial (at least 3 visible shades,
    // and the thread sequences themselves aren't monochrome).
    for (let attempt = 0; attempt < 40; attempt++) {
        const warp = randomSeq(spec.w, spec.dyes);
        const weft = randomSeq(spec.h, spec.dyes);
        const shades = new Set();
        for (let y = 0; y < spec.h; y++) {
            for (let x = 0; x < spec.w; x++) shades.add(mix(warp[x], weft[y]));
        }
        const interesting = shades.size >= Math.min(3, spec.w * spec.h) &&
            (spec.w === 1 || distinctCount(warp) >= 2 || distinctCount(weft) >= 2);
        if (interesting || attempt === 39) {
            state.solutionWarp = warp;
            state.solutionWeft = weft;
            break;
        }
    }

    state.target = Array.from({ length: ROWS }, (_, y) =>
        Array.from({ length: COLS }, (_, x) =>
            mix(state.solutionWarp[x % state.solW], state.solutionWeft[y % state.solH])
        )
    );

    // Player starts on a blank cream loom with a 1×1 repeat.
    state.W = 1;
    state.H = 1;
    state.warpSeq = [CREAM];
    state.weftSeq = [CREAM];

    buildStrips();
    paint();
    saveGame();
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
    el.levelChip.textContent = `Nº ${state.level} · ${state.name}`;
    el.patternName.textContent = state.name;
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
    const t = event.target.closest('.thread');
    if (!t) return;
    cycleThread(t.dataset.kind, Number(t.dataset.idx), event.shiftKey ? -1 : 1);
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
    const time = state.startTime ? fmtTime(Date.now() - state.startTime) : '0:00';

    if (!state.revealed) {
        const prev = state.best[state.level] || 0;
        if (stars > prev) state.best[state.level] = stars;
        saveGame();
        startConfetti();
        winChime();
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
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (Number.isInteger(data.level) && data.level >= 1) state.level = data.level;
        if (typeof data.sound === 'boolean') state.sound = data.sound;
        if (data.best && typeof data.best === 'object') state.best = data.best;
    } catch (e) { /* fresh start */ }
}

// ---------- Wiring ----------

function wireControls() {
    el.playerGrid.addEventListener('click', onClothClick);
    el.warpStrip.addEventListener('click', onThreadClick);
    el.weftStrip.addEventListener('click', onThreadClick);
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
        stopConfetti();
        el.winOverlay.hidden = true;
        generateLevel(state.level);
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
    el.helpBtn.addEventListener('click', () => {
        el.startBtn.textContent = 'Back to the loom';
        el.introOverlay.hidden = false;
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
        generateLevel(state.level + 1);
    });
    el.replayBtn.addEventListener('click', () => {
        el.winOverlay.hidden = true;
        stopConfetti();
        generateLevel(state.level);
    });

    window.addEventListener('keydown', (e) => {
        if (!el.introOverlay.hidden || !el.winOverlay.hidden) return;
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
    };
    for (const [key, id] of Object.entries(ids)) el[key] = document.getElementById(id);
}

document.addEventListener('DOMContentLoaded', () => {
    cacheDom();
    buildFabric('sampleGrid', sampleCells);
    buildFabric('playerGrid', playerCells);
    wireControls();
    loadGame();
    el.soundBtn.textContent = state.sound ? '🔊' : '🔇';
    el.soundBtn.classList.toggle('muted', !state.sound);
    if (state.level > 1) {
        el.startBtn.textContent = `Continue · Pattern Nº ${state.level}`;
    }
    generateLevel(state.level);
});
