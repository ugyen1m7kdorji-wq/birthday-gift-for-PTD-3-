# Snoopy Companion

A cute desktop companion Snoopy for Windows: a draggable pet that lives on the
desktop, a Pomodoro-style focus/break timer, a to-do list, a level/streak
system, and a cozy "study den" themed dashboard.

Rewritten from an earlier Python/PyQt version into **Tauri** (Rust backend +
HTML/CSS/JS frontend) so the shipped app is small (~10-15MB installed) and
feels native, instead of bundling a Python interpreter.

## What's in here

```
snoopy-companion/
  src/                    frontend - pet window, dashboard, break overlay
    pet.html/css/js       the floating companion (drag, speech bubble, timer pill)
    dashboard.html/css/js Overview / Study Room / Progress / To-Do / Settings
    break.html/css/js     fullscreen break reminder
    shared/                theme.css (palette), state.js (persistence + leveling), messages.js
    assets/gifs/            the six Snoopy animations
  src-tauri/               Rust backend - windows, system tray, timer engine
    src/main.rs
    Cargo.toml
    tauri.conf.json
    icons/
  .github/workflows/build.yml   builds the Windows installer in the cloud
```

## Building it (you need to do this once)

This sandbox that generated the code has Node but **not Rust**, so the actual
`.exe` compile has to happen somewhere with a Rust toolchain. Two ways to do
that - pick whichever is easier for you:

### Option A: Build in the cloud (no installs on your PC)

1. Create a new **public or private GitHub repo** and push this folder to it.
2. On GitHub, go to the **Actions** tab → select **"Build Snoopy Companion
   (Windows)"** → click **"Run workflow"**.
3. Wait for it to finish (5-10 minutes), then open the run and download the
   **`snoopy-companion-windows`** artifact at the bottom. Unzip it - inside is
   the installer `.exe`.
4. Send that installer to her. She double-clicks it, and Snoopy shows up.

### Option B: Build locally on a Windows machine

1. Install [Node.js](https://nodejs.org) (LTS) and
   [Rust](https://rustup.rs) (the installer defaults are fine - it'll also
   prompt you to install the "Desktop development with C++" workload from
   Visual Studio Build Tools if you don't have it; accept that).
2. Open a terminal in this folder and run:
   ```
   npm install
   npm run build
   ```
3. The installer will be at
   `src-tauri/target/release/bundle/nsis/*.exe`.

### Trying it without building an installer (dev mode)

If you have Rust + Node installed, `npm run dev` launches the app straight
from source with hot-reload, no installer needed - good for tweaking things.

## Customizing before you send it

- **Messages**: `src/shared/messages.js` - the speech bubble lines. Make them
  more personal to her if you'd like.
- **Colors**: `src/shared/theme.css` - the "Study Den" palette (warm cream +
  Snoopy red + mustard yellow). All five windows pull from these variables.
- **Timer defaults**: `src/shared/state.js` → `defaultState()` → `settings`
  (default is 25 min focus / 5 min break, adjustable in-app too).
- **App icon / installer name**: `src-tauri/tauri.conf.json`
  (`productName`) and `src-tauri/icons/`.

## Known limitations (honest list)

- **Window is a fixed rectangle, not per-pixel transparent-click-through.**
  The pet window is a small 220×340 box; clicking anywhere in that box
  (including the transparent padding around Snoopy) interacts with the app
  rather than clicking through to the desktop underneath. True per-pixel
  click-through is possible in Tauri but needs extra platform-specific work
  I didn't implement here.
- **Drag detection is simple.** Any left-click-drag on the sprite starts a
  window drag; a plain click pets him. This works well in practice but
  hasn't been tested against every edge case (e.g. very fast double-clicks).
- **No code-signing.** Windows SmartScreen will likely show an "unknown
  publisher" warning the first time she opens the installer. That's normal
  for an unsigned indie app - she just clicks "More info" → "Run anyway."
  Getting rid of that warning requires a paid code-signing certificate.
- **I could not compile or run this Tauri app myself** (no Rust toolchain in
  the environment I built it in). I syntax-checked all the JS, unit-tested
  the state/leveling logic in Node, and visually tested every window's HTML/
  CSS/JS in a real browser with the Tauri APIs mocked out - but the Rust
  side (`main.rs`, window/tray/timer wiring) has only been carefully
  reviewed by hand against the Tauri v2 API, not compiled. If `npm run
build` (or the GitHub Action) throws a Rust compile error, paste it back
  to me and I'll fix it - that's a normal part of shipping Rust code I
  couldn't execute myself.
