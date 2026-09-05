import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  loadState,
  saveState,
  onStateChanged,
  defaultState,
  levelProgress,
  last7Days,
} from './shared/state.js';
import { enable as enableAutostart, disable as disableAutostart } from '@tauri-apps/plugin-autostart';

// NOTE: state/timer are loaded further down, guarded in try/catch. All tab
// switching, buttons, and inputs get their listeners attached first and
// synchronously below, so a failure loading state or reaching the backend
// can't leave the whole dashboard window unresponsive - it previously sat
// behind two un-guarded top-level `await`s that, if either threw, silently
// skipped every listener registration for the rest of the file.
let state = defaultState();
let timerMode = 'Idle';
let remaining = 0;

// ---------- tabs ----------

const tabButtons = [...document.querySelectorAll('.tab-btn')];
const panels = [...document.querySelectorAll('.tab-panel')];

function switchTab(name) {
  tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  panels.forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`));
  if (name === 'room') renderRoom();
}

tabButtons.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

const urlTab = new URLSearchParams(location.search).get('tab');
switchTab(urlTab && document.getElementById(`panel-${urlTab}`) ? urlTab : 'overview');

// ---------- overview ----------

const ovTimer = document.getElementById('ov-timer');
const ovModeLabel = document.getElementById('ov-mode-label');
const ovStart = document.getElementById('ov-start');
const ovPause = document.getElementById('ov-pause');
const ovStop = document.getElementById('ov-stop');

function fmt(totalSeconds) {
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function renderOverview() {
  const running = timerMode === 'Focus' || timerMode === 'Break';
  const paused = timerMode === 'PausedFocus' || timerMode === 'PausedBreak';
  if (running || paused) {
    ovTimer.textContent = fmt(remaining);
  } else {
    ovTimer.textContent = fmt(state.settings.focusMinutes * 60);
  }
  const labels = {
    Idle: 'Not started',
    Focus: 'Focusing...',
    Break: 'On a break',
    PausedFocus: 'Focus paused',
    PausedBreak: 'Break paused',
  };
  ovModeLabel.textContent = labels[timerMode] ?? 'Not started';

  ovStart.disabled = running || paused;
  ovPause.disabled = !(running || paused);
  ovStop.disabled = !(running || paused);
  ovPause.textContent = paused ? 'Resume' : 'Pause';
}

ovStart.addEventListener('click', () => invoke('start_focus', { minutes: state.settings.focusMinutes }));
ovPause.addEventListener('click', () => {
  if (timerMode === 'PausedFocus' || timerMode === 'PausedBreak') invoke('resume_timer');
  else invoke('pause_timer');
});
ovStop.addEventListener('click', () => invoke('stop_timer'));

function renderStats() {
  document.getElementById('stat-level').textContent = `Lv. ${state.level}`;
  document.getElementById('stat-streak').textContent = String(state.streakDays);
  document.getElementById('stat-today').textContent = `${state.stats.todayFocusMinutes}m`;
  const prog = levelProgress(state);
  document.getElementById('xp-fill').style.width = `${prog.pct}%`;

  document.getElementById('pr-total').textContent = formatHours(state.stats.totalFocusMinutes);
  document.getElementById('pr-sessions').textContent = String(state.stats.sessionsCompleted);
  document.getElementById('pr-streak').textContent = String(state.streakDays);
}

function formatHours(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ---------- progress chart ----------

function renderChart() {
  const chart = document.getElementById('chart');
  const days = last7Days(state);
  const max = Math.max(1, ...days.map((d) => d.minutes));
  chart.innerHTML = '';
  for (const d of days) {
    const wrap = document.createElement('div');
    wrap.className = 'chart-bar-wrap';
    const val = document.createElement('div');
    val.className = 'chart-value';
    val.textContent = d.minutes > 0 ? `${d.minutes}m` : '';
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.style.height = `${Math.max(3, (d.minutes / max) * 100)}px`;
    const label = document.createElement('div');
    label.className = 'chart-label';
    label.textContent = d.label;
    wrap.appendChild(val);
    wrap.appendChild(bar);
    wrap.appendChild(label);
    chart.appendChild(wrap);
  }
}

// ---------- study room ----------

let roomBuilt = false;

function renderRoom() {
  const svg = document.getElementById('room-scene');
  const isNight = new Date().getHours() >= 19 || new Date().getHours() < 6;
  const paneColor = isNight ? '#3B2A1E' : '#BFE3F0';
  const celestial = isNight
    ? `<circle cx="150" cy="55" r="12" fill="#F0E6D2"/>
       <circle cx="90" cy="70" r="2" fill="#F0E6D2"/>
       <circle cx="115" cy="95" r="2" fill="#F0E6D2"/>
       <circle cx="70" cy="100" r="2" fill="#F0E6D2"/>`
    : `<circle cx="150" cy="55" r="12" fill="#F5B942"/>`;

  svg.innerHTML = `
    <defs>
      <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#F5E9D6"/>
        <stop offset="1" stop-color="#EAD9B8"/>
      </linearGradient>
    </defs>
    <rect width="700" height="320" rx="16" fill="url(#bgGrad)"/>

    <rect x="40" y="30" width="170" height="120" rx="14" fill="${paneColor}" stroke="#8B5E34" stroke-width="6"/>
    <line x1="125" y1="38" x2="125" y2="142" stroke="#8B5E34" stroke-width="4"/>
    <line x1="48" y1="90" x2="202" y2="90" stroke="#8B5E34" stroke-width="4"/>
    ${celestial}

    <rect x="0" y="272" width="700" height="48" fill="#C89B6B"/>
    ${Array.from({ length: 18 }, (_, i) => `<line x1="${i * 40}" y1="272" x2="${i * 40}" y2="320" stroke="#A97F4E" stroke-width="2"/>`).join('')}

    <rect x="260" y="190" width="380" height="20" rx="6" fill="#8B5A2B"/>
    <line x1="285" y1="210" x2="285" y2="272" stroke="#5C3A1A" stroke-width="6"/>
    <line x1="610" y1="210" x2="610" y2="272" stroke="#5C3A1A" stroke-width="6"/>

    <rect x="330" y="122" width="140" height="80" rx="10" fill="#7A6A58"/>
    <rect x="338" y="130" width="124" height="56" rx="5" fill="#6FB8D2"/>
    <rect x="318" y="200" width="164" height="10" rx="4" fill="#7A6A58"/>

    <rect x="560" y="150" width="18" height="40" fill="#D62839"/>
    <rect x="582" y="145" width="18" height="45" fill="#F5B942"/>
    <rect x="604" y="142" width="18" height="48" fill="#4C9A6A"/>

    <g id="snoopy-indicator" transform="translate(250,176)">
      <circle id="lamp-glow" r="30" fill="none" stroke="#F5B942" stroke-width="4" opacity="0"/>
      <ellipse cx="0" cy="0" rx="22" ry="16" fill="#ffffff" stroke="#241C15" stroke-width="2"/>
      <ellipse cx="14" cy="3" rx="9" ry="7" fill="#241C15"/>
      <circle cx="-6" cy="8" r="2.4" fill="#241C15"/>
      <circle cx="8" cy="8" r="2.4" fill="#241C15"/>
    </g>
  `;
  roomBuilt = true;
  animateRoom();
}

let roomAnimFrame = null;
function animateRoom() {
  if (roomAnimFrame) cancelAnimationFrame(roomAnimFrame);
  const step = () => {
    const indicator = document.getElementById('snoopy-indicator');
    const glow = document.getElementById('lamp-glow');
    if (indicator) {
      const bob = Math.sin(Date.now() / 500) * 3;
      indicator.setAttribute('transform', `translate(250, ${176 + bob})`);
    }
    if (glow) glow.setAttribute('opacity', timerMode === 'Focus' || timerMode === 'PausedFocus' ? '0.7' : '0');
    roomAnimFrame = requestAnimationFrame(step);
  };
  step();
}

// ---------- to-do ----------

const todoInput = document.getElementById('todo-input');
const todoList = document.getElementById('todo-list');

function renderTodos() {
  todoList.innerHTML = '';
  if (state.todos.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'todo-empty';
    empty.textContent = 'Nothing on your list yet — add a task above.';
    todoList.appendChild(empty);
    return;
  }
  state.todos.forEach((todo) => {
    const li = document.createElement('li');
    li.className = `todo-item${todo.done ? ' done' : ''}`;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = todo.done;
    cb.addEventListener('change', async () => {
      todo.done = cb.checked;
      await persist();
    });
    const span = document.createElement('span');
    span.textContent = todo.text;
    const del = document.createElement('button');
    del.textContent = '✕';
    del.addEventListener('click', async () => {
      state.todos = state.todos.filter((t) => t.id !== todo.id);
      await persist();
    });
    li.appendChild(cb);
    li.appendChild(span);
    li.appendChild(del);
    todoList.appendChild(li);
  });
}

async function addTodo() {
  const text = todoInput.value.trim();
  if (!text) return;
  state.todos.push({ id: crypto.randomUUID(), text, done: false });
  todoInput.value = '';
  await persist();
}

document.getElementById('todo-add').addEventListener('click', addTodo);
todoInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addTodo();
});
document.getElementById('todo-clear').addEventListener('click', async () => {
  state.todos = state.todos.filter((t) => !t.done);
  await persist();
});

// ---------- settings ----------

const setFocus = document.getElementById('set-focus');
const setBreak = document.getElementById('set-break');
const setAutobreak = document.getElementById('set-autobreak');
const setSound = document.getElementById('set-sound');
const setAutostart = document.getElementById('set-autostart');

function renderSettings() {
  setFocus.value = state.settings.focusMinutes;
  setBreak.value = state.settings.breakMinutes;
  setAutobreak.checked = state.settings.autoStartBreak;
  setSound.checked = state.settings.soundOn;
  setAutostart.checked = state.settings.launchAtLogin;
}

setFocus.addEventListener('change', async () => {
  state.settings.focusMinutes = clamp(parseInt(setFocus.value, 10) || 25, 5, 120);
  await persist();
  renderOverview();
});
setBreak.addEventListener('change', async () => {
  state.settings.breakMinutes = clamp(parseInt(setBreak.value, 10) || 5, 1, 60);
  await persist();
});
setAutobreak.addEventListener('change', async () => {
  state.settings.autoStartBreak = setAutobreak.checked;
  await persist();
});
setSound.addEventListener('change', async () => {
  state.settings.soundOn = setSound.checked;
  await persist();
});
setAutostart.addEventListener('change', async () => {
  state.settings.launchAtLogin = setAutostart.checked;
  try {
    if (setAutostart.checked) await enableAutostart();
    else await disableAutostart();
  } catch (err) {
    console.error('autostart toggle failed', err);
  }
  await persist();
});

document.getElementById('set-reset').addEventListener('click', async () => {
  const sure = confirm('Reset all progress? This clears your level, streak, stats, and to-dos. This cannot be undone.');
  if (!sure) return;
  state = defaultState();
  await persist();
  renderAll();
});

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

// ---------- persistence + render ----------

async function persist() {
  await saveState(state);
  renderAll();
}

function renderAll() {
  renderOverview();
  renderStats();
  renderChart();
  renderTodos();
  renderSettings();
  if (roomBuilt) renderRoom();
}

// ---------- async init ----------
// Everything here can legitimately fail on a fresh install (backend not
// ready yet, store I/O issue, event channel hiccup). It's guarded so a
// failure just gets logged instead of leaving tabs/buttons/inputs above
// dead - those are all already wired up by this point regardless.

try {
  onStateChanged((newState) => {
    state = newState;
    renderAll();
  });

  await listen('switch-tab', (event) => switchTab(event.payload));

  await listen('timer-tick', (event) => {
    timerMode = event.payload.mode;
    remaining = event.payload.remaining_seconds;
    renderOverview();
  });

  await listen('focus-complete', async () => {
    try {
      state = await loadState();
    } catch (err) {
      console.error('Snoopy: failed to reload state on focus-complete', err);
    }
    renderAll();
  });
  await listen('break-complete', async () => {
    try {
      state = await loadState();
    } catch (err) {
      console.error('Snoopy: failed to reload state on break-complete', err);
    }
    renderAll();
  });
} catch (err) {
  console.error('Snoopy: dashboard event listener setup failed', err);
}

try {
  state = await loadState();
} catch (err) {
  console.error('Snoopy: failed to load saved state, using defaults', err);
}

try {
  const [initMode, initRemaining] = await invoke('get_timer_state');
  timerMode = initMode;
  remaining = initRemaining;
} catch (err) {
  console.error('Snoopy: failed to fetch timer state from backend', err);
}

renderAll();
