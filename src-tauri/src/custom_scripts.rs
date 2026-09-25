use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::RwLock;

const MAX_OUTPUT_LENGTH: usize = 500_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CustomScript {
    pub id: String,
    pub name: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

pub fn get_custom_scripts_file_path() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if let Some(config) = dirs::config_dir() {
            return Some(config.join("termi").join("custom_scripts.json"));
        }
    }
    dirs::home_dir().map(|h| h.join(".config").join("termi").join("custom_scripts.json"))
}

pub fn default_custom_scripts() -> Vec<CustomScript> {
    vec![
        CustomScript {
            id: "script-git-status-log".to_string(),
            name: "Git Status & Recent Commits".to_string(),
            description: Some("Inspect status and recent commit history in current directory".to_string()),
            content: r#"#!/usr/bin/env bash
set -e

if [ -d .git ] || git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "=== Git Status ==="
  git status --short
  echo ""
  echo "=== Recent Commits ==="
  git log --oneline -n 7
else
  echo "Not a git repository."
fi
"#.to_string(),
        },
        CustomScript {
            id: "script-disk-usage".to_string(),
            name: "Directory Disk Usage".to_string(),
            description: Some("Display top disk space consumers in current folder".to_string()),
            content: r#"#!/usr/bin/env bash
echo "=== Top items by disk usage in $(pwd) ==="
if command -v du >/dev/null 2>&1; then
  du -sh * 2>/dev/null | sort -hr | head -n 10
else
  ls -lh
fi
"#.to_string(),
        },
        CustomScript {
            id: "script-quick-test".to_string(),
            name: "Run Project Tests".to_string(),
            description: Some("Auto-detect package.json, Cargo.toml or Makefile and run test suite".to_string()),
            content: r#"#!/usr/bin/env bash
set -e

if [ -f "package.json" ]; then
  echo "Detected package.json. Running npm test..."
  npm test
elif [ -f "Cargo.toml" ]; then
  echo "Detected Cargo.toml. Running cargo test..."
  cargo test
elif [ -f "Makefile" ]; then
  echo "Detected Makefile. Running make test..."
  make test
elif [ -f "go.mod" ]; then
  echo "Detected Go project. Running go test ./..."
  go test ./...
else
  echo "No recognized test runner found in $(pwd)"
fi
"#.to_string(),
        },
        CustomScript {
            id: "script-system-info".to_string(),
            name: "System & Tool Environment".to_string(),
            description: Some("Show OS info, tool versions, and active paths".to_string()),
            content: r#"#!/usr/bin/env bash
echo "=== System Summary ==="
uname -a
echo ""
echo "=== PATH & Developer Tools ==="
for cmd in node npm git cargo rustc python3 go docker; do
  if command -v $cmd >/dev/null 2>&1; then
    printf "%-10s %s (%s)\n" "$cmd" "$($cmd --version 2>&1 | head -n 1)" "$(which $cmd)"
  fi
done
"#.to_string(),
        },
    ]
}

pub async fn load_custom_scripts() -> Vec<CustomScript> {
    let file_path = match get_custom_scripts_file_path() {
        Some(p) => p,
        None => return default_custom_scripts(),
    };

    if !file_path.exists() {
        let defaults = default_custom_scripts();
        let _ = save_custom_scripts(&defaults).await;
        return defaults;
    }

    let content = match fs::read_to_string(&file_path).await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[termi] Failed to read custom scripts file: {e}");
            return default_custom_scripts();
        }
    };

    match serde_json::from_str::<Vec<CustomScript>>(&content) {
        Ok(scripts) => scripts,
        Err(e) => {
            eprintln!("[termi] Failed to parse custom scripts JSON: {e}");
            default_custom_scripts()
        }
    }
}

pub async fn save_custom_scripts(scripts: &[CustomScript]) -> Result<(), std::io::Error> {
    let file_path = match get_custom_scripts_file_path() {
        Some(p) => p,
        None => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "Config directory not found",
            ))
        }
    };

    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).await?;
    }

    let json = serde_json::to_string_pretty(scripts)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

    let temp_path = file_path.with_extension(format!("tmp.{}", uuid::Uuid::new_v4()));
    fs::write(&temp_path, json).await?;
    fs::rename(&temp_path, &file_path).await?;
    Ok(())
}

// ----------------- PATH Augmentation -----------------

pub fn get_augmented_path() -> String {
    let delimiter = if cfg!(windows) { ";" } else { ":" };
    let mut candidate_dirs: Vec<PathBuf> = Vec::new();

    if let Some(home) = dirs::home_dir() {
        candidate_dirs.push(home.join(".bun").join("bin"));
        candidate_dirs.push(home.join(".cargo").join("bin"));
        candidate_dirs.push(home.join(".local").join("bin"));
        candidate_dirs.push(home.join("Library").join("pnpm"));
        candidate_dirs.push(home.join(".pnpm"));
        candidate_dirs.push(home.join(".deno").join("bin"));
        candidate_dirs.push(home.join(".yarn").join("bin"));
        candidate_dirs.push(home.join(".fnm").join("current").join("bin"));
        candidate_dirs.push(home.join(".volta").join("bin"));
        candidate_dirs.push(home.join(".asdf").join("shims"));
        candidate_dirs.push(home.join(".asdf").join("bin"));

        // NVM node versions
        let nvm_node = home.join(".nvm").join("versions").join("node");
        if let Ok(entries) = std::fs::read_dir(&nvm_node) {
            for entry in entries.flatten() {
                let bin_dir = entry.path().join("bin");
                if bin_dir.exists() {
                    candidate_dirs.push(bin_dir);
                }
            }
        }
    }

    #[cfg(unix)]
    {
        candidate_dirs.push(PathBuf::from("/opt/homebrew/bin"));
        candidate_dirs.push(PathBuf::from("/opt/homebrew/sbin"));
        candidate_dirs.push(PathBuf::from("/usr/local/bin"));
        candidate_dirs.push(PathBuf::from("/usr/local/sbin"));
        candidate_dirs.push(PathBuf::from("/usr/bin"));
        candidate_dirs.push(PathBuf::from("/bin"));
        candidate_dirs.push(PathBuf::from("/usr/sbin"));
        candidate_dirs.push(PathBuf::from("/sbin"));
    }

    #[cfg(windows)]
    {
        candidate_dirs.push(PathBuf::from("C:\\Program Files\\Git\\bin"));
        candidate_dirs.push(PathBuf::from("C:\\Program Files\\Git\\usr\\bin"));
        candidate_dirs.push(PathBuf::from("C:\\Program Files\\nodejs"));
    }

    if let Ok(current_path) = std::env::var("PATH") {
        for part in current_path.split(delimiter) {
            if !part.trim().is_empty() {
                candidate_dirs.push(PathBuf::from(part.trim()));
            }
        }
    }

    let mut seen = std::collections::HashSet::new();
    let mut final_paths = Vec::new();

    for dir in candidate_dirs {
        if dir.exists() {
            let s = dir.to_string_lossy().to_string();
            if seen.insert(s.clone()) {
                final_paths.push(s);
            }
        }
    }

    final_paths.join(delimiter)
}

// ----------------- Execution State & Runner -----------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionResponse {
    pub execution_id: String,
    pub cwd: String,
    pub script_name: String,
    pub script_content: String,
    pub status: String,
    pub cancel_requested: bool,
    pub output: String,
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CustomScriptPayload {
    pub command: String,
    pub cwd: Option<String>,
    pub script_name: Option<String>,
    pub script_content: Option<String>,
    pub execution_id: Option<String>,
    pub force: Option<bool>,
}

struct ScriptExecutionState {
    id: String,
    cwd: String,
    script_name: String,
    script_content: String,
    status: String,
    cancel_requested: bool,
    output: String,
    exit_code: Option<i32>,
    signal: Option<String>,
    started_at: String,
    finished_at: Option<String>,
    pid: Option<u32>,
}

pub struct CustomScriptManager {
    executions: Arc<RwLock<HashMap<String, Arc<RwLock<ScriptExecutionState>>>>>,
}

impl Default for CustomScriptManager {
    fn default() -> Self {
        Self::new()
    }
}

impl CustomScriptManager {
    pub fn new() -> Self {
        Self {
            executions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn list(&self) -> Vec<ExecutionResponse> {
        let map = self.executions.read().await;
        let mut list = Vec::new();
        for exec_arc in map.values() {
            let st = exec_arc.read().await;
            list.push(ExecutionResponse {
                execution_id: st.id.clone(),
                cwd: st.cwd.clone(),
                script_name: st.script_name.clone(),
                script_content: st.script_content.clone(),
                status: st.status.clone(),
                cancel_requested: st.cancel_requested,
                output: st.output.clone(),
                exit_code: st.exit_code,
                signal: st.signal.clone(),
                started_at: st.started_at.clone(),
                finished_at: st.finished_at.clone(),
            });
        }
        list
    }

    pub async fn get(&self, id: &str) -> Option<ExecutionResponse> {
        let map = self.executions.read().await;
        let exec_arc = map.get(id)?;
        let st = exec_arc.read().await;
        Some(ExecutionResponse {
            execution_id: st.id.clone(),
            cwd: st.cwd.clone(),
            script_name: st.script_name.clone(),
            script_content: st.script_content.clone(),
            status: st.status.clone(),
            cancel_requested: st.cancel_requested,
            output: st.output.clone(),
            exit_code: st.exit_code,
            signal: st.signal.clone(),
            started_at: st.started_at.clone(),
            finished_at: st.finished_at.clone(),
        })
    }

    pub async fn dismiss(&self, id: &str) -> bool {
        let mut map = self.executions.write().await;
        if let Some(exec_arc) = map.remove(id) {
            let mut st = exec_arc.write().await;
            if st.status == "running" {
                if let Some(pid) = st.pid {
                    kill_process_group(pid, true);
                }
                st.status = "canceled".to_string();
                st.finished_at = Some(chrono_iso_now());
            }
            true
        } else {
            false
        }
    }

    pub async fn cancel(&self, id: &str, force: bool) -> Option<ExecutionResponse> {
        let map = self.executions.read().await;
        let exec_arc = map.get(id)?.clone();
        drop(map);

        let mut st = exec_arc.write().await;
        if st.status == "running" {
            st.cancel_requested = true;
            if let Some(pid) = st.pid {
                if force {
                    st.output.push_str("\n[info] Force termination requested...\n");
                    kill_process_group(pid, true);
                    st.status = "canceled".to_string();
                    st.finished_at = Some(chrono_iso_now());
                } else {
                    st.output.push_str("\n[info] Terminating process...\n");
                    kill_process_group(pid, false);

                    let exec_clone = exec_arc.clone();
                    tokio::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
                        let mut inner = exec_clone.write().await;
                        if inner.status == "running" {
                            inner.output.push_str("\n[info] Process did not terminate after 2s, escalating to SIGKILL...\n");
                            if let Some(p) = inner.pid {
                                kill_process_group(p, true);
                            }
                            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
                            if inner.status == "running" {
                                inner.status = "canceled".to_string();
                                inner.finished_at = Some(chrono_iso_now());
                            }
                        }
                    });
                }
            }
        }

        Some(ExecutionResponse {
            execution_id: st.id.clone(),
            cwd: st.cwd.clone(),
            script_name: st.script_name.clone(),
            script_content: st.script_content.clone(),
            status: st.status.clone(),
            cancel_requested: st.cancel_requested,
            output: st.output.clone(),
            exit_code: st.exit_code,
            signal: st.signal.clone(),
            started_at: st.started_at.clone(),
            finished_at: st.finished_at.clone(),
        })
    }

    pub async fn start(
        &self,
        cwd: String,
        script_name: String,
        script_content: String,
    ) -> Result<ExecutionResponse, String> {
        let target_path = Path::new(&cwd);
        if !target_path.exists() {
            return Err(format!("Directory not found: {cwd}"));
        }
        if !target_path.is_dir() {
            return Err(format!("Path is not a directory: {cwd}"));
        }

        let execution_id = uuid::Uuid::new_v4().to_string();
        let augmented_path = get_augmented_path();

        let mut cmd = tokio::process::Command::new("bash");
        cmd.arg("-s")
            .current_dir(&cwd)
            .env("PATH", augmented_path)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        #[cfg(unix)]
        {
            // Detach child process into its own process group
            // We can spawn and handle process group through standard command or killpg
        }

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn bash: {e}"))?;
        let pid = child.id();

        let state = Arc::new(RwLock::new(ScriptExecutionState {
            id: execution_id.clone(),
            cwd: cwd.clone(),
            script_name: script_name.clone(),
            script_content: script_content.clone(),
            status: "running".to_string(),
            cancel_requested: false,
            output: String::new(),
            exit_code: None,
            signal: None,
            started_at: chrono_iso_now(),
            finished_at: None,
            pid,
        }));

        {
            let mut map = self.executions.write().await;
            map.insert(execution_id.clone(), state.clone());
        }

        let mut stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Write script content to stdin in background
        if let Some(mut stdin) = stdin.take() {
            let content_clone = script_content.clone();
            tokio::spawn(async move {
                let _ = stdin.write_all(content_clone.as_bytes()).await;
                let _ = stdin.shutdown().await;
            });
        }

        // Output reader task
        let state_for_output = state.clone();
        tokio::spawn(async move {
            let mut stdout_reader = stdout.map(tokio::io::BufReader::new);
            let mut stderr_reader = stderr.map(tokio::io::BufReader::new);

            let mut out_buf = [0u8; 4096];
            let mut err_buf = [0u8; 4096];

            loop {
                tokio::select! {
                    res = async {
                        if let Some(ref mut r) = stdout_reader {
                            r.read(&mut out_buf).await
                        } else {
                            futures::future::pending().await
                        }
                    } => {
                        match res {
                            Ok(0) => {
                                stdout_reader = None;
                            }
                            Ok(n) => {
                                let text = String::from_utf8_lossy(&out_buf[..n]);
                                let mut st = state_for_output.write().await;
                                append_output(&mut st.output, &text);
                            }
                            Err(_) => {
                                stdout_reader = None;
                            }
                        }
                    }
                    res = async {
                        if let Some(ref mut r) = stderr_reader {
                            r.read(&mut err_buf).await
                        } else {
                            futures::future::pending().await
                        }
                    } => {
                        match res {
                            Ok(0) => {
                                stderr_reader = None;
                            }
                            Ok(n) => {
                                let text = String::from_utf8_lossy(&err_buf[..n]);
                                let mut st = state_for_output.write().await;
                                append_output(&mut st.output, &text);
                            }
                            Err(_) => {
                                stderr_reader = None;
                            }
                        }
                    }
                    exit_res = child.wait() => {
                        // Flush remaining buffers if any
                        if let Some(mut r) = stdout_reader.take() {
                            let mut buf = Vec::new();
                            let _ = r.read_to_end(&mut buf).await;
                            if !buf.is_empty() {
                                let text = String::from_utf8_lossy(&buf);
                                let mut st = state_for_output.write().await;
                                append_output(&mut st.output, &text);
                            }
                        }
                        if let Some(mut r) = stderr_reader.take() {
                            let mut buf = Vec::new();
                            let _ = r.read_to_end(&mut buf).await;
                            if !buf.is_empty() {
                                let text = String::from_utf8_lossy(&buf);
                                let mut st = state_for_output.write().await;
                                append_output(&mut st.output, &text);
                            }
                        }

                        let mut st = state_for_output.write().await;
                        st.finished_at = Some(chrono_iso_now());
                        match exit_res {
                            Ok(status) => {
                                st.exit_code = status.code();
                                if st.cancel_requested {
                                    st.status = "canceled".to_string();
                                } else if status.success() {
                                    st.status = "completed".to_string();
                                } else {
                                    st.status = "failed".to_string();
                                }
                            }
                            Err(e) => {
                                append_output(&mut st.output, &format!("\n[error] {}\n", e));
                                st.status = if st.cancel_requested { "canceled".to_string() } else { "failed".to_string() };
                            }
                        }
                        break;
                    }
                }

                if stdout_reader.is_none() && stderr_reader.is_none() {
                    // Wait for child to exit
                    let exit_res = child.wait().await;
                    let mut st = state_for_output.write().await;
                    st.finished_at = Some(chrono_iso_now());
                    match exit_res {
                        Ok(status) => {
                            st.exit_code = status.code();
                            if st.cancel_requested {
                                st.status = "canceled".to_string();
                            } else if status.success() {
                                st.status = "completed".to_string();
                            } else {
                                st.status = "failed".to_string();
                            }
                        }
                        Err(e) => {
                            append_output(&mut st.output, &format!("\n[error] {}\n", e));
                            st.status = if st.cancel_requested { "canceled".to_string() } else { "failed".to_string() };
                        }
                    }
                    break;
                }
            }
        });

        let initial_st = state.read().await;
        Ok(ExecutionResponse {
            execution_id,
            cwd: initial_st.cwd.clone(),
            script_name: initial_st.script_name.clone(),
            script_content: initial_st.script_content.clone(),
            status: initial_st.status.clone(),
            cancel_requested: initial_st.cancel_requested,
            output: initial_st.output.clone(),
            exit_code: initial_st.exit_code,
            signal: initial_st.signal.clone(),
            started_at: initial_st.started_at.clone(),
            finished_at: initial_st.finished_at.clone(),
        })
    }
}

fn append_output(output: &mut String, text: &str) {
    output.push_str(text);
    if output.len() > MAX_OUTPUT_LENGTH {
        let trim_idx = output.len() - MAX_OUTPUT_LENGTH;
        *output = output[trim_idx..].to_string();
    }
}

fn kill_process_group(pid: u32, force: bool) {
    #[cfg(unix)]
    {
        let signal = if force { "-9" } else { "-15" };
        // Try kill process group first (-pid), then kill single pid as fallback
        let _ = std::process::Command::new("kill")
            .arg(signal)
            .arg(format!("-{}", pid))
            .output();
        let _ = std::process::Command::new("kill")
            .arg(signal)
            .arg(pid.to_string())
            .output();
    }

    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/pid", &pid.to_string(), "/T", "/F"])
            .output();
    }
}

fn chrono_iso_now() -> String {
    // Rust without full chrono can format standard RFC3339 via std::time
    let now = std::time::SystemTime::now();
    let duration = now.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    let secs = duration.as_secs();
    let millis = duration.subsec_millis();

    // Convert epoch secs to UTC date-time
    let days = secs / 86400;
    let rem_secs = secs % 86400;
    let hours = rem_secs / 3600;
    let minutes = (rem_secs % 3600) / 60;
    let seconds = rem_secs % 60;

    // Approximate ISO 8601 string:
    format!("{}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z", 1970 + (days / 365), 1 + ((days % 365) / 30), 1 + ((days % 365) % 30), hours, minutes, seconds, millis)
}
