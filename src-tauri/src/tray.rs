use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_autostart::ManagerExt;

#[cfg(target_os = "macos")]
use std::sync::Mutex;

#[cfg(target_os = "macos")]
pub struct TrayFdaState {
    pub item: Mutex<Option<CheckMenuItem<Wry>>>,
}

#[cfg(target_os = "macos")]
pub fn update_fda_menu_item(app: &AppHandle) {
    if let Some(state) = app.try_state::<TrayFdaState>() {
        let granted = check_full_disk_access();
        if let Ok(guard) = state.item.lock() {
            if let Some(item) = guard.as_ref() {
                let _ = item.set_checked(granted);
                let _ = item.set_text(if granted {
                    "Full Disk Access Enabled"
                } else {
                    "Grant Full Disk Access..."
                });
            }
        }
    }
}

fn copy_to_clipboard(text: &str) {
    #[cfg(target_os = "macos")]
    {
        use std::io::Write;
        if let Ok(mut child) = std::process::Command::new("pbcopy")
            .stdin(std::process::Stdio::piped())
            .spawn()
        {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(text.as_bytes());
            }
            let _ = child.wait();
        }
    }
    #[cfg(target_os = "windows")]
    {
        let ps_cmd = format!("Set-Clipboard -Value '{}'", text);
        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps_cmd])
            .spawn();
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        use std::io::Write;
        if let Ok(mut child) = std::process::Command::new("xclip")
            .args(["-selection", "clipboard"])
            .stdin(std::process::Stdio::piped())
            .spawn()
        {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(text.as_bytes());
            }
            let _ = child.wait();
        }
    }
}

pub fn check_full_disk_access() -> bool {
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let safari_path = std::path::Path::new(&home).join("Library/Safari");
            if std::fs::read_dir(safari_path).is_ok() {
                return true;
            }
        }
        std::fs::read_dir("/Library/Application Support/com.apple.TCC").is_ok()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

#[tauri::command]
pub fn cmd_check_full_disk_access() -> bool {
    check_full_disk_access()
}

pub fn open_full_disk_access_settings() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
            .spawn();

        if let Ok(current_exe) = std::env::current_exe() {
            if let Some(app_bundle) = current_exe.ancestors().find(|p| p.extension().map_or(false, |e| e == "app")) {
                let _ = std::process::Command::new("open")
                    .args(["-R", &app_bundle.to_string_lossy()])
                    .spawn();
            } else if std::path::Path::new("/Applications/Termi.app").exists() {
                let _ = std::process::Command::new("open")
                    .args(["-R", "/Applications/Termi.app"])
                    .spawn();
            }
        }
    }
}

#[tauri::command]
pub fn cmd_open_full_disk_access_settings() {
    open_full_disk_access_settings();
}

pub fn setup_tray(
    app: &AppHandle,
    server_url: String,
) -> Result<(), Box<dyn std::error::Error>> {
    let autostart_enabled = app
        .autolaunch()
        .is_enabled()
        .unwrap_or(false);

    let open_item = MenuItem::with_id(app, "open_browser", "Open in Browser", true, None::<&str>)?;
    let copy_item = MenuItem::with_id(app, "copy_url", "Copy URL", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;

    #[cfg(target_os = "macos")]
    let fda_granted = check_full_disk_access();
    #[cfg(target_os = "macos")]
    let fda_text = if fda_granted {
        "Full Disk Access Enabled"
    } else {
        "Grant Full Disk Access..."
    };
    #[cfg(target_os = "macos")]
    let fda_item = CheckMenuItem::with_id(
        app,
        "full_disk_access",
        fda_text,
        true,
        fda_granted,
        None::<&str>,
    )?;
    #[cfg(target_os = "macos")]
    {
        app.manage(TrayFdaState {
            item: Mutex::new(Some(fda_item.clone())),
        });

        let app_handle_poll = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(3));
            loop {
                interval.tick().await;
                update_fda_menu_item(&app_handle_poll);
            }
        });
    }

    let autostart_item = CheckMenuItem::with_id(
        app,
        "toggle_autostart",
        "Launch at Login",
        true,
        autostart_enabled,
        None::<&str>,
    )?;
    let check_updates_item = MenuItem::with_id(
        app,
        "check_updates",
        "Check for Updates...",
        true,
        None::<&str>,
    )?;
    crate::updater::register_tray_item(app, check_updates_item.clone());
    let version_text = format!("Version {}", app.package_info().version);
    let version_item = MenuItem::with_id(
        app,
        "version",
        &version_text,
        false,
        None::<&str>,
    )?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Termi", true, None::<&str>)?;

    #[cfg(target_os = "macos")]
    let menu = Menu::with_items(
        app,
        &[
            &open_item,
            &copy_item,
            &sep1,
            &fda_item,
            &autostart_item,
            &check_updates_item,
            &version_item,
            &sep2,
            &quit_item,
        ],
    )?;

    #[cfg(not(target_os = "macos"))]
    let menu = Menu::with_items(
        app,
        &[
            &open_item,
            &copy_item,
            &sep1,
            &autostart_item,
            &check_updates_item,
            &version_item,
            &sep2,
            &quit_item,
        ],
    )?;

    let url_for_menu = server_url.clone();
    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
        .ok()
        .or_else(|| app.default_window_icon().cloned());

    let mut builder = TrayIconBuilder::with_id("termi-tray")
        .icon_as_template(false)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Termi Web Terminal")
        .on_menu_event(move |app_handle, event| {
            let id = event.id.as_ref();
            match id {
                "open_browser" => {
                    let _ = open::that(&url_for_menu);
                }
                "copy_url" => {
                    copy_to_clipboard(&url_for_menu);
                }
                #[cfg(target_os = "macos")]
                "full_disk_access" => {
                    open_full_disk_access_settings();
                    update_fda_menu_item(app_handle);
                }
                "toggle_autostart" => {
                    let autolaunch = app_handle.autolaunch();
                    if let Ok(enabled) = autolaunch.is_enabled() {
                        if enabled {
                            let _ = autolaunch.disable();
                        } else {
                            let _ = autolaunch.enable();
                        }
                    }
                }
                "check_updates" => {
                    let handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        crate::updater::handle_check_updates_click(&handle).await;
                    });
                }
                "quit" => {
                    app_handle.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event({
            let url_for_click = server_url.clone();
            #[cfg(target_os = "macos")]
            let app_handle_tray = app.clone();
            move |_tray, event| {
                #[cfg(target_os = "macos")]
                {
                    update_fda_menu_item(&app_handle_tray);
                }
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    let _ = open::that(&url_for_click);
                }
            }
        });

    if let Some(icon) = tray_icon {
        builder = builder.icon(icon);
    }

    builder.build(app)?;

    Ok(())
}
