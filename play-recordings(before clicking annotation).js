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

// Keep TRUE while testing one task.
//
// Set to false for all tasks.
const TEST_MODE = false;

// Used only when TEST_MODE = true.
const TEST_TASK_ID = '84113362';

// ------------------------------------------------------------
// NUMBER OF FULL PASSES
// ------------------------------------------------------------

// 2 means:
// Pass 1 -> all tasks
// Pass 2 -> all tasks again
const PASSES = 5;

// ------------------------------------------------------------
// RETRY SETTINGS
// ------------------------------------------------------------

// Maximum playback attempts per task per pass.
const MAX_PLAYBACK_ATTEMPTS = 3;

// ------------------------------------------------------------
// TIMEOUTS
// ------------------------------------------------------------

const TIMEOUT = {

  TASK_RENDER: 15000,

  TASK_SWITCH: 15000,

  AUDIO_LOAD: 30000,

  PLAY_BUTTON: 15000,

  PLAYBACK_START: 10000,

  PLAYBACK_FINISH: 120000,

};


// ============================================================
// GLOBALS
// ============================================================

let browser;
let context;
let page;
let sidebar;


// ============================================================
// RESULTS
// ============================================================

const results = {

  startedAt:
    new Date().toISOString(),

  passes: [],

  completed: [],

  failed: [],

};


// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {

  return new Promise(
    resolve => setTimeout(resolve, ms)
  );

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
    pages.find(p =>
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

  await focusDingTalkPage();

  await findVirtualScrollContainer();

}


// ============================================================
// BRING DINGTALK PAGE TO FOREGROUND
// ============================================================

async function focusDingTalkPage() {

  if (!page) {
    return;
  }

  try {

    console.log(
      'Bringing DingTalk tab to foreground...'
    );

    await page.bringToFront();

    await sleep(300);

    console.log(
      'DingTalk tab is visible and active.'
    );

  } catch (error) {

    console.log(
      'Could not bring DingTalk tab to foreground:',
      error.message
    );

  }

}


// ============================================================
// FIND VIRTUAL SCROLL CONTAINER
// ============================================================

async function findVirtualScrollContainer() {

  sidebar =
    await page.evaluateHandle(() => {

      const elements =
        [...document.querySelectorAll('*')];

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

      const taskContainer =
        candidates.find(el =>
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

  if (!fs.existsSync(
    TASKS_FILE
  )) {

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

    tasks = parsed;

  } else if (
    Array.isArray(parsed.tasks)
  ) {

    tasks = parsed.tasks;

  } else {

    throw new Error(
      'tasks.json must contain an array or an object with a "tasks" array.'
    );

  }

  const taskIds =
    tasks

      .map(task => {

        if (
          typeof task === 'string'
        ) {

          return task;

        }

        if (
          typeof task === 'number'
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
    [...new Set(taskIds)];

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
// GET CURRENT TASK FROM TOP BAR
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

      el.scrollTop = 0;

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
            match
              ? match[1]
              : null;

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
        item => item.taskId
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

  console.table(tasks);

  return tasks;

}


// ============================================================
// FIND RENDERED TASK
// ============================================================

async function findRenderedTask(
  taskId
) {

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

          found: true,

          checked:
            checkbox.getAttribute(
              'aria-checked'
            ) === 'true',

        };

      }

      return {
        found: false
      };

    },
    taskId
  );

}


// ============================================================
// SCROLL SIDEBAR
// ============================================================

async function scrollSidebar(
  amount
) {

  await page.evaluate(
    amount => {

      const elements =
        [
          ...document.querySelectorAll('*')
        ];

      const candidates =
        elements.filter(el => {

          const style =
            getComputedStyle(el);

          return (

            (
              style.overflowY === 'auto' ||
              style.overflowY === 'scroll'
            ) &&

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

async function locateTask(
  taskId
) {

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

  if (result.found) {

    console.log(
      `Task ${taskId} is currently rendered.`
    );

    return result;

  }

  await moveSidebarToTop();

  const maxScrolls = 100;

  for (
    let i = 0;
    i < maxScrolls;
    i++
  ) {

    result =
      await findRenderedTask(
        taskId
      );

    if (result.found) {

      console.log(
        `Task ${taskId} is currently rendered.`
      );

      return result;

    }

    const before =
      await page.evaluate(() => {

        const elements =
          [
            ...document.querySelectorAll('*')
          ];

        const candidates =
          elements.filter(el => {

            const style =
              getComputedStyle(el);

            return (

              (
                style.overflowY === 'auto' ||
                style.overflowY === 'scroll'
              ) &&

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

      });

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
      await page.evaluate(() => {

        const elements =
          [
            ...document.querySelectorAll('*')
          ];

        const candidates =
          elements.filter(el => {

            const style =
              getComputedStyle(el);

            return (

              (
                style.overflowY === 'auto' ||
                style.overflowY === 'scroll'
              ) &&

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

      });

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

async function clickTaskRow(
  taskId
) {

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

            success: false,

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

            success: false,

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

            success: false,

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

        // cells[0] = checkbox
        // cells[1] = normal numeric cell
        // cells[2] = mini audio player
        //
        // We deliberately click cells[1].

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

            success: false,

            reason:
              'clickable-cell-not-found',

          };

        }

        clickableCell.click();

        return {

          success: true,

          cellCount:
            cells.length,

        };

      },
      taskId
    );

  if (!clicked.success) {

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

async function waitForTaskSwitch(
  taskId
) {

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

async function openTask(
  taskId
) {

  taskId =
    normalizeTaskId(
      taskId
    );

  console.log(
    `\nOpening task ${taskId}...`
  );

  await focusDingTalkPage();

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

async function findTaskAudio(
  taskId
) {

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

async function waitForTaskAudio(
  taskId
) {

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

  let stableSince = null;

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

    if (count > 0) {

      try {

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
            stableSince === null
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

          // Require stable audio for 1.5 sec.
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

      } catch {

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

async function getAudioState(
  audio
) {

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
// GET MAIN DINGTALK PLAYBACK BUTTON
// ============================================================
//
// IMPORTANT:
//
// We deliberately DO NOT require
//
// data-testid="playback-button:play"
//
// here.
//
// DingTalk can temporarily enter this strange state:
//
// aria-label = "Play"
// data-testid = "playback-button:pause"
//
// We need to detect that state ourselves.

async function getMainPlaybackButton() {

  const buttons =
    page.locator(
      'button[data-testid^="playback-button:"]'
    );

  const count =
    await buttons.count();

  if (!count) {

    return null;

  }

  for (
    let i = 0;
    i < count;
    i++
  ) {

    const button =
      buttons.nth(i);

    try {

      if (
        !(await button.isVisible())
      ) {

        continue;

      }

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

      return {

        button,

        state,

      };

    } catch {

      continue;

    }

  }

  return null;

}


// ============================================================
// WAIT FOR MAIN PLAY BUTTON
// ============================================================

async function waitForMainPlayButton() {

  const deadline =
    Date.now() +
    TIMEOUT.PLAY_BUTTON;

  let stableSince = null;

  while (
    Date.now() <
    deadline
  ) {

    const result =
      await getMainPlaybackButton();

    if (result) {

      const {
        state
      } = result;

      if (
        state.disabled
      ) {

        stableSince =
          null;

      } else {

        // Genuine Play state.
        if (
          state.ariaLabel ===
            'Play' &&
          state.testId ===
            'playback-button:play'
        ) {

          if (
            stableSince === null
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

            return result.button;

          }

        } else {

          stableSince =
            null;

        }

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
// RESET INCONSISTENT PLAYBACK BUTTON
// ============================================================
//
// Handles:
//
// aria-label = Play
// data-testid = playback-button:pause
//
// This means DingTalk thinks the player is somehow
// in the pause state internally even though the UI
// label says Play.

async function recoverPlaybackButton(
  taskId
) {

  console.log(
    `Attempting playback-button recovery for ${taskId}...`
  );

  await focusDingTalkPage();

  const result =
    await getMainPlaybackButton();

  if (!result) {

    console.log(
      'No main playback button found during recovery.'
    );

    return false;

  }

  console.log(
    'Playback button during recovery:',
    result.state
  );

  const {
    button,
    state
  } = result;

  if (
    state.disabled
  ) {

    console.log(
      'Playback button is disabled.'
    );

    return false;

  }

  // ----------------------------------------------------------
  // Strange DingTalk state:
  //
  // aria-label = Play
  // data-testid = playback-button:pause
  //
  // Click once to reset it.
  // ----------------------------------------------------------

  if (
    state.testId ===
      'playback-button:pause'
  ) {

    console.log(
      'Detected inconsistent Pause-state button.'
    );

    console.log(
      'Clicking button once to reset DingTalk...'
    );

    try {

      await button.click();

      await sleep(1000);

      console.log(
        'Playback button reset attempt completed.'
      );

      return true;

    } catch (error) {

      console.log(
        'Could not reset playback button:',
        error.message
      );

      return false;

    }

  }

  return true;

}


// ============================================================
// CLICK MAIN PLAY BUTTON
// ============================================================

async function clickMainPlayButton(
  taskId
) {

  await focusDingTalkPage();

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
    state.ariaLabel !== 'Play' ||
    state.testId !==
      'playback-button:play'
  ) {

    throw new Error(
      `Playback button is not in genuine Play state. ` +
      `Current state: ${JSON.stringify(state)}`
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

  let lastState = null;

  while (
    Date.now() <
    deadline
  ) {

    try {

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

    } catch {

      // Audio element may be replaced
      // during DingTalk rendering.

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

  let lastPrintedSecond = -1;

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

      return;

    }

    const second =
      Math.floor(
        state.currentTime
      );

    if (
      second !==
        lastPrintedSecond &&
      second % 5 === 0
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
// PLAY WITH RETRY / RECOVERY
// ============================================================

async function playWithRetry(
  taskId,
  audio
) {

  taskId =
    normalizeTaskId(
      taskId
    );

  let lastError = null;

  for (
    let attempt = 1;
    attempt <=
      MAX_PLAYBACK_ATTEMPTS;
    attempt++
  ) {

    console.log(
      `Playback attempt ${attempt}/${MAX_PLAYBACK_ATTEMPTS} ` +
      `for task ${taskId}`
    );

    try {

      await focusDingTalkPage();

      // ------------------------------------------------------
      // Check that we still have the correct audio.
      // ------------------------------------------------------

      let state =
        await getAudioState(
          audio
        );

      console.log(
        'Pre-play audio state:',
        state
      );

      if (
        !state.src ||
        !state.src.includes(
          `/tasks/${taskId}/resolve/`
        )
      ) {

        throw new Error(
          `Wrong audio detected before playback for task ${taskId}.`
        );

      }

      // ------------------------------------------------------
      // Reset audio to beginning.
      // ------------------------------------------------------

      await audio.evaluate(
        el => {

          try {

            el.pause();

            el.currentTime = 0;

          } catch {}

        }
      );

      await sleep(300);

      // ------------------------------------------------------
      // Attempt to recover weird DingTalk button state.
      // ------------------------------------------------------

      await recoverPlaybackButton(
        taskId
      );

      // ------------------------------------------------------
      // Wait for genuine Play state.
      // ------------------------------------------------------

      await focusDingTalkPage();

      await clickMainPlayButton(
        taskId
      );

      // ------------------------------------------------------
      // Verify actual playback.
      // ------------------------------------------------------

      await waitForPlaybackStart(
        taskId,
        audio
      );

      // ------------------------------------------------------
      // Playback successfully started.
      // ------------------------------------------------------

      await waitForPlaybackToFinish(
        taskId,
        audio
      );

      return {

        success: true,

        attempts:
          attempt,

      };

    } catch (error) {

      lastError =
        error;

      console.log(
        `Playback attempt ${attempt} failed.`
      );

      console.log(
        error?.message ||
        error
      );

      // ------------------------------------------------------
      // Inspect button after failure.
      // ------------------------------------------------------

      try {

        await focusDingTalkPage();

        const button =
          await getMainPlaybackButton();

        if (button) {

          console.log(
            'Playback button after failed attempt:',
            button.state
          );

        }

      } catch {}

      // ------------------------------------------------------
      // If attempts remain, recover DingTalk.
      // ------------------------------------------------------

      if (
        attempt <
        MAX_PLAYBACK_ATTEMPTS
      ) {

        console.log(
          `Recovering before playback attempt ${attempt + 1}...`
        );

        try {

          await focusDingTalkPage();

          await recoverPlaybackButton(
            taskId
          );

        } catch (
          recoveryError
        ) {

          console.log(
            'Recovery error:',
            recoveryError?.message ||
            recoveryError
          );

        }

        // Give React/DingTalk time to settle.
        await sleep(1500);

      }

    }

  }

  throw lastError ||
    new Error(
      `Playback failed for task ${taskId}.`
    );

}


// ============================================================
// PLAY ONE TASK
// ============================================================

async function playTask(
  taskId
) {

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
  // Switch to requested task.
  // ----------------------------------------------------------

  await openTask(
    taskId
  );

  // Give DingTalk time to begin rebuilding
  // its main audio interface.
  await sleep(500);

  // ----------------------------------------------------------
  // STEP 2
  // Wait for THIS task's audio.
  // ----------------------------------------------------------

  let audio =
    await waitForTaskAudio(
      taskId
    );

  // ----------------------------------------------------------
  // STEP 3
  // Inspect audio.
  // ----------------------------------------------------------

  let initialState =
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
  // Make sure audio is at beginning.
  // ----------------------------------------------------------

  try {

    await audio.evaluate(
      el => {

        try {

          el.pause();

          el.currentTime = 0;

        } catch {}

      }
    );

  } catch {}

  await sleep(300);

  // ----------------------------------------------------------
  // STEP 5
  // Play with recovery.
  // ----------------------------------------------------------

  const result =
    await playWithRetry(
      taskId,
      audio
    );

  console.log(
    `TASK ${taskId} COMPLETE`
  );

  console.log(
    `Playback attempts used: ${result.attempts}`
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

  await focusDingTalkPage();

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

}


// ============================================================
// PROCESS ONE PASS
// ============================================================

async function processOnePass(
  tasks,
  passNumber
) {

  const passStartedAt =
    Date.now();

  const passResults = {

    pass:
      passNumber,

    startedAt:
      new Date().toISOString(),

    completed: [],

    failed: [],

  };

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

    console.log('\n');

    console.log(
      '##################################################'
    );

    console.log(
      `PASS ${passNumber}/${PASSES} ` +
      `| TASK ${i + 1}/${tasks.length}: ${taskId}`
    );

    console.log(
      '##################################################'
    );

    try {

      await playTask(
        taskId
      );

      passResults.completed.push(
        taskId
      );

      results.completed.push({

        taskId,

        pass:
          passNumber,

        completedAt:
          new Date().toISOString(),

      });

      console.log(
        `Completed ${taskId} ` +
        `(${i + 1}/${tasks.length})`
      );

    } catch (error) {

      const errorMessage =
        error?.message ||
        String(error);

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

      // ------------------------------------------------------
      // IMPORTANT:
      //
      // DO NOT throw.
      //
      // The task is recorded as failed and
      // processing continues to the next task.
      // ------------------------------------------------------

      passResults.failed.push({

        taskId,

        error:
          errorMessage,

        failedAt:
          new Date().toISOString(),

      });

      results.failed.push({

        taskId,

        pass:
          passNumber,

        error:
          errorMessage,

        failedAt:
          new Date().toISOString(),

      });

      console.log(
        `Skipping ${taskId} and continuing to next task...`
      );

      // ------------------------------------------------------
      // Give DingTalk a little recovery time.
      // ------------------------------------------------------

      await sleep(2000);

      try {

        await focusDingTalkPage();

      } catch {}

      continue;

    }

  }

  passResults.finishedAt =
    new Date().toISOString();

  passResults.elapsedSeconds =
    (
      Date.now() -
      passStartedAt
    ) / 1000;

  results.passes.push(
    passResults
  );

  console.log(
    '\n##################################################'
  );

  console.log(
    `PASS ${passNumber} COMPLETE`
  );

  console.log(
    `Completed: ${passResults.completed.length}`
  );

  console.log(
    `Failed: ${passResults.failed.length}`
  );

  console.log(
    `Elapsed: ${passResults.elapsedSeconds.toFixed(2)} seconds`
  );

  console.log(
    '##################################################'
  );

  return passResults;

}


// ============================================================
// SAVE RESULTS
// ============================================================

function saveResults() {

  results.finishedAt =
    new Date().toISOString();

  results.totalTasks =
    results.passes.length
      ? results.passes[0].completed.length +
        results.passes[0].failed.length
      : 0;

  results.totalCompletedEntries =
    results.completed.length;

  results.totalFailedEntries =
    results.failed.length;

  fs.writeFileSync(

    RESULTS_FILE,

    JSON.stringify(
      results,
      null,
      2
    ),

    'utf8'

  );

  console.log(
    `Batch results saved to: ${RESULTS_FILE}`
  );

}


// ============================================================
// PRINT FINAL SUMMARY
// ============================================================

function printFinalSummary(
  tasks
) {

  console.log(
    '\n'
  );

  console.log(
    '============================================================'
  );

  console.log(
    'FINAL SUMMARY'
  );

  console.log(
    '============================================================'
  );

  console.log(
    `Total tasks: ${tasks.length}`
  );

  console.log(
    `Passes requested: ${PASSES}`
  );

  for (
    const pass of results.passes
  ) {

    console.log(
      `Pass ${pass.pass}: ` +
      `${pass.completed.length} completed, ` +
      `${pass.failed.length} failed`
    );

  }

  // ----------------------------------------------------------
  // Determine which tasks failed at least once.
  // ----------------------------------------------------------

  const failedTaskIds =
    [
      ...new Set(
        results.failed.map(
          item =>
            item.taskId
        )
      )
    ];

  console.log(
    `Total failed task entries: ${results.failed.length}`
  );

  console.log(
    `Unique tasks with at least one failure: ${failedTaskIds.length}`
  );

  if (
    failedTaskIds.length
  ) {

    console.log(
      '\nFAILED TASKS:'
    );

    for (
      const taskId of failedTaskIds
    ) {

      console.log(
        `- ${taskId}`
      );

    }

    console.log(
      '\nThese tasks should be reviewed/re-run.'
    );

  } else {

    console.log(
      '\n🎉 NO TASKS FAILED.'
    );

  }

  // ----------------------------------------------------------
  // Check whether EVERY task succeeded in EVERY pass.
  // ----------------------------------------------------------

  const everyPassSucceeded =
    results.passes.length ===
      PASSES &&
    results.passes.every(
      pass =>
        pass.failed.length === 0 &&
        pass.completed.length ===
          tasks.length
    );

  console.log(
    '\n============================================================'
  );

  if (
    everyPassSucceeded
  ) {

    console.log(
      '🎉 ALL PASSES COMPLETED SUCCESSFULLY.'
    );

    console.log(
      `🎉 ${tasks.length} tasks × ${PASSES} passes completed.`
    );

  } else {

    console.log(
      'PROCESSING FINISHED WITH SOME FAILURES.'
    );

    console.log(
      'The process itself did NOT stop because of individual task failures.'
    );

  }

  console.log(
    '============================================================'
  );

}


// ============================================================
// PROCESS ALL TASKS
// ============================================================

async function processAllTasks(
  tasks
) {

  const overallStartedAt =
    Date.now();

  console.log(
    '\n========================================'
  );

  console.log(
    'FULL PROCESSING MODE'
  );

  console.log(
    '========================================'
  );

  console.log(
    `Total tasks: ${tasks.length}`
  );

  console.log(
    `Total passes: ${PASSES}`
  );

  console.log(
    `Expected recordings: ${tasks.length * PASSES}`
  );

  console.log(
    '========================================'
  );

  // ----------------------------------------------------------
  // Run every task in every pass.
  // ----------------------------------------------------------

  for (
    let pass = 1;
    pass <= PASSES;
    pass++
  ) {

    await processOnePass(
      tasks,
      pass
    );

    // Save after every pass.
    // This protects your progress if something
    // happens later.

    saveResults();

    if (
      pass < PASSES
    ) {

      console.log(
        '\n========================================'
      );

      console.log(
        `PASS ${pass} FINISHED.`
      );

      console.log(
        `Preparing for PASS ${pass + 1}...`
      );

      console.log(
        '========================================'
      );

      // Give DingTalk a little time before
      // starting the next complete cycle.

      await focusDingTalkPage();

      await sleep(3000);

    }

  }

  const elapsedSeconds =
    (
      Date.now() -
      overallStartedAt
    ) / 1000;

  results.elapsedSeconds =
    elapsedSeconds;

  saveResults();

  printFinalSummary(
    tasks
  );

}


// ============================================================
// MAIN
// ============================================================

async function main() {

  try {

    // --------------------------------------------------------
    // Connect to existing Chrome
    // --------------------------------------------------------

    await connectToChrome();

    // --------------------------------------------------------
    // Load tasks
    // --------------------------------------------------------

    const tasks =
      loadTasks();

    // --------------------------------------------------------
    // TEST MODE
    // --------------------------------------------------------

    if (
      TEST_MODE
    ) {

      await testTask(
        TEST_TASK_ID
      );

    } else {

      // ------------------------------------------------------
      // FULL MODE
      // ------------------------------------------------------

      await processAllTasks(
        tasks
      );

    }

  } catch (error) {

    console.error(
      '\n========================================'
    );

    console.error(
      'FATAL ERROR'
    );

    console.error(
      '========================================'
    );

    console.error(
      error?.stack ||
      error
    );

    process.exitCode = 1;

  } finally {

    // --------------------------------------------------------
    // Do not close the user's Chrome window.
    //
    // Disconnect from CDP instead.
    // --------------------------------------------------------

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