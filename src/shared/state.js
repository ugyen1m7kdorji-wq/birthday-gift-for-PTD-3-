import { Store } from '@tauri-apps/plugin-store';
import { emit, listen } from '@tauri-apps/api/event';

const STORE_FILE = 'snoopy-state.json';
let _store = null;

export function defaultState() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    xp: 0,
    level: 1,
    streakDays: 0,
    lastActiveDate: today,
    pettingCountToday: 0,
    todos: [],
    settings: {
      focusMinutes: 25,
      breakMinutes: 5,
      soundOn: true,
      autoStartBreak: true,
      launchAtLogin: false,
    },
    stats: {
      totalFocusMinutes: 0,
      sessionsCompleted: 0,
      todayFocusMinutes: 0,
      todayDate: today,
    },
    history: [], // [{date: 'YYYY-MM-DD', minutes: number}]
  };
}

async function getStore() {
  if (!_store) {
    _store = await Store.load(STORE_FILE, { autoSave: 300 });
  }
  return _store;
}

export async function loadState() {
  const store = await getStore();
  const existing = await store.get('state');
  if (!existing) {
    const fresh = defaultState();
    await store.set('state', fresh);
    await store.save();
    return fresh;
  }
  // merge with defaults so new fields introduced by app updates don't crash old saves
  const merged = deepMerge(defaultState(), existing);
  return rolloverDailyFields(merged);
}

export async function saveState(state, { broadcast = true } = {}) {
  const store = await getStore();
  await store.set('state', state);
  await store.save();
  if (broadcast) {
    await emit('state-changed', state);
  }
}

export function onStateChanged(callback) {
  return listen('state-changed', (event) => callback(event.payload));
}

function deepMerge(base, override) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const key of Object.keys(base)) {
    if (
      typeof base[key] === 'object' &&
      base[key] !== null &&
      !Array.isArray(base[key]) &&
      typeof override[key] === 'object' &&
      override[key] !== null
    ) {
      out[key] = deepMerge(base[key], override[key]);
    } else if (key in override) {
      out[key] = override[key];
    }
  }
  // keep any extra keys already in override (e.g. todos with ids)
  for (const key of Object.keys(override)) {
    if (!(key in out)) out[key] = override[key];
  }
  return out;
}

function rolloverDailyFields(state) {
  const today = new Date().toISOString().slice(0, 10);
  if (state.stats.todayDate !== today) {
    state.stats.todayDate = today;
    state.stats.todayFocusMinutes = 0;
    state.pettingCountToday = 0;
  }
  if (state.lastActiveDate !== today) {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yesterday = y.toISOString().slice(0, 10);
    state.streakDays = state.lastActiveDate === yesterday ? state.streakDays + 1 : 1;
    state.lastActiveDate = today;
  }
  return state;
}

// ---- leveling ----
export function xpForLevel(level) {
  return 50 * level * level; // gentle curve: 50, 200, 450, 800...
}

export function applyXp(state, amount) {
  state.xp += amount;
  while (state.xp >= xpForLevel(state.level)) {
    state.xp -= xpForLevel(state.level);
    state.level += 1;
  }
  return state;
}

export function levelProgress(state) {
  const need = xpForLevel(state.level);
  return { current: state.xp, need, pct: Math.min(100, Math.round((state.xp / need) * 100)) };
}

export function recordFocusMinutes(state, minutes) {
  const today = new Date().toISOString().slice(0, 10);
  const entry = state.history.find((h) => h.date === today);
  if (entry) entry.minutes += minutes;
  else state.history.push({ date: today, minutes });
  state.history = state.history.slice(-30);
  return state;
}

export function last7Days(state) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const entry = state.history.find((h) => h.date === key);
    days.push({
      date: key,
      label: d.toLocaleDateString(undefined, { weekday: 'short' }),
      minutes: entry ? entry.minutes : 0,
    });
  }
  return days;
}
