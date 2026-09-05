import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { loadState, saveState, onStateChanged, applyXp, recordFocusMinutes, defaultState } from './shared/state.js';
import { MESSAGES, randomFrom } from './shared/messages.js';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

// IMPORTANT: grab elements + wire up dragging/clicking/buttons FIRST, and do
// it synchronously (no awaits above this point). Everything below this line
// used to sit ABOVE the drag/click listeners, behind a couple of un-guarded
// `await`s (notification permission + state store load). If either of those
// throws - e.g. the notification permission prompt gets denied/blocked, or
// the state store can't be read/written yet on a fresh install - a module
// script just stops executing at the point of the error. Every listener
// defined further down (drag, petting, toolbar buttons, context menu) would
// then simply never get attached, which is exactly "nothing responds at
// all". Attaching the UI listeners up front means the pet is always
// draggable/clickable even if notifications or the store misbehave.

const win = getCurrentWindow();

const sprite = document.getElementById('sprite');
const spriteOverlay = document.getElementById('sprite-overlay');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const pill = document.getElementById('pill');
const pillLabel = document.getElementById('pill-label');
const pillTime = document.getElementById('pill-time');
const toolFocusBtn = document.getElementById('tool-focus');
const todoBadge = document.getElementById('todo-badge');
const ctxMenu = document.getElementById('ctx-menu');

let notifsReady = false;
let state = defaultState();
let timerMode = 'Idle';
let remaining = 0;
let transientSprite = null;
let transientUntil = 0;
let bubbleTimer = null;

// ---------- sprite / visual state ----------
//
// Each state below can list ONE OR MORE gif variants. With one entry it
// behaves exactly like before. Add more filenames (they must exist as
// assets/gifs/<file>.gif) and the pet will rotate between them - on every
// state change, and periodically while sitting in the same state - instead
// of looping one clip forever. This is purely config: no other code needs
// to change when you add art.
const SPRITE_VARIANTS = {
  // DEMO: 'normal' now rotates between 3 poses (the original + 2 simple
  // placeholder ones I generated) so you can SEE the rotation working
  // immediately. Swap normal-2/normal-3 for real art whenever you're ready
  // - the mechanism itself doesn't need to change.
  normal: ['normal', 'normal-2', 'normal-3'],
  happy: ['happy'],
  excited: ['excited'],
  sleepy: ['sleepy'],
  study: ['study'],
  break: ['break'],
};

// DEMO: overlay-zzz and overlay-sparkle are simple placeholder effects I
// generated (a drifting "Zzz" and a few sparkle blips) - already wired up
// so you can see an overlay rendering on top of the base sprite at the
// same time. Replace the files, keep the config, or delete these two
// lines if you don't want overlays yet.
const SPRITE_OVERLAYS = {
  sleepy: 'overlay-zzz',
  excited: 'overlay-sparkle',
};

const SPRITE_ROTATE_MS = 25000; // how often to switch variants while staying in the same state

let currentBaseState = null;
let currentVariantFile = null;
let lastRotateAt = 0;

function pickRandomVariant(stateName) {
  const variants = SPRITE_VARIANTS[stateName] && SPRITE_VARIANTS[stateName].length
    ? SPRITE_VARIANTS[stateName]
    : [stateName];
  if (variants.length === 1) return variants[0];
  const others = variants.filter((v) => v !== currentVariantFile);
  return others[Math.floor(Math.random() * others.length)] || variants[0];
}

function setSprite(stateName, fileBase) {
  const target = `assets/gifs/${fileBase}.gif`;
  if (sprite.src.endsWith(target)) return;
  currentVariantFile = fileBase;
  // If a variant file hasn't been drawn yet (404), fall back to that
  // state's first/base file instead of showing a broken image icon.
  sprite.onerror = () => {
    const fallback = (SPRITE_VARIANTS[stateName] || [stateName])[0];
    const fallbackTarget = `assets/gifs/${fallback}.gif`;
    if (!sprite.src.endsWith(fallbackTarget)) {
      currentVariantFile = fallback;
      sprite.src = fallbackTarget;
    }
  };
  sprite.src = target;
}

function setOverlay(stateName) {
  const overlayName = SPRITE_OVERLAYS[stateName];
  if (!overlayName) {
    spriteOverlay.classList.remove('visible');
    return;
  }
  const target = `assets/gifs/${overlayName}.gif`;
  if (!spriteOverlay.src.endsWith(target)) {
    spriteOverlay.onerror = () => spriteOverlay.classList.remove('visible');
    spriteOverlay.src = target;
  }
  spriteOverlay.classList.remove('hidden');
  spriteOverlay.classList.add('visible');
}

function baseSprite() {
  if (timerMode === 'Focus' || timerMode === 'PausedFocus') return 'study';
  if (timerMode === 'Break' || timerMode === 'PausedBreak') return 'break';
  const h = new Date().getHours();
  if (h >= 23 || h < 6) return 'sleepy';
  return 'normal';
}

function refreshSprite() {
  const now = Date.now();
  let stateName;
  if (transientSprite && now < transientUntil) {
    stateName = transientSprite;
  } else {
    transientSprite = null;
    stateName = baseSprite();
  }

  const stateChanged = stateName !== currentBaseState;
  const rotationDue = now - lastRotateAt > SPRITE_ROTATE_MS;

  if (stateChanged || rotationDue || !currentVariantFile) {
    currentBaseState = stateName;
    lastRotateAt = now;
    setSprite(stateName, pickRandomVariant(stateName));
  }
  if (stateChanged) setOverlay(stateName);
}

function triggerTransient(name, ms) {
  transientSprite = name;
  transientUntil = Date.now() + ms;
  refreshSprite();
}

setInterval(refreshSprite, 1000);

// ---------- speech bubble ----------

function showBubble(text, ms = 4200) {
  bubbleText.textContent = text;
  bubble.classList.remove('hidden');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), ms);
}

setInterval(() => {
  if (timerMode === 'Focus') showBubble(randomFrom(MESSAGES.focusTick));
  else if (timerMode === 'Idle') showBubble(randomFrom(MESSAGES.idle));
}, 25000);

// ---------- timer pill ----------

function fmt(totalSeconds) {
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function updatePill() {
  pill.classList.remove('focus', 'break', 'hidden');
  if (timerMode === 'Focus' || timerMode === 'PausedFocus') {
    pill.classList.add('focus');
    pillLabel.textContent = timerMode === 'PausedFocus' ? 'PAUSED ' : 'FOCUS ';
    pillTime.textContent = fmt(remaining);
    toolFocusBtn.textContent = timerMode === 'PausedFocus' ? '▶' : '⏸';
  } else if (timerMode === 'Break' || timerMode === 'PausedBreak') {
    pill.classList.add('break');
    pillLabel.textContent = timerMode === 'PausedBreak' ? 'PAUSED ' : 'BREAK ';
    pillTime.textContent = fmt(remaining);
    toolFocusBtn.textContent = '▶';
  } else {
    pill.classList.add('hidden');
    toolFocusBtn.textContent = '▶';
  }
}

pill.addEventListener('click', () => {
  if (timerMode === 'Focus' || timerMode === 'Break') invoke('pause_timer');
  else if (timerMode === 'PausedFocus' || timerMode === 'PausedBreak') invoke('resume_timer');
});

// ---------- todo badge ----------

function updateTodoBadge() {
  const open = state.todos.filter((t) => !t.done).length;
  todoBadge.textContent = String(open);
  todoBadge.classList.toggle('hidden', open === 0);
}

// ---------- dragging + petting ----------

sprite.addEventListener('mousedown', async (e) => {
  if (e.button !== 0) return;
  await win.startDragging();
});

sprite.addEventListener('click', async () => {
  const prevLevel = state.level;
  applyXp(state, 5);
  state.pettingCountToday += 1;
  if (state.level > prevLevel) {
    triggerTransient('happy', 3000);
    showBubble(randomFrom(MESSAGES.levelUp));
  } else {
    triggerTransient('excited', 2200);
    showBubble(randomFrom(MESSAGES.petted));
  }
  sprite.classList.add('pop');
  setTimeout(() => sprite.classList.remove('pop'), 200);
  await saveState(state);
});

// ---------- hover toolbar ----------

toolFocusBtn.addEventListener('click', () => {
  if (timerMode === 'Idle') {
    invoke('start_focus', { minutes: state.settings.focusMinutes });
    showBubble(randomFrom(MESSAGES.focusStart));
  } else if (timerMode === 'Focus') {
    invoke('pause_timer');
  } else if (timerMode === 'PausedFocus') {
    invoke('resume_timer');
  } else {
    invoke('stop_timer');
  }
});

document.getElementById('tool-todo').addEventListener('click', () => {
  invoke('show_dashboard', { tab: 'todo' });
});
document.getElementById('tool-dash').addEventListener('click', () => {
  invoke('show_dashboard', { tab: 'overview' });
});

// ---------- context menu ----------

document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  ctxMenu.style.left = `${e.clientX}px`;
  ctxMenu.style.top = `${e.clientY}px`;
  ctxMenu.classList.remove('hidden');
});
document.addEventListener('click', (e) => {
  if (!ctxMenu.contains(e.target)) ctxMenu.classList.add('hidden');
});
ctxMenu.addEventListener('click', (e) => {
  const action = e.target.dataset.action;
  if (!action) return;
  ctxMenu.classList.add('hidden');
  switch (action) {
    case 'focus':
      invoke('start_focus', { minutes: state.settings.focusMinutes });
      showBubble(randomFrom(MESSAGES.focusStart));
      break;
    case 'todo':
      invoke('show_dashboard', { tab: 'todo' });
      break;
    case 'settings':
      invoke('show_dashboard', { tab: 'settings' });
      break;
    case 'dashboard':
      invoke('show_dashboard', { tab: 'overview' });
      break;
    case 'hide':
      win.hide();
      break;
    case 'quit':
      invoke('quit_app');
      break;
  }
});

// ---------- backend events ----------
// Everything from here down is async initialization. It's wrapped so that
// if any single piece fails (notification permission, store I/O, an event
// listener registration), it's logged instead of silently killing the rest
// of the pet window's behavior - the drag/click/toolbar/context-menu
// listeners above are already attached by this point regardless.

try {
  await listen('timer-tick', (event) => {
    timerMode = event.payload.mode;
    remaining = event.payload.remaining_seconds;
    updatePill();
    refreshSprite();
  });

  await listen('focus-complete', async () => {
    try {
      state = await loadState();
    } catch (err) {
      console.error('Snoopy: failed to reload state on focus-complete', err);
    }
    state.stats.sessionsCompleted += 1;
    state.stats.totalFocusMinutes += state.settings.focusMinutes;
    state.stats.todayFocusMinutes += state.settings.focusMinutes;
    recordFocusMinutes(state, state.settings.focusMinutes);
    const prevLevel = state.level;
    applyXp(state, 20);
    try {
      await saveState(state);
    } catch (err) {
      console.error('Snoopy: failed to save state on focus-complete', err);
    }
    showBubble(randomFrom(MESSAGES.focusComplete));
    if (notifsReady) {
      try {
        sendNotification({ title: 'Snoopy', body: 'Focus session complete! Nice work. 🐶' });
      } catch (err) {
        console.error('Snoopy: notification failed', err);
      }
    }
    if (state.level > prevLevel) {
      triggerTransient('happy', 3200);
      setTimeout(() => showBubble(randomFrom(MESSAGES.levelUp)), 1500);
    }
    if (state.settings.autoStartBreak) {
      invoke('start_break', { minutes: state.settings.breakMinutes });
      setTimeout(() => showBubble(randomFrom(MESSAGES.breakStart)), 1600);
    }
  });

  await listen('break-complete', async () => {
    showBubble(randomFrom(MESSAGES.breakComplete));
    await invoke('close_break_overlay');
  });

  onStateChanged((newState) => {
    state = newState;
    updateTodoBadge();
  });
} catch (err) {
  console.error('Snoopy: failed to register backend event listeners', err);
}

// ---------- notifications ----------

try {
  notifsReady = await isPermissionGranted();
  if (!notifsReady) {
    const perm = await requestPermission();
    notifsReady = perm === 'granted';
  }
} catch (err) {
  console.error('Snoopy: notification permission check failed', err);
  notifsReady = false;
}

// ---------- state ----------

try {
  state = await loadState();
  updateTodoBadge();
} catch (err) {
  console.error('Snoopy: failed to load saved state, using defaults', err);
}

// ---------- boot ----------

(async () => {
  try {
    const [mode, secs] = await invoke('get_timer_state');
    timerMode = mode;
    remaining = secs;
  } catch (err) {
    console.error('Snoopy: failed to fetch timer state from backend', err);
  }
  updatePill();
  refreshSprite();
  updateTodoBadge();
  if (timerMode === 'Idle') showBubble(randomFrom(MESSAGES.idle), 3500);
})();
