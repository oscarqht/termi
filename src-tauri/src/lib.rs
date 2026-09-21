pub mod server;
pub mod session;
pub mod tray;
pub mod updater;

use std::sync::Arc;
use session::SessionManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let session_manager = Arc::new(SessionManager::new());

    tauri::Builder::default()
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
                match server::start_server(sm).await {
                    Ok((server_url, _port, _handle)) => {
                        if let Err(e) = tray::setup_tray(&app_handle, server_url.clone()) {
                            eprintln!("[termi] Failed to setup tray: {e}");
                        }
                        updater::start_background_updater(app_handle);
                    }
                    Err(e) => {
                        eprintln!("[termi] Failed to start server: {e}");
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running termi application");
}
