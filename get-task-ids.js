const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ============================================================
// CONFIGURATION
// ============================================================

const CDP_URL = 'http://127.0.0.1:9222';

const DINGTALK_DOMAIN = 'scale.dingtalk.com';

const TASKS_FILE = path.join(__dirname, 'tasks.json');

// How far to scroll each time.
// 0.8 means approximately 80% of the visible container height.
const SCROLL_RATIO = 0.8;

// Wait after each scroll so DingTalk's virtual list can render.
const SCROLL_WAIT = 700;

// Maximum number of scroll iterations as a safety limit.
const MAX_SCROLLS = 500;


// ============================================================
// GLOBALS
// ============================================================

let browser;
let context;
let page;
let sidebar;


// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeTaskId(value) {
    return String(value || '').trim();
}

function isTaskId(value) {
    return /^\d+$/.test(String(value || '').trim());
}


// ============================================================
// CONNECT TO EXISTING CHROME
// ============================================================

async function connectToChrome() {

    console.log('Connecting to existing Chrome...');

    browser = await chromium.connectOverCDP(CDP_URL);

    context = browser.contexts()[0];

    if (!context) {
        throw new Error('No browser context found.');
    }

    const pages = context.pages();

    if (!pages.length) {
        throw new Error('No browser pages found.');
    }

    page =
        pages.find(p =>
            p.url().includes(DINGTALK_DOMAIN)
        ) || pages[0];

    console.log('Connected to:');
    console.log(page.url());

    await page.bringToFront();

    await findVirtualScrollContainer();
}


// ============================================================
// FIND VIRTUAL SCROLL CONTAINER
// ============================================================

async function findVirtualScrollContainer() {

    sidebar = await page.evaluateHandle(() => {

        const elements = [
            ...document.querySelectorAll('*')
        ];

        const candidates =
            elements.filter(el => {

                const style =
                    getComputedStyle(el);

                const scrollable =
                    style.overflowY === 'auto' ||
                    style.overflowY === 'scroll';

                return (
                    scrollable &&
                    el.scrollHeight > el.clientHeight &&
                    el.clientHeight > 200
                );
            });

        const taskContainer =
            candidates.find(el =>
                el.querySelector('.lsf-table-row')
            );

        return (
            taskContainer ||
            candidates[0] ||
            null
        );
    });

    if (!sidebar) {

        throw new Error(
            'Virtual scroll container could not be found.'
        );
    }

    console.log(
        'Virtual scroll container found.'
    );
}


// ============================================================
// GET SCROLL INFORMATION
// ============================================================

async function getScrollInfo() {

    return await page.evaluate(el => {

        if (!el) {
            return null;
        }

        return {
            scrollTop:
                el.scrollTop,

            scrollHeight:
                el.scrollHeight,

            clientHeight:
                el.clientHeight,

            atBottom:
                el.scrollTop +
                el.clientHeight >=
                el.scrollHeight - 5
        };

    }, sidebar);
}


// ============================================================
// SCROLL TO TOP
// ============================================================

async function scrollToTop() {

    await page.evaluate(el => {

        if (!el) {
            return;
        }

        el.scrollTop = 0;

    }, sidebar);

    await sleep(1000);

    const info =
        await getScrollInfo();

    console.log(
        'Sidebar moved to top.'
    );

    console.log(
        'Scroll position:',
        info
    );
}


// ============================================================
// EXTRACT TASK IDS CURRENTLY RENDERED
// ============================================================

async function getRenderedTaskIds() {

    return await page.evaluate(() => {

        const wrappers = [
            ...document.querySelectorAll(
                '.lsf-table__row-wrapper'
            )
        ];

        const results = [];

        for (const wrapper of wrappers) {

            const checkbox =
                wrapper.querySelector(
                    'input[type="checkbox"][aria-label]'
                );

            if (!checkbox) {
                continue;
            }

            const ariaLabel =
                checkbox.getAttribute(
                    'aria-label'
                ) || '';

            const match =
                ariaLabel.match(
                    /(?:Select|Unselect) Task\s+(\d+)/
                );

            if (!match) {
                continue;
            }

            const taskId =
                match[1];

            const row =
                wrapper.querySelector(
                    '.lsf-table-row'
                );

            results.push({
                taskId,
                text:
                    row?.innerText?.trim() || ''
            });
        }

        return results;
    });
}


// ============================================================
// SCROLL DOWN
// ============================================================

async function scrollDown() {

    const before =
        await getScrollInfo();

    if (!before) {
        throw new Error(
            'Could not read scroll information.'
        );
    }

    const amount =
        Math.max(
            300,
            Math.floor(
                before.clientHeight *
                SCROLL_RATIO
            )
        );

    await page.evaluate(
        ({ amount }) => {

            const elements = [
                ...document.querySelectorAll('*')
            ];

            const candidates =
                elements.filter(el => {

                    const style =
                        getComputedStyle(el);

                    const scrollable =
                        style.overflowY === 'auto' ||
                        style.overflowY === 'scroll';

                    return (
                        scrollable &&
                        el.scrollHeight >
                        el.clientHeight &&
                        el.clientHeight > 200
                    );
                });

            const container =
                candidates.find(el =>
                    el.querySelector(
                        '.lsf-table-row'
                    )
                ) || candidates[0];

            if (container) {
                container.scrollTop += amount;
            }

        },
        { amount }
    );

    await sleep(SCROLL_WAIT);

    const after =
        await getScrollInfo();

    return {
        before,
        after
    };
}


// ============================================================
// COLLECT ALL TASK IDS
// ============================================================

async function collectAllTaskIds() {

    const taskIds = new Set();

    await scrollToTop();

    console.log('');
    console.log(
        '========================================'
    );
    console.log(
        'COLLECTING TASK IDS'
    );
    console.log(
        '========================================'
    );

    let previousScrollTop = -1;

    for (
        let iteration = 0;
        iteration < MAX_SCROLLS;
        iteration++
    ) {

        // ----------------------------------------------------
        // Read currently rendered tasks
        // ----------------------------------------------------

        const rendered =
            await getRenderedTaskIds();

        let newIds = 0;

        for (const item of rendered) {

            const taskId =
                normalizeTaskId(
                    item.taskId
                );

            if (!isTaskId(taskId)) {
                continue;
            }

            if (!taskIds.has(taskId)) {

                taskIds.add(taskId);
                newIds++;
            }
        }

        const scroll =
            await getScrollInfo();

        console.log(
            `Scan ${iteration + 1}: ` +
            `visible=${rendered.length}, ` +
            `new=${newIds}, ` +
            `total=${taskIds.size}, ` +
            `scrollTop=${scroll?.scrollTop ?? '?'}/` +
            `${scroll?.scrollHeight ?? '?'}`
        );

        // ----------------------------------------------------
        // Bottom reached
        // ----------------------------------------------------

        if (
            scroll &&
            scroll.atBottom
        ) {

            console.log(
                'Reached bottom of task list.'
            );

            break;
        }

        // ----------------------------------------------------
        // Safety: scroll position stopped changing
        // ----------------------------------------------------

        if (
            scroll &&
            scroll.scrollTop ===
            previousScrollTop
        ) {

            console.log(
                'Scroll position stopped changing.'
            );

            // Give DingTalk one additional chance
            // to render new rows.
            await sleep(1000);

            const retryScroll =
                await getScrollInfo();

            if (
                retryScroll &&
                retryScroll.scrollTop ===
                scroll.scrollTop
            ) {

                console.log(
                    'Confirmed that scrolling has stopped.'
                );

                break;
            }
        }

        previousScrollTop =
            scroll?.scrollTop ?? -1;

        // ----------------------------------------------------
        // Scroll downward
        // ----------------------------------------------------

        const result =
            await scrollDown();

        if (
            result.after &&
            result.before &&
            result.after.scrollTop ===
            result.before.scrollTop
        ) {

            console.log(
                'Could not move the virtual scroll further.'
            );

            break;
        }
    }

    return [...taskIds];
}


// ============================================================
// SAVE TASKS.JSON
// ============================================================

function saveTasks(taskIds) {

    const unique =
        [...new Set(
            taskIds
                .map(normalizeTaskId)
                .filter(isTaskId)
        )];

    fs.writeFileSync(
        TASKS_FILE,
        JSON.stringify(
            unique,
            null,
            2
        ),
        'utf8'
    );

    console.log('');
    console.log(
        '========================================'
    );
    console.log(
        'TASK IDS SAVED'
    );
    console.log(
        '========================================'
    );

    console.log(
        `File: ${TASKS_FILE}`
    );

    console.log(
        `Total task IDs: ${unique.length}`
    );

    if (unique.length) {

        console.log(
            `First task: ${unique[0]}`
        );

        console.log(
            `Last task: ${unique[unique.length - 1]}`
        );
    }
}


// ============================================================
// PRINT TASK IDS
// ============================================================

function printTaskIds(taskIds) {

    console.log('');
    console.log(
        '========================================'
    );
    console.log(
        'TASK IDS FOUND'
    );
    console.log(
        '========================================'
    );

    taskIds.forEach(
        (taskId, index) => {

            console.log(
                `${index + 1}. ${taskId}`
            );
        }
    );
}


// ============================================================
// MAIN
// ============================================================

async function main() {

    try {

        await connectToChrome();

        const taskIds =
            await collectAllTaskIds();

        if (!taskIds.length) {

            throw new Error(
                'No task IDs were found.'
            );
        }

        printTaskIds(taskIds);

        saveTasks(taskIds);

        console.log('');
        console.log(
            '========================================'
        );
        console.log(
            'COMPLETE'
        );
        console.log(
            '========================================'
        );

    } catch (error) {

        console.error('');
        console.error(
            '========================================'
        );

        console.error(
            'ERROR'
        );

        console.error(
            '========================================'
        );

        console.error(
            error?.stack || error
        );

        process.exitCode = 1;

    } finally {

        // We connected to the user's existing Chrome.
        // Do not close Chrome itself.

        try {

            if (browser) {
                await browser.close();
            }

        } catch {
            // Ignore disconnect errors.
        }
    }
}


// ============================================================
// START
// ============================================================

main();
