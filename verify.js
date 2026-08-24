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
