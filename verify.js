// Automated verification: console errors, layout, and a full playthrough.
process.env.PLAYWRIGHT_BROWSERS_PATH = require('path').join(__dirname, '.pw-browsers');
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

        // --- Start ---
        await page.click('#start-btn');
        await page.waitForTimeout(300);
        check('intro hidden after start', !(await page.isVisible('#intro-overlay')));

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

        // --- Next level ---
        await page.click('#next-level-btn');
        await page.waitForTimeout(300);
        check('advanced to level 2', (await page.textContent('#level-chip')).includes('Nº 2'));
        check('win overlay closed', !(await page.isVisible('#win-overlay')));

        // --- Persistence ---
        const saved = await page.evaluate(() => localStorage.getItem('loom.save.v2'));
        check('progress saved', saved && JSON.parse(saved).level === 2, saved);

        // --- Keyboard shortcuts ---
        await page.click('#warp-strip .thread:nth-child(1)');
        await page.keyboard.press('z');
        check('Z undoes', (await page.textContent('#moves-chip')).includes('0'));

        check('no console errors', errors.length === 0, errors.join(' | ').slice(0, 200));

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
