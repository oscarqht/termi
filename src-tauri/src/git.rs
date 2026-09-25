use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktree {
    pub path: String,
    pub head: String,
    pub branch: String,
    pub commit_msg: String,
    pub is_main: bool,
    pub relative: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub is_repo: bool,
    pub repo_root: Option<String>,
    pub common_dir: Option<String>,
    pub current_branch: Option<String>,
    pub branches: Vec<String>,
    pub worktrees: Vec<GitWorktree>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorktreeResult {
    pub worktree_path: String,
    pub branch: String,
    pub base_branch: String,
    pub remote_sync_warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteWorktreeResult {
    pub ok: bool,
    pub branch_deleted: bool,
    pub error: Option<String>,
}

pub fn normalize_branch_name(raw: &str) -> String {
    let raw = raw.trim();
    if raw.is_empty() {
        return String::new();
    }

    let mut s = String::new();
    let mut prev_slash = false;
    for c in raw.chars() {
        if c == '/' || c == '\\' {
            if !prev_slash {
                s.push('/');
                prev_slash = true;
            }
        } else {
            prev_slash = false;
            s.push(c.to_ascii_lowercase());
        }
    }

    let segments: Vec<String> = s
        .split('/')
        .map(|seg| {
            let mut cleaned = String::new();
            for c in seg.chars() {
                if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                    cleaned.push(c);
                } else {
                    cleaned.push('-');
                }
            }
            let mut collapsed = String::new();
            let mut prev_dash = false;
            for c in cleaned.chars() {
                if c == '-' {
                    if !prev_dash {
                        collapsed.push(c);
                        prev_dash = true;
                    }
                } else {
                    prev_dash = false;
                    collapsed.push(c);
                }
            }
            collapsed.trim_matches(|c| c == '-' || c == '.').to_string()
        })
        .filter(|seg| !seg.is_empty())
        .collect();

    segments.join("/")
}

async fn run_git(cwd: &str, args: &[&str]) -> Result<(bool, String, String), String> {
    let output = tokio::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(|e| format!("Failed to execute git: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Ok((output.status.success(), stdout, stderr))
}

pub async fn ensure_worktrees_excluded(repo_root: &str, common_dir: &str) {
    let base_dir = if !common_dir.is_empty() {
        let p = Path::new(common_dir);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            Path::new(repo_root).join(p)
        }
    } else {
        Path::new(repo_root).join(".git")
    };

    let exclude_path = base_dir.join("info").join("exclude");
    if let Ok(content) = tokio::fs::read_to_string(&exclude_path).await {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed == ".worktrees" || trimmed == ".worktrees/" {
                return;
            }
        }
        let mut new_content = content;
        if !new_content.ends_with('\n') && !new_content.is_empty() {
            new_content.push('\n');
        }
        new_content.push_str(".worktrees\n.worktrees/\n");
        let _ = tokio::fs::write(&exclude_path, new_content).await;
    } else if let Some(parent) = exclude_path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
        let _ = tokio::fs::write(&exclude_path, ".worktrees\n.worktrees/\n").await;
    }
}

pub async fn get_git_info(cwd: &str) -> GitInfo {
    let p = Path::new(cwd);
    if !p.exists() || !p.is_dir() {
        return GitInfo {
            is_repo: false,
            repo_root: None,
            common_dir: None,
            current_branch: None,
            branches: Vec::new(),
            worktrees: Vec::new(),
            error: Some("Directory does not exist".to_string()),
        };
    }

    let is_inside = match run_git(cwd, &["rev-parse", "--is-inside-work-tree"]).await {
        Ok((success, stdout, _)) => success && stdout == "true",
        Err(e) => {
            return GitInfo {
                is_repo: false,
                repo_root: None,
                common_dir: None,
                current_branch: None,
                branches: Vec::new(),
                worktrees: Vec::new(),
                error: Some(e),
            };
        }
    };

    if !is_inside {
        return GitInfo {
            is_repo: false,
            repo_root: None,
            common_dir: None,
            current_branch: None,
            branches: Vec::new(),
            worktrees: Vec::new(),
            error: None,
        };
    }

    let repo_root = match run_git(cwd, &["rev-parse", "--show-toplevel"]).await {
        Ok((true, stdout, _)) => stdout,
        _ => cwd.to_string(),
    };

    let common_dir = match run_git(cwd, &["rev-parse", "--git-common-dir"]).await {
        Ok((true, stdout, _)) => {
            let p = Path::new(&stdout);
            if p.is_absolute() {
                stdout
            } else {
                Path::new(&repo_root).join(p).to_string_lossy().to_string()
            }
        }
        _ => Path::new(&repo_root).join(".git").to_string_lossy().to_string(),
    };

    let current_branch = match run_git(cwd, &["symbolic-ref", "--short", "HEAD"]).await {
        Ok((true, stdout, _)) if !stdout.is_empty() => Some(stdout),
        _ => match run_git(cwd, &["rev-parse", "--short", "HEAD"]).await {
            Ok((true, stdout, _)) if !stdout.is_empty() => Some(stdout),
            _ => None,
        },
    };

    // List remotes so we can ignore remote names and strip remote prefixes
    let remotes: Vec<String> = match run_git(&repo_root, &["remote"]).await {
        Ok((true, stdout, _)) => stdout
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        _ => vec!["origin".to_string()],
    };

    // List all branches (local and remote)
    let mut raw_branches = Vec::new();
    if let Ok((true, stdout, _)) = run_git(
        &repo_root,
        &["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"],
    )
    .await
    {
        for line in stdout.lines() {
            let refname = line.trim();
            if refname.is_empty() || refname.ends_with("/HEAD") || refname.contains("->") {
                continue;
            }

            let branch_name = if let Some(local) = refname.strip_prefix("refs/heads/") {
                local.to_string()
            } else if let Some(remote_ref) = refname.strip_prefix("refs/remotes/") {
                if let Some((_remote_name, r_branch)) = remote_ref.split_once('/') {
                    if r_branch == "HEAD" || r_branch.is_empty() {
                        continue;
                    }
                    r_branch.to_string()
                } else {
                    continue;
                }
            } else {
                continue;
            };

            let clean = branch_name.trim();
            if clean.is_empty()
                || clean == "HEAD"
                || clean == "origin"
                || remotes.iter().any(|r| r == clean)
            {
                continue;
            }

            if !raw_branches.contains(&clean.to_string()) {
                raw_branches.push(clean.to_string());
            }
        }
    }

    let mut branches = Vec::new();
    if let Some(ref cur) = current_branch {
        if cur != "origin"
            && cur != "HEAD"
            && !remotes.iter().any(|r| r == cur)
            && (raw_branches.contains(cur) || raw_branches.is_empty())
        {
            branches.push(cur.clone());
        }
    }
    if !branches.contains(&"main".to_string()) && raw_branches.contains(&"main".to_string()) {
        branches.push("main".to_string());
    }
    if !branches.contains(&"master".to_string()) && raw_branches.contains(&"master".to_string()) {
        branches.push("master".to_string());
    }
    for b in raw_branches {
        if !branches.contains(&b) {
            branches.push(b);
        }
    }

    // List worktrees
    let mut worktrees = Vec::new();
    if let Ok((true, stdout, _)) =
        run_git(&repo_root, &["worktree", "list", "--porcelain"]).await
    {
        let blocks: Vec<&str> = stdout.split("\n\n").collect();
        for block in blocks {
            let mut wt_path = String::new();
            let mut head = String::new();
            let mut branch = String::new();
            for line in block.lines() {
                if let Some(p) = line.strip_prefix("worktree ") {
                    wt_path = p.trim().to_string();
                } else if let Some(h) = line.strip_prefix("HEAD ") {
                    head = h.trim().to_string();
                } else if let Some(b) = line.strip_prefix("branch refs/heads/") {
                    branch = b.trim().to_string();
                }
            }
            if wt_path.is_empty() {
                continue;
            }
            let is_main = wt_path == repo_root;
            let relative = if is_main {
                ".".to_string()
            } else if let Ok(rel) = Path::new(&wt_path).strip_prefix(&repo_root) {
                rel.to_string_lossy().to_string()
            } else {
                wt_path.clone()
            };

            let commit_msg = if !head.is_empty() {
                match run_git(&repo_root, &["log", "-1", "--format=%s", &head]).await {
                    Ok((true, stdout, _)) => stdout,
                    _ => String::new(),
                }
            } else {
                String::new()
            };

            let short_head = if head.len() > 7 {
                head[..7].to_string()
            } else {
                head
            };

            worktrees.push(GitWorktree {
                path: wt_path,
                head: short_head,
                branch,
                commit_msg,
                is_main,
                relative,
            });
        }
    }

    ensure_worktrees_excluded(&repo_root, &common_dir).await;

    GitInfo {
        is_repo: true,
        repo_root: Some(repo_root),
        common_dir: Some(common_dir),
        current_branch,
        branches,
        worktrees,
        error: None,
    }
}

pub async fn create_worktree_session(
    repo_root: &str,
    base_branch: &str,
    new_branch_raw: &str,
) -> Result<CreateWorktreeResult, String> {
    let new_branch = normalize_branch_name(new_branch_raw);
    if new_branch.is_empty() {
        return Err("Branch name cannot be empty".to_string());
    }

    // Check branch collision
    if let Ok((true, _, _)) = run_git(
        repo_root,
        &["rev-parse", "--verify", &format!("refs/heads/{}", new_branch)],
    )
    .await
    {
        return Err(format!("Branch '{new_branch}' already exists"));
    }

    // Attempt to fetch latest from remote
    let mut remote_sync_warning = None;
    let fetch_res = run_git(repo_root, &["fetch", "origin", base_branch]).await;
    let mut start_point = base_branch.to_string();

    match fetch_res {
        Ok((true, _, _)) => {
            if let Ok((true, _, _)) = run_git(
                repo_root,
                &[
                    "rev-parse",
                    "--verify",
                    &format!("refs/remotes/origin/{}", base_branch),
                ],
            )
            .await
            {
                start_point = format!("origin/{base_branch}");
            }
        }
        _ => {
            remote_sync_warning = Some(format!(
                "Could not fetch remote 'origin/{base_branch}'. Branched off local '{base_branch}' instead."
            ));
        }
    }

    let folder_slug = new_branch.replace('/', "-");
    let worktree_dir = Path::new(repo_root).join(".worktrees").join(&folder_slug);
    if worktree_dir.exists() {
        return Err(format!(
            "Worktree directory already exists: {}",
            worktree_dir.display()
        ));
    }

    let worktrees_parent = Path::new(repo_root).join(".worktrees");
    let _ = tokio::fs::create_dir_all(&worktrees_parent).await;

    let wt_path_str = worktree_dir.to_string_lossy().to_string();
    let add_res = run_git(
        repo_root,
        &[
            "worktree",
            "add",
            "-b",
            &new_branch,
            &wt_path_str,
            &start_point,
        ],
    )
    .await;

    match add_res {
        Ok((true, _, _)) => {
            let common_dir = match run_git(repo_root, &["rev-parse", "--git-common-dir"]).await {
                Ok((true, stdout, _)) => stdout,
                _ => String::new(),
            };
            ensure_worktrees_excluded(repo_root, &common_dir).await;

            Ok(CreateWorktreeResult {
                worktree_path: wt_path_str,
                branch: new_branch,
                base_branch: base_branch.to_string(),
                remote_sync_warning,
            })
        }
        Ok((false, _, stderr)) => Err(format!("Failed to create worktree: {stderr}")),
        Err(e) => Err(format!("Failed to run git worktree add: {e}")),
    }
}

pub async fn sync_existing_worktree(worktree_path: &str) -> Result<(), String> {
    let p = Path::new(worktree_path);
    if !p.exists() || !p.is_dir() {
        return Err(format!("Worktree directory does not exist: {worktree_path}"));
    }

    match run_git(worktree_path, &["pull", "--rebase", "--autostash"]).await {
        Ok((true, _, _)) => Ok(()),
        Ok((false, _, stderr)) => Err(format!("Failed to sync worktree: {stderr}")),
        Err(e) => Err(format!("Failed to run git pull: {e}")),
    }
}

pub async fn delete_worktree(
    repo_root: &str,
    worktree_path: &str,
    branch: Option<&str>,
) -> Result<DeleteWorktreeResult, String> {
    let mut branch_deleted = false;

    // Remove worktree
    let _ = run_git(
        repo_root,
        &["worktree", "remove", "--force", worktree_path],
    )
    .await;

    if Path::new(worktree_path).exists() {
        let _ = tokio::fs::remove_dir_all(worktree_path).await;
    }

    let _ = run_git(repo_root, &["worktree", "prune"]).await;

    if let Some(b) = branch {
        let trimmed = b.trim();
        if !trimmed.is_empty() && trimmed != "main" && trimmed != "master" {
            if let Ok((true, _, _)) = run_git(repo_root, &["branch", "-D", trimmed]).await {
                branch_deleted = true;
            }
        }
    }

    Ok(DeleteWorktreeResult {
        ok: true,
        branch_deleted,
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_branch_name() {
        assert_eq!(normalize_branch_name(""), "");
        assert_eq!(normalize_branch_name("  "), "");
        assert_eq!(normalize_branch_name("Add Google Auth"), "add-google-auth");
        assert_eq!(normalize_branch_name("feat/login-page"), "feat/login-page");
        assert_eq!(normalize_branch_name("  FEAT//Fix_Bug#123... "), "feat/fix_bug-123");
        assert_eq!(normalize_branch_name("my--feature---branch"), "my-feature-branch");
    }

    #[tokio::test]
    async fn test_get_git_info_on_current_repo() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let repo_root = Path::new(manifest_dir).parent().unwrap().to_str().unwrap();
        let info = get_git_info(repo_root).await;
        assert!(info.is_repo);
        assert!(info.repo_root.is_some());
        assert!(!info.branches.is_empty());
        assert!(!info.branches.contains(&"origin".to_string()));
        assert!(!info.branches.contains(&"HEAD".to_string()));
    }
}
