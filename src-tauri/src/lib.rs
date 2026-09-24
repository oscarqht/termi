pub mod prompts;
pub mod recent_cwds;
pub mod server;
pub mod session;
pub mod tray;
pub mod updater;


use std::sync::Arc;
use session::SessionManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let session_manager = Arc::new(SessionManager::new());

    let app = tauri::Builder::default()
        .manage(updater::init_state())
        .invoke_handler(tauri::generate_handler![
            updater::check_for_updates_manual,
            updater::get_update_status,
            updater::install_and_relaunch,
            updater::close_update_window,
            tray::cmd_check_full_disk_access,
            tray::cmd_open_full_disk_access_settings,
        ])
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let app_handle = app.handle().clone();
            let sm = session_manager.clone();

            tauri::async_runtime::spawn(async move {
                match server::start_server(app_handle.clone(), sm).await {
                    Ok((server_url, _port, _handle)) => {
                        if let Err(e) = tray::setup_tray(&app_handle, server_url.clone()) {
                            eprintln!("[termi] Failed to setup tray: {e}");
                        }
                        updater::start_background_updater(app_handle.clone());

                        #[cfg(target_os = "macos")]
                        {
                            use tauri_plugin_notification::NotificationExt;
                            if !tray::check_full_disk_access() {
                                println!("[termi] Full Disk Access is not granted yet. Notifying user...");
                                let _ = app_handle
                                    .notification()
                                    .builder()
                                    .title("Termi Permissions")
                                    .body("Termi needs Full Disk Access to avoid folder permission prompts in terminal sessions. Click the status bar icon to configure.")
                                    .show();
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[termi] Failed to start server: {e}");
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building termi application");

    app.run(|app_handle, event| {
        match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                let handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    updater::handle_app_reopen(&handle).await;
                });
            }
            tauri::RunEvent::ExitRequested { code, api, .. } => {
                // Keep the app running in the status bar/tray when windows are closed.
                // Only permit exit when an explicit code is provided (e.g. from "Quit Termi").
                if code.is_none() {
                    api.prevent_exit();
                }
            }
            _ => {}
        }
    });
}
