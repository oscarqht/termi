use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, mpsc, RwLock};
use uuid::Uuid;

pub const BUFFER_MAX_CHARS: usize = 1_000_000;

#[derive(Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub cwd: String,
    pub cmd: String,
    pub title: String,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
    pub connected: bool,
}

pub struct OutputBuffer {
    chunks: VecDeque<String>,
    total_len: usize,
    max_chars: usize,
}

impl OutputBuffer {
    pub fn new(max_chars: usize) -> Self {
        Self {
            chunks: VecDeque::new(),
            total_len: 0,
            max_chars,
        }
    }

    pub fn write(&mut self, s: String) {
        if s.is_empty() {
            return;
        }
        self.total_len += s.len();
        self.chunks.push_back(s);

        while let Some(front) = self.chunks.front() {
            if self.total_len - front.len() >= self.max_chars {
                self.total_len -= front.len();
                self.chunks.pop_front();
            } else {
                break;
            }
        }

        if self.total_len > self.max_chars {
            if let Some(front) = self.chunks.front_mut() {
                let overflow = self.total_len - self.max_chars;
                if overflow < front.len() {
                    *front = front[overflow..].to_string();
                    self.total_len = self.max_chars;
                }
            }
        }
    }

    pub fn to_string(&self) -> String {
        self.chunks.iter().cloned().collect()
    }
}

pub struct Session {
    pub id: String,
    pub cwd: String,
    pub cmd: String,
    pub title: RwLock<String>,
    pub created_at: u64,
    pub buffer: RwLock<OutputBuffer>,
    pub client_count: AtomicUsize,
    pub exited: AtomicBool,
    pub master: std::sync::Mutex<Box<dyn MasterPty + Send>>,
    pub writer_tx: mpsc::UnboundedSender<Vec<u8>>,
    pub tx: broadcast::Sender<String>,
    pub upload_dir: PathBuf,
}

impl Session {
    pub fn write_input(&self, data: &str) {
        if !self.exited.load(Ordering::Relaxed) {
            let _ = self.writer_tx.send(data.as_bytes().to_vec());
        }
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        if !self.exited.load(Ordering::Relaxed) && cols > 0 && rows > 0 {
            if let Ok(master) = self.master.lock() {
                let _ = master.resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                });
            }
        }
    }

    pub fn get_info(&self) -> SessionInfo {
        let title = self.title.try_read().map(|t| t.clone()).unwrap_or_default();
        SessionInfo {
            id: self.id.clone(),
            cwd: self.cwd.clone(),
            cmd: self.cmd.clone(),
            title,
            created_at: self.created_at,
            connected: self.client_count.load(Ordering::Relaxed) > 0,
        }
    }
}

pub struct SessionManager {
    sessions: RwLock<HashMap<String, Arc<Session>>>,
}

fn detect_shell() -> (String, Vec<String>) {
    if let Ok(shell) = std::env::var("SHELL") {
        if !shell.trim().is_empty() {
            return (shell, vec!["-l".to_string()]);
        }
    }

    if cfg!(target_os = "windows") {
        let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string());
        (comspec, vec![])
    } else if cfg!(target_os = "macos") {
        ("/bin/zsh".to_string(), vec!["-l".to_string()])
    } else {
        ("/bin/bash".to_string(), vec!["-l".to_string()])
    }
}

pub fn default_cwd() -> String {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string())
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
        }
    }

    pub async fn list(&self) -> Vec<SessionInfo> {
        let map = self.sessions.read().await;
        map.values().map(|s| s.get_info()).collect()
    }

    pub async fn get(&self, id: &str) -> Option<Arc<Session>> {
        let map = self.sessions.read().await;
        map.get(id).cloned()
    }

    pub async fn update_title(&self, id: &str, title: String) -> Option<SessionInfo> {
        let map = self.sessions.read().await;
        if let Some(session) = map.get(id) {
            {
                let mut t = session.title.write().await;
                *t = title;
            }
            Some(session.get_info())
        } else {
            None
        }
    }

    pub async fn create(
        self: &Arc<Self>,
        cwd: String,
        cmd: String,
        title: String,
    ) -> Result<Arc<Session>, String> {
        let id = Uuid::new_v4().to_string();
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {e}"))?;

        let (shell_cmd, shell_args) = detect_shell();
        let mut cmd_builder = CommandBuilder::new(shell_cmd);
        for arg in shell_args {
            cmd_builder.arg(arg);
        }
        cmd_builder.cwd(&cwd);

        // Inherit environment variables
        for (k, v) in std::env::vars() {
            cmd_builder.env(k, v);
        }

        let mut child = pair
            .slave
            .spawn_command(cmd_builder)
            .map_err(|e| format!("Failed to spawn shell: {e}"))?;

        let (tx, _rx) = broadcast::channel(512);
        let (writer_tx, mut writer_rx) = mpsc::unbounded_channel::<Vec<u8>>();

        let mut writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take PTY writer: {e}"))?;

        // Background thread to handle writing to PTY
        std::thread::spawn(move || {
            while let Some(data) = writer_rx.blocking_recv() {
                if writer.write_all(&data).is_err() {
                    break;
                }
                let _ = writer.flush();
            }
        });

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let upload_dir = std::env::temp_dir().join("termi-uploads").join(&id);
        let _ = std::fs::create_dir_all(&upload_dir);

        let session = Arc::new(Session {
            id: id.clone(),
            cwd: cwd.clone(),
            cmd: cmd.clone(),
            title: RwLock::new(title.trim().to_string()),
            created_at: now,
            buffer: RwLock::new(OutputBuffer::new(BUFFER_MAX_CHARS)),
            client_count: AtomicUsize::new(0),
            exited: AtomicBool::new(false),
            master: std::sync::Mutex::new(pair.master),
            writer_tx,
            tx: tx.clone(),
            upload_dir: upload_dir.clone(),
        });

        // Background thread reading output from PTY
        let session_for_read = session.clone();
        let tx_for_read = tx.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        {
                            let mut b = session_for_read.buffer.blocking_write();
                            b.write(text.clone());
                        }
                        let msg = serde_json::json!({
                            "type": "output",
                            "data": text
                        })
                        .to_string();
                        let _ = tx_for_read.send(msg);
                    }
                    Err(_) => break,
                }
            }
        });

        // Background thread waiting for child process exit
        let session_for_exit = session.clone();
        let tx_for_exit = tx.clone();
        let sm = self.clone();
        let session_id = id.clone();
        std::thread::spawn(move || {
            let exit_status = child.wait();
            session_for_exit.exited.store(true, Ordering::Relaxed);
            let code = match exit_status {
                Ok(status) => status.exit_code() as i32,
                Err(_) => 0,
            };
            let msg = serde_json::json!({
                "type": "exit",
                "code": code
            })
            .to_string();
            let _ = tx_for_exit.send(msg);

            // Cleanup upload dir and remove from map
            let _ = std::fs::remove_dir_all(&upload_dir);
            tokio::spawn(async move {
                sm.remove(&session_id).await;
            });
        });

        // If an initial cmd was provided, send it
        if !cmd.trim().is_empty() {
            session.write_input(&format!("{}\r", cmd.trim()));
        }

        self.sessions.write().await.insert(id, session.clone());
        Ok(session)
    }

    pub async fn remove(&self, id: &str) {
        let mut map = self.sessions.write().await;
        if let Some(s) = map.remove(id) {
            s.exited.store(true, Ordering::Relaxed);
            let _ = std::fs::remove_dir_all(&s.upload_dir);
        }
    }
}
