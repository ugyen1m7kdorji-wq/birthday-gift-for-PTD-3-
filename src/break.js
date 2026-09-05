import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { MESSAGES, randomFrom } from './shared/messages.js';

const countdown = document.getElementById('countdown');
const msg = document.getElementById('break-msg');

msg.textContent = randomFrom(MESSAGES.breakStart);

function fmt(totalSeconds) {
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// Wire up the button BEFORE any await - if invoke()/listen() below throws
// (backend not ready yet, event channel hiccup, etc.), "End Break" still
// works instead of becoming a dead button.
document.getElementById('end-break').addEventListener('click', () => {
  invoke('stop_timer');
});

try {
  const [mode, remaining] = await invoke('get_timer_state');
  if (mode === 'Break' || mode === 'PausedBreak') countdown.textContent = fmt(remaining);

  await listen('timer-tick', (event) => {
    if (event.payload.mode === 'Break' || event.payload.mode === 'PausedBreak') {
      countdown.textContent = fmt(event.payload.remaining_seconds);
    }
  });
} catch (err) {
  console.error('Snoopy: break overlay init failed', err);
}
