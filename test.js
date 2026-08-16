const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.connectOverCDP(
        'http://127.0.0.1:9222'
    );

    const context = browser.contexts()[0];

    const page = context.pages().find(p =>
        p.url().includes('/projects/62430/data')
    );

    if (!page) {
        throw new Error('DingTag task page not found.');
    }

    console.log('Connected to:', page.url());

    // Exact virtual-scroll container identified from DevTools.
    const scrollContainer = page.locator(
        'div[style*="overflow: auto"][style*="will-change: transform"]'
    ).first();

    console.log('\nContainer count:', await scrollContainer.count());

    const before = await scrollContainer.evaluate(el => ({
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height
    }));

    console.log('\nBefore scrolling:');
    console.log(before);

    const getTasks = async () => {
        return await page
            .locator('.lsf-table-row input[aria-label^="Select Task"]')
            .evaluateAll(inputs =>
                inputs
                    .map(input => input.getAttribute('aria-label'))
                    .filter(Boolean)
            );
    };

    console.log('\nTasks before:');
    console.log(await getTasks());

    // Scroll the actual virtual-scroll container.
    await scrollContainer.evaluate(el => {
        el.scrollTop += 500;
    });

    await page.waitForTimeout(300);

    const after = await scrollContainer.evaluate(el => ({
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight
    }));

    console.log('\nAfter scrolling:');
    console.log(after);

    console.log('\nTasks after:');
    console.log(await getTasks());

    console.log('\nDone.');

    // Don't close the browser — it is your manually logged-in Chrome.
})();


