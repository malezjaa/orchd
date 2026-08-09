use crate::error::ApiError;
use axum::extract::Query;
use axum::Json;
use ignore::{WalkBuilder, WalkState};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::path::{Path as FsPath, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

fn home_dir() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

fn rel_to_slash(rel: &FsPath) -> String {
    let s = rel.to_string_lossy();
    if std::path::MAIN_SEPARATOR == '/' {
        s.into_owned()
    } else {
        s.replace(std::path::MAIN_SEPARATOR, "/")
    }
}

async fn resolve_dir(path: Option<String>) -> Result<PathBuf, ApiError> {
    let requested = match path {
        Some(p) if !p.is_empty() => PathBuf::from(p),
        _ => home_dir(),
    };

    tokio::task::spawn_blocking(move || {
        let canonical = std::fs::canonicalize(&requested)
            .map_err(|err| ApiError::bad_request(format!("cannot open directory: {err}")))?;
        if !canonical.is_dir() {
            return Err(ApiError::bad_request("path is not a directory"));
        }
        Ok(canonical)
    })
        .await
        .map_err(|_| ApiError::internal("filesystem task failed"))?
}

#[derive(Deserialize)]
pub struct BrowseFsQuery {
    pub path: Option<String>,
}

#[derive(Serialize)]
pub struct FsEntry {
    pub name: String,
    pub path: String,
}

#[derive(Serialize)]
pub struct BrowseFsResponse {
    pub path: String,
    pub parent: Option<String>,
    pub entries: Vec<FsEntry>,
}

/// Lists subdirectories for the project-creation folder picker, defaulting to
/// the daemon owner's home. Directories only, since this picks a project root
/// rather than browsing files. Any absolute path on the host is fair game: the
/// caller is the authenticated single owner, the same trust boundary
/// `create_project` already accepts.
pub async fn browse_fs(
    Query(query): Query<BrowseFsQuery>,
) -> Result<Json<BrowseFsResponse>, ApiError> {
    let canonical = resolve_dir(query.path).await?;

    let listing = {
        let canonical = canonical.clone();
        tokio::task::spawn_blocking(move || list_subdirs(&canonical))
            .await
            .map_err(|_| ApiError::internal("filesystem task failed"))?
            .map_err(|err| ApiError::bad_request(format!("cannot list directory: {err}")))?
    };

    let parent = canonical.parent().map(|p| p.to_string_lossy().into_owned());

    Ok(Json(BrowseFsResponse {
        path: canonical.to_string_lossy().into_owned(),
        parent,
        entries: listing,
    }))
}

fn list_subdirs(dir: &FsPath) -> std::io::Result<Vec<FsEntry>> {
    let mut entries = Vec::new();

    for entry in std::fs::read_dir(dir)?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }

        // `readdir` already tells us the type on most platforms, so `file_type()`
        // is free; only symlinks need a real `stat`. Note that neither
        // `DirEntry::file_type()` nor `DirEntry::metadata()` follows links --
        // resolving the target requires `fs::metadata` on the full path.
        let Ok(file_type) = entry.file_type() else { continue };
        let path = entry.path();
        let is_dir = if file_type.is_symlink() {
            std::fs::metadata(&path).map(|m| m.is_dir()).unwrap_or(false)
        } else {
            file_type.is_dir()
        };
        if !is_dir {
            continue;
        }

        entries.push(FsEntry { name, path: path.to_string_lossy().into_owned() });
    }

    entries.sort_by_cached_key(|e| e.name.to_lowercase());
    Ok(entries)
}

const SKIPPED_DIRS: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    ".bzr",
    "node_modules",
    "target",
    "dist",
    ".next",
    ".nuxt",
    "__pycache__",
    ".venv",
    "venv",
    ".tox",
];

const MAX_DEPTH: usize = 12;

/// Batched sender: each walker thread accumulates paths locally and ships them
/// in one message when its visitor closure is dropped, so a 100k-file tree
/// costs one channel send per thread rather than per file.
struct Batch {
    tx: mpsc::Sender<Vec<String>>,
    buf: Vec<String>,
}

impl Drop for Batch {
    fn drop(&mut self) {
        let _ = self.tx.send(std::mem::take(&mut self.buf));
    }
}

/// Collect the project's files, relative to `root`, using ripgrep's parallel
/// walker. Ignore rules are applied during traversal, so ignored subtrees are
/// never descended into rather than being walked and filtered afterwards.
/// `parents(true)` matters here: a project root may be a subdirectory of the
/// repo, and the rules that govern it can live in a `.gitignore` above it.
fn collect_files(root: &FsPath) -> Vec<String> {
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1).min(12);

    let walker = WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .parents(true)
        .follow_links(false)
        .max_depth(Some(MAX_DEPTH))
        .threads(threads)
        .filter_entry(|entry| {
            // Only prune directories; a file named `dist` should still be listed.
            if entry.file_type().is_some_and(|t| t.is_dir()) {
                !SKIPPED_DIRS.contains(&entry.file_name().to_string_lossy().as_ref())
            } else {
                true
            }
        })
        .build_parallel();

    let (tx, rx) = mpsc::channel::<Vec<String>>();

    walker.run(|| {
        let mut batch = Batch { tx: tx.clone(), buf: Vec::new() };
        Box::new(move |result| {
            let Ok(entry) = result else { return WalkState::Continue };
            if entry.depth() == 0 {
                return WalkState::Continue;
            }

            if entry.file_type().is_some_and(|t| t.is_dir()) {
                return WalkState::Continue;
            }
            if let Ok(rel) = entry.path().strip_prefix(root) {
                batch.buf.push(rel_to_slash(rel));
            }
            WalkState::Continue
        })
    });

    drop(tx);

    let mut files: Vec<String> = rx.into_iter().flatten().collect();
    files.sort_unstable();
    files
}

#[derive(Serialize, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
enum GitStatus {
    Added,
    Deleted,
    Ignored,
    Modified,
    Renamed,
    Untracked,
}

#[derive(Serialize)]
struct GitStatusEntry {
    path: String,
    status: GitStatus,
}

fn map_git_status(x: u8, y: u8) -> GitStatus {
    if x == b'?' && y == b'?' {
        return GitStatus::Untracked;
    }
    if x == b'!' && y == b'!' {
        return GitStatus::Ignored;
    }
    match y {
        b'M' | b'T' => return GitStatus::Modified,
        b'D' => return GitStatus::Deleted,
        b'A' => return GitStatus::Added,
        b'R' => return GitStatus::Renamed,
        b'U' => return GitStatus::Modified,
        _ => {}
    }
    match x {
        b'M' | b'T' => GitStatus::Modified,
        b'A' => GitStatus::Added,
        b'D' => GitStatus::Deleted,
        b'R' => GitStatus::Renamed,
        b'C' => GitStatus::Added,
        b'U' => GitStatus::Modified,
        _ => GitStatus::Modified,
    }
}

/// A wedged git process (index.lock contention, a stalled network mount) must
/// not pin the request indefinitely.
const GIT_TIMEOUT: Duration = Duration::from_secs(10);

async fn git_status(root: &FsPath) -> Option<Vec<GitStatusEntry>> {
    let toplevel_fut = tokio::process::Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["rev-parse", "--show-toplevel"])
        .kill_on_drop(true)
        .output();

    let status_fut = tokio::process::Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["status", "--porcelain=v1", "-z", "--untracked-files=all"])
        .kill_on_drop(true)
        .output();

    let (toplevel, status) =
        tokio::time::timeout(GIT_TIMEOUT, async { tokio::join!(toplevel_fut, status_fut) })
            .await
            .ok()?;

    let toplevel = toplevel.ok()?;
    let status = status.ok()?;
    if !toplevel.status.success() || !status.status.success() {
        return None;
    }

    // `rev-parse --show-toplevel` resolves links by its own rules, which diverge
    // from `canonicalize` on macOS (`/tmp` vs `/private/tmp`) and for symlinked
    // repo paths. Without canonicalizing, `strip_prefix` below fails for every
    // entry and git decorations silently vanish.
    let toplevel = String::from_utf8(toplevel.stdout).ok()?;
    let toplevel = tokio::fs::canonicalize(toplevel.trim()).await.ok()?;

    // Repo-relative prefix of the project root, computed once instead of joining
    // and re-stripping a `PathBuf` per entry.
    let prefix = root.strip_prefix(&toplevel).ok().map(rel_to_slash)?;

    let mut entries = Vec::new();
    for (path, x, y) in parse_git_porcelain(&status.stdout) {
        let rel = if prefix.is_empty() {
            path.as_ref()
        } else {
            // Drop anything outside the project root.
            match path.strip_prefix(prefix.as_str()).and_then(|r| r.strip_prefix('/')) {
                Some(rel) => rel,
                None => continue,
            }
        };
        entries.push(GitStatusEntry { path: rel.to_owned(), status: map_git_status(x, y) });
    }

    Some(entries)
}

/// Parse `git status --porcelain=v1 -z` into `(path, x, y)` triples. Each
/// NUL-terminated field is `XY <path>`; renames/copies append a second
/// NUL-terminated field with the origin path, which is skipped.
///
/// Paths borrow from `stdout` where they're valid UTF-8, so nothing is
/// allocated for entries the caller discards.
fn parse_git_porcelain(stdout: &[u8]) -> Vec<(Cow<'_, str>, u8, u8)> {
    let mut entries = Vec::new();
    let mut rest = stdout;

    while !rest.is_empty() {
        let nul = rest.iter().position(|&b| b == 0).unwrap_or(rest.len());
        let field = &rest[..nul];
        // `get` rather than indexing: truncated output leaves no trailing NUL, and
        // `&rest[nul + 1..]` would then be out of bounds.
        rest = rest.get(nul + 1..).unwrap_or(&[]);

        if field.len() < 4 {
            continue;
        }
        let (x, y) = (field[0], field[1]);

        // Renames/copies carry a second NUL-terminated field holding the origin
        // path; skip it so the loop lands on the next entry.
        if x == b'R' || x == b'C' {
            let nul2 = rest.iter().position(|&b| b == 0).unwrap_or(rest.len());
            rest = rest.get(nul2 + 1..).unwrap_or(&[]);
        }

        entries.push((String::from_utf8_lossy(&field[3..]), x, y));
    }

    entries
}

#[derive(Serialize)]
pub struct FileTreeResponse {
    pub path: String,
    pub files: Vec<String>,
    pub git: Option<Vec<GitStatusEntry>>,
}

pub async fn file_tree(
    Query(query): Query<BrowseFsQuery>,
) -> Result<Json<FileTreeResponse>, ApiError> {
    let canonical = resolve_dir(query.path).await?;

    let walk = {
        let root = canonical.clone();
        tokio::task::spawn_blocking(move || collect_files(&root))
    };
    let (walk, git) = tokio::join!(walk, git_status(&canonical));

    let files = walk.map_err(|_| ApiError::internal("directory walk failed"))?;

    Ok(Json(FileTreeResponse {
        path: canonical.to_string_lossy().into_owned(),
        files,
        git,
    }))
}