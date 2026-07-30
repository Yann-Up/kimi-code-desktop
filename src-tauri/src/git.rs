//! git: 主进程执行 git 命令,为 Git 面板提供数据。
//! - status: porcelain 解析工作区改动
//! - log: 提交历史
//! - diff: 单文件 diff
//! 全部容错:非仓库返回 isRepo:false / 空数组 / 空串
//! Local 直 spawn git;WSL/SSH 经 target.run_shell 在对应环境执行(cwd 为对应环境路径)

use serde::Serialize;
use std::time::Duration;

use crate::cli::{connection_target, hidden_command};
use crate::target::{sq, ConnectionTarget};

const GIT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Serialize)]
pub struct GitFileChange {
    pub path: String,
    pub status: String, // M/A/D/R/?/U 等
    pub staged: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additions: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletions: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    pub changes: Vec<GitFileChange>,
    pub additions: i64,
    pub deletions: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author: String,
    pub date: String,
}

async fn git(cwd: &str, args: &[&str]) -> Result<String, String> {
    match connection_target() {
        ConnectionTarget::Local => {
            let out = tokio::time::timeout(
                GIT_TIMEOUT,
                hidden_command("git")
                    .arg("-C")
                    .arg(cwd)
                    .args(args)
                    .output(),
            )
            .await
            .map_err(|_| "git 命令超时".to_string())?
            .map_err(|e| e.to_string())?;
            if !out.status.success() {
                return Err(String::from_utf8_lossy(&out.stderr).into_owned());
            }
            Ok(String::from_utf8_lossy(&out.stdout).into_owned())
        }
        // WSL/SSH:在对应环境执行,参数逐个单引号转义(远端无 git 时上层按 isRepo:false 兜底)
        target => {
            let mut cmd = format!("git -C {}", sq(cwd));
            for a in args {
                cmd.push(' ');
                cmd.push_str(&sq(a));
            }
            let out = target.run_shell(&cmd, GIT_TIMEOUT).await?;
            if out.code != 0 {
                return Err(out.stderr);
            }
            Ok(out.stdout)
        }
    }
}

pub async fn git_status(cwd: &str) -> GitStatus {
    let fallback = GitStatus {
        is_repo: false,
        branch: None,
        changes: vec![],
        additions: 0,
        deletions: 0,
    };
    let inner = async {
        let branch = git(cwd, &["branch", "--show-current"]).await?.trim().to_string();
        // core.quotepath=false:非 ASCII 路径不做 C 风格八进制转义,否则中文文件名乱码且 diff 查不到
        let porcelain = git(
            cwd,
            &["-c", "core.quotepath=false", "status", "--porcelain=v1", "-uall"],
        )
        .await?;
        let mut changes = Vec::new();
        for line in porcelain.split('\n') {
            if line.trim().is_empty() {
                continue;
            }
            let bytes = line.as_bytes();
            if bytes.len() < 3 {
                continue;
            }
            let x = bytes[0] as char;
            let y = bytes[1] as char;
            let mut path = &line[3..];
            // rename 条目格式 "old -> new",取新路径(整串当路径 diff 必失败)
            if let Some((_, new)) = path.split_once(" -> ") {
                path = new;
            }
            let path = path.trim_matches('"').to_string();
            let staged = x != ' ' && x != '?';
            let status = if x == '?' {
                '?'
            } else if staged {
                x
            } else if y != ' ' {
                y
            } else {
                x
            };
            changes.push(GitFileChange {
                path,
                status: status.to_string(),
                staged,
                additions: None,
                deletions: None,
            });
        }
        let mut additions = 0i64;
        let mut deletions = 0i64;
        // 无 HEAD(新仓库)时忽略
        if let Ok(numstat) = git(cwd, &["diff", "--numstat", "HEAD"]).await {
            for line in numstat.split('\n') {
                let parts: Vec<&str> = line.split('\t').collect();
                if parts.len() < 3 {
                    continue;
                }
                if let Ok(a) = parts[0].parse::<i64>() {
                    additions += a;
                }
                if let Ok(d) = parts[1].parse::<i64>() {
                    deletions += d;
                }
            }
        }
        Ok::<GitStatus, String>(GitStatus {
            is_repo: true,
            branch: if branch.is_empty() { None } else { Some(branch) },
            changes,
            additions,
            deletions,
        })
    };
    inner.await.unwrap_or(fallback)
}

pub async fn git_log(cwd: &str, limit: Option<u32>) -> Vec<GitCommit> {
    let limit = limit.unwrap_or(50);
    let inner = async {
        let out = git(
            cwd,
            &[
                "log",
                &format!("--max-count={limit}"),
                "--format=%H%x1f%h%x1f%s%x1f%an%x1f%ad",
                "--date=format:%Y-%m-%d %H:%M",
            ],
        )
        .await?;
        let mut commits = Vec::new();
        for line in out.split('\n') {
            let parts: Vec<&str> = line.split('\x1f').collect();
            if parts.len() < 5 {
                continue;
            }
            commits.push(GitCommit {
                hash: parts[0].to_string(),
                short_hash: parts[1].to_string(),
                subject: parts[2].to_string(),
                author: parts[3].to_string(),
                date: parts[4].to_string(),
            });
        }
        Ok::<Vec<GitCommit>, String>(commits)
    };
    inner.await.unwrap_or_default()
}

pub async fn git_diff_file(cwd: &str, path: &str, staged: bool) -> String {
    let args: Vec<&str> = if staged {
        vec!["diff", "--cached", "--", path]
    } else {
        vec!["diff", "--", path]
    };
    git(cwd, &args).await.unwrap_or_default()
}
