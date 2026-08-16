const { chromium } = require('playwright');

const CDP_URL = 'http://127.0.0.1:9222';
const TARGET_TASK = '84113362';

async function main() {
console.log('Connecting to existing Chrome...');

const browser = await chromium.connectOverCDP(CDP_URL);

const context = browser.contexts()[0];

if (!context) {
throw new Error('No browser context found.');
}

const pages = context.pages();

const page =
pages.find(p => p.url().includes('scale.dingtalk.com')) ||
pages[0];

console.log('Connected to:');
console.log(page.url());

console.log('\n========================================');
console.log('SIDEBAR ROW DIAGNOSTIC');
console.log('========================================');

console.log('Looking for task:', TARGET_TASK);

// Get every element containing the target task ID.
const elements = await page.locator(`text=${TARGET_TASK}`).all();

console.log('Total text matches:', elements.length);

for (let i = 0; i < elements.length; i++) {
const element = elements[i];

console.log(`\n\n========== TEXT MATCH ${i + 1} ==========`);

try {
const info = await element.evaluate(el => ({
tag: el.tagName,
className: el.className,
text: el.textContent,
rect: (() => {
const r = el.getBoundingClientRect();

return {
x: r.x,
y: r.y,
width: r.width,
height: r.height
};
})()
}));

console.log(info);

// Walk upward and inspect every parent.
const parents = await element.evaluate(el => {
const result = [];

let current = el;

for (let level = 0; level < 12 && current; level++) {
const rect = current.getBoundingClientRect();

result.push({
level,
tag: current.tagName,
id: current.id || '',
className:
typeof current.className === 'string'
? current.className
: '',
role: current.getAttribute('role'),
ariaLabel: current.getAttribute('aria-label'),
dataTestId: current.getAttribute('data-testid'),
dataTaskId: current.getAttribute('data-task-id'),
dataId: current.getAttribute('data-id'),
href: current.getAttribute('href'),
onclick: current.getAttribute('onclick'),
rect: {
x: rect.x,
y: rect.y,
width: rect.width,
height: rect.height
},
scrollable:
current.scrollHeight > current.clientHeight ||
current.scrollWidth > current.clientWidth,
text: (current.innerText || '').slice(0, 500),
html: current.outerHTML.slice(0, 5000)
});

current = current.parentElement;
}

return result;
});

for (const parent of parents) {
console.log(`\n----- PARENT LEVEL ${parent.level} -----`);

console.log('Tag:', parent.tag);
console.log('Class:', parent.className);
console.log('Role:', parent.role);
console.log('aria-label:', parent.ariaLabel);
console.log('data-testid:', parent.dataTestId);
console.log('data-task-id:', parent.dataTaskId);
console.log('data-id:', parent.dataId);
console.log('href:', parent.href);
console.log('onclick:', parent.onclick);
console.log('rect:', parent.rect);
console.log('scrollable:', parent.scrollable);

console.log('TEXT:');
console.log(parent.text);

console.log('HTML:');
console.log(parent.html);
}

} catch (err) {
console.log('Inspection failed:', err.message);
}
}

// --------------------------------------------------
// Find all checkboxes currently in the page.
// --------------------------------------------------

console.log('\n\n========================================');
console.log('CHECKBOX DIAGNOSTIC');
console.log('========================================');

const checkboxes = page.locator('input[type="checkbox"]');

const checkboxCount = await checkboxes.count();

console.log('Checkbox count:', checkboxCount);

for (let i = 0; i < checkboxCount; i++) {
const checkbox = checkboxes.nth(i);

try {
const info = await checkbox.evaluate(el => {
const rect = el.getBoundingClientRect();

// Get a few parents.
const parents = [];

let current = el;

for (let level = 0; level < 6 && current; level++) {
parents.push({
level,
tag: current.tagName,
className:
typeof current.className === 'string'
? current.className
: '',
role: current.getAttribute('role'),
ariaLabel: current.getAttribute('aria-label'),
dataTestId: current.getAttribute('data-testid'),
dataTaskId: current.getAttribute('data-task-id'),
text: (current.innerText || '').slice(0, 300),
html: current.outerHTML.slice(0, 3000)
});

current = current.parentElement;
}

return {
index: i,
checked: el.checked,
disabled: el.disabled,
name: el.name,
value: el.value,
rect: {
x: rect.x,
y: rect.y,
width: rect.width,
height: rect.height
},
parents
};
});

console.log('\n========== CHECKBOX', i, '==========');
console.dir(info, { depth: null });

} catch (err) {
console.log(
`Could not inspect checkbox ${i}:`,
err.message
);
}
}

// --------------------------------------------------
// Search for elements whose text looks like task IDs.
// This helps us understand the sidebar structure.
// --------------------------------------------------

console.log('\n\n========================================');
console.log('TASK-ID ELEMENT DIAGNOSTIC');
console.log('========================================');

const taskIdElements = await page.locator(
'div, span, label, button, a'
).evaluateAll(elements => {
return elements
.map((el, index) => {
const text = (el.textContent || '').trim();

if (!/^84113\d+$/.test(text)) {
return null;
}

const rect = el.getBoundingClientRect();

return {
index,
tag: el.tagName,
className:
typeof el.className === 'string'
? el.className
: '',
text,
role: el.getAttribute('role'),
ariaLabel: el.getAttribute('aria-label'),
dataTestId: el.getAttribute('data-testid'),
dataTaskId: el.getAttribute('data-task-id'),
dataId: el.getAttribute('data-id'),
rect: {
x: rect.x,
y: rect.y,
width: rect.width,
height: rect.height
},
visible:
rect.width > 0 &&
rect.height > 0
};
})
.filter(Boolean);
});

console.log('Task-ID elements found:', taskIdElements.length);

console.dir(taskIdElements, { depth: null });

console.log('\n========================================');
console.log('DIAGNOSTIC COMPLETE');
console.log('========================================');

await browser.close();
}

main().catch(err => {
console.error('\n========================================');
console.error('ERROR');
console.error('========================================');
console.error(err);
process.exit(1);
});