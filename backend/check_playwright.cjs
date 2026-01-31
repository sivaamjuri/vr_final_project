const { chromium } = require('playwright');
(async () => {
    try {
        const browser = await chromium.launch();
        console.log('Playwright ok');
        await browser.close();
    } catch (e) {
        console.error('Playwright failed:', e.message);
    }
})();
