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
    #[serde(default)]
    pub dormant: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SessionRecord {
    pub id: String,
    pub cwd: String,
    pub cmd: String,
    pub title: String,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
}

pub fn get_sessions_file_path() -> Option<PathBuf> {
    crate::daemon::get_daemon_dir().map(|d| d.join("sessions.json"))
}

pub async fn load_saved_session_records() -> Vec<SessionRecord> {
    if let Some(path) = get_sessions_file_path() {
        if path.exists() {
            if let Ok(data) = tokio::fs::read_to_string(&path).await {
                if let Ok(records) = serde_json::from_str::<Vec<SessionRecord>>(&data) {
                    return records;
                }
            }
        }
    }
    Vec::new()
}

pub async fn save_session_records(records: &[SessionRecord]) -> Result<(), std::io::Error> {
    if let Some(path) = get_sessions_file_path() {
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let json = serde_json::to_string_pretty(records)?;
        tokio::fs::write(&path, json).await?;
    }
    Ok(())
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

        // Drop whole chunks from the front while total_len exceeds max_chars
        while let Some(front) = self.chunks.front() {
            if self.total_len.saturating_sub(front.len()) >= self.max_chars {
                self.total_len -= front.len();
                self.chunks.pop_front();
            } else {
                break;
            }
        }

        // If still over max_chars, trim the front chunk at a safe UTF-8 character boundary
        if self.total_len > self.max_chars {
            if let Some(front) = self.chunks.front_mut() {
                let overflow = self.total_len - self.max_chars;
                let trim_idx = front.ceil_char_boundary(overflow);
                if trim_idx < front.len() {
                    *front = front[trim_idx..].to_string();
                    self.total_len -= trim_idx;
                } else {
                    self.total_len -= front.len();
                    self.chunks.pop_front();
                }
            }
        }
    }

    pub fn to_string(&self) -> String {
        let mut result = String::with_capacity(self.total_len);
        for chunk in &self.chunks {
            result.push_str(chunk);
        }
        result
    }

    #[cfg(test)]
    pub fn total_len(&self) -> usize {
        self.total_len
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
    pub dormant: AtomicBool,
    pub master: std::sync::Mutex<Option<Box<dyn MasterPty + Send>>>,
    pub writer_tx: std::sync::RwLock<Option<mpsc::UnboundedSender<Vec<u8>>>>,
    pub tx: broadcast::Sender<String>,
    pub upload_dir: PathBuf,
}

impl Session {
    pub fn write_input(&self, data: &str) {
        if !self.exited.load(Ordering::Relaxed) && !self.dormant.load(Ordering::Relaxed) {
            if let Ok(tx_guard) = self.writer_tx.read() {
                if let Some(ref tx) = *tx_guard {
                    let _ = tx.send(data.as_bytes().to_vec());
                }
            }
        }
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        if !self.exited.load(Ordering::Relaxed) && !self.dormant.load(Ordering::Relaxed) && cols > 0 && rows > 0 {
            if let Ok(guard) = self.master.lock() {
                if let Some(ref master) = *guard {
                    let _ = master.resize(PtySize {
                        rows,
                        cols,
                        pixel_width: 0,
                        pixel_height: 0,
                    });
                }
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
            dormant: self.dormant.load(Ordering::Relaxed),
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

fn spawn_pty(
    session: &Arc<Session>,
    sm: Arc<SessionManager>,
) -> Result<(), String> {
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
    cmd_builder.cwd(&session.cwd);

    // Inherit environment variables
    for (k, v) in std::env::vars() {
        cmd_builder.env(k, v);
    }

    cmd_builder.env("TERM", "xterm-256color");
    cmd_builder.env("COLORTERM", "truecolor");
    cmd_builder.env("TERM_PROGRAM", "Apple_Terminal");
    cmd_builder.env("TERM_PROGRAM_VERSION", "470.2");

    if std::env::var("LANG").map(|l| l.is_empty() || l == "C" || l == "POSIX").unwrap_or(true) {
        cmd_builder.env("LANG", "en_US.UTF-8");
    }
    if std::env::var("LC_ALL").map(|l| l == "C" || l == "POSIX").unwrap_or(false) {
        cmd_builder.env("LC_ALL", "en_US.UTF-8");
    }

    #[cfg(target_os = "macos")]
    {
        let current_path = std::env::var("PATH").unwrap_or_default();
        let mut paths: Vec<String> = current_path.split(':').map(|s| s.to_string()).collect();
        let standard_paths = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"];
        for p in standard_paths {
            if !paths.iter().any(|existing| existing == p) && std::path::Path::new(p).exists() {
                paths.insert(0, p.to_string());
            }
        }
        cmd_builder.env("PATH", paths.join(":"));
    }

    let mut child = pair
        .slave
        .spawn_command(cmd_builder)
        .map_err(|e| format!("Failed to spawn shell: {e}"))?;

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

    {
        let mut master_guard = session.master.lock().unwrap();
        *master_guard = Some(pair.master);
    }
    {
        let mut writer_tx_guard = session.writer_tx.write().unwrap();
        *writer_tx_guard = Some(writer_tx);
    }

    let _ = std::fs::create_dir_all(&session.upload_dir);

    // Background thread reading output from PTY
    let session_for_read = session.clone();
    let tx_for_read = session.tx.clone();
    let session_id_for_read = session.id.clone();
    std::thread::spawn(move || {
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mut buf = [0u8; 4096];
            let mut pending_bytes = Vec::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        eprintln!("[termi] PTY EOF reached for session {session_id_for_read}");
                        break;
                    }
                    Ok(n) => {
                        let mut combined = if pending_bytes.is_empty() {
                            buf[..n].to_vec()
                        } else {
                            let mut v = std::mem::take(&mut pending_bytes);
                            v.extend_from_slice(&buf[..n]);
                            v
                        };

                        let valid_up_to = match std::str::from_utf8(&combined) {
                            Ok(_) => combined.len(),
                            Err(e) => {
                                if e.error_len().is_none() {
                                    e.valid_up_to()
                                } else {
                                    combined.len()
                                }
                            }
                        };

                        if valid_up_to < combined.len() {
                            pending_bytes = combined.split_off(valid_up_to);
                        }

                        let text = String::from_utf8_lossy(&combined).to_string();
                        if !text.is_empty() {
                            let msg = serde_json::json!({
                                "type": "output",
                                "data": text
                            })
                            .to_string();
                            {
                                let mut b = session_for_read.buffer.blocking_write();
                                b.write(text);
                                let _ = tx_for_read.send(msg);
                            }
                        }
                    }
                    Err(e) => {
                        if e.kind() == std::io::ErrorKind::Interrupted {
                            continue;
                        }
                        eprintln!("[termi] PTY read error for session {session_id_for_read}: {e}");
                        break;
                    }
                }
            }
        }));
        if let Err(panic_err) = res {
            eprintln!("[termi] PTY reader thread panicked for session {session_id_for_read}: {panic_err:?}");
        }
    });

    // Background thread waiting for child process exit
    let session_for_exit = session.clone();
    let tx_for_exit = session.tx.clone();
    let upload_dir = session.upload_dir.clone();
    let _ = sm;
    std::thread::spawn(move || {
        let exit_status = child.wait();
        session_for_exit.exited.store(true, Ordering::Relaxed);
        session_for_exit.dormant.store(true, Ordering::Relaxed);
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

        // Reset master and writer_tx so stale file descriptors are closed
        if let Ok(mut master_guard) = session_for_exit.master.lock() {
            *master_guard = None;
        }
        if let Ok(mut writer_tx_guard) = session_for_exit.writer_tx.write() {
            *writer_tx_guard = None;
        }

        let _ = std::fs::remove_dir_all(&upload_dir);
    });

    // If an initial cmd was provided, send it
    if !session.cmd.trim().is_empty() {
        session.write_input(&format!("{}\r", session.cmd.trim()));
    }

    Ok(())
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
        }
    }

    pub async fn load_saved_sessions(&self) {
        let records = load_saved_session_records().await;
        let mut map = self.sessions.write().await;
        for r in records {
            let (tx, _rx) = broadcast::channel(512);
            let upload_dir = std::env::temp_dir().join("termi-uploads").join(&r.id);
            let session = Arc::new(Session {
                id: r.id.clone(),
                cwd: r.cwd.clone(),
                cmd: r.cmd.clone(),
                title: RwLock::new(r.title.clone()),
                created_at: r.created_at,
                buffer: RwLock::new(OutputBuffer::new(BUFFER_MAX_CHARS)),
                client_count: AtomicUsize::new(0),
                exited: AtomicBool::new(false),
                dormant: AtomicBool::new(true),
                master: std::sync::Mutex::new(None),
                writer_tx: std::sync::RwLock::new(None),
                tx,
                upload_dir,
            });
            map.insert(r.id, session);
        }
    }

    pub async fn persist_sessions(&self) {
        let map = self.sessions.read().await;
        let mut records = Vec::new();
        for s in map.values() {
            let title = s.title.read().await.clone();
            records.push(SessionRecord {
                id: s.id.clone(),
                cwd: s.cwd.clone(),
                cmd: s.cmd.clone(),
                title,
                created_at: s.created_at,
            });
        }
        let _ = save_session_records(&records).await;
    }

    pub async fn list(&self) -> Vec<SessionInfo> {
        let map = self.sessions.read().await;
        map.values().map(|s| s.get_info()).collect()
    }

    pub async fn get(&self, id: &str) -> Option<Arc<Session>> {
        let map = self.sessions.read().await;
        map.get(id).cloned()
    }

    pub async fn active_count(&self) -> usize {
        let map = self.sessions.read().await;
        map.values()
            .filter(|s| !s.dormant.load(Ordering::Relaxed) && !s.exited.load(Ordering::Relaxed))
            .count()
    }

    pub async fn total_count(&self) -> usize {
        let map = self.sessions.read().await;
        map.len()
    }

    pub async fn activate(self: &Arc<Self>, id: &str) -> Result<Arc<Session>, String> {
        let session = {
            let map = self.sessions.read().await;
            map.get(id).cloned().ok_or_else(|| "Session not found".to_string())?
        };

        if session.dormant.load(Ordering::Relaxed) || session.exited.load(Ordering::Relaxed) {
            spawn_pty(&session, self.clone())?;
            session.dormant.store(false, Ordering::Relaxed);
            session.exited.store(false, Ordering::Relaxed);
        }

        Ok(session)
    }

    pub async fn update_title(&self, id: &str, title: String) -> Option<SessionInfo> {
        let session = {
            let map = self.sessions.read().await;
            map.get(id).cloned()
        };
        if let Some(s) = session {
            {
                let mut t = s.title.write().await;
                *t = title;
            }
            self.persist_sessions().await;
            Some(s.get_info())
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
        let (tx, _rx) = broadcast::channel(512);
        let upload_dir = std::env::temp_dir().join("termi-uploads").join(&id);

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let session = Arc::new(Session {
            id: id.clone(),
            cwd: cwd.clone(),
            cmd: cmd.clone(),
            title: RwLock::new(title.trim().to_string()),
            created_at: now,
            buffer: RwLock::new(OutputBuffer::new(BUFFER_MAX_CHARS)),
            client_count: AtomicUsize::new(0),
            exited: AtomicBool::new(false),
            dormant: AtomicBool::new(false),
            master: std::sync::Mutex::new(None),
            writer_tx: std::sync::RwLock::new(None),
            tx,
            upload_dir,
        });

        spawn_pty(&session, self.clone())?;

        self.sessions.write().await.insert(id.clone(), session.clone());
        self.persist_sessions().await;

        Ok(session)
    }

    pub async fn remove(&self, id: &str) {
        let session = {
            let mut map = self.sessions.write().await;
            map.remove(id)
        };
        if let Some(s) = session {
            s.exited.store(true, Ordering::Relaxed);
            let _ = std::fs::remove_dir_all(&s.upload_dir);
            self.persist_sessions().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_output_buffer_basic() {
        let mut buf = OutputBuffer::new(10);
        buf.write("hello".to_string());
        assert_eq!(buf.to_string(), "hello");
        assert_eq!(buf.total_len(), 5);

        buf.write("world".to_string());
        assert_eq!(buf.to_string(), "helloworld");
        assert_eq!(buf.total_len(), 10);

        buf.write("!".to_string());
        // Dropped first chunk or trimmed safely to fit within max_chars
        assert!(buf.total_len() <= 10);
        assert!(buf.to_string().ends_with("world!"));
    }

    #[test]
    fn test_output_buffer_multibyte_utf8_no_panic() {
        // Test braille characters, emojis, Chinese characters, box drawing characters
        let mut buf = OutputBuffer::new(10);
        // "⣻" is 3 bytes (0xE2, 0xA3, 0xBB)
        // "你好世界" is 12 bytes
        buf.write("⣻".to_string());
        buf.write("你好世界".to_string());
        buf.write("●".to_string());
        buf.write("🚀".to_string()); // 4 bytes

        assert!(buf.total_len() <= 10);
        let s = buf.to_string();
        // S should be valid UTF-8 and end with the last written character
        assert!(s.ends_with("🚀"));
    }

    #[test]
    fn test_output_buffer_heavy_overflow() {
        let mut buf = OutputBuffer::new(100);
        for i in 0..10_000 {
            buf.write(format!("line {i}: ⣻ spinner test 你好世界 ─│┌┐\n"));
            assert!(buf.total_len() <= 100);
        }
        let output = buf.to_string();
        assert!(!output.is_empty());
        assert!(output.len() <= 100);
    }

    #[tokio::test]
    async fn test_session_records_serde() {
        let records = vec![SessionRecord {
            id: "test-id-1".to_string(),
            cwd: "/tmp".to_string(),
            cmd: "echo 123".to_string(),
            title: "Test Tab".to_string(),
            created_at: 1700000000,
        }];
        let json = serde_json::to_string(&records).unwrap();
        let loaded: Vec<SessionRecord> = serde_json::from_str(&json).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "test-id-1");
        assert_eq!(loaded[0].cwd, "/tmp");
        assert_eq!(loaded[0].title, "Test Tab");
    }

    #[tokio::test]
    async fn test_dormant_session_lifecycle() {
        let sm = Arc::new(SessionManager::new());
        let (tx, _rx) = broadcast::channel(512);
        let session = Arc::new(Session {
            id: "dormant-1".to_string(),
            cwd: default_cwd(),
            cmd: "".to_string(),
            title: RwLock::new("Dormant Shell".to_string()),
            created_at: 1700000000,
            buffer: RwLock::new(OutputBuffer::new(1000)),
            client_count: AtomicUsize::new(0),
            exited: AtomicBool::new(false),
            dormant: AtomicBool::new(true),
            master: std::sync::Mutex::new(None),
            writer_tx: std::sync::RwLock::new(None),
            tx,
            upload_dir: std::env::temp_dir().join("termi-test-upload"),
        });
        sm.sessions.write().await.insert("dormant-1".to_string(), session);

        // Active count should be 0 because the session is dormant
        assert_eq!(sm.active_count().await, 0);

        let info = sm.get("dormant-1").await.unwrap().get_info();
        assert!(info.dormant);
        assert_eq!(info.title, "Dormant Shell");

        // Activating the session spawns the PTY and clears dormant
        let activated = sm.activate("dormant-1").await.expect("Failed to activate");
        assert!(!activated.dormant.load(Ordering::Relaxed));
        assert_eq!(sm.active_count().await, 1);

        // Cleaning up
        sm.remove("dormant-1").await;
        assert_eq!(sm.active_count().await, 0);
        assert!(sm.get("dormant-1").await.is_none());
    }

    #[tokio::test]
    async fn test_session_persistence_when_exited() {
        let sm = Arc::new(SessionManager::new());
        let (tx, _rx) = broadcast::channel(512);
        let session = Arc::new(Session {
            id: "persist-1".to_string(),
            cwd: default_cwd(),
            cmd: "".to_string(),
            title: RwLock::new("Persisted Shell".to_string()),
            created_at: 1700000000,
            buffer: RwLock::new(OutputBuffer::new(1000)),
            client_count: AtomicUsize::new(0),
            exited: AtomicBool::new(true),
            dormant: AtomicBool::new(true),
            master: std::sync::Mutex::new(None),
            writer_tx: std::sync::RwLock::new(None),
            tx,
            upload_dir: std::env::temp_dir().join("termi-test-upload"),
        });
        sm.sessions.write().await.insert("persist-1".to_string(), session);

        assert_eq!(sm.total_count().await, 1);
        assert_eq!(sm.active_count().await, 0);

        // Activating re-spawns PTY and resets exited/dormant
        let activated = sm.activate("persist-1").await.expect("Failed to activate");
        assert!(!activated.dormant.load(Ordering::Relaxed));
        assert!(!activated.exited.load(Ordering::Relaxed));
        assert_eq!(sm.active_count().await, 1);

        sm.remove("persist-1").await;
        assert_eq!(sm.total_count().await, 0);
    }
}
