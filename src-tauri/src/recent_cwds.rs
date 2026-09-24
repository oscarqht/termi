use std::path::{Path, PathBuf};
use tokio::fs;

pub const MAX_RECENT_CWDS: usize = 15;

fn get_recent_cwds_file_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".termi").join("recent_cwds.json"))
}

pub fn resolve_cwd(target: &str) -> String {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let expanded = if trimmed.starts_with('~') {
        dirs::home_dir()
            .map(|h| trimmed.replacen('~', &h.to_string_lossy(), 1))
            .unwrap_or_else(|| trimmed.to_string())
    } else {
        trimmed.to_string()
    };

    let p = Path::new(&expanded);
    if let Ok(canonical) = std::fs::canonicalize(p) {
        #[cfg(windows)]
        {
            let s = canonical.to_string_lossy().to_string();
            return s.strip_prefix(r"\\?\").unwrap_or(&s).to_string();
        }
        #[cfg(not(windows))]
        {
            return canonical.to_string_lossy().to_string();
        }
    }
    expanded
}

pub async fn load_recent_cwds() -> Vec<String> {
    let path = match get_recent_cwds_file_path() {
        Some(p) => p,
        None => return Vec::new(),
    };

    let content = match fs::read_to_string(&path).await {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let parsed: Vec<String> = match serde_json::from_str(&content) {
        Ok(l) => l,
        Err(_) => return Vec::new(),
    };

    let mut valid = Vec::new();
    let mut changed = false;

    for item in parsed {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            changed = true;
            continue;
        }
        let resolved = resolve_cwd(trimmed);
        if let Ok(meta) = fs::metadata(&resolved).await {
            if meta.is_dir() {
                if !valid.contains(&resolved) {
                    valid.push(resolved);
                } else {
                    changed = true;
                }
            } else {
                changed = true;
            }
        } else {
            changed = true;
        }
    }

    if valid.len() > MAX_RECENT_CWDS {
        valid.truncate(MAX_RECENT_CWDS);
        changed = true;
    }

    if changed {
        let _ = save_recent_cwds(&valid).await;
    }

    valid
}

pub async fn save_recent_cwds(cwds: &[String]) -> Result<(), std::io::Error> {
    let file_path = match get_recent_cwds_file_path() {
        Some(p) => p,
        None => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "Home directory not found",
            ))
        }
    };

    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).await?;
    }

    let slice = if cwds.len() > MAX_RECENT_CWDS {
        &cwds[..MAX_RECENT_CWDS]
    } else {
        cwds
    };

    let json = serde_json::to_string_pretty(slice)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

    let temp_path = file_path.with_extension(format!("tmp.{}", uuid::Uuid::new_v4()));
    fs::write(&temp_path, json).await?;
    fs::rename(&temp_path, &file_path).await?;
    Ok(())
}

pub async fn add_recent_cwd(target: &str) -> Vec<String> {
    let resolved = resolve_cwd(target);
    if resolved.is_empty() {
        return load_recent_cwds().await;
    }

    match fs::metadata(&resolved).await {
        Ok(m) if m.is_dir() => {}
        _ => return load_recent_cwds().await,
    }

    let mut list = load_recent_cwds().await;
    list.retain(|p| p != &resolved);
    list.insert(0, resolved);
    if list.len() > MAX_RECENT_CWDS {
        list.truncate(MAX_RECENT_CWDS);
    }
    let _ = save_recent_cwds(&list).await;
    list
}

pub async fn remove_recent_cwd(target: &str) -> Vec<String> {
    let resolved = resolve_cwd(target);
    let mut list = load_recent_cwds().await;
    list.retain(|p| p != target && p != &resolved);
    let _ = save_recent_cwds(&list).await;
    list
}
