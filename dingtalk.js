const { chromium } = require('playwright');
const fs = require('fs');

const CDP_URL = 'http://127.0.0.1:9222';
const TASK_PAGE = '/projects/62430/data';

const SCROLL_STEP = 500;
const WAIT_AFTER_SCROLL = 300;

async function main() {
    console.log('Connecting to existing Chrome...');

    // --------------------------------------------------
    // Connect to your already-open Chrome
    // --------------------------------------------------

    const browser = await chromium.connectOverCDP(CDP_URL);

    const contexts = browser.contexts();

    if (contexts.length === 0) {
        throw new Error('No Chrome browser context found.');
    }

    const context = contexts[0];

    // --------------------------------------------------
    // Find the DingTag task page
    // --------------------------------------------------

    const pages = context.pages();

    const page = pages.find(page =>
        page.url().includes(TASK_PAGE)
    );

    if (!page) {
        throw new Error(
            'DingTag task page not found.\n' +
            'Make sure you have opened the project page in Chrome.'
        );
    }

    console.log('Connected to:');
    console.log(page.url());

    // --------------------------------------------------
    // Find the virtual scroll container
    // --------------------------------------------------

    const scrollContainer = page.locator(
        'div[style*="overflow: auto"][style*="will-change: transform"]'
    ).first();

    if (await scrollContainer.count() === 0) {
        throw new Error(
            'Virtual scroll container not found.'
        );
    }

    console.log('Virtual scroll container found.');

    // --------------------------------------------------
    // Get currently rendered task IDs
    // --------------------------------------------------

    async function getVisibleTasks() {
        return await page
            .locator(
                '.lsf-table-row input[aria-label^="Select Task"]'
            )
            .evaluateAll(inputs => {
                return inputs
                    .map(input => {
                        const label =
                            input.getAttribute('aria-label');

                        if (!label) {
                            return null;
                        }

                        const match =
                            label.match(/Select Task (\d+)/);

                        return match
                            ? match[1]
                            : null;
                    })
                    .filter(Boolean);
            });
    }

    // --------------------------------------------------
    // Get scroll information
    // --------------------------------------------------

    async function getScrollInfo() {
        return await scrollContainer.evaluate(el => ({
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight
        }));
    }

    // --------------------------------------------------
    // Store unique task IDs
    // --------------------------------------------------

    const discoveredTasks = new Set();

    // --------------------------------------------------
    // Collect currently visible tasks
    // --------------------------------------------------

    async function collectTasks() {
        const visibleTasks = await getVisibleTasks();

        const newTasks = [];

        for (const taskId of visibleTasks) {
            if (!discoveredTasks.has(taskId)) {
                discoveredTasks.add(taskId);
                newTasks.push(taskId);
            }
        }

        if (newTasks.length > 0) {
            console.log(
                `Found ${newTasks.length} new task(s). ` +
                `Total: ${discoveredTasks.size}`
            );

            console.log('New:', newTasks);
        }
    }

    // --------------------------------------------------
    // Move sidebar to the very top
    // --------------------------------------------------

    console.log('\nMoving sidebar to top...');

    await scrollContainer.evaluate(el => {
        el.scrollTop = 0;
    });

    await page.waitForTimeout(500);

    console.log(
        'Scroll position:',
        await getScrollInfo()
    );

    // --------------------------------------------------
    // Collect first batch
    // --------------------------------------------------

    await collectTasks();

    // --------------------------------------------------
    // Scroll through entire virtual list
    // --------------------------------------------------

    let previousScrollTop = -1;

    while (true) {
        const info = await getScrollInfo();

        const maxScroll =
            info.scrollHeight - info.clientHeight;

        console.log(
            `\nScroll: ${info.scrollTop.toFixed(1)} / ` +
            `${maxScroll.toFixed(1)}`
        );

        // --------------------------------------------------
        // Reached bottom
        // --------------------------------------------------

        if (info.scrollTop >= maxScroll - 1) {
            console.log(
                '\nReached bottom of task list.'
            );

            break;
        }

        // --------------------------------------------------
        // Safety check
        // --------------------------------------------------

        if (info.scrollTop === previousScrollTop) {
            console.log(
                '\nScroll position did not change. ' +
                'Stopping to avoid an infinite loop.'
            );

            break;
        }

        previousScrollTop = info.scrollTop;

        // --------------------------------------------------
        // Scroll down
        // --------------------------------------------------

        await scrollContainer.evaluate(
            (el, step) => {
                const max =
                    el.scrollHeight - el.clientHeight;

                el.scrollTop = Math.min(
                    el.scrollTop + step,
                    max
                );
            },
            SCROLL_STEP
        );

        // --------------------------------------------------
        // Allow DingTag's virtual list to update
        // --------------------------------------------------

        await page.waitForTimeout(
            WAIT_AFTER_SCROLL
        );

        // --------------------------------------------------
        // Collect newly visible tasks
        // --------------------------------------------------

        await collectTasks();
    }

    // --------------------------------------------------
    // Sort task IDs numerically
    // --------------------------------------------------

    const sortedTasks = [...discoveredTasks]
        .map(Number)
        .sort((a, b) => a - b);

    // --------------------------------------------------
    // Create tasks.json
    // --------------------------------------------------

    const taskData = {
        discoveredAt: new Date().toISOString(),
        count: sortedTasks.length,
        firstTask: String(sortedTasks[0]),
        lastTask: String(sortedTasks[sortedTasks.length - 1]),
        tasks: sortedTasks.map(String)
    };

    fs.writeFileSync(
        'tasks.json',
        JSON.stringify(taskData, null, 2),
        'utf8'
    );

    // --------------------------------------------------
    // Final report
    // --------------------------------------------------

    console.log('\n========================================');
    console.log('COMPLETE TASK DISCOVERY');
    console.log('========================================');

    console.log(
        `Total unique tasks: ${sortedTasks.length}`
    );

    if (sortedTasks.length > 0) {
        console.log(
            `First task: ${sortedTasks[0]}`
        );

        console.log(
            `Last task: ${sortedTasks[sortedTasks.length - 1]}`
        );
    }

    console.log(
        '\nSaved task list to: tasks.json'
    );

    console.log('\nAll task IDs:');

    for (const taskId of sortedTasks) {
        console.log(taskId);
    }

    console.log('\nDone.');

    // --------------------------------------------------
    // IMPORTANT
    // --------------------------------------------------
    // We intentionally DO NOT call browser.close().
    //
    // This Chrome instance is your manually logged-in
    // browser session.
    // --------------------------------------------------
}

main().catch(error => {
    console.error('\n========================================');
    console.error('ERROR');
    console.error('========================================');

    console.error(error);

    process.exit(1);
});