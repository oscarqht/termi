use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tokio::fs;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SavedPrompt {
    pub id: String,
    pub title: String,
    pub content: String,
}

pub fn get_prompts_file_path() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if let Some(config) = dirs::config_dir() {
            return Some(config.join("termi").join("prompts.json"));
        }
    }
    dirs::home_dir().map(|h| h.join(".config").join("termi").join("prompts.json"))
}

pub fn default_prompts() -> Vec<SavedPrompt> {
    vec![
        SavedPrompt {
            id: "prompt-code-review".to_string(),
            title: "Code Review".to_string(),
            content: "Review the recent git changes for potential bugs, security vulnerabilities, edge cases, and performance regressions. Provide prioritized, actionable feedback.".to_string(),
        },
        SavedPrompt {
            id: "prompt-explain-error".to_string(),
            title: "Explain Error".to_string(),
            content: "Analyze the error above in detail: explain why it occurred, identify the root cause, and provide the exact steps or code fix required to resolve it.".to_string(),
        },
        SavedPrompt {
            id: "prompt-git-summary".to_string(),
            title: "Git Diff & Commit Message".to_string(),
            content: "Inspect git status and staged diffs. Summarize the key changes made and propose a clean, conventional commit message with a short description.".to_string(),
        },
        SavedPrompt {
            id: "prompt-plan-next-steps".to_string(),
            title: "Plan Next Steps".to_string(),
            content: "Evaluate our current progress against requirements, list any remaining work or risks, and propose a concise step-by-step plan for what to tackle next.".to_string(),
        },
    ]
}

pub async fn load_saved_prompts() -> Vec<SavedPrompt> {
    let file_path = match get_prompts_file_path() {
        Some(p) => p,
        None => return default_prompts(),
    };

    if !file_path.exists() {
        let defaults = default_prompts();
        let _ = save_saved_prompts(&defaults).await;
        return defaults;
    }

    let content = match fs::read_to_string(&file_path).await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[termi] Failed to read prompts file: {e}");
            return default_prompts();
        }
    };

    match serde_json::from_str::<Vec<SavedPrompt>>(&content) {
        Ok(prompts) => prompts,
        Err(e) => {
            eprintln!("[termi] Failed to parse prompts JSON: {e}");
            default_prompts()
        }
    }
}

pub async fn save_saved_prompts(prompts: &[SavedPrompt]) -> Result<(), std::io::Error> {
    let file_path = match get_prompts_file_path() {
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

    let json = serde_json::to_string_pretty(prompts)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

    let temp_path = file_path.with_extension(format!("tmp.{}", uuid::Uuid::new_v4()));
    fs::write(&temp_path, json).await?;
    fs::rename(&temp_path, &file_path).await?;
    Ok(())
}
