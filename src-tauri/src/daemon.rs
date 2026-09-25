use std::path::PathBuf;
use std::time::Duration;
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
    get_daemon_dir().map(|d| d.join("daemon.json"))
}

pub fn get_daemon_log_path() -> Option<PathBuf> {
    get_daemon_dir().map(|d| d.join("daemon.log"))
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
        .timeout(Duration::from_millis(600))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    let health_url = format!("http://127.0.0.1:{}/api/health", info.port);
    match client.get(&health_url).send().await {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
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
    if let Some(info) = read_daemon_info() {
        if is_daemon_alive(&info).await {
            println!("[termi] Connecting to existing background daemon on port {}", info.port);
            return Ok(info);
        } else {
            println!("[termi] Stale daemon file found (pid {}). Cleaning up...", info.pid);
            remove_daemon_file();
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
        .timeout(Duration::from_millis(800))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("http://127.0.0.1:{}/api/daemon/session-count", info.port);
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let val: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let count = val.get("activeSessions").and_then(|v| v.as_u64()).unwrap_or(0);
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
}
