use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

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
        .icon_as_template(true)
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
            move |_tray, event| {
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
