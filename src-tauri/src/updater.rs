use std::sync::Arc;
use std::time::Duration;
use tauri::menu::MenuItem;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, Wry};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(tag = "status", content = "data")]
pub enum UpdateStatus {
    Idle,
    Checking,
    UpToDate {
        current_version: String,
    },
    Downloading {
        version: String,
        current_version: String,
        body: Option<String>,
        downloaded: u64,
        total: Option<u64>,
        percent: u32,
    },
    Downloaded {
        version: String,
        current_version: String,
        body: Option<String>,
    },
    Error {
        message: String,
    },
}

pub struct UpdateManager {
    pub status: UpdateStatus,
    pub pending_update: Option<Update>,
    pub downloaded_bytes: Option<Vec<u8>>,
    pub tray_item: Option<MenuItem<Wry>>,
    pub is_checking_or_downloading: bool,
}

impl Default for UpdateManager {
    fn default() -> Self {
        Self {
            status: UpdateStatus::Idle,
            pending_update: None,
            downloaded_bytes: None,
            tray_item: None,
            is_checking_or_downloading: false,
        }
    }
}

pub struct UpdateState(pub Arc<tokio::sync::Mutex<UpdateManager>>);

pub fn init_state() -> UpdateState {
    UpdateState(Arc::new(tokio::sync::Mutex::new(UpdateManager::default())))
}

pub fn register_tray_item(app: &AppHandle, item: MenuItem<Wry>) {
    let state = app.state::<UpdateState>();
    let state_arc = state.0.clone();
    tauri::async_runtime::spawn(async move {
        let mut mgr = state_arc.lock().await;
        mgr.tray_item = Some(item);
    });
}

pub fn open_or_focus_updater_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("updater") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let state_arc = app.state::<UpdateState>().0.clone();
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let mgr = state_arc.lock().await;
            let _ = handle.emit("termi://update-status", &mgr.status);
        });
        return Ok(());
    }

    let url = WebviewUrl::App("index.html#updater".into());
    let window = WebviewWindowBuilder::new(app, "updater", url)
        .title("Termi Software Update")
        .inner_size(440.0, 420.0)
        .resizable(false)
        .center()
        .always_on_top(true)
        .build()?;

    let _ = window.set_focus();
    Ok(())
}

pub fn close_update_window_inner(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("updater") {
        let _ = window.close();
    }
}

pub async fn check_and_download(app: &AppHandle, show_window: bool, force: bool) {
    if show_window {
        let _ = open_or_focus_updater_window(app);
    }

    let state = app.state::<UpdateState>();
    {
        let mgr = state.0.lock().await;
        if !force && matches!(mgr.status, UpdateStatus::Downloaded { .. }) {
            let _ = app.emit("termi://update-status", &mgr.status);
            return;
        }
        if mgr.is_checking_or_downloading {
            let _ = app.emit("termi://update-status", &mgr.status);
            return;
        }
    }

    {
        let mut mgr = state.0.lock().await;
        mgr.is_checking_or_downloading = true;
        mgr.status = UpdateStatus::Checking;
    }
    let _ = app.emit("termi://update-status", UpdateStatus::Checking);

    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            let err_msg = format!("Failed to initialize updater: {e}");
            eprintln!("[termi] {err_msg}");
            let err_status = UpdateStatus::Error { message: err_msg };
            let mut mgr = state.0.lock().await;
            mgr.status = err_status.clone();
            mgr.is_checking_or_downloading = false;
            let _ = app.emit("termi://update-status", &err_status);
            return;
        }
    };

    println!("[termi] Updater: checking for updates...");
    match updater.check().await {
        Ok(Some(update)) => {
            println!("[termi] Updater: new version available: v{}", update.version);
            let version = update.version.clone();
            let current_version = update.current_version.clone();
            let body = update.body.clone();

            {
                let mut mgr = state.0.lock().await;
                mgr.status = UpdateStatus::Downloading {
                    version: version.clone(),
                    current_version: current_version.clone(),
                    body: body.clone(),
                    downloaded: 0,
                    total: None,
                    percent: 0,
                };
            }
            let _ = app.emit("termi://update-status", {
                let mgr = state.0.lock().await;
                mgr.status.clone()
            });

            let mut downloaded = 0u64;
            let mut last_emit = std::time::Instant::now();
            let mut last_pct = 0u32;
            let app_clone = app.clone();
            let version_for_cb = version.clone();
            let curr_for_cb = current_version.clone();
            let body_for_cb = body.clone();

            let res = update
                .download(
                    move |chunk_length, content_length| {
                        downloaded += chunk_length as u64;
                        let pct = if let Some(tot) = content_length {
                            if tot > 0 {
                                ((downloaded as f64 / tot as f64) * 100.0) as u32
                            } else {
                                0
                            }
                        } else {
                            0
                        };

                        if pct != last_pct || last_emit.elapsed() >= Duration::from_millis(300) {
                            last_pct = pct;
                            last_emit = std::time::Instant::now();
                            let status = UpdateStatus::Downloading {
                                version: version_for_cb.clone(),
                                current_version: curr_for_cb.clone(),
                                body: body_for_cb.clone(),
                                downloaded,
                                total: content_length,
                                percent: pct,
                            };
                            let _ = app_clone.emit("termi://update-status", &status);
                        }
                    },
                    || {
                        println!("[termi] Updater: download complete.");
                    },
                )
                .await;

            match res {
                Ok(bytes) => {
                    println!("[termi] Updater: downloaded {} bytes successfully", bytes.len());
                    let new_status = UpdateStatus::Downloaded {
                        version: version.clone(),
                        current_version: current_version.clone(),
                        body: body.clone(),
                    };

                    {
                        let mut mgr = state.0.lock().await;
                        mgr.pending_update = Some(update);
                        mgr.downloaded_bytes = Some(bytes);
                        mgr.status = new_status.clone();
                        if let Some(tray_item) = &mgr.tray_item {
                            let _ = tray_item.set_text(format!("Restart to Update to v{version}"));
                        }
                    }

                    let _ = app.emit("termi://update-status", &new_status);

                    let notif_body = format!(
                        "Version v{} is downloaded. Click here or open the status bar menu to restart.",
                        version
                    );
                    let _ = app
                        .notification()
                        .builder()
                        .title("Termi Update Ready")
                        .body(notif_body)
                        .show();
                }
                Err(e) => {
                    eprintln!("[termi] Updater download failed: {e}");
                    let err_status = UpdateStatus::Error {
                        message: format!("Download failed: {e}"),
                    };
                    let mut mgr = state.0.lock().await;
                    mgr.status = err_status.clone();
                    let _ = app.emit("termi://update-status", &err_status);
                }
            }
        }
        Ok(None) => {
            println!("[termi] Updater: Termi is up to date.");
            let status = UpdateStatus::UpToDate {
                current_version: app.package_info().version.to_string(),
            };
            let mut mgr = state.0.lock().await;
            mgr.pending_update = None;
            mgr.downloaded_bytes = None;
            mgr.status = status.clone();
            if let Some(tray_item) = &mgr.tray_item {
                let _ = tray_item.set_text("Check for Updates...");
            }
            let _ = app.emit("termi://update-status", &status);
        }
        Err(e) => {
            eprintln!("[termi] Updater check error: {e}");
            let err_status = UpdateStatus::Error {
                message: format!("Check failed: {e}"),
            };
            let mut mgr = state.0.lock().await;
            mgr.status = err_status.clone();
            let _ = app.emit("termi://update-status", &err_status);
        }
    }

    let mut mgr = state.0.lock().await;
    mgr.is_checking_or_downloading = false;
}

pub async fn check_and_download_silent(app: &AppHandle) {
    check_and_download(app, false, false).await;
}

pub async fn check_and_download_manual(app: &AppHandle) {
    check_and_download(app, true, true).await;
}

pub async fn handle_check_updates_click(app: &AppHandle) {
    let is_downloaded = {
        let state = app.state::<UpdateState>();
        let mgr = state.0.lock().await;
        matches!(mgr.status, UpdateStatus::Downloaded { .. })
    };

    if is_downloaded {
        let _ = open_or_focus_updater_window(app);
    } else {
        check_and_download_manual(app).await;
    }
}

pub async fn handle_app_reopen(app: &AppHandle) {
    let is_downloaded = {
        let state = app.state::<UpdateState>();
        let mgr = state.0.lock().await;
        matches!(mgr.status, UpdateStatus::Downloaded { .. })
    };

    if is_downloaded {
        let _ = open_or_focus_updater_window(app);
    }
}

pub async fn install_and_relaunch_inner(app: &AppHandle) -> Result<(), String> {
    let (pending_update, downloaded_bytes) = {
        let state = app.state::<UpdateState>();
        let mut mgr = state.0.lock().await;
        (mgr.pending_update.take(), mgr.downloaded_bytes.take())
    };

    if let (Some(update), Some(bytes)) = (pending_update, downloaded_bytes) {
        println!("[termi] Installing downloaded update package...");
        if let Err(e) = update.install(bytes) {
            let err_msg = format!("Failed to install update: {e}");
            eprintln!("[termi] {err_msg}");
            let state = app.state::<UpdateState>();
            let mut mgr = state.0.lock().await;
            mgr.status = UpdateStatus::Error {
                message: err_msg.clone(),
            };
            let _ = app.emit("termi://update-status", &mgr.status);
            return Err(err_msg);
        }
        println!("[termi] Update installed successfully! Relaunching app...");
    }

    // Stop background daemon so the new binary version is cleanly spawned upon relaunch
    if let Some(info) = crate::daemon::read_daemon_info() {
        println!("[termi] Stopping background daemon before relaunch...");
        let _ = crate::daemon::stop_daemon(&info).await;
    }

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(500)).await;
        handle.restart();
    });
    Ok(())
}

pub fn start_background_updater(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Initial check 10 seconds after startup
        tokio::time::sleep(Duration::from_secs(10)).await;
        check_and_download_silent(&app).await;

        // Recurring check every 1 hour
        let mut interval = tokio::time::interval(Duration::from_secs(3600));
        loop {
            interval.tick().await;
            check_and_download_silent(&app).await;
        }
    });
}

// Tauri IPC Commands
#[tauri::command]
pub async fn check_for_updates_manual(app: AppHandle) -> Result<(), String> {
    check_and_download_manual(&app).await;
    Ok(())
}

#[tauri::command]
pub async fn get_update_status(app: AppHandle) -> Result<UpdateStatus, String> {
    let state = app.state::<UpdateState>();
    let mgr = state.0.lock().await;
    Ok(mgr.status.clone())
}

#[tauri::command]
pub async fn install_and_relaunch(app: AppHandle) -> Result<(), String> {
    install_and_relaunch_inner(&app).await
}

#[tauri::command]
pub async fn close_update_window(app: AppHandle) -> Result<(), String> {
    close_update_window_inner(&app);
    Ok(())
}
