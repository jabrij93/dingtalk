const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ============================================================
// CONFIGURATION
// ============================================================

const CDP_URL = 'http://127.0.0.1:9222';

const PROJECT_URL =
  'https://scale.dingtalk.com/projects/62430/data?tab=dBCWovXruD';

const TASKS_FILE =
  path.join(__dirname, 'tasks.json');

const RESULTS_FILE =
  path.join(__dirname, 'batch-results.json');

// ------------------------------------------------------------
// TEST / FULL MODE
// ------------------------------------------------------------

// TRUE = test one task
// FALSE = process all tasks
const TEST_MODE = false;

// Used only when TEST_MODE = true.
const TEST_TASK_ID = '84278296';

// ------------------------------------------------------------
// START TASK
// ------------------------------------------------------------
//
// Only tasks with IDs >= this value are processed.
//
// Example:
//
// 84278713 -> skipped
// 84278714 -> processed
// 84278715 -> processed
//
// ------------------------------------------------------------

const START_TASK_ID = '84278296';

// ------------------------------------------------------------
// NUMBER OF FULL PASSES
// ------------------------------------------------------------

const PASSES = 5;

// ------------------------------------------------------------
// RETRY SETTINGS
// ------------------------------------------------------------

// Maximum complete task attempts.
// Each attempt contains 2 playbacks.
const MAX_PLAYBACK_ATTEMPTS = 3;

// ------------------------------------------------------------
// TIMEOUTS
// ------------------------------------------------------------

const TIMEOUT = {

  TASK_RENDER: 15000,

  TASK_SWITCH: 15000,

  AUDIO_LOAD: 30000,

  ANNOTATION_READY: 30000,

  PLAY_BUTTON: 15000,

  PLAYBACK_START: 10000,

  PLAYBACK_FINISH: 120000,

  UPDATE_BUTTON: 15000,

};


// ============================================================
// GLOBALS
// ============================================================

let browser;
let context;
let page;
let sidebar;

// Total actual audio duration successfully played
// during THIS program run.
let totalAudioPlayedSeconds = 0;


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
  return /^\d+$/.test(
    String(value || '').trim()
  );
}


// ============================================================
// TOTAL AUDIO DURATION
// ============================================================

function getTotalAudioPlayedMinutes() {

  return (
    totalAudioPlayedSeconds / 60
  ).toFixed(2);
}


function printTotalAudioDuration() {

  console.log(
    `Total duration: ${getTotalAudioPlayedMinutes()} minutes`
  );
}


function addPlayedAudioDuration(
  durationSeconds
) {

  if (
    !Number.isFinite(
      durationSeconds
    ) ||
    durationSeconds <= 0
  ) {
    return;
  }

  totalAudioPlayedSeconds +=
    durationSeconds;

  console.log(
    `Audio duration added: ${durationSeconds.toFixed(2)} seconds`
  );

  printTotalAudioDuration();
}


// ============================================================
// CONNECT TO EXISTING CHROME
// ============================================================

async function connectToChrome() {

  console.log(
    'Connecting to existing Chrome...'
  );

  browser =
    await chromium.connectOverCDP(
      CDP_URL
    );

  context =
    browser.contexts()[0];

  if (!context) {

    throw new Error(
      'No browser context found.'
    );
  }

  const pages =
    context.pages();

  if (!pages.length) {

    throw new Error(
      'No browser pages found.'
    );
  }

  page =
    pages.find(
      p =>
        p.url().includes(
          'scale.dingtalk.com'
        )
    ) || pages[0];

  console.log(
    'Connected to:'
  );

  console.log(
    page.url()
  );

  await bringDingTalkToForeground();

  await findVirtualScrollContainer();
}


// ============================================================
// BRING DINGTALK TAB TO FOREGROUND
// ============================================================

async function bringDingTalkToForeground() {

  if (!page) {
    return;
  }

  console.log(
    'Bringing DingTalk tab to foreground...'
  );

  try {

    await page.bringToFront();

  } catch (error) {

    console.log(
      'Could not bring DingTalk tab to foreground:',
      error.message
    );
  }

  await sleep(250);

  console.log(
    'DingTalk tab is visible and active.'
  );
}


// ============================================================
// FIND VIRTUAL SCROLL CONTAINER
// ============================================================

async function findVirtualScrollContainer() {

  sidebar =
    await page.evaluateHandle(() => {

      const elements =
        [
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
            el.clientHeight >
              200
          );
        });

      const taskContainer =
        candidates.find(
          el =>
            el.querySelector(
              '.lsf-table-row'
            )
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
// LOAD TASKS.JSON
// ============================================================

function loadTasks() {

  if (!fs.existsSync(TASKS_FILE)) {

    throw new Error(
      `tasks.json not found: ${TASKS_FILE}`
    );
  }

  const raw =
    fs.readFileSync(
      TASKS_FILE,
      'utf8'
    );

  const parsed =
    JSON.parse(raw);

  let tasks;

  if (Array.isArray(parsed)) {

    tasks =
      parsed;

  } else if (
    Array.isArray(
      parsed.tasks
    )
  ) {

    tasks =
      parsed.tasks;

  } else {

    throw new Error(
      'tasks.json must contain an array or an object with a "tasks" array.'
    );
  }

  const taskIds =
    tasks
      .map(task => {

        if (
          typeof task ===
          'string'
        ) {
          return task;
        }

        if (
          typeof task ===
          'number'
        ) {
          return String(task);
        }

        if (
          task &&
          task.taskId != null
        ) {
          return String(
            task.taskId
          );
        }

        if (
          task &&
          task.id != null
        ) {
          return String(
            task.id
          );
        }

        return null;
      })
      .filter(isTaskId)
      .map(normalizeTaskId);

  const unique =
    [
      ...new Set(taskIds)
    ];

  console.log(
    `Loaded ${unique.length} task(s) from tasks.json.`
  );

  if (!unique.length) {

    throw new Error(
      'No valid task IDs found in tasks.json.'
    );
  }

  return unique;
}


// ============================================================
// GET CURRENT TASK FROM DINGTALK TOP BAR
// ============================================================

async function getCurrentTaskId() {

  return await page.evaluate(() => {

    const el =
      document.querySelector(
        '.lsf-current-task__task-id'
      );

    return (
      el?.textContent?.trim() ||
      null
    );
  });
}


// ============================================================
// GET TASK ID FROM URL
// ============================================================

function getTaskIdFromUrl(url) {

  try {

    const parsed =
      new URL(url);

    return (
      parsed.searchParams.get(
        'task'
      ) || null
    );

  } catch {

    return null;
  }
}


// ============================================================
// MOVE SIDEBAR TO TOP
// ============================================================

async function moveSidebarToTop() {

  if (!sidebar) {

    await findVirtualScrollContainer();
  }

  await page.evaluate(
    el => {

      if (!el) {
        return;
      }

      el.scrollTop =
        0;

    },
    sidebar
  );

  await sleep(500);

  const info =
    await page.evaluate(
      el => {

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

        };

      },
      sidebar
    );

  console.log(
    'Sidebar moved to top.'
  );

  console.log(
    'Scroll position:',
    info
  );
}


// ============================================================
// GET CURRENTLY RENDERED TASKS
// ============================================================

async function getVisibleTasks() {

  return await page.evaluate(() => {

    const wrappers =
      [
        ...document.querySelectorAll(
          '.lsf-table__row-wrapper'
        )
      ];

    return wrappers
      .map(
        (wrapper, index) => {

          const checkbox =
            wrapper.querySelector(
              'input[type="checkbox"][aria-label]'
            );

          const aria =
            checkbox?.getAttribute(
              'aria-label'
            ) || '';

          const match =
            aria.match(
              /(?:Select|Unselect) Task\s+(\d+)/
            );

          const taskId =
            match ?
              match[1] :
              null;

          const row =
            wrapper.querySelector(
              '.lsf-table-row'
            );

          const player =
            row?.querySelector(
              '.lsf-player'
            );

          const playButton =
            row?.querySelector(
              '.lsf-player__play'
            );

          const track =
            row?.querySelector(
              '.lsf-player__track'
            );

          return {

            index,

            taskId,

            checked:
              checkbox?.getAttribute(
                'aria-checked'
              ) === 'true',

            hasPlayer:
              !!player,

            hasPlayButton:
              !!playButton,

            track:
              track?.textContent?.trim() ||
              '',

            rowText:
              row?.innerText?.trim() ||
              '',

          };

        }
      )
      .filter(
        item =>
          item.taskId
      );
  });
}


// ============================================================
// PRINT VISIBLE TASKS
// ============================================================

async function printVisibleTasks() {

  const tasks =
    await getVisibleTasks();

  console.log(
    '\nVisible tasks:'
  );

  console.table(
    tasks
  );

  return tasks;
}


// ============================================================
// FIND RENDERED TASK
// ============================================================

async function findRenderedTask(taskId) {

  taskId =
    normalizeTaskId(
      taskId
    );

  return await page.evaluate(
    taskId => {

      const wrappers =
        [
          ...document.querySelectorAll(
            '.lsf-table__row-wrapper'
          )
        ];

      for (
        const wrapper of wrappers
      ) {

        const checkbox =
          wrapper.querySelector(
            `input[aria-label="Select Task ${taskId}"], ` +
            `input[aria-label="Unselect Task ${taskId}"]`
          );

        if (!checkbox) {
          continue;
        }

        const row =
          wrapper.querySelector(
            '.lsf-table-row'
          );

        if (!row) {
          continue;
        }

        return {

          found:
            true,

          checked:
            checkbox.getAttribute(
              'aria-checked'
            ) === 'true',

          wrapper,

          row,

        };
      }

      return {

        found:
          false,

      };

    },
    taskId
  );
}


// ============================================================
// SCROLL SIDEBAR
// ============================================================

async function scrollSidebar(amount) {

  await page.evaluate(
    amount => {

      const elements =
        [
          ...document.querySelectorAll('*')
        ];

      const candidates =
        elements.filter(
          el => {

            const style =
              getComputedStyle(el);

            return (

              (
                style.overflowY ===
                  'auto' ||

                style.overflowY ===
                  'scroll'
              ) &&

              el.scrollHeight >
                el.clientHeight &&

              el.clientHeight >
                200

            );
          }
        );

      const container =
        candidates.find(
          el =>
            el.querySelector(
              '.lsf-table-row'
            )
        ) ||
        candidates[0];

      if (container) {

        container.scrollTop +=
          amount;
      }

    },
    amount
  );

  await sleep(500);
}


// ============================================================
// LOCATE TASK IN VIRTUAL SCROLL
// ============================================================

async function locateTask(taskId) {

  taskId =
    normalizeTaskId(
      taskId
    );

  console.log(
    `\nLooking for task ${taskId}...`
  );

  let result =
    await findRenderedTask(
      taskId
    );

  if (
    result.found
  ) {

    console.log(
      `Task ${taskId} is currently rendered.`
    );

    return result;
  }

  await moveSidebarToTop();

  const maxScrolls =
    100;

  for (
    let i = 0;
    i < maxScrolls;
    i++
  ) {

    result =
      await findRenderedTask(
        taskId
      );

    if (
      result.found
    ) {

      console.log(
        `Task ${taskId} is currently rendered.`
      );

      return result;
    }

    const before =
      await page.evaluate(
        () => {

          const elements =
            [
              ...document.querySelectorAll('*')
            ];

          const candidates =
            elements.filter(
              el => {

                const style =
                  getComputedStyle(el);

                return (

                  (
                    style.overflowY ===
                      'auto' ||

                    style.overflowY ===
                      'scroll'
                  ) &&

                  el.scrollHeight >
                    el.clientHeight &&

                  el.clientHeight >
                    200

                );
              }
            );

          const container =
            candidates.find(
              el =>
                el.querySelector(
                  '.lsf-table-row'
                )
            ) ||
            candidates[0];

          if (!container) {
            return null;
          }

          return {

            scrollTop:
              container.scrollTop,

            scrollHeight:
              container.scrollHeight,

            clientHeight:
              container.clientHeight,

          };
        }
      );

    if (!before) {

      throw new Error(
        'Could not determine virtual scroll container.'
      );
    }

    if (
      before.scrollTop +
        before.clientHeight >=
      before.scrollHeight - 5
    ) {

      break;
    }

    await scrollSidebar(
      Math.max(
        300,
        Math.floor(
          before.clientHeight *
          0.8
        )
      )
    );

    const after =
      await page.evaluate(
        () => {

          const elements =
            [
              ...document.querySelectorAll('*')
            ];

          const candidates =
            elements.filter(
              el => {

                const style =
                  getComputedStyle(el);

                return (

                  (
                    style.overflowY ===
                      'auto' ||

                    style.overflowY ===
                      'scroll'
                  ) &&

                  el.scrollHeight >
                    el.clientHeight &&

                  el.clientHeight >
                    200

                );
              }
            );

          const container =
            candidates.find(
              el =>
                el.querySelector(
                  '.lsf-table-row'
                )
            ) ||
            candidates[0];

          if (!container) {
            return null;
          }

          return {

            scrollTop:
              container.scrollTop,

            scrollHeight:
              container.scrollHeight,

            clientHeight:
              container.clientHeight,

          };
        }
      );

    if (
      after &&
      after.scrollTop ===
        before.scrollTop
    ) {

      break;
    }
  }

  throw new Error(
    `Task ${taskId} could not be located in the rendered task list.`
  );
}


// ============================================================
// CLICK NORMAL ROW CELL
// ============================================================

async function clickTaskRow(taskId) {

  taskId =
    normalizeTaskId(
      taskId
    );

  const clicked =
    await page.evaluate(
      taskId => {

        const checkbox =
          document.querySelector(
            `input[aria-label="Select Task ${taskId}"], ` +
            `input[aria-label="Unselect Task ${taskId}"]`
          );

        if (!checkbox) {

          return {

            success:
              false,

            reason:
              'checkbox-not-found',

          };
        }

        const wrapper =
          checkbox.closest(
            '.lsf-table__row-wrapper'
          );

        if (!wrapper) {

          return {

            success:
              false,

            reason:
              'wrapper-not-found',

          };
        }

        const row =
          wrapper.querySelector(
            '.lsf-table-row'
          );

        if (!row) {

          return {

            success:
              false,

            reason:
              'row-not-found',

          };
        }

        const cells =
          [
            ...row.querySelectorAll(
              '.lsf-table__cell'
            )
          ];

        const clickableCell =
          cells[1] ||
          cells.find(
            cell =>
              !cell.classList.contains(
                'lsf-select-row'
              )
          );

        if (!clickableCell) {

          return {

            success:
              false,

            reason:
              'clickable-cell-not-found',

          };
        }

        clickableCell.click();

        return {

          success:
            true,

          cellCount:
            cells.length,

        };

      },
      taskId
    );

  if (
    !clicked.success
  ) {

    throw new Error(
      `Could not click task ${taskId}: ` +
      clicked.reason
    );
  }

  console.log(
    `Clicked normal row cell for task ${taskId}.`
  );

  return clicked;
}


// ============================================================
// WAIT FOR TASK SWITCH
// ============================================================

async function waitForTaskSwitch(taskId) {

  taskId =
    normalizeTaskId(
      taskId
    );

  const deadline =
    Date.now() +
    TIMEOUT.TASK_SWITCH;

  let lastUrl =
    page.url();

  let lastCurrent =
    await getCurrentTaskId();

  while (
    Date.now() <
    deadline
  ) {

    const url =
      page.url();

    const urlTask =
      getTaskIdFromUrl(
        url
      );

    const current =
      await getCurrentTaskId();

    if (
      urlTask === taskId ||
      current === taskId
    ) {

      console.log(
        `Task ${taskId} is now active.`
      );

      return;
    }

    lastUrl =
      url;

    lastCurrent =
      current;

    await sleep(250);
  }

  console.log(
    'Last URL:',
    lastUrl
  );

  console.log(
    'Last current task:',
    lastCurrent
  );

  throw new Error(
    `Task switch failed. Expected ${taskId}.`
  );
}


// ============================================================
// OPEN TASK
// ============================================================

async function openTask(taskId) {

  taskId =
    normalizeTaskId(
      taskId
    );

  console.log(
    `\nOpening task ${taskId}...`
  );

  await bringDingTalkToForeground();

  const current =
    await getCurrentTaskId();

  const urlTask =
    getTaskIdFromUrl(
      page.url()
    );

  if (
    current === taskId ||
    urlTask === taskId
  ) {

    console.log(
      `Task ${taskId} is already the current task.`
    );

    return;
  }

  console.log(
    `Current task: ${current || 'none'}`
  );

  console.log(
    `Looking for task ${taskId} in sidebar...`
  );

  await locateTask(
    taskId
  );

  await clickTaskRow(
    taskId
  );

  await waitForTaskSwitch(
    taskId
  );

  console.log(
    `Successfully switched to task ${taskId}.`
  );
}


// ============================================================
// FIND AUDIO FOR SPECIFIC TASK
// ============================================================

async function findTaskAudio(taskId) {

  taskId =
    normalizeTaskId(
      taskId
    );

  return page.locator(
    `audio[src*="/tasks/${taskId}/resolve/"]`
  ).last();
}


// ============================================================
// WAIT FOR AUDIO TO COMPLETELY LOAD
// ============================================================

async function waitForTaskAudio(taskId) {

  taskId =
    normalizeTaskId(
      taskId
    );

  console.log(
    `Waiting for audio ${taskId} to completely load...`
  );

  const deadline =
    Date.now() +
    TIMEOUT.AUDIO_LOAD;

  let stableSince =
    null;

  while (
    Date.now() <
    deadline
  ) {

    const audio =
      await findTaskAudio(
        taskId
      );

    const count =
      await audio.count();

    if (
      count > 0
    ) {

      const state =
        await audio.evaluate(
          el => ({

            src:
              el.currentSrc ||
              el.src,

            readyState:
              el.readyState,

            networkState:
              el.networkState,

            duration:
              el.duration,

            currentTime:
              el.currentTime,

            paused:
              el.paused,

            ended:
              el.ended,

          })
        );

      const correctAudio =
        state.src &&
        state.src.includes(
          `/tasks/${taskId}/resolve/`
        );

      const completelyLoaded =
        state.readyState === 4 &&
        Number.isFinite(
          state.duration
        ) &&
        state.duration > 0;

      if (
        correctAudio &&
        completelyLoaded
      ) {

        if (
          stableSince ===
          null
        ) {

          stableSince =
            Date.now();

          console.log(
            `Audio ${taskId} reached readyState 4.`
          );

          console.log(
            `Duration: ${state.duration.toFixed(2)} seconds`
          );

          console.log(
            'Waiting for DingTalk player UI to settle...'
          );
        }

        if (
          Date.now() -
            stableSince >=
          1500
        ) {

          console.log(
            `Audio ${taskId} is fully loaded and stable.`
          );

          return audio;
        }

      } else {

        stableSince =
          null;
      }
    }

    await sleep(250);
  }

  throw new Error(
    `Audio ${taskId} did not completely load within ` +
    `${TIMEOUT.AUDIO_LOAD / 1000} seconds.`
  );
}


// ============================================================
// GET AUDIO STATE
// ============================================================

async function getAudioState(audio) {

  return audio.evaluate(
    el => ({

      src:
        el.currentSrc ||
        el.src,

      readyState:
        el.readyState,

      networkState:
        el.networkState,

      duration:
        el.duration,

      currentTime:
        el.currentTime,

      paused:
        el.paused,

      ended:
        el.ended,

    })
  );
}


// ============================================================
// GET MAIN PLAYBACK BUTTON STATE
// ============================================================

async function getPlaybackButtonState() {

  try {

    const buttons =
      page.locator(
        'button[data-testid^="playback-button:"]'
      );

    const count =
      await buttons.count();

    if (
      count === 0
    ) {

      return null;
    }

    for (
      let i = 0;
      i < count;
      i++
    ) {

      const button =
        buttons.nth(i);

      if (
        await button.isVisible()
      ) {

        return await button.evaluate(
          el => ({

            ariaLabel:
              el.getAttribute(
                'aria-label'
              ),

            testId:
              el.getAttribute(
                'data-testid'
              ),

            disabled:
              el.disabled,

          })
        );
      }
    }

    return null;

  } catch {

    return null;
  }
}


// ============================================================
// WAIT FOR REAL DINGTALK PLAY BUTTON
// ============================================================

async function waitForMainPlayButton() {

  const deadline =
    Date.now() +
    TIMEOUT.PLAY_BUTTON;

  let stableSince =
    null;

  while (
    Date.now() <
    deadline
  ) {

    const button =
      page.locator(
        'button[data-testid="playback-button:play"][aria-label="Play"]'
      ).first();

    const count =
      await button.count();

    if (
      count > 0
    ) {

      try {

        const visible =
          await button.isVisible();

        if (
          visible
        ) {

          if (
            stableSince ===
            null
          ) {

            stableSince =
              Date.now();

            console.log(
              'DingTalk Play button detected.'
            );
          }

          if (
            Date.now() -
              stableSince >=
            1000
          ) {

            console.log(
              'DingTalk Play button is stable.'
            );

            printTotalAudioDuration();

            return button;
          }

        } else {

          stableSince =
            null;
        }

      } catch {

        stableSince =
          null;
      }

    } else {

      stableSince =
        null;
    }

    await sleep(250);
  }

  throw new Error(
    'DingTalk Play button did not become ready.'
  );
}


// ============================================================
// CLICK MAIN PLAY BUTTON
// ============================================================

async function clickMainPlayButton(taskId) {

  await bringDingTalkToForeground();

  const button =
    await waitForMainPlayButton();

  console.log(
    `Clicking main Play button for task ${taskId}...`
  );

  const state =
    await button.evaluate(
      el => ({

        ariaLabel:
          el.getAttribute(
            'aria-label'
          ),

        testId:
          el.getAttribute(
            'data-testid'
          ),

        disabled:
          el.disabled,

      })
    );

  console.log(
    'Playback button state:',
    state
  );

  if (
    state.ariaLabel !==
    'Play'
  ) {

    throw new Error(
      `Playback button is not in Play state. ` +
      `Current state: ${state.ariaLabel}`
    );
  }

  if (
    state.disabled
  ) {

    throw new Error(
      'Playback Play button is disabled.'
    );
  }

  await button.click();

  console.log(
    `Main Play button clicked for task ${taskId}.`
  );
}


// ============================================================
// PLAYBACK BUTTON RECOVERY
// ============================================================

async function recoverPlaybackButton(taskId) {

  await bringDingTalkToForeground();

  console.log(
    `Attempting playback-button recovery for ${taskId}...`
  );

  try {

    const state =
      await getPlaybackButtonState();

    console.log(
      'Playback button during recovery:',
      state
    );

    if (
      state &&
      state.testId ===
        'playback-button:pause'
    ) {

      console.log(
        'Playback button is stuck in Pause state. Resetting it...'
      );

      const pauseButton =
        page.locator(
          'button[data-testid="playback-button:pause"]'
        ).first();

      if (
        await pauseButton.count() > 0
      ) {

        await pauseButton.click();

        await sleep(500);

        console.log(
          'Playback button reset to Play state.'
        );
      }
    }

  } catch (error) {

    console.log(
      'Playback button recovery encountered:',
      error.message
    );
  }
}


// ============================================================
// FIND ANNOTATION ITEMS HEADING
// ============================================================

async function findAnnotationItemsHeading() {

  const selectors = [

    'text=Annotation Items',

    'h1:has-text("Annotation Items")',

    'h2:has-text("Annotation Items")',

    'h3:has-text("Annotation Items")',

    'div:has-text("Annotation Items")',

    'span:has-text("Annotation Items")',

  ];

  for (
    const selector of
    selectors
  ) {

    try {

      const locator =
        page.locator(
          selector
        );

      const count =
        await locator.count();

      if (
        count === 0
      ) {
        continue;
      }

      for (
        let i = 0;
        i < count;
        i++
      ) {

        const candidate =
          locator.nth(i);

        try {

          if (
            await candidate.isVisible()
          ) {

            const text =
              (
                await candidate.innerText()
              ).trim();

            if (
              text ===
              'Annotation Items'
            ) {

              return candidate;
            }
          }

        } catch {
          // Try next candidate.
        }
      }

    } catch {
      // Try next selector.
    }
  }

  return null;
}


// ============================================================
// CLICK AREA BELOW ANNOTATION ITEMS
// ============================================================

async function clickAreaBelowAnnotationItems() {

  console.log(
    'Looking for the "Annotation Items" area...'
  );

  const deadline =
    Date.now() +
    TIMEOUT.ANNOTATION_READY;

  while (
    Date.now() <
    deadline
  ) {

    const existingTextarea =
      page.locator(
        'textarea[name="Annotation Result"]'
      ).first();

    if (
      await existingTextarea.count() > 0
    ) {

      try {

        if (
          await existingTextarea.isVisible()
        ) {

          console.log(
            'Annotation Result textarea is already visible.'
          );

          return true;
        }

      } catch {
        // Continue.
      }
    }

    const heading =
      await findAnnotationItemsHeading();

    if (
      !heading
    ) {

      await sleep(500);

      continue;
    }

    console.log(
      'Annotation Items heading detected.'
    );

    try {

      await heading.scrollIntoViewIfNeeded();

    } catch {
      // Ignore.
    }

    await sleep(300);

    const geometry =
      await heading.evaluate(
        el => {

          const rect =
            el.getBoundingClientRect();

          const parent =
            el.parentElement;

          const parentRect =
            parent?.getBoundingClientRect();

          return {

            heading: {

              left:
                rect.left,

              top:
                rect.top,

              width:
                rect.width,

              height:
                rect.height,

              right:
                rect.right,

              bottom:
                rect.bottom,

            },

            parent: parentRect
              ? {

                  left:
                    parentRect.left,

                  top:
                    parentRect.top,

                  width:
                    parentRect.width,

                  height:
                    parentRect.height,

                  right:
                    parentRect.right,

                  bottom:
                    parentRect.bottom,

                }
              : null,

          };
        }
      );

    console.log(
      'Annotation Items geometry:',
      geometry
    );

    const clicked =
      await page.evaluate(
        geometry => {

          if (
            !geometry ||
            !geometry.heading
          ) {

            return {

              success:
                false,

              reason:
                'no-geometry',

            };
          }

          const h =
            geometry.heading;

          const points = [];

          points.push({

            x:
              h.left +
              h.width / 2,

            y:
              h.bottom +
              45,

          });

          points.push({

            x:
              h.left +
              h.width / 2,

            y:
              h.bottom +
              75,

          });

          points.push({

            x:
              h.left +
              h.width / 2,

            y:
              h.bottom +
              110,

          });

          points.push({

            x:
              h.left +
              30,

            y:
              h.bottom +
              60,

          });

          points.push({

            x:
              h.right -
              30,

            y:
              h.bottom +
              60,

          });

          for (
            const point of
            points
          ) {

            const element =
              document.elementFromPoint(
                point.x,
                point.y
              );

            if (
              !element
            ) {
              continue;
            }

            if (
              element ===
              document.body
            ) {
              continue;
            }

            try {

              element.dispatchEvent(
                new MouseEvent(
                  'mousedown',
                  {

                    bubbles:
                      true,

                    cancelable:
                      true,

                    clientX:
                      point.x,

                    clientY:
                      point.y,

                  }
                )
              );

              element.dispatchEvent(
                new MouseEvent(
                  'mouseup',
                  {

                    bubbles:
                      true,

                    cancelable:
                      true,

                    clientX:
                      point.x,

                    clientY:
                      point.y,

                  }
                )
              );

              element.click();

              return {

                success:
                  true,

                point,

                tag:
                  element.tagName,

                className:
                  element.className,

                text:
                  (
                    element.innerText ||
                    ''
                  ).slice(
                    0,
                    100
                  ),

              };

            } catch {
              // Try next point.
            }
          }

          return {

            success:
              false,

            reason:
              'all-points-failed',

          };

        },
        geometry
      );

    console.log(
      'Annotation Items area click result:',
      clicked
    );

    if (
      clicked.success
    ) {

      console.log(
        'Clicked area below Annotation Items.'
      );

      await sleep(700);

      const resultVisible =
        await page.evaluate(
          () => {

            const textarea =
              document.querySelector(
                'textarea[name="Annotation Result"]'
              );

            const annoArea =
              document.querySelector(
                '.anno-area'
              );

            return {

              textarea:
                !!(
                  textarea &&
                  (
                    textarea.offsetWidth ||
                    textarea.offsetHeight ||
                    textarea.getClientRects().length
                  )
                ),

              annoArea:
                !!(
                  annoArea &&
                  (
                    annoArea.offsetWidth ||
                    annoArea.offsetHeight ||
                    annoArea.getClientRects().length
                  )
                ),

            };
          }
        );

      console.log(
        'Annotation Result visibility:',
        resultVisible
      );

      if (
        resultVisible.textarea ||
        resultVisible.annoArea
      ) {

        return true;
      }
    }

    await sleep(500);
  }

  return false;
}


// ============================================================
// ENSURE EXACTLY ONE TRAILING SPACE
// ============================================================

async function ensureTrailingSpace(
  textarea
) {

  const currentValue =
    await textarea.inputValue();

  const updatedValue =
    currentValue.replace(
      /\s+$/,
      ''
    ) + ' ';

  if (
    currentValue !==
    updatedValue
  ) {

    console.log(
      'Adding exactly one trailing space to Annotation Result...'
    );

    await textarea.fill(
      updatedValue
    );

    await sleep(300);

    console.log(
      'Trailing space added successfully.'
    );

  } else {

    console.log(
      'Annotation Result already has exactly one trailing space.'
    );
  }
}


// ============================================================
// OPEN ANNOTATION ITEM AND SELECT ANNOTATION RESULT
// ============================================================

async function clickAnnotationResult() {

  console.log(
    'Opening AnnotationItem and selecting Annotation Result...'
  );

  const deadline =
    Date.now() +
    TIMEOUT.ANNOTATION_READY;

  let annotationItemClicked =
    false;

  while (
    Date.now() <
    deadline
  ) {

    try {

      // --------------------------------------------------------
      // Check whether Annotation Result is already visible.
      // --------------------------------------------------------

      const textarea =
        page.locator(
          'textarea[name="Annotation Result"]'
        ).first();

      if (
        await textarea.count() > 0
      ) {

        try {

          if (
            await textarea.isVisible()
          ) {

            console.log(
              'Annotation Result textarea detected.'
            );

            await textarea.scrollIntoViewIfNeeded();

            await sleep(300);

            await textarea.click();

            console.log(
              'Annotation Result sentence area clicked successfully.'
            );

            await ensureTrailingSpace(
              textarea
            );

            return;

          }

        } catch {
          // Continue.
        }
      }

      // --------------------------------------------------------
      // Find and click AnnotationItem.
      // --------------------------------------------------------

      if (
        !annotationItemClicked
      ) {

        const candidates = [

          page.getByText(
            'AnnotationItem',
            {
              exact:
                true
            }
          ),

          page.locator(
            '[role="tab"]'
          ).filter({
            hasText:
              'AnnotationItem'
          }),

          page.locator(
            'button'
          ).filter({
            hasText:
              'AnnotationItem'
          }),

          page.locator(
            '[class*="tab"]'
          ).filter({
            hasText:
              'AnnotationItem'
          }),

        ];

        let annotationItem =
          null;

        for (
          const candidate of
          candidates
        ) {

          try {

            const count =
              await candidate.count();

            if (
              count ===
              0
            ) {
              continue;
            }

            for (
              let i = 0;
              i < count;
              i++
            ) {

              const item =
                candidate.nth(i);

              if (
                await item.isVisible()
              ) {

                annotationItem =
                  item;

                break;
              }
            }

            if (
              annotationItem
            ) {
              break;
            }

          } catch {
            // Try next candidate.
          }
        }

        if (
          annotationItem
        ) {

          console.log(
            'AnnotationItem tab/section detected.'
          );

          try {

            await annotationItem.scrollIntoViewIfNeeded();

          } catch {
            // Ignore.
          }

          await sleep(300);

          try {

            await annotationItem.click();

          } catch {

            await annotationItem.click({
              force:
                true
            });
          }

          annotationItemClicked =
            true;

          console.log(
            'AnnotationItem tab clicked.'
          );

          await sleep(800);

        } else {

          console.log(
            'AnnotationItem tab not detected yet.'
          );

          await sleep(500);

          continue;
        }
      }

      // --------------------------------------------------------
      // Click area below Annotation Items.
      // --------------------------------------------------------

      console.log(
        'Clicking area below Annotation Items...'
      );

      const clicked =
        await clickAreaBelowAnnotationItems();

      if (
        clicked
      ) {

        console.log(
          'Annotation Items area successfully activated.'
        );

        const resultDeadline =
          Date.now() +
          TIMEOUT.ANNOTATION_READY;

        while (
          Date.now() <
          resultDeadline
        ) {

          const resultTextarea =
            page.locator(
              'textarea[name="Annotation Result"]'
            ).first();

          if (
            await resultTextarea.count() > 0
          ) {

            try {

              if (
                await resultTextarea.isVisible()
              ) {

                console.log(
                  'Annotation Result textarea detected.'
                );

                await resultTextarea.scrollIntoViewIfNeeded();

                await sleep(300);

                await resultTextarea.click();

                console.log(
                  'Annotation Result sentence area clicked successfully.'
                );

                await ensureTrailingSpace(
                  resultTextarea
                );

                return;

              }

            } catch {
              // Continue waiting.
            }
          }

          await sleep(300);
        }
      }

    } catch (error) {

      console.log(
        'Annotation Result interaction is still loading:',
        error.message
      );

      await sleep(500);
    }
  }

  // ----------------------------------------------------------
  // DEBUG INFORMATION
  // ----------------------------------------------------------

  try {

    const debug =
      await page.evaluate(
        () => {

          const textareas =
            [
              ...document.querySelectorAll(
                'textarea'
              )
            ];

          const annotationHeadings =
            [
              ...document.querySelectorAll(
                '*'
              )
            ]
              .filter(
                el =>
                  (
                    el.innerText ||
                    ''
                  ).trim() ===
                  'Annotation Items'
              )
              .slice(
                0,
                10
              )
              .map(
                el => ({

                  tag:
                    el.tagName,

                  className:
                    el.className,

                  visible:
                    !!(
                      el.offsetWidth ||
                      el.offsetHeight ||
                      el.getClientRects().length
                    ),

                })
              );

          const annoAreas =
            [
              ...document.querySelectorAll(
                '.anno-area'
              )
            ]
              .map(
                el => ({

                  visible:
                    !!(
                      el.offsetWidth ||
                      el.offsetHeight ||
                      el.getClientRects().length
                    ),

                  text:
                    (
                      el.innerText ||
                      ''
                    ).slice(
                      0,
                      200
                    ),

                })
              );

          return {

            textareaCount:
              textareas.length,

            textareas:
              textareas.map(
                textarea => ({

                  name:
                    textarea.getAttribute(
                      'name'
                    ),

                  aria:
                    textarea.getAttribute(
                      'aria-label'
                    ),

                  visible:
                    !!(
                      textarea.offsetWidth ||
                      textarea.offsetHeight ||
                      textarea.getClientRects().length
                    ),

                  value:
                    textarea.value
                      ?.slice(
                        0,
                        150
                      ) ||
                    '',

                })
              ),

            annotationHeadings,

            annoAreas,

          };
        }
      );

    console.log(
      'Annotation UI debug:',
      debug
    );

  } catch {
    // Ignore debug errors.
  }

  throw new Error(
    'Annotation Result sentence area did not become ready within ' +
    `${TIMEOUT.ANNOTATION_READY / 1000} seconds.`
  );
}


// ============================================================
// WAIT FOR PLAYBACK TO START
// ============================================================

async function waitForPlaybackStart(
  taskId,
  audio
) {

  taskId =
    normalizeTaskId(
      taskId
    );

  console.log(
    `Waiting for playback ${taskId} to start...`
  );

  const deadline =
    Date.now() +
    TIMEOUT.PLAYBACK_START;

  let lastState =
    null;

  while (
    Date.now() <
    deadline
  ) {

    lastState =
      await getAudioState(
        audio
      );

    if (
      !lastState.paused &&
      !lastState.ended
    ) {

      console.log(
        `Audio ${taskId} playback started.`
      );

      return;
    }

    await sleep(200);
  }

  console.log(
    'Final playback-start state:',
    lastState
  );

  throw new Error(
    `Audio ${taskId} did not start playing within ` +
    `${TIMEOUT.PLAYBACK_START / 1000} seconds.`
  );
}


// ============================================================
// WAIT FOR PLAYBACK TO FINISH
// ============================================================

async function waitForPlaybackToFinish(
  taskId,
  audio
) {

  taskId =
    normalizeTaskId(
      taskId
    );

  console.log(
    `Waiting for task ${taskId} playback to finish...`
  );

  const deadline =
    Date.now() +
    TIMEOUT.PLAYBACK_FINISH;

  let lastPrintedSecond =
    -1;

  while (
    Date.now() <
    deadline
  ) {

    const state =
      await getAudioState(
        audio
      );

    if (
      state.ended
    ) {

      console.log(
        `Audio ${taskId} reached the end.`
      );

      addPlayedAudioDuration(
        state.duration
      );

      return;
    }

    if (
      Number.isFinite(
        state.duration
      ) &&
      state.duration > 0 &&
      state.currentTime >=
        state.duration - 0.15
    ) {

      console.log(
        `Audio ${taskId} reached the end.`
      );

      addPlayedAudioDuration(
        state.duration
      );

      return;
    }

    const second =
      Math.floor(
        state.currentTime
      );

    if (
      second !==
        lastPrintedSecond &&
      second % 5 ===
        0
    ) {

      console.log(
        `Task ${taskId}: ` +
        `${state.currentTime.toFixed(1)} / ` +
        `${state.duration.toFixed(1)} seconds`
      );

      lastPrintedSecond =
        second;
    }

    await sleep(250);
  }

  const finalState =
    await getAudioState(
      audio
    );

  throw new Error(
    `Audio ${taskId} did not finish within ` +
    `${TIMEOUT.PLAYBACK_FINISH / 1000} seconds.\n` +
    JSON.stringify(
      finalState,
      null,
      2
    )
  );
}


// ============================================================
// RESET AUDIO TO BEGINNING
// ============================================================
//
// Used for initial task setup/recovery.
//
// For the second playback, we use DingTalk's own
// "Replay from beginning" button instead.
//
// ============================================================

async function resetTaskAudio(
  taskId,
  audio
) {

  console.log(
    `Resetting audio ${taskId} to beginning...`
  );

  await audio.evaluate(
    el => {

      try {

        el.pause();

        el.currentTime =
          0;

      } catch {
        // Ignore if DingTalk is rebuilding
        // the audio element.
      }
    }
  );

  await sleep(300);
}


// ============================================================
// CLICK DINGTALK REPLAY FROM BEGINNING
// ============================================================
//
// DingTalk's "Replay from beginning" may either:
//
// 1. Reset the audio AND start playing automatically.
// OR
//
// 2. Reset the audio and leave it paused.
//
// We handle both cases.
//
// Returns:
//
// true  = Replay already started playback
// false = Replay reset audio but left it paused
//
// ============================================================

async function clickReplayFromBeginning(
  taskId,
  audio
) {

  console.log(
    `Clicking Replay from beginning for task ${taskId}...`
  );

  const deadline =
    Date.now() +
    TIMEOUT.PLAY_BUTTON;

  while (
    Date.now() <
    deadline
  ) {

    const replayButton =
      page.locator(
        'button[aria-label="Replay from beginning"][data-waiting="false"]'
      ).first();

    if (
      await replayButton.count() > 0
    ) {

      try {

        if (
          await replayButton.isVisible()
        ) {

          const disabled =
            await replayButton.isDisabled();

          if (
            disabled
          ) {

            await sleep(300);

            continue;
          }

          await replayButton.scrollIntoViewIfNeeded();

          await sleep(300);

          await replayButton.click();

          console.log(
            `Replay from beginning clicked for task ${taskId}.`
          );

          // --------------------------------------------------
          // IMPORTANT
          //
          // DingTalk may automatically start playback here.
          // Do NOT immediately click Play.
          // --------------------------------------------------

          const stateDeadline =
            Date.now() + 5000;

          let lastState =
            null;

          while (
            Date.now() <
            stateDeadline
          ) {

            lastState =
              await getAudioState(
                audio
              );

            // ------------------------------------------------
            // CASE 1
            //
            // Replay automatically started playback.
            // ------------------------------------------------

            if (
              !lastState.paused &&
              !lastState.ended
            ) {

              console.log(
                `Replay automatically started audio ${taskId}.`
              );

              console.log(
                'No additional Play click is required.'
              );

              return true;
            }

            // ------------------------------------------------
            // CASE 2
            //
            // Replay reset to beginning and left it paused.
            // ------------------------------------------------

            if (
              Number.isFinite(
                lastState.currentTime
              ) &&
              lastState.currentTime <=
                0.1 &&
              lastState.paused &&
              !lastState.ended
            ) {

              console.log(
                `Audio ${taskId} returned to beginning and is paused.`
              );

              console.log(
                'Play button will be clicked next.'
              );

              return false;
            }

            await sleep(100);
          }

          console.log(
            'Final replay state:',
            lastState
          );

          throw new Error(
            `Audio ${taskId} did not reach a valid replay state.`
          );
        }

      } catch (error) {

        console.log(
          'Replay button interaction still loading:',
          error.message
        );
      }
    }

    await sleep(300);
  }

  throw new Error(
    `Replay from beginning button did not become ready within ` +
    `${TIMEOUT.PLAY_BUTTON / 1000} seconds.`
  );
}


// ============================================================
// CLICK UPDATE BUTTON
// ============================================================

async function clickUpdateButton() {

  console.log(
    'Waiting for Update button...'
  );

  const deadline =
    Date.now() +
    TIMEOUT.UPDATE_BUTTON;

  while (
    Date.now() <
    deadline
  ) {

    const button =
      page.locator(
        'button[aria-label="submit"][name="submit"]'
      ).first();

    if (
      await button.count() > 0
    ) {

      try {

        if (
          await button.isVisible()
        ) {

          const disabled =
            await button.isDisabled();

          const waiting =
            await button.getAttribute(
              'data-waiting'
            );

          const text =
            (
              await button.innerText()
            ).trim();

          console.log(
            'Update button detected:',
            {
              text,
              disabled,
              waiting,
            }
          );

          if (
            disabled
          ) {

            await sleep(500);

            continue;
          }

          if (
            waiting ===
            'true'
          ) {

            await sleep(500);

            continue;
          }

          await button.scrollIntoViewIfNeeded();

          await sleep(300);

          await button.click();

          console.log(
            'Update button clicked successfully.'
          );

          // Give DingTalk time to complete the update
          // and handle any warning/notification popup.
          console.log(
            'Waiting 4 seconds for DingTalk to finish updating...'
          );

          await sleep(4000);

          console.log(
            'Update wait complete.'
          );

          return;
        }

      } catch (error) {

        console.log(
          'Update button interaction is still loading:',
          error.message
        );
      }
    }

    await sleep(300);
  }

  throw new Error(
    'Update button did not become ready within ' +
    `${TIMEOUT.UPDATE_BUTTON / 1000} seconds.`
  );
}


// ============================================================
// PLAY WITH RETRY
// ============================================================
//
// Each successful task attempt:
//
// 1. Annotation
// 2. Add trailing space
// 3. Playback #1
// 4. Replay from beginning
// 5. Playback #2
// 6. Update
//
// ============================================================

async function playWithRetry(
  taskId,
  audio
) {

  let lastError =
    null;

  for (
    let attempt = 1;
    attempt <=
      MAX_PLAYBACK_ATTEMPTS;
    attempt++
  ) {

    console.log(
      `Playback attempt ${attempt}/${MAX_PLAYBACK_ATTEMPTS} for task ${taskId}`
    );

    try {

      await bringDingTalkToForeground();

      const preState =
        await getAudioState(
          audio
        );

      console.log(
        'Pre-play audio state:',
        preState
      );

      // ------------------------------------------------------
      // Recover potentially stuck player.
      // ------------------------------------------------------

      await recoverPlaybackButton(
        taskId
      );

      // ======================================================
      // ANNOTATION
      // ======================================================

      await bringDingTalkToForeground();

      await clickAnnotationResult();

      // ======================================================
      // PLAYBACK #1
      // ======================================================

      console.log(
        `Starting playback 1/2 for task ${taskId}...`
      );

      await bringDingTalkToForeground();

      await clickMainPlayButton(
        taskId
      );

      await waitForPlaybackStart(
        taskId,
        audio
      );

      await waitForPlaybackToFinish(
        taskId,
        audio
      );

      console.log(
        `First playback of task ${taskId} completed.`
      );

      // ======================================================
      // PLAYBACK #2
      // ======================================================

      console.log(
        `Preparing second playback for task ${taskId}...`
      );

      await bringDingTalkToForeground();

      // ------------------------------------------------------
      // Use DingTalk's own Replay button.
      // ------------------------------------------------------

      const replayStarted =
        await clickReplayFromBeginning(
          taskId,
          audio
        );

      // ------------------------------------------------------
      // If Replay automatically started playback,
      // do NOT click Play again.
      //
      // Otherwise Replay only reset the audio, so click Play.
      // ------------------------------------------------------

      if (
        !replayStarted
      ) {

        console.log(
          `Replay did not automatically start ${taskId}.`
        );

        await bringDingTalkToForeground();

        await clickMainPlayButton(
          taskId
        );

      } else {

        console.log(
          `Playback 2 for ${taskId} is already running.`
        );
      }

      // ------------------------------------------------------
      // Verify Playback #2.
      // ------------------------------------------------------

      await waitForPlaybackStart(
        taskId,
        audio
      );

      await waitForPlaybackToFinish(
        taskId,
        audio
      );

      console.log(
        `Second playback of task ${taskId} completed.`
      );

      // ======================================================
      // UPDATE
      // ======================================================

      await bringDingTalkToForeground();

      await clickUpdateButton();

      console.log(
        `TASK ${taskId} UPDATE COMPLETE`
      );

      return;

    } catch (error) {

      lastError =
        error;

      console.log(
        `Playback attempt ${attempt} failed.`
      );

      console.log(
        error.message
      );

      try {

        await bringDingTalkToForeground();

        const buttonState =
          await getPlaybackButtonState();

        console.log(
          'Playback button after failed attempt:',
          buttonState
        );

      } catch {
        // Ignore recovery inspection errors.
      }

      if (
        attempt <
        MAX_PLAYBACK_ATTEMPTS
      ) {

        console.log(
          `Recovering before playback attempt ${attempt + 1}...`
        );

        try {

          await bringDingTalkToForeground();

          await resetTaskAudio(
            taskId,
            audio
          );

          await recoverPlaybackButton(
            taskId
          );

        } catch (
          recoveryError
        ) {

          console.log(
            'Recovery error:',
            recoveryError.message
          );
        }

        await sleep(1000);
      }
    }
  }

  throw lastError ||
    new Error(
      `All playback attempts failed for ${taskId}.`
    );
}


// ============================================================
// PLAY ONE TASK
// ============================================================

async function playTask(taskId) {

  taskId =
    normalizeTaskId(
      taskId
    );

  console.log(
    '\n========================================'
  );

  console.log(
    `PLAYING TASK ${taskId}`
  );

  console.log(
    '========================================\n'
  );

  // ----------------------------------------------------------
  // STEP 1
  // Open task.
  // ----------------------------------------------------------

  await openTask(
    taskId
  );

  await sleep(500);

  // ----------------------------------------------------------
  // STEP 2
  // Find correct audio.
  // ----------------------------------------------------------

  const audio =
    await waitForTaskAudio(
      taskId
    );

  // ----------------------------------------------------------
  // STEP 3
  // Verify correct audio.
  // ----------------------------------------------------------

  const initialState =
    await getAudioState(
      audio
    );

  console.log(
    'Audio state:',
    initialState
  );

  if (
    !initialState.src ||
    !initialState.src.includes(
      `/tasks/${taskId}/resolve/`
    )
  ) {

    throw new Error(
      `Wrong audio selected for task ${taskId}.`
    );
  }

  // ----------------------------------------------------------
  // STEP 4
  // Reset initial audio.
  // ----------------------------------------------------------

  await resetTaskAudio(
    taskId,
    audio
  );

  // ----------------------------------------------------------
  // STEP 5
  // Annotation + 2 playbacks + Update.
  // ----------------------------------------------------------

  await playWithRetry(
    taskId,
    audio
  );

  console.log(
    `TASK ${taskId} COMPLETE`
  );
}


// ============================================================
// TEST MODE
// ============================================================

async function testTask(
  taskId
) {

  console.log(
    '\n========================================'
  );

  console.log(
    'TEST MODE'
  );

  console.log(
    '========================================'
  );

  console.log(
    `Testing task: ${taskId}`
  );

  await moveSidebarToTop();

  await printVisibleTasks();

  await playTask(
    taskId
  );

  console.log(
    '\n========================================'
  );

  console.log(
    'TEST COMPLETE'
  );

  console.log(
    '========================================'
  );

  printTotalAudioDuration();
}


// ============================================================
// RESULT HELPERS
// ============================================================

function loadExistingResults() {

  if (
    !fs.existsSync(
      RESULTS_FILE
    )
  ) {

    return {

      startedAt:
        new Date().toISOString(),

      passes:
        PASSES,

      totalTasks:
        0,

      completed:
        [],

      failed:
        [],

    };
  }

  try {

    const raw =
      fs.readFileSync(
        RESULTS_FILE,
        'utf8'
      );

    return JSON.parse(
      raw
    );

  } catch {

    return {

      startedAt:
        new Date().toISOString(),

      passes:
        PASSES,

      totalTasks:
        0,

      completed:
        [],

      failed:
        [],

    };
  }
}


function saveResults(
  results
) {

  fs.writeFileSync(
    RESULTS_FILE,
    JSON.stringify(
      results,
      null,
      2
    )
  );
}


// ============================================================
// PROCESS ONE PASS
// ============================================================

async function processOnePass(
  tasks,
  passNumber,
  results
) {

  console.log(
    '\n##################################################'
  );

  console.log(
    `PASS ${passNumber}/${PASSES}`
  );

  console.log(
    `TOTAL TASKS: ${tasks.length}`
  );

  console.log(
    '##################################################'
  );

  for (
    let i = 0;
    i < tasks.length;
    i++
  ) {

    const taskId =
      tasks[i];

    console.log(
      '\n##################################################'
    );

    console.log(
      `PASS ${passNumber}/${PASSES} | TASK ${i + 1}/${tasks.length}: ${taskId}`
    );

    console.log(
      '##################################################'
    );

    try {

      await playTask(
        taskId
      );

      console.log(
        `Completed ${taskId} ` +
        `(${i + 1}/${tasks.length})`
      );

      results.completed.push({

        pass:
          passNumber,

        taskId,

        completedAt:
          new Date().toISOString(),

      });

      saveResults(
        results
      );

    } catch (error) {

      console.error(
        '\n========================================'
      );

      console.error(
        `ERROR ON TASK ${taskId}`
      );

      console.error(
        `PASS ${passNumber}/${PASSES}`
      );

      console.error(
        '========================================'
      );

      console.error(
        error?.stack ||
        error
      );

      results.failed.push({

        pass:
          passNumber,

        taskId,

        error:
          error?.message ||
          String(error),

        failedAt:
          new Date().toISOString(),

      });

      saveResults(
        results
      );

      // IMPORTANT:
      //
      // Do not stop the whole batch.
      // Skip this task and continue.
      //

      console.log(
        `Skipping ${taskId} and continuing to next task...`
      );

      await bringDingTalkToForeground();

      await sleep(1000);
    }
  }
}


// ============================================================
// PROCESS ALL TASKS
// ============================================================

async function processAllTasks(
  tasks
) {

  console.log(
    '\n========================================'
  );

  console.log(
    'FULL PROCESSING MODE'
  );

  console.log(
    '========================================'
  );

  // ----------------------------------------------------------
  // Filter tasks starting from START_TASK_ID.
  // ----------------------------------------------------------

  const originalTaskCount =
    tasks.length;

  if (
    originalTaskCount ===
    0
  ) {

    throw new Error(
      'tasks.json contains no tasks.'
    );
  }

  const minimumTaskId =
    tasks.reduce(
      (min, id) =>
        BigInt(id) < BigInt(min)
          ? id
          : min,
      tasks[0]
    );

  const maximumTaskId =
    tasks.reduce(
      (max, id) =>
        BigInt(id) > BigInt(max)
          ? id
          : max,
      tasks[0]
    );

  tasks =
    tasks.filter(
      taskId =>
        BigInt(taskId) >=
        BigInt(START_TASK_ID)
    );

  console.log(
    `Tasks loaded from tasks.json: ${originalTaskCount}`
  );

  console.log(
    `Minimum task ID: ${minimumTaskId}`
  );

  console.log(
    `Maximum task ID: ${maximumTaskId}`
  );

  console.log(
    `Starting from task: ${START_TASK_ID}`
  );

  console.log(
    `Tasks to process: ${tasks.length}`
  );

  if (
    tasks.length ===
    0
  ) {

    throw new Error(
      `No task IDs in tasks.json are >= ${START_TASK_ID}. ` +
      `Current range is ${minimumTaskId} -> ${maximumTaskId}.`
    );
  }

  console.log(
    `Total passes: ${PASSES}`
  );

  // Each task is played twice.
  console.log(
    `Expected playback sessions: ` +
    `${tasks.length * PASSES * 2}`
  );

  console.log(
    '========================================'
  );

  // ----------------------------------------------------------
  // Reset total audio duration for this program run.
  // ----------------------------------------------------------

  totalAudioPlayedSeconds =
    0;

  printTotalAudioDuration();

  const startedAt =
    Date.now();

  // ----------------------------------------------------------
  // Start fresh results for THIS batch execution.
  // ----------------------------------------------------------

  const results = {

    startedAt:
      new Date().toISOString(),

    passes:
      PASSES,

    totalTasks:
      tasks.length,

    expectedRecordings:
      tasks.length *
      PASSES *
      2,

    completed:
      [],

    failed:
      [],

  };

  saveResults(
    results
  );

  // ----------------------------------------------------------
  // Process all passes.
  // ----------------------------------------------------------

  for (
    let pass = 1;
    pass <= PASSES;
    pass++
  ) {

    await processOnePass(
      tasks,
      pass,
      results
    );
  }

  // ----------------------------------------------------------
  // Final statistics.
  // ----------------------------------------------------------

  const elapsedSeconds =
    (
      Date.now() -
      startedAt
    ) / 1000;

  const completed =
    results.completed.length;

  const failed =
    results.failed.length;

  results.finishedAt =
    new Date().toISOString();

  results.elapsedSeconds =
    elapsedSeconds;

  results.totalAudioPlayedSeconds =
    totalAudioPlayedSeconds;

  results.totalAudioPlayedMinutes =
    Number(
      getTotalAudioPlayedMinutes()
    );

  saveResults(
    results
  );

  console.log(
    '\n========================================'
  );

  console.log(
    'BATCH PROCESSING COMPLETE'
  );

  console.log(
    '========================================'
  );

  console.log(
    `Batch results saved to: ${RESULTS_FILE}`
  );

  console.log(
    `Total tasks: ${tasks.length}`
  );

  console.log(
    `Total passes: ${PASSES}`
  );

  console.log(
    `Expected playback sessions: ` +
    `${tasks.length * PASSES * 2}`
  );

  console.log(
    `Completed tasks: ${completed}`
  );

  console.log(
    `Failed tasks: ${failed}`
  );

  console.log(
    `Elapsed time: ${(elapsedSeconds / 60).toFixed(2)} minutes`
  );

  console.log(
    `Total duration: ${getTotalAudioPlayedMinutes()} minutes`
  );

  if (
    failed ===
    0
  ) {

    console.log(
      '🎉 ALL TASKS COMPLETED SUCCESSFULLY.'
    );

  } else {

    console.log(
      `⚠️ ${failed} task attempt(s) failed.`
    );
  }
}


// ============================================================
// MAIN
// ============================================================

async function main() {

  try {

    await connectToChrome();

    const tasks =
      loadTasks();

    totalAudioPlayedSeconds =
      0;

    console.log(
      '\n========================================'
    );

    console.log(
      'AUDIO DURATION TRACKER'
    );

    console.log(
      '========================================'
    );

    printTotalAudioDuration();

    console.log(
      '========================================'
    );

    if (
      TEST_MODE
    ) {

      await testTask(
        TEST_TASK_ID
      );

    } else {

      await processAllTasks(
        tasks
      );
    }

  } catch (error) {

    console.error(
      '\n========================================'
    );

    console.error(
      'ERROR'
    );

    console.error(
      '========================================'
    );

    console.error(
      error?.stack ||
      error
    );

    process.exitCode =
      1;

  } finally {

    try {

      if (
        browser
      ) {

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