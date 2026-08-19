// Captures real screenshots of the game for the README.
// Usage: node capture.js
process.env.PLAYWRIGHT_BROWSERS_PATH = require('path').join(__dirname, '.pw-browsers');

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3456;
const LOOM_DIR = __dirname;
const OUT = path.join(LOOM_DIR, 'screenshots');

const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    const filePath = path.join(LOOM_DIR, urlPath === '/' ? 'index.html' : urlPath);
    const ext = path.extname(filePath);
    const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml'
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

async function captureScreenshots() {
    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

    server.listen(PORT, async () => {
        console.log(`Server running at http://localhost:${PORT}`);

        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            viewport: { width: 1280, height: 860 },
            deviceScaleFactor: 2
        });
        const page = await context.newPage();

        try {
            await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
            await page.waitForTimeout(600); // let fonts settle

            // 1. Intro
            await page.screenshot({ path: path.join(OUT, 'intro.png') });
            console.log('Captured: screenshots/intro.png');

            // 1b. Pattern Library (level select) from the intro
            await page.click('#levels-intro-btn');
            await page.waitForTimeout(400);
            await page.screenshot({ path: path.join(OUT, 'library.png') });
            console.log('Captured: screenshots/library.png');
            await page.click('#levels-close-btn');
            await page.waitForTimeout(300);

            // 2. Gameplay — start, then make a few moves so the loom looks alive
            await page.click('#start-btn');
            await page.waitForTimeout(400);
            await page.click('#warp-plus');
            await page.click('#weft-plus');
            await page.click('#warp-strip .thread:nth-child(1)');
            await page.click('#warp-strip .thread:nth-child(2)');
            await page.click('#weft-strip .thread:nth-child(1)');
            await page.waitForTimeout(500);
            await page.screenshot({ path: path.join(OUT, 'gameplay.png') });
            console.log('Captured: screenshots/gameplay.png');

            // 3. Solved — reveal the solution, capture the win modal
            await page.click('#reveal-btn');
            await page.waitForTimeout(1200);
            await page.screenshot({ path: path.join(OUT, 'solved.png') });
            console.log('Captured: screenshots/solved.png');

            // 4. Mobile gameplay — phone viewport, a few moves in
            const mobileCtx = await browser.newContext({
                viewport: { width: 390, height: 844 },
                deviceScaleFactor: 2,
                hasTouch: true,
                isMobile: true,
            });
            const mobile = await mobileCtx.newPage();
            await mobile.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
            await mobile.waitForTimeout(600);
            await mobile.click('#start-btn');
            await mobile.waitForTimeout(400);
            await mobile.click('#warp-plus');
            await mobile.click('#weft-plus');
            await mobile.click('#warp-strip .thread:nth-child(1)');
            await mobile.click('#warp-strip .thread:nth-child(2)');
            await mobile.click('#weft-strip .thread:nth-child(1)');
            await mobile.waitForTimeout(500);
            await mobile.screenshot({ path: path.join(OUT, 'mobile.png') });
            console.log('Captured: screenshots/mobile.png');
            await mobileCtx.close();

        } catch (error) {
            console.error('Error capturing screenshots:', error);
        } finally {
            await browser.close();
            server.close();
            console.log('Done!');
        }
    });
}

captureScreenshots();
