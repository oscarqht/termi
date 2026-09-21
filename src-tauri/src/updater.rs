use std::time::Duration;
use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::UpdaterExt;

pub async fn check_for_updates<R: Runtime>(app: &AppHandle<R>, user_initiated: bool) {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            eprintln!("[termi] Failed to initialize updater: {e}");
            return;
        }
    };

    println!("[termi] Checking for updates...");
    match updater.check().await {
        Ok(Some(update)) => {
            println!("[termi] New version available: v{}", update.version);
            let mut downloaded = 0;
            let res = update
                .download_and_install(
                    |chunk_length, content_length| {
                        downloaded += chunk_length;
                        if let Some(total) = content_length {
                            let pct = (downloaded as f64 / total as f64 * 100.0) as u32;
                            print!("\r[termi] Downloading update: {pct}%");
                        }
                    },
                    || {
                        println!("\n[termi] Download complete, installing update...");
                    },
                )
                .await;

            match res {
                Ok(_) => {
                    println!("[termi] Update installed successfully! Restarting...");
                    app.restart();
                }
                Err(e) => {
                    eprintln!("[termi] Failed to install update: {e}");
                }
            }
        }
        Ok(None) => {
            if user_initiated {
                println!("[termi] You are on the latest version.");
            }
        }
        Err(e) => {
            if user_initiated {
                eprintln!("[termi] Update check error: {e}");
            }
        }
    }
}

pub fn start_background_updater<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        // Initial check 5s after startup
        tokio::time::sleep(Duration::from_secs(5)).await;
        check_for_updates(&app, false).await;

        // Recurring check every 4 hours
        let mut interval = tokio::time::interval(Duration::from_secs(4 * 3600));
        loop {
            interval.tick().await;
            check_for_updates(&app, false).await;
        }
    });
}
