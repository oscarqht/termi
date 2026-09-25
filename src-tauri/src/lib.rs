pub mod custom_scripts;
pub mod daemon;
pub mod git;
pub mod prompts;
pub mod recent_cwds;
pub mod server;
pub mod session;
pub mod tray;
pub mod updater;

use std::sync::Arc;
use session::SessionManager;
use tauri::Manager;

pub fn is_dev() -> bool {
    if let Ok(val) = std::env::var("TERMI_ENV") {
        let v = val.trim().to_lowercase();
        if v == "production" || v == "prod" {
            return false;
        }
        if v == "development" || v == "dev" {
            return true;
        }
    }
    if let Ok(val) = std::env::var("NODE_ENV") {
        let v = val.trim().to_lowercase();
        if v == "production" || v == "prod" {
            return false;
        }
        if v == "development" || v == "dev" {
            return true;
        }
    }
    cfg!(debug_assertions) || std::env::var("TERMI_DEV").map(|v| v == "1" || v.eq_ignore_ascii_case("true")).unwrap_or(false)
}

pub fn run_daemon() {
    let rt = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[termi-daemon] Failed to create Tokio runtime: {e}");
            return;
        }
    };

    rt.block_on(async {
        println!("[termi-daemon] Starting background daemon...");
        let sm = Arc::new(SessionManager::new());
        // Load saved session records for reboot persistence
        sm.load_saved_sessions().await;

        let token = uuid::Uuid::new_v4().to_string();
        let (shutdown_tx, mut shutdown_rx) = tokio::sync::broadcast::channel::<()>(4);

        let (server_url, bound_port, _app_state, server_handle) =
            match server::start_server(sm.clone(), token.clone(), shutdown_tx.clone()).await {
                Ok(res) => res,
                Err(e) => {
                    eprintln!("[termi-daemon] Failed to start server: {e}");
                    return;
                }
            };

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let daemon_info = daemon::DaemonInfo {
            pid: std::process::id(),
            port: bound_port,
            url: server_url,
            version: env!("CARGO_PKG_VERSION").to_string(),
            token,
            started_at: now,
        };

        if let Err(e) = daemon::write_daemon_info(&daemon_info) {
            eprintln!("[termi-daemon] Failed to write daemon.json: {e}");
        }

        // Install OS signal handler for graceful cleanup
        let sm_for_signal = sm.clone();
        tokio::spawn(async move {
            #[cfg(unix)]
            {
                use tokio::signal::unix::{signal, SignalKind};
                if let (Ok(mut sigint), Ok(mut sigterm)) = (
                    signal(SignalKind::interrupt()),
                    signal(SignalKind::terminate()),
                ) {
                    tokio::select! {
                        _ = sigint.recv() => {
                            println!("[termi-daemon] Received SIGINT, exiting...");
                        }
                        _ = sigterm.recv() => {
                            println!("[termi-daemon] Received SIGTERM, exiting...");
                        }
                    }
                }
            }
            #[cfg(windows)]
            {
                let _ = tokio::signal::ctrl_c().await;
                println!("[termi-daemon] Received Ctrl+C, exiting...");
            }
            sm_for_signal.persist_sessions().await;
            daemon::remove_daemon_file();
            std::process::exit(0);
        });

        // Wait for shutdown signal or server error
        tokio::select! {
            _ = shutdown_rx.recv() => {
                println!("[termi-daemon] Shutdown requested via API.");
            }
            _ = server_handle => {
                println!("[termi-daemon] Server task completed.");
            }
        }

        sm.persist_sessions().await;
        daemon::remove_daemon_file();
        println!("[termi-daemon] Daemon stopped cleanly.");
    });
}

fn start_desktop_daemon_sync(app_handle: tauri::AppHandle, daemon_info: daemon::DaemonInfo) {
    tauri::async_runtime::spawn(async move {
        let client = match reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(2))
            .build()
        {
            Ok(c) => c,
            Err(_) => return,
        };

        let mut interval = tokio::time::interval(std::time::Duration::from_millis(1500));
        let mut last_status: Option<updater::UpdateStatus> = None;

        loop {
            interval.tick().await;

            let cur_daemon = daemon::read_daemon_info().unwrap_or_else(|| daemon_info.clone());

            // 1. Push latest UpdateStatus to daemon if changed
            if let Some(state) = app_handle.try_state::<updater::UpdateState>() {
                let current_status = {
                    let mgr = state.0.lock().await;
                    mgr.status.clone()
                };

                if last_status.as_ref() != Some(&current_status) {
                    last_status = Some(current_status.clone());
                    let url = format!("http://127.0.0.1:{}/api/daemon/updater-status", cur_daemon.port);
                    let _ = client
                        .post(&url)
                        .header("X-Termi-Token", &cur_daemon.token)
                        .json(&current_status)
                        .send()
                        .await;
                }
            }

            // 2. Check if web client triggered updater action
            let action_url = format!("http://127.0.0.1:{}/api/daemon/updater-action", cur_daemon.port);
            if let Ok(resp) = client
                .get(&action_url)
                .header("X-Termi-Token", &cur_daemon.token)
                .send()
                .await
            {
                if let Ok(val) = resp.json::<serde_json::Value>().await {
                    if let Some(act) = val.get("action").and_then(|v| v.as_str()) {
                        match act {
                            "check" => {
                                let h = app_handle.clone();
                                tauri::async_runtime::spawn(async move {
                                    updater::check_and_download(&h, false, true).await;
                                });
                            }
                            "install" => {
                                let h = app_handle.clone();
                                tauri::async_runtime::spawn(async move {
                                    let _ = updater::install_and_relaunch_inner(&h).await;
                                });
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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

            tauri::async_runtime::spawn(async move {
                let daemon_info = match daemon::ensure_daemon_running().await {
                    Ok(info) => info,
                    Err(e) => {
                        eprintln!("[termi] Failed to start/connect to daemon: {e}");
                        return;
                    }
                };

                if let Err(e) = tray::setup_tray(&app_handle, daemon_info.clone()) {
                    eprintln!("[termi] Failed to setup tray: {e}");
                }
                updater::start_background_updater(app_handle.clone());
                start_desktop_daemon_sync(app_handle.clone(), daemon_info);

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
            tauri::RunEvent::Exit => {
                if is_dev() {
                    daemon::remove_daemon_file();
                }
            }
            _ => {}
        }
    });
}

#[cfg(test)]
pub static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_dev_env_overrides() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("TERMI_ENV", "production");
        assert!(!is_dev());

        std::env::set_var("TERMI_ENV", "development");
        assert!(is_dev());

        std::env::remove_var("TERMI_ENV");

        std::env::set_var("NODE_ENV", "production");
        assert!(!is_dev());

        std::env::set_var("NODE_ENV", "development");
        assert!(is_dev());

        std::env::remove_var("NODE_ENV");
    }
}
