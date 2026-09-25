use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path as AxumPath, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use futures::{SinkExt, StreamExt};
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use tower_http::cors::CorsLayer;
use uuid::Uuid;

use crate::session::{default_cwd, Session, SessionInfo, SessionManager};

#[derive(RustEmbed)]
#[folder = "../dist"]
struct Assets;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum UpdaterAction {
    Check,
    Install,
}

pub struct AppState {
    pub session_manager: Arc<SessionManager>,
    pub custom_scripts_manager: Arc<crate::custom_scripts::CustomScriptManager>,
    pub updater_status: Arc<tokio::sync::RwLock<crate::updater::UpdateStatus>>,
    pub pending_updater_action: Arc<tokio::sync::Mutex<Option<UpdaterAction>>>,
    pub token: String,
    pub shutdown_tx: tokio::sync::broadcast::Sender<()>,
}

pub fn resolve_host() -> String {
    if let Ok(host) = std::env::var("HOST") {
        if !host.trim().is_empty() {
            return host.trim().to_string();
        }
    }

    if let Ok(interfaces) = local_ip_address::list_afinet_netifas() {
        for (_name, ip) in interfaces {
            if let std::net::IpAddr::V4(ipv4) = ip {
                let octets = ipv4.octets();
                // Tailscale CGNAT range 100.64.0.0/10 (100.64.x.x - 100.127.x.x)
                if octets[0] == 100 && (64..=127).contains(&octets[1]) {
                    return ipv4.to_string();
                }
            }
        }
    }

    "127.0.0.1".to_string()
}

fn sanitize_filename(name: &str) -> String {
    let file_name = Path::new(name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("upload")
        .trim();
    let cleaned: String = file_name
        .chars()
        .map(|c| if c == '/' || c == '\\' || c == '\0' { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim_start_matches('.');
    if trimmed.is_empty() {
        "upload".to_string()
    } else {
        trimmed.to_string()
    }
}

fn unique_dest_path(dir: &Path, name: &str) -> PathBuf {
    let dest = dir.join(name);
    if !dest.exists() {
        return dest;
    }
    let p = Path::new(name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("upload");
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    loop {
        let short_id = &Uuid::new_v4().to_string()[..8];
        let candidate = dir.join(format!("{stem}-{short_id}{ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
}

#[derive(Deserialize)]
pub struct CreateSessionBody {
    pub cwd: Option<String>,
    pub cmd: Option<String>,
    pub title: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateSessionBody {
    pub title: Option<String>,
}

async fn list_sessions(State(state): State<Arc<AppState>>) -> Json<Vec<SessionInfo>> {
    Json(state.session_manager.list().await)
}

async fn get_session(
    AxumPath(id): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<SessionInfo>, (StatusCode, Json<serde_json::Value>)> {
    match state.session_manager.get(&id).await {
        Some(s) => Ok(Json(s.get_info())),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Session not found" })),
        )),
    }
}

async fn update_session(
    AxumPath(id): AxumPath<String>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<UpdateSessionBody>,
) -> Result<Json<SessionInfo>, (StatusCode, Json<serde_json::Value>)> {
    if let Some(title) = body.title {
        match state.session_manager.update_title(&id, title).await {
            Some(info) => Ok(Json(info)),
            None => Err((
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Session not found" })),
            )),
        }
    } else {
        get_session(AxumPath(id), State(state)).await
    }
}

async fn create_session(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateSessionBody>,
) -> Result<Json<SessionInfo>, (StatusCode, Json<serde_json::Value>)> {
    let req_cwd = body.cwd.unwrap_or_else(default_cwd);
    let resolved_cwd = if req_cwd.starts_with('~') {
        dirs::home_dir()
            .map(|h| req_cwd.replacen('~', &h.to_string_lossy(), 1))
            .unwrap_or(req_cwd)
    } else {
        req_cwd
    };

    let p = Path::new(&resolved_cwd);
    if !p.exists() || !p.is_dir() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": format!("Directory does not exist: {resolved_cwd}") })),
        ));
    }

    let cmd = body.cmd.unwrap_or_default();
    let title = body.title.unwrap_or_default();
    match state.session_manager.create(resolved_cwd.clone(), cmd, title).await {
        Ok(session) => {
            crate::recent_cwds::add_recent_cwd(&resolved_cwd).await;
            Ok(Json(session.get_info()))
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )),
    }
}

async fn delete_session(
    AxumPath(id): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    state.session_manager.remove(&id).await;
    Json(serde_json::json!({ "success": true }))
}

async fn get_default_cwd() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "cwd": default_cwd() }))
}

#[derive(Deserialize, Default)]
pub struct CwdBody {
    pub cwd: Option<String>,
}

#[derive(Deserialize, Default)]
pub struct DeleteCwdQuery {
    pub cwd: Option<String>,
}

async fn get_recent_cwds() -> Json<serde_json::Value> {
    let cwds = crate::recent_cwds::load_recent_cwds().await;
    Json(serde_json::json!({
        "cwds": cwds,
        "defaultCwd": default_cwd(),
    }))
}

async fn add_recent_cwd_handler(
    Json(body): Json<CwdBody>,
) -> Json<serde_json::Value> {
    let target = body.cwd.unwrap_or_default();
    let cwds = crate::recent_cwds::add_recent_cwd(&target).await;
    Json(serde_json::json!({ "cwds": cwds }))
}

async fn delete_recent_cwd_handler(
    Query(query): Query<DeleteCwdQuery>,
    body_bytes: axum::body::Bytes,
) -> Json<serde_json::Value> {
    let mut target = query.cwd.unwrap_or_default();
    if target.is_empty() && !body_bytes.is_empty() {
        if let Ok(val) = serde_json::from_slice::<CwdBody>(&body_bytes) {
            if let Some(c) = val.cwd {
                target = c;
            }
        }
    }
    let cwds = crate::recent_cwds::remove_recent_cwd(&target).await;
    Json(serde_json::json!({ "cwds": cwds }))
}

async fn pick_folder_native() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let output = tokio::process::Command::new("osascript")
            .arg("-e")
            .arg("POSIX path of (choose folder with prompt \"Select working directory\")")
            .output()
            .await
            .map_err(|e| format!("Failed to run osascript: {e}"))?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut path = stdout.trim().to_string();
            if path.len() > 1 && path.ends_with('/') {
                path.pop();
            }
            if !path.is_empty() {
                return Ok(Some(path));
            }
            return Ok(None);
        }

        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("-128") || stderr.to_lowercase().contains("user cancel") {
            return Ok(None);
        }

        Err(format!("Folder picker failed: {}", stderr.trim()))
    }

    #[cfg(target_os = "windows")]
    {
        let ps_cmd = r#"Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select working directory'; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }"#;
        let output = tokio::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", ps_cmd])
            .output()
            .await
            .map_err(|e| format!("Failed to run PowerShell folder picker: {e}"))?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let path = stdout.trim().to_string();
            if !path.is_empty() {
                return Ok(Some(path));
            }
            return Ok(None);
        }

        Err("PowerShell folder picker failed".to_string())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if let Ok(output) = tokio::process::Command::new("zenity")
            .args(["--file-selection", "--directory", "--title=Select working directory"])
            .output()
            .await
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let mut path = stdout.trim().to_string();
                if path.len() > 1 && path.ends_with('/') {
                    path.pop();
                }
                if !path.is_empty() {
                    return Ok(Some(path));
                }
                return Ok(None);
            }
            if output.status.code() == Some(1) {
                return Ok(None);
            }
        }

        if let Ok(output) = tokio::process::Command::new("kdialog")
            .args(["--getexistingdirectory", "--title", "Select working directory"])
            .output()
            .await
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let mut path = stdout.trim().to_string();
                if path.len() > 1 && path.ends_with('/') {
                    path.pop();
                }
                if !path.is_empty() {
                    return Ok(Some(path));
                }
                return Ok(None);
            }
            if output.status.code() == Some(1) {
                return Ok(None);
            }
        }

        Err("Native folder picker is not supported or not installed (requires zenity or kdialog)".to_string())
    }
}

async fn choose_folder() -> Json<serde_json::Value> {
    match pick_folder_native().await {
        Ok(Some(path_str)) => {
            crate::recent_cwds::add_recent_cwd(&path_str).await;
            Json(serde_json::json!({ "cwd": path_str }))
        }
        Ok(None) => Json(serde_json::json!({ "cwd": null })),
        Err(err) => Json(serde_json::json!({ "cwd": null, "error": err })),
    }
}

async fn get_saved_prompts_handler() -> Json<Vec<crate::prompts::SavedPrompt>> {
    Json(crate::prompts::load_saved_prompts().await)
}

async fn save_saved_prompts_handler(
    Json(body): Json<Vec<crate::prompts::SavedPrompt>>,
) -> Result<Json<Vec<crate::prompts::SavedPrompt>>, (StatusCode, Json<serde_json::Value>)> {
    match crate::prompts::save_saved_prompts(&body).await {
        Ok(_) => Ok(Json(body)),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("Failed to save prompts: {e}") })),
        )),
    }
}

async fn get_custom_scripts_config_handler() -> Json<Vec<crate::custom_scripts::CustomScript>> {
    Json(crate::custom_scripts::load_custom_scripts().await)
}

async fn save_custom_scripts_config_handler(
    Json(body): Json<Vec<crate::custom_scripts::CustomScript>>,
) -> Result<Json<Vec<crate::custom_scripts::CustomScript>>, (StatusCode, Json<serde_json::Value>)> {
    match crate::custom_scripts::save_custom_scripts(&body).await {
        Ok(_) => Ok(Json(body)),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("Failed to save custom scripts: {e}") })),
        )),
    }
}

async fn list_custom_scripts_handler(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    let executions = state.custom_scripts_manager.list().await;
    Json(serde_json::json!({ "success": true, "executions": executions }))
}

async fn handle_custom_scripts_command(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<crate::custom_scripts::CustomScriptPayload>,
) -> (StatusCode, Json<serde_json::Value>) {
    match payload.command.as_str() {
        "list" => {
            let executions = state.custom_scripts_manager.list().await;
            (StatusCode::OK, Json(serde_json::json!({ "success": true, "executions": executions })))
        }
        "status" => {
            let id = payload.execution_id.unwrap_or_default();
            if let Some(res) = state.custom_scripts_manager.get(&id).await {
                (
                    StatusCode::OK,
                    Json(serde_json::json!({
                        "success": true,
                        "executionId": res.execution_id,
                        "cwd": res.cwd,
                        "scriptName": res.script_name,
                        "scriptContent": res.script_content,
                        "status": res.status,
                        "cancelRequested": res.cancel_requested,
                        "output": res.output,
                        "exitCode": res.exit_code,
                        "signal": res.signal,
                        "startedAt": res.started_at,
                        "finishedAt": res.finished_at,
                    })),
                )
            } else {
                (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Execution not found" })))
            }
        }
        "cancel" => {
            let id = payload.execution_id.unwrap_or_default();
            let force = payload.force.unwrap_or(false);
            if let Some(res) = state.custom_scripts_manager.cancel(&id, force).await {
                (
                    StatusCode::OK,
                    Json(serde_json::json!({
                        "success": true,
                        "executionId": res.execution_id,
                        "cwd": res.cwd,
                        "scriptName": res.script_name,
                        "scriptContent": res.script_content,
                        "status": res.status,
                        "cancelRequested": res.cancel_requested,
                        "output": res.output,
                        "exitCode": res.exit_code,
                        "signal": res.signal,
                        "startedAt": res.started_at,
                        "finishedAt": res.finished_at,
                    })),
                )
            } else {
                (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Execution not found" })))
            }
        }
        "dismiss" => {
            let id = payload.execution_id.unwrap_or_default();
            state.custom_scripts_manager.dismiss(&id).await;
            (StatusCode::OK, Json(serde_json::json!({ "success": true })))
        }
        "start" => {
            let cwd = payload.cwd.unwrap_or_else(default_cwd);
            let script_name = payload.script_name.unwrap_or_else(|| "Custom Script".to_string());
            let script_content = payload.script_content.unwrap_or_default();

            match state.custom_scripts_manager.start(cwd, script_name, script_content).await {
                Ok(res) => (
                    StatusCode::OK,
                    Json(serde_json::json!({
                        "success": true,
                        "executionId": res.execution_id,
                        "cwd": res.cwd,
                        "scriptName": res.script_name,
                        "scriptContent": res.script_content,
                        "status": res.status,
                        "cancelRequested": res.cancel_requested,
                        "output": res.output,
                        "exitCode": res.exit_code,
                        "signal": res.signal,
                        "startedAt": res.started_at,
                        "finishedAt": res.finished_at,
                    })),
                ),
                Err(err) => (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": err })),
                ),
            }
        }
        other => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": format!("Unknown command: {other}") })),
        ),
    }
}

async fn get_updater_status(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let mgr_status = state.updater_status.read().await.clone();
    let current_version = env!("CARGO_PKG_VERSION");
    Json(serde_json::json!({
        "current_version": current_version,
        "status": mgr_status,
    }))
}

async fn check_updater(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let mut pending = state.pending_updater_action.lock().await;
    *pending = Some(UpdaterAction::Check);
    Json(serde_json::json!({ "success": true }))
}

async fn install_updater(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let mut pending = state.pending_updater_action.lock().await;
    *pending = Some(UpdaterAction::Install);
    Ok(Json(serde_json::json!({ "success": true })))
}

async fn get_updater_action(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !verify_token(&state, &headers) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let mut pending = state.pending_updater_action.lock().await;
    let action = pending.take();
    let action_str = match action {
        Some(UpdaterAction::Check) => Some("check"),
        Some(UpdaterAction::Install) => Some("install"),
        None => None,
    };
    Ok(Json(serde_json::json!({ "action": action_str })))
}

async fn update_daemon_updater_status(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Json(status): Json<crate::updater::UpdateStatus>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !verify_token(&state, &headers) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let mut guard = state.updater_status.write().await;
    *guard = status;
    Ok(Json(serde_json::json!({ "success": true })))
}

async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

async fn daemon_info_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let count = state.session_manager.active_count().await;
    let total = state.session_manager.total_count().await;
    Json(serde_json::json!({
        "pid": std::process::id(),
        "version": env!("CARGO_PKG_VERSION"),
        "activeSessions": count,
        "totalSessions": total
    }))
}

async fn daemon_session_count_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let count = state.session_manager.active_count().await;
    let total = state.session_manager.total_count().await;
    Json(serde_json::json!({
        "activeSessions": count,
        "totalSessions": total
    }))
}

async fn daemon_shutdown_handler(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !verify_token(&state, &headers) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let tx = state.shutdown_tx.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let _ = tx.send(());
    });
    Ok(Json(serde_json::json!({ "success": true, "message": "Daemon shutting down" })))
}

async fn activate_session_handler(
    AxumPath(id): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<SessionInfo>, (StatusCode, Json<serde_json::Value>)> {
    match state.session_manager.activate(&id).await {
        Ok(s) => Ok(Json(s.get_info())),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )),
    }
}

fn verify_token(state: &AppState, headers: &axum::http::HeaderMap) -> bool {
    if let Some(token_header) = headers.get("X-Termi-Token") {
        if let Ok(token_str) = token_header.to_str() {
            return token_str == state.token;
        }
    }
    false
}

#[derive(Deserialize)]
pub struct UploadQuery {
    pub name: Option<String>,
}

async fn upload_file(
    AxumPath(id): AxumPath<String>,
    Query(query): Query<UploadQuery>,
    State(state): State<Arc<AppState>>,
    body: axum::body::Bytes,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let session = match state.session_manager.get(&id).await {
        Some(s) => s,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Session not found" })),
            ))
        }
    };

    let raw_name = query.name.unwrap_or_else(|| "upload".to_string());
    let safe_name = sanitize_filename(&raw_name);
    let dest_path = unique_dest_path(&session.upload_dir, &safe_name);

    if let Err(e) = std::fs::write(&dest_path, &body) {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("Failed to write file: {e}") })),
        ));
    }

    let file_name = dest_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("upload")
        .to_string();
    Ok(Json(serde_json::json!({
        "path": dest_path.to_string_lossy(),
        "name": file_name
    })))
}

#[derive(Deserialize)]
pub struct WsQuery {
    pub session: Option<String>,
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(query): Query<WsQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let session_id = match query.session {
        Some(id) => id,
        None => {
            return (StatusCode::BAD_REQUEST, "Missing session parameter").into_response();
        }
    };

    let session = match state.session_manager.activate(&session_id).await {
        Ok(s) => s,
        Err(_) => {
            return (StatusCode::NOT_FOUND, "Session not found").into_response();
        }
    };

    ws.on_upgrade(move |socket| handle_ws_socket(socket, session))
}

async fn handle_ws_socket(socket: WebSocket, session: Arc<Session>) {
    session.client_count.fetch_add(1, Ordering::Relaxed);
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Snapshot buffer and subscribe atomically under the read lock to prevent
    // dropping any messages or sending duplicate replay text.
    let (initial_data, mut rx) = {
        let b = session.buffer.read().await;
        (b.to_string(), session.tx.subscribe())
    };

    // Replay buffered output to newly connected client in chunks if large
    if !initial_data.is_empty() {
        const CHUNK_SIZE: usize = 65536;
        if initial_data.len() > CHUNK_SIZE {
            let mut start = 0;
            while start < initial_data.len() {
                let target_end = (start + CHUNK_SIZE).min(initial_data.len());
                let end = initial_data.ceil_char_boundary(target_end);
                let chunk = &initial_data[start..end];
                let msg = serde_json::json!({
                    "type": "output",
                    "data": chunk
                })
                .to_string();
                if ws_sender.send(Message::Text(msg.into())).await.is_err() {
                    session.client_count.fetch_sub(1, Ordering::Relaxed);
                    return;
                }
                start = end;
            }
        } else {
            let msg = serde_json::json!({
                "type": "output",
                "data": initial_data
            })
            .to_string();
            if ws_sender.send(Message::Text(msg.into())).await.is_err() {
                session.client_count.fetch_sub(1, Ordering::Relaxed);
                return;
            }
        }
    }

    // Forward session PTY output to WS
    let mut send_task = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(msg) => {
                    if ws_sender.send(Message::Text(msg.into())).await.is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    eprintln!("[termi] WS broadcast lagged by {skipped} messages");
                    continue;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    break;
                }
            }
        }
    });

    // Receive user inputs and resize events from WS
    let session_for_recv = session.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Text(text) => {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                        let msg_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
                        if msg_type == "input" {
                            if let Some(data) = val.get("data").and_then(|v| v.as_str()) {
                                session_for_recv.write_input(data);
                            }
                        } else if msg_type == "resize" {
                            let cols = val.get("cols").and_then(|v| v.as_u64()).unwrap_or(80) as u16;
                            let rows = val.get("rows").and_then(|v| v.as_u64()).unwrap_or(24) as u16;
                            session_for_recv.resize(cols, rows);
                        }
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    }

    session.client_count.fetch_sub(1, Ordering::Relaxed);
}

async fn static_or_spa_fallback(uri: axum::http::Uri) -> axum::response::Response {
    let mut path = uri.path().trim_start_matches('/');
    if path.is_empty() {
        path = "index.html";
    }

    if let Some(file) = Assets::get(path) {
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        return (
            [(axum::http::header::CONTENT_TYPE, mime.as_ref())],
            file.data,
        )
            .into_response();
    }

    // Fallback to index.html for SPA routes (e.g. /term, /session)
    if let Some(index) = Assets::get("index.html") {
        return (
            [(axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8")],
            index.data,
        )
            .into_response();
    }

    (StatusCode::NOT_FOUND, "Not Found").into_response()
}

pub fn get_default_port() -> u16 {
    if crate::is_dev() {
        3201
    } else {
        3200
    }
}

pub async fn start_server(
    session_manager: Arc<SessionManager>,
    token: String,
    shutdown_tx: tokio::sync::broadcast::Sender<()>,
) -> Result<(String, u16, Arc<AppState>, tokio::task::JoinHandle<()>), Box<dyn std::error::Error + Send + Sync>> {
    let host = resolve_host();
    let default_port = get_default_port();
    let initial_port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(default_port);

    let mut listener = None;
    let mut bound_port = initial_port;

    for port in initial_port..(initial_port + 50) {
        let addr = format!("0.0.0.0:{port}");
        match tokio::net::TcpListener::bind(&addr).await {
            Ok(l) => {
                listener = Some(l);
                bound_port = port;
                break;
            }
            Err(_) => {
                eprintln!("[termi] Port {port} in use, trying {}...", port + 1);
            }
        }
    }

    let listener = match listener {
        Some(l) => l,
        None => {
            return Err(format!(
                "Could not bind to any port in range {initial_port}..{}",
                initial_port + 50
            )
            .into());
        }
    };

    let server_url = format!("http://{host}:{bound_port}");
    println!("[termi] Server listening on {server_url}");

    let custom_scripts_manager = Arc::new(crate::custom_scripts::CustomScriptManager::new());

    let state = Arc::new(AppState {
        session_manager,
        custom_scripts_manager,
        updater_status: Arc::new(tokio::sync::RwLock::new(crate::updater::UpdateStatus::Idle)),
        pending_updater_action: Arc::new(tokio::sync::Mutex::new(None)),
        token,
        shutdown_tx: shutdown_tx.clone(),
    });

    let mut shutdown_rx = shutdown_tx.subscribe();

    let app = Router::new()
        .route("/api/health", get(health_check))
        .route("/api/daemon/info", get(daemon_info_handler))
        .route("/api/daemon/session-count", get(daemon_session_count_handler))
        .route("/api/daemon/shutdown", post(daemon_shutdown_handler))
        .route("/api/daemon/updater-status", post(update_daemon_updater_status))
        .route("/api/daemon/updater-action", get(get_updater_action))
        .route("/api/sessions", get(list_sessions).post(create_session))
        .route(
            "/api/sessions/{id}",
            get(get_session)
                .patch(update_session)
                .delete(delete_session),
        )
        .route("/api/sessions/{id}/activate", post(activate_session_handler))
        .route("/api/sessions/{id}/upload", post(upload_file))
        .route("/api/default-cwd", get(get_default_cwd))
        .route(
            "/api/recent-cwds",
            get(get_recent_cwds)
                .post(add_recent_cwd_handler)
                .delete(delete_recent_cwd_handler),
        )
        .route("/api/choose-folder", post(choose_folder))
        .route(
            "/api/prompts",
            get(get_saved_prompts_handler).put(save_saved_prompts_handler),
        )
        .route(
            "/api/custom-scripts/config",
            get(get_custom_scripts_config_handler).put(save_custom_scripts_config_handler),
        )
        .route(
            "/api/custom-scripts",
            get(list_custom_scripts_handler).post(handle_custom_scripts_command),
        )
        .route("/api/updater/status", get(get_updater_status))
        .route("/api/updater/check", post(check_updater))
        .route("/api/updater/install", post(install_updater))
        .route("/ws/pty", get(ws_handler))
        .fallback(static_or_spa_fallback)
        .layer(CorsLayer::permissive())
        .with_state(state.clone());

    let handle = tokio::spawn(async move {
        let server = axum::serve(listener, app);
        if let Err(e) = server
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.recv().await;
            })
            .await
        {
            eprintln!("[termi] Server error: {e}");
        }
    });

    Ok((server_url, bound_port, state, handle))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_port_dev_vs_prod() {
        let _guard = crate::ENV_LOCK.lock().unwrap();

        // Dev mode (default during debug test)
        assert_eq!(get_default_port(), 3201);

        // Prod mode
        std::env::set_var("TERMI_ENV", "production");
        assert_eq!(get_default_port(), 3200);
        std::env::remove_var("TERMI_ENV");
    }
}
