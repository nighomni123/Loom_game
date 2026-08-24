// Automated verification: console errors, layout, and a full playthrough.
process.env.PLAYWRIGHT_BROWSERS_PATH = require('path').join(__dirname, '..', '..', 'Do not delete folder', '.pw-browsers');
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3457;
const LOOM_DIR = __dirname;

const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    const filePath = path.join(LOOM_DIR, urlPath === '/' ? 'index.html' : urlPath);
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };
    fs.readFile(filePath, (err, content) => {
        if (err) { res.writeHead(404); res.end('Not found'); }
        else { res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' }); res.end(content); }
    });
});

let failures = 0;
function check(name, cond, extra = '') {
    console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  [' + extra + ']' : ''));
    if (!cond) failures++;
}

server.listen(PORT, async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();

    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));

    try {
        await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(400);

        // --- Intro ---
        check('intro overlay visible', await page.isVisible('#intro-overlay'));
        check('intro has 3 steps', (await page.locator('.step').count()) === 3);
        check('start button visible', await page.isVisible('#start-btn'));
        check('intro has browse-patterns button', await page.isVisible('#levels-intro-btn'));

        // --- Level select from intro ---
        await page.click('#levels-intro-btn');
        await page.waitForTimeout(300);
        check('levels overlay opens from intro', await page.isVisible('#levels-overlay'));
        check('library shows 16 cards', (await page.locator('.level-card').count()) === 16);
        check('level 1 card unlocked', !(await page.locator('.level-card[data-level="1"]').isDisabled()));
        check('level 2 card locked (fresh save)', await page.locator('.level-card[data-level="2"]').isDisabled());
        check('each card has a preview', (await page.locator('.level-preview').count()) === 16);
        check('summary shows star count', (await page.textContent('#levels-summary')).includes('★'));
        check('intro has daily-weave button', await page.isVisible('#daily-intro-btn'));
        check('endless cards show difficulty grades', (await page.locator('.level-card[data-level="11"] .level-grade').count()) === 1);

        // Jump straight to level 1 from the library (also dismisses the intro)
        await page.click('.level-card[data-level="1"]');
        await page.waitForTimeout(300);
        check('levels overlay closes on pick', !(await page.isVisible('#levels-overlay')));
        check('intro dismissed on pick', !(await page.isVisible('#intro-overlay')));
        check('level chip shows Nº 1', (await page.textContent('#level-chip')).includes('Nº 1'));

        // --- Layout sanity ---
        const boxes = {};
        for (const id of ['sample-grid', 'player-grid', 'warp-strip', 'weft-strip']) {
            const b = await page.locator('#' + id).boundingBox();
            boxes[id] = b;
            const minW = id === 'weft-strip' ? 20 : 50;
            const minH = id === 'warp-strip' ? 20 : 50;
            check(`${id} has size`, b && b.width > minW && b.height > minH, b ? `${Math.round(b.width)}x${Math.round(b.height)}` : 'null');
        }
        check('warp strip above player grid', boxes['warp-strip'].y < boxes['player-grid'].y);
        check('weft strip left of player grid', boxes['weft-strip'].x < boxes['player-grid'].x);
        check('warp strip width matches grid', Math.abs(boxes['warp-strip'].width - boxes['player-grid'].width) < 8);
        check('weft strip height matches grid', Math.abs(boxes['weft-strip'].height - boxes['player-grid'].height) < 8);

        // --- Ad slots (house placeholders until an ad network is configured) ---
        check('5 ad slots on page', (await page.locator('[data-ad-slot]').count()) === 5);
        check('every ad slot filled', (await page.locator('.ad-slot .house-ad').count()) === 5);
        check('ad slots labeled', /advertisement/i.test(await page.locator('.ad-leaderboard').textContent()));
        check('intro modal carries an ad slot', (await page.locator('#intro-overlay .ad-inline').count()) === 1);
        const footBox = await page.locator('.ad-leaderboard').boundingBox();
        check('footer ad sits below the loom', footBox && footBox.y > boxes['player-grid'].y + boxes['player-grid'].height,
            footBox ? `y=${Math.round(footBox.y)}` : 'null');
        check('footer ad fits the content column', footBox && footBox.width <= 728,
            footBox ? `${Math.round(footBox.width)}px` : 'null');
        check('side rails hidden at 1280px', (await page.locator('[data-ad-slot="railLeft"]').boundingBox()) === null);

        // Wide screens: rails appear in the blank margins, never over the game.
        const wide = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
        wide.on('console', m => { if (m.type() === 'error') errors.push('wide: ' + m.text()); });
        wide.on('pageerror', e => errors.push('wide: ' + String(e)));
        await wide.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
        await wide.waitForTimeout(400);
        const railBox = await wide.locator('[data-ad-slot="railLeft"]').boundingBox();
        const mainBox = await wide.locator('main').boundingBox();
        const railRightBox = await wide.locator('[data-ad-slot="railRight"]').boundingBox();
        check('wide: side rails are skyscrapers', railBox && railRightBox &&
            railBox.width > 100 && railBox.height > 500 && railRightBox.height > 500,
            railBox ? `${Math.round(railBox.width)}x${Math.round(railBox.height)}` : 'null');
        check('wide: left rail beside content, not on top', railBox && mainBox && railBox.x + railBox.width <= mainBox.x);
        check('wide: right rail beside content, not on top', railRightBox && mainBox && railRightBox.x >= mainBox.x + mainBox.width);
        await wide.close();

        check('120 sample cells', (await page.locator('#sample-grid .cell').count()) === 120);
        check('120 player cells', (await page.locator('#player-grid .cell').count()) === 120);
        check('12 warp threads', (await page.locator('#warp-strip .thread').count()) === 12);
        check('10 weft threads', (await page.locator('#weft-strip .thread').count()) === 10);

        // --- HUD ---
        check('level chip shows Nº 1', (await page.textContent('#level-chip')).includes('Nº 1'));
        check('match starts at 0%', (await page.textContent('#match-pct')) === '0%');

        // --- Gameplay: dye threads, adjust repeats ---
        await page.click('#warp-plus');
        await page.click('#warp-plus');
        await page.click('#weft-plus');
        check('warp repeat = 3', (await page.textContent('#warp-repeat-val')) === '3');
        check('weft repeat = 2', (await page.textContent('#weft-repeat-val')) === '2');

        await page.click('#warp-strip .thread:nth-child(1)');
        await page.click('#warp-strip .thread:nth-child(2)');
        await page.click('#weft-strip .thread:nth-child(1)');
        await page.waitForTimeout(200);
        const moves = await page.textContent('#moves-chip');
        check('moves counted', moves.includes('3'), moves);
        const pct = parseInt(await page.textContent('#match-pct'));
        check('match % changed from 0', pct > 0, pct + '%');

        // --- Undo ---
        await page.click('#undo-btn');
        check('undo decrements moves', (await page.textContent('#moves-chip')).includes('2'));

        // --- Hint ---
        await page.click('#hint-btn');
        await page.waitForTimeout(200);
        check('hint consumed', (await page.textContent('#hint-count')) === '2');
        check('toast shown', await page.isVisible('#toast.show'));

        // --- Reveal -> win ---
        await page.click('#reveal-btn');
        await page.waitForTimeout(1400);
        check('win overlay appears', await page.isVisible('#win-overlay'));
        check('win title says revealed', (await page.textContent('#win-title')).toLowerCase().includes('reveal'));
        check('match is 100%', (await page.textContent('#match-pct')) === '100%');
        check('win modal carries an ad slot', (await page.locator('#win-overlay .ad-inline').count()) === 1);

        // --- Next level ---
        await page.click('#next-level-btn');
        await page.waitForTimeout(300);
        check('advanced to level 2', (await page.textContent('#level-chip')).includes('Nº 2'));
        check('win overlay closed', !(await page.isVisible('#win-overlay')));

        // --- Persistence ---
        const saved = await page.evaluate(() => localStorage.getItem('loom.save.v3'));
        check('progress saved', saved && JSON.parse(saved).level === 2, saved);

        // --- Library reflects progress ---
        await page.click('#levels-btn');
        await page.waitForTimeout(300);
        check('levels overlay opens from HUD', await page.isVisible('#levels-overlay'));
        check('level 2 unlocked after progress', !(await page.locator('.level-card[data-level="2"]').isDisabled()));
        await page.click('#levels-close-btn');
        await page.waitForTimeout(200);
        check('levels overlay closes via X', !(await page.isVisible('#levels-overlay')));

        // ================= Solver: brute-force proofs =================
        const solver = await page.evaluate(() => {
            const planted = solveLevel(3, 0); // hand-tuned level
            const result = solvePuzzle(planted.target);
            return {
                hasFns: typeof solvePuzzle === 'function' && typeof verifySolution === 'function' &&
                    typeof weaveCloth === 'function',
                unique: result.unique,
                count: result.count,
                minMoves: result.minMoves,
                plantedVerifies: verifySolution(planted.warp, planted.weft, planted.target),
                bestVerifies: result.best
                    ? verifySolution(result.best.warp, result.best.weft, planted.target)
                    : false,
            };
        });
        check('solver functions exposed', solver.hasFns);
        check('solver proves level 3 uniquely solvable', solver.unique === true && solver.count === 1,
            `count=${solver.count}`);
        check('solver computes a positive minimum move count', solver.minMoves > 0, String(solver.minMoves));
        check('solver solution reproduces the cloth', solver.plantedVerifies && solver.bestVerifies);

        // Ambiguity: a flat cloth of blend(Indigo, Madder) can be woven as
        // warp=Indigo/weft=Madder OR warp=Madder/weft=Indigo — the solver must
        // count both. An all-cream cloth collapses to ONE canonical solution.
        const ambig = await page.evaluate(() => {
            const flat = Array.from({ length: ROWS }, () => new Array(COLS).fill('#7f4f47'));
            const flatCount = solvePuzzle(flat).count;
            const cream = Array.from({ length: ROWS }, () => new Array(COLS).fill('#F2E8CF'));
            const creamRes = solvePuzzle(cream);
            const red = weaveCloth(['#3D5A80', '#C1440E', '#3D5A80', '#C1440E'], ['#F2E8CF']);
            const rr = solvePuzzle(red);
            return {
                flatCount,
                creamCount: creamRes.count, creamW: creamRes.best.w, creamH: creamRes.best.h,
                w: rr.best.w, h: rr.best.h,
            };
        });
        check('ambiguous flat cloth proved not unique', ambig.flatCount === 2, `count=${ambig.flatCount}`);
        check('trivial cloth reduces to one canonical solution',
            ambig.creamCount === 1 && ambig.creamW === 1 && ambig.creamH === 1,
            `count=${ambig.creamCount}`);
        check('solver collapses redundant repeat 4→2', ambig.w === 2 && ambig.h === 1,
            `w=${ambig.w},h=${ambig.h}`);

        // ================= Generator + Daily: determinism =================
        const det = await page.evaluate(() => {
            const solveTwice = JSON.stringify(solvePuzzle(solveLevel(5, 0).target)) ===
                JSON.stringify(solvePuzzle(solveLevel(5, 0).target));
            const dailySame = JSON.stringify(generateDailyPuzzle('2024-06-01')) ===
                JSON.stringify(generateDailyPuzzle('2024-06-01'));
            const dailyDiffers = JSON.stringify(generateDailyPuzzle('2024-06-01')) !==
                JSON.stringify(generateDailyPuzzle('2024-06-02'));
            const varied = JSON.stringify(solveLevel(13, 0)) !== JSON.stringify(solveLevel(13, 1));
            return { solveTwice, dailySame, dailyDiffers, varied };
        });
        check('solver deterministic (same input → same output)', det.solveTwice);
        check('generator deterministic per level+variation', det.varied);
        check('daily deterministic per date', det.dailySame && det.dailyDiffers);

        // Endless levels 11–16 must be unique-solvable, graded, in-bounds.
        const gen = await page.evaluate(() => {
            const out = [];
            for (let n = 11; n <= 16; n++) {
                const lv = solveLevel(n, 0);
                const res = solvePuzzle(lv.target);
                out.push({
                    unique: res.unique,
                    grade: lv.spec.grade || '',
                    minMoves: res.minMoves,
                    w: lv.spec.w, h: lv.spec.h,
                });
            }
            return out;
        });
        check('levels 11–16 all uniquely solvable', gen.every(g => g.unique),
            gen.map(g => g.unique ? '✓' : '✗').join(''));
        check('generated levels carry difficulty grades',
            gen.every(g => ['Gentle', 'Medium', 'Hard', 'Expert'].includes(g.grade)),
            gen.map(g => g.grade).join(','));
        check('generated repeats within player bounds (2–8)',
            gen.every(g => g.w >= 2 && g.w <= 8 && g.h >= 2 && g.h <= 8),
            gen.map(g => `${g.w}×${g.h}`).join(' '));

        // Daily puzzle for today must also be solver-proven unique.
        const todayPuzzle = await page.evaluate(() => {
            const dp = generateDailyPuzzle(todayKey());
            return { unique: solvePuzzle(dp.target).unique, grade: dp.spec.grade };
        });
        check("today's daily puzzle is uniquely solvable", todayPuzzle.unique, todayPuzzle.grade);

        // ================= Daily Weave UI flow =================
        check('daily button in HUD', await page.isVisible('#daily-btn'));
        await page.click('#daily-btn');
        await page.waitForTimeout(300);
        check('level chip switches to Daily', (await page.textContent('#level-chip')).includes('Daily'));
        check('daily board starts fresh at 0 moves', (await page.textContent('#moves-chip')).includes('Moves 0'));

        // Instant-solve through the real win pipeline.
        const won = await page.evaluate(() => {
            state.W = state.solW;
            state.H = state.solH;
            state.warpSeq = [...state.solutionWarp];
            state.weftSeq = [...state.solutionWeft];
            paint();
            return state.hasWon;
        });
        check('solving the daily triggers the win', won === true);
        await page.waitForTimeout(1500);
        check('win overlay appears for the daily', await page.isVisible('#win-overlay'));
        check('share grid rendered (6×5 cells)', (await page.locator('#share-grid .share-cell').count()) === 30);
        check('copy-result button offered', await page.isVisible('#copy-share-btn'));

        const dailySave = await page.evaluate(() => ({
            store: JSON.parse(localStorage.getItem('loom.daily.v1') || '{}'),
            key: todayKey(),
        }));
        const todayEntry = dailySave.store[dailySave.key];
        check('daily best persisted for today', !!(todayEntry && typeof todayEntry.moves === 'number'),
            JSON.stringify(todayEntry || null));

        await page.click('#copy-share-btn');
        await page.waitForTimeout(300);
        check('copy gives feedback toast', await page.isVisible('#toast.show'));

        await page.click('#next-level-btn');
        await page.waitForTimeout(300);
        check('daily exit returns to campaign pattern', (await page.textContent('#level-chip')).includes('Nº 2'));
        const campaign = await page.evaluate(() => ({ isDaily: state.isDaily, level: state.level }));
        check('campaign state intact after the daily', campaign.isDaily === false && campaign.level === 2);
        const campSave = await page.evaluate(() => JSON.parse(localStorage.getItem('loom.save.v3')));
        check('campaign save untouched by the daily', campSave.level === 2);

        // --- Keyboard shortcuts ---
        await page.click('#warp-strip .thread:nth-child(1)');
        await page.keyboard.press('z');
        check('Z undoes', (await page.textContent('#moves-chip')).includes('0'));

        check('no console errors', errors.length === 0, errors.join(' | ').slice(0, 200));

        // ================= Mobile (phone viewport + touch) =================
        const mobile = await (await browser.newContext({
            viewport: { width: 390, height: 844 },
            hasTouch: true,
            isMobile: true,
        })).newPage();
        mobile.on('console', m => { if (m.type() === 'error') errors.push('mobile: ' + m.text()); });
        mobile.on('pageerror', e => errors.push('mobile: ' + String(e)));

        await mobile.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
        await mobile.waitForTimeout(400);
        await mobile.click('#start-btn');
        await mobile.waitForTimeout(300);

        // Loom must fit inside the phone viewport
        const frame = await mobile.locator('.loom-frame').boundingBox();
        check('mobile: loom frame fits viewport', frame && frame.width <= 390, frame ? `${Math.round(frame.width)}px` : 'null');
        const cellBox = await mobile.locator('#player-grid .cell').first().boundingBox();
        check('mobile: cells at least 15px', cellBox && cellBox.width >= 15, cellBox ? `${Math.round(cellBox.width)}px` : 'null');

        // Ads on phones: no rails (no blank linen), slim footer banner only
        const mRail = await mobile.locator('[data-ad-slot="railLeft"]').boundingBox();
        check('mobile: side rails hidden', mRail === null);
        const mFoot = await mobile.locator('.ad-leaderboard').boundingBox();
        check('mobile: footer ad fits viewport', mFoot && mFoot.width <= 390 && mFoot.height > 40,
            mFoot ? `${Math.round(mFoot.width)}x${Math.round(mFoot.height)}` : 'null');

        // Long-press a cloth cell = weft cycle backward (Shift-click alternative)
        const longPress = async (selector) => {
            const b = await mobile.locator(selector).first().boundingBox();
            const x = b.x + b.width / 2, y = b.y + b.height / 2;
            await mobile.evaluate(({ x, y }) => {
                const el = document.elementFromPoint(x, y);
                el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
            }, { x, y });
            await mobile.waitForTimeout(600);
            await mobile.evaluate(({ x, y }) => {
                const el = document.elementFromPoint(x, y);
                el.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
            }, { x, y });
        };

        const weftColor = async () => mobile.evaluate(() => document.querySelector('#weft-strip .thread').style.backgroundColor);
        const warpColor = async () => mobile.evaluate(() => document.querySelector('#warp-strip .thread').style.backgroundColor);

        await longPress('#player-grid .cell');
        await mobile.waitForTimeout(200);
        check('mobile: long-press cell counts a move', (await mobile.textContent('#moves-chip')).includes('1'));
        check('mobile: long-press cell cycled weft', (await weftColor()) === 'rgb(124, 139, 111)', await weftColor());

        await longPress('#warp-strip .thread:nth-child(1)');
        await mobile.waitForTimeout(200);
        check('mobile: long-press thread cycles backward', (await warpColor()) === 'rgb(124, 139, 111)', await warpColor());
        check('mobile: moves = 2', (await mobile.textContent('#moves-chip')).includes('2'));

        // A normal tap still cycles forward (and is not swallowed by long-press logic).
        // Warp is at Sage after the backward long-press; forward from Sage is Cream.
        const tapBox = await mobile.locator('#player-grid .cell').first().boundingBox();
        await mobile.touchscreen.tap(tapBox.x + tapBox.width / 2, tapBox.y + tapBox.height / 2);
        await mobile.waitForTimeout(200);
        check('mobile: tap still cycles warp forward', (await warpColor()) === 'rgb(242, 232, 207)', await warpColor());
        check('mobile: moves = 3', (await mobile.textContent('#moves-chip')).includes('3'));

        // Modals fit the phone screen
        await mobile.click('#levels-btn');
        await mobile.waitForTimeout(300);
        const levelsModal = await mobile.locator('.levels-modal').boundingBox();
        check('mobile: library modal fits screen', levelsModal && levelsModal.height <= 844 && levelsModal.width <= 390,
            levelsModal ? `${Math.round(levelsModal.width)}x${Math.round(levelsModal.height)}` : 'null');
        await mobile.click('#levels-close-btn');
        await mobile.waitForTimeout(200);

        check('no console errors (mobile)', errors.filter(e => e.startsWith('mobile:')).length === 0,
            errors.filter(e => e.startsWith('mobile:')).join(' | ').slice(0, 200));

    } catch (e) {
        console.error('VERIFICATION ERROR:', e);
        failures++;
    } finally {
        await browser.close();
        server.close();
        console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
        process.exit(failures === 0 ? 0 : 1);
    }
});
