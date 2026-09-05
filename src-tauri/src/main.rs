// Snoopy Companion - Rust/Tauri backend
//
// Responsibilities kept here (deliberately minimal):
//   - creating/showing/hiding the three windows (pet, dashboard, break overlay)
//   - the system tray icon + menu
//   - a background Pomodoro timer thread, so focus/break countdown keeps
//     ticking accurately even if a webview window is hidden/throttled
//
// Everything else (XP, streaks, to-dos, settings values, speech bubble
// copy, which GIF to show) lives in the frontend and is persisted with
// tauri-plugin-store, since none of that needs to survive the pet window
// being closed independently of the process.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
enum TimerMode {
    Idle,
    Focus,
    Break,
    PausedFocus,
    PausedBreak,
}

#[derive(Debug)]
struct TimerState {
    mode: TimerMode,
    remaining_seconds: u64,
}

impl Default for TimerState {
    fn default() -> Self {
        TimerState {
            mode: TimerMode::Idle,
            remaining_seconds: 0,
        }
    }
}

type SharedTimer = Arc<Mutex<TimerState>>;

#[derive(Clone, Serialize)]
struct TimerTickPayload {
    mode: TimerMode,
    remaining_seconds: u64,
}

fn emit_tick(app: &AppHandle, state: &TimerState) {
    let _ = app.emit(
        "timer-tick",
        TimerTickPayload {
            mode: state.mode,
            remaining_seconds: state.remaining_seconds,
        },
    );
}

// ---------- window helpers ----------

const PET_W: f64 = 220.0;
const PET_H: f64 = 340.0;

fn show_pet_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("pet") {
        let _ = win.show();
        let _ = win.set_focus();
    } else {
        let _ = WebviewWindowBuilder::new(app, "pet", WebviewUrl::App("pet.html".into()))
            .title("Snoopy")
            .inner_size(PET_W, PET_H)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .build();
    }
}

fn open_dashboard(app: &AppHandle, tab: Option<&str>) {
    let url = match tab {
        Some(t) => format!("dashboard.html?tab={t}"),
        None => "dashboard.html".to_string(),
    };
    if let Some(win) = app.get_webview_window("dashboard") {
        let _ = win.show();
        let _ = win.set_focus();
        if let Some(t) = tab {
            let _ = app.emit_to("dashboard", "switch-tab", t);
        }
    } else {
        let _ = WebviewWindowBuilder::new(app, "dashboard", WebviewUrl::App(url.into()))
            .title("Snoopy - Dashboard")
            .inner_size(980.0, 680.0)
            .min_inner_size(760.0, 560.0)
            .resizable(true)
            .decorations(true)
            .center()
            .build();
    }
}

fn open_break_overlay(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("break") {
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    if let Some(monitor) = app.primary_monitor().ok().flatten() {
        let size = monitor.size();
        let _ = WebviewWindowBuilder::new(app, "break", WebviewUrl::App("break.html".into()))
            .title("Break time")
            .inner_size(size.width as f64, size.height as f64)
            .position(0.0, 0.0)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .build();
    } else {
        let _ = WebviewWindowBuilder::new(app, "break", WebviewUrl::App("break.html".into()))
            .title("Break time")
            .inner_size(900.0, 600.0)
            .always_on_top(true)
            .decorations(false)
            .transparent(true)
            .build();
    }
}

// ---------- commands invoked from the frontend ----------

#[tauri::command]
fn start_focus(app: AppHandle, timer: tauri::State<SharedTimer>, minutes: u64) {
    let mut s = timer.lock().unwrap();
    s.mode = TimerMode::Focus;
    s.remaining_seconds = minutes * 60;
    emit_tick(&app, &s);
}

#[tauri::command]
fn start_break(app: AppHandle, timer: tauri::State<SharedTimer>, minutes: u64) {
    let mut s = timer.lock().unwrap();
    s.mode = TimerMode::Break;
    s.remaining_seconds = minutes * 60;
    emit_tick(&app, &s);
    open_break_overlay(&app);
}

#[tauri::command]
fn pause_timer(app: AppHandle, timer: tauri::State<SharedTimer>) {
    let mut s = timer.lock().unwrap();
    s.mode = match s.mode {
        TimerMode::Focus => TimerMode::PausedFocus,
        TimerMode::Break => TimerMode::PausedBreak,
        other => other,
    };
    emit_tick(&app, &s);
}

#[tauri::command]
fn resume_timer(app: AppHandle, timer: tauri::State<SharedTimer>) {
    let mut s = timer.lock().unwrap();
    s.mode = match s.mode {
        TimerMode::PausedFocus => TimerMode::Focus,
        TimerMode::PausedBreak => TimerMode::Break,
        other => other,
    };
    emit_tick(&app, &s);
}

#[tauri::command]
fn stop_timer(app: AppHandle, timer: tauri::State<SharedTimer>) {
    let mut s = timer.lock().unwrap();
    s.mode = TimerMode::Idle;
    s.remaining_seconds = 0;
    emit_tick(&app, &s);
    if let Some(win) = app.get_webview_window("break") {
        let _ = win.close();
    }
}

#[tauri::command]
fn get_timer_state(timer: tauri::State<SharedTimer>) -> (TimerMode, u64) {
    let s = timer.lock().unwrap();
    (s.mode, s.remaining_seconds)
}

#[tauri::command]
fn show_dashboard(app: AppHandle, tab: Option<String>) {
    open_dashboard(&app, tab.as_deref());
}

#[tauri::command]
fn close_break_overlay(app: AppHandle) {
    if let Some(win) = app.get_webview_window("break") {
        let _ = win.close();
    }
}

#[tauri::command]
fn show_pet(app: AppHandle) {
    show_pet_window(&app);
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

fn main() {
    let timer_state: SharedTimer = Arc::new(Mutex::new(TimerState::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(timer_state.clone())
        .invoke_handler(tauri::generate_handler![
            start_focus,
            start_break,
            pause_timer,
            resume_timer,
            stop_timer,
            get_timer_state,
            show_dashboard,
            close_break_overlay,
            show_pet,
            quit_app,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();

            // Background countdown thread - the single source of truth for
            // timer accuracy, independent of any webview being visible.
            let tick_timer = timer_state.clone();
            let tick_handle = handle.clone();
            thread::spawn(move || loop {
                thread::sleep(Duration::from_secs(1));
                let mut s = tick_timer.lock().unwrap();
                let is_running = matches!(s.mode, TimerMode::Focus | TimerMode::Break);
                if is_running && s.remaining_seconds > 0 {
                    s.remaining_seconds -= 1;
                    emit_tick(&tick_handle, &s);
                    if s.remaining_seconds == 0 {
                        let finished_mode = s.mode;
                        s.mode = TimerMode::Idle;
                        emit_tick(&tick_handle, &s);
                        let event = match finished_mode {
                            TimerMode::Focus => "focus-complete",
                            TimerMode::Break => "break-complete",
                            _ => "",
                        };
                        if !event.is_empty() {
                            let _ = tick_handle.emit(event, ());
                        }
                    }
                }
            });

            show_pet_window(&handle);

            // Tray icon + menu
            let show_item = MenuItemBuilder::with_id("show", "Show Snoopy").build(app)?;
            let focus_item = MenuItemBuilder::with_id("focus", "Start Focus Timer").build(app)?;
            let todo_item = MenuItemBuilder::with_id("todo", "To-Do List").build(app)?;
            let settings_item = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

            let menu = MenuBuilder::new(app)
                .items(&[
                    &show_item,
                    &focus_item,
                    &todo_item,
                    &settings_item,
                    &sep,
                    &quit_item,
                ])
                .build()?;

            // Load the tray icon from bytes embedded at compile time instead of
            // `app.default_window_icon().unwrap()`. That call can return `None`
            // depending on build mode/platform, and with `panic = "abort"` set
            // in the release profile, an `.unwrap()` panic here aborts the
            // *entire process* immediately after `show_pet_window` has already
            // painted the pet once. The result looks exactly like "the icon is
            // frozen and nothing responds" - because the backend is dead and
            // the window is just a static leftover frame.
            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;

            TrayIconBuilder::new()
                .icon(tray_icon)
                .tooltip("Snoopy Companion")
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "show" => show_pet_window(app),
                    "focus" => open_dashboard(app, Some("overview")),
                    "todo" => open_dashboard(app, Some("todo")),
                    "settings" => open_dashboard(app, Some("settings")),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(move |tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_pet_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the pet window from the OS chrome (Alt+F4 etc.) just
            // hides it, same behavior as the old tray-driven pet - only the
            // tray "Quit" truly exits the process.
            if window.label() == "pet" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Snoopy Companion");
}
