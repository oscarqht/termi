use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DaemonInfo {
    pub pid: u32,
    pub port: u16,
    pub url: String,
    pub version: String,
    pub token: String,
    #[serde(rename = "startedAt")]
    pub started_at: u64,
}

pub fn get_daemon_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if let Some(config) = dirs::config_dir() {
            return Some(config.join("termi"));
        }
    }
    dirs::home_dir().map(|h| h.join(".config").join("termi"))
}

pub fn get_daemon_file_path() -> Option<PathBuf> {
    get_daemon_dir().map(|d| {
        if crate::is_dev() {
            d.join("daemon-dev.json")
        } else {
            d.join("daemon.json")
        }
    })
}

pub fn get_daemon_log_path() -> Option<PathBuf> {
    get_daemon_dir().map(|d| {
        if crate::is_dev() {
            d.join("daemon-dev.log")
        } else {
            d.join("daemon.log")
        }
    })
}

pub fn is_process_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
    }
    #[cfg(windows)]
    {
        use std::process::Command;
        let output = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid), "/NH"])
            .output();
        if let Ok(out) = output {
            let s = String::from_utf8_lossy(&out.stdout);
            s.contains(&pid.to_string())
        } else {
            false
        }
    }
}

pub async fn is_daemon_alive(info: &DaemonInfo) -> bool {
    if !is_process_alive(info.pid) {
        return false;
    }
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(2000))
        .no_proxy()
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    let health_url = format!("http://127.0.0.1:{}/api/health", info.port);
    for attempt in 0..3 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        if let Ok(resp) = client.get(&health_url).send().await {
            if resp.status().is_success() {
                return true;
            }
        }
    }
    false
}

pub fn read_daemon_info() -> Option<DaemonInfo> {
    let path = get_daemon_file_path()?;
    if !path.exists() {
        return None;
    }
    let content = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

pub fn write_daemon_info(info: &DaemonInfo) -> Result<(), std::io::Error> {
    if let Some(path) = get_daemon_file_path() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let data = serde_json::to_string_pretty(info)?;
        std::fs::write(&path, data)?;
    }
    Ok(())
}

pub fn remove_daemon_file() {
    if let Some(path) = get_daemon_file_path() {
        let _ = std::fs::remove_file(path);
    }
}

pub async fn ensure_daemon_running() -> Result<DaemonInfo, String> {
    if crate::is_dev() {
        println!("[termi] Dev mode: starting fresh in-process server on next free port (never re-attaching)...");
        let sm = std::sync::Arc::new(crate::session::SessionManager::new());
        sm.load_saved_sessions().await;

        let token = uuid::Uuid::new_v4().to_string();
        let (shutdown_tx, _) = tokio::sync::broadcast::channel::<()>(4);

        let (server_url, bound_port, _app_state, _server_handle) =
            crate::server::start_server(sm.clone(), token.clone(), shutdown_tx)
                .await
                .map_err(|e| format!("Failed to start dev server: {e}"))?;

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let dev_info = DaemonInfo {
            pid: std::process::id(),
            port: bound_port,
            url: server_url,
            version: env!("CARGO_PKG_VERSION").to_string(),
            token,
            started_at: now,
        };

        let _ = write_daemon_info(&dev_info);
        return Ok(dev_info);
    }

    if let Some(info) = read_daemon_info() {
        if is_daemon_alive(&info).await {
            println!("[termi] Connecting to existing background daemon on port {}", info.port);
            return Ok(info);
        } else if is_process_alive(info.pid) {
            println!("[termi] Daemon process {} alive, waiting for response...", info.pid);
            tokio::time::sleep(Duration::from_millis(1000)).await;
            if is_daemon_alive(&info).await {
                println!("[termi] Connecting to existing background daemon on port {}", info.port);
                return Ok(info);
            }
        }
        println!("[termi] Stale daemon file found (pid {}). Cleaning up...", info.pid);
        remove_daemon_file();
    }

    // Check if an existing daemon is already listening on default port 3200 before spawning
    let default_port = 3200;
    if let Ok(client) = reqwest::Client::builder().timeout(Duration::from_millis(1000)).no_proxy().build() {
        let health_url = format!("http://127.0.0.1:{default_port}/api/health");
        if let Ok(resp) = client.get(&health_url).send().await {
            if resp.status().is_success() {
                let info_url = format!("http://127.0.0.1:{default_port}/api/daemon/info");
                if let Ok(info_resp) = client.get(&info_url).send().await {
                    if let Ok(json) = info_resp.json::<serde_json::Value>().await {
                        if let Some(pid) = json.get("pid").and_then(|v| v.as_u64()) {
                            let recovered_info = DaemonInfo {
                                pid: pid as u32,
                                port: default_port,
                                url: format!("http://127.0.0.1:{default_port}"),
                                version: json.get("version").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                token: String::new(),
                                started_at: SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
                            };
                            let _ = write_daemon_info(&recovered_info);
                            println!("[termi] Reconnected to existing background daemon on port {default_port}");
                            return Ok(recovered_info);
                        }
                    }
                }
            }
        }
    }

    println!("[termi] Spawning detached background daemon...");
    let current_exe = std::env::current_exe().map_err(|e| format!("Cannot find current executable: {e}"))?;

    let log_file = if let Some(log_path) = get_daemon_log_path() {
        if let Some(parent) = log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)
            .ok()
    } else {
        None
    };

    let mut cmd = std::process::Command::new(&current_exe);
    cmd.arg("--daemon");
    cmd.stdin(std::process::Stdio::null());

    if let Some(ref file) = log_file {
        if let Ok(file_clone) = file.try_clone() {
            cmd.stdout(std::process::Stdio::from(file_clone));
        } else {
            cmd.stdout(std::process::Stdio::null());
        }
        if let Ok(file_clone) = file.try_clone() {
            cmd.stderr(std::process::Stdio::from(file_clone));
        } else {
            cmd.stderr(std::process::Stdio::null());
        }
    } else {
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::null());
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
        unsafe {
            cmd.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x00000008;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW);
    }

    let _child = cmd.spawn().map_err(|e| format!("Failed to spawn daemon process: {e}"))?;

    // Poll until daemon is up and responsive (up to 6 seconds)
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(6) {
        tokio::time::sleep(Duration::from_millis(150)).await;
        if let Some(info) = read_daemon_info() {
            if is_daemon_alive(&info).await {
                println!("[termi] Background daemon is ready at {}", info.url);
                return Ok(info);
            }
        }
    }

    Err("Timed out waiting for background daemon to start.".to_string())
}

pub async fn stop_daemon(info: &DaemonInfo) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;

    let shutdown_url = format!("http://127.0.0.1:{}/api/daemon/shutdown", info.port);
    let _ = client
        .post(&shutdown_url)
        .header("X-Termi-Token", &info.token)
        .send()
        .await;

    // Wait up to 2 seconds for process to exit
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if !is_process_alive(info.pid) {
            remove_daemon_file();
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    #[cfg(unix)]
    {
        unsafe {
            libc::kill(info.pid as libc::pid_t, libc::SIGTERM);
        }
    }
    remove_daemon_file();
    Ok(())
}

pub async fn get_daemon_session_count(info: &DaemonInfo) -> Result<usize, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(1500))
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("http://127.0.0.1:{}/api/daemon/session-count", info.port);
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let val: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let count = val.get("totalSessions").and_then(|v| v.as_u64())
        .or_else(|| val.get("activeSessions").and_then(|v| v.as_u64()))
        .unwrap_or(0);
    Ok(count as usize)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_process_alive() {
        let current_pid = std::process::id();
        assert!(is_process_alive(current_pid));
        assert!(!is_process_alive(0));
        assert!(!is_process_alive(99999999));
    }

    #[test]
    fn test_daemon_info_serde() {
        let info = DaemonInfo {
            pid: 1234,
            port: 3200,
            url: "http://127.0.0.1:3200".to_string(),
            version: "0.35.0".to_string(),
            token: "secret-token".to_string(),
            started_at: 1700000000,
        };

        let serialized = serde_json::to_string(&info).expect("Failed to serialize");
        assert!(serialized.contains("startedAt"));
        let deserialized: DaemonInfo = serde_json::from_str(&serialized).expect("Failed to deserialize");
        assert_eq!(info, deserialized);
    }

    #[test]
    fn test_daemon_file_paths_distinguish_dev_and_prod() {
        let _guard = crate::ENV_LOCK.lock().unwrap();

        // In dev mode (default during debug test)
        let dev_file = get_daemon_file_path().unwrap();
        let dev_log = get_daemon_log_path().unwrap();
        assert!(dev_file.to_string_lossy().ends_with("daemon-dev.json"));
        assert!(dev_log.to_string_lossy().ends_with("daemon-dev.log"));

        // In prod mode
        std::env::set_var("TERMI_ENV", "production");
        let prod_file = get_daemon_file_path().unwrap();
        let prod_log = get_daemon_log_path().unwrap();
        assert!(prod_file.to_string_lossy().ends_with("daemon.json"));
        assert!(!prod_file.to_string_lossy().ends_with("daemon-dev.json"));
        assert!(prod_log.to_string_lossy().ends_with("daemon.log"));
        assert!(!prod_log.to_string_lossy().ends_with("daemon-dev.log"));
        std::env::remove_var("TERMI_ENV");
    }
}
