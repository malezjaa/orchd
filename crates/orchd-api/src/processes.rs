use serde::Serialize;

/// A process that belongs to one session's process group.
#[derive(Clone, Debug, Serialize)]
pub struct ProcessRecord {
  pub pid: u32,
  pub ppid: u32,
  pub pgid: u32,
  pub name: String,
  pub path: Option<String>,
  pub executable: Option<String>,
  pub command: Option<String>,
  pub status: &'static str,
  pub state: String,
  pub memory_bytes: Option<u64>,
  pub cpu_time_ticks: u64,
  pub is_group_leader: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct ProcessInventory {
  pub processes: Vec<ProcessRecord>,
  pub session_busy: bool,
}

/// Linux exposes the complete process tree through `/proc`. The agent and
/// every tool it starts normally stays in the same process group. Some agent
/// runners deliberately create a new group for a shell or sandbox, so the
/// inventory also follows parent-child edges from every process in the
/// session group. This keeps those children visible without including
/// unrelated host processes.
#[cfg(target_os = "linux")]
pub fn list_processes(pgid: Option<i64>) -> Vec<ProcessRecord> {
  let Some(pgid) = pgid.and_then(|value| u32::try_from(value).ok()) else {
    return Vec::new();
  };

  let process_meta = std::fs::read_dir("/proc")
    .ok()
    .into_iter()
    .flatten()
    .filter_map(Result::ok)
    .filter_map(|entry| {
      let pid = entry.file_name().to_str()?.parse::<u32>().ok()?;
      read_process_meta(pid)
    })
    .collect::<Vec<_>>();
  let session_pids = session_process_ids(&process_meta, pgid);

  let mut processes = process_meta
    .into_iter()
    .filter(|process| session_pids.contains(&process.pid))
    .map(|process| read_process(process, pgid))
    .collect::<Vec<_>>();

  processes.sort_by_key(|process| (process.pid != pgid, process.pid));
  processes
}

#[cfg(target_os = "linux")]
#[derive(Clone, Debug, PartialEq, Eq)]
struct ProcessMeta {
  pid: u32,
  ppid: u32,
  pgid: u32,
  name: String,
  state: String,
  cpu_time_ticks: u64,
}

#[cfg(target_os = "linux")]
fn read_process_meta(pid: u32) -> Option<ProcessMeta> {
  let proc_dir = format!("/proc/{pid}");
  let stat = std::fs::read_to_string(format!("{proc_dir}/stat")).ok()?;
  let (name, state, ppid, pgid, cpu_time_ticks) = parse_stat(&stat)?;
  Some(ProcessMeta { pid, ppid, pgid, name, state, cpu_time_ticks })
}

#[cfg(target_os = "linux")]
fn session_process_ids(
  processes: &[ProcessMeta],
  target_pgid: u32,
) -> std::collections::HashSet<u32> {
  let mut included = processes
    .iter()
    .filter(|process| process.pgid == target_pgid || process.pid == target_pgid)
    .map(|process| process.pid)
    .collect::<std::collections::HashSet<_>>();

  // Follow descendants until the set stops growing. This captures a shell
  // or sandbox that calls setpgid/setsid, while still keeping the session's
  // process group as the only root of the search.
  loop {
    let previous_len = included.len();
    for process in processes {
      if included.contains(&process.ppid) {
        included.insert(process.pid);
      }
    }
    if included.len() == previous_len {
      break;
    }
  }
  included
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
  use super::{ProcessMeta, parse_stat, session_process_ids};

  #[test]
  fn parses_cpu_time_from_stat() {
    let stat = "123 (codex (worker)) S 1 100 100 0 0 0 0 0 0 0 11 7";

    assert_eq!(
      parse_stat(stat),
      Some(("codex (worker)".to_string(), "S".to_string(), 1, 100, 18))
    );
  }

  #[test]
  fn follows_descendants_that_change_process_group() {
    let processes = vec![
      ProcessMeta {
        pid: 100,
        ppid: 1,
        pgid: 100,
        name: "agent".to_string(),
        state: "S".to_string(),
        cpu_time_ticks: 0,
      },
      ProcessMeta {
        pid: 101,
        ppid: 100,
        pgid: 100,
        name: "shell".to_string(),
        state: "S".to_string(),
        cpu_time_ticks: 0,
      },
      ProcessMeta {
        pid: 102,
        ppid: 101,
        pgid: 900,
        name: "test".to_string(),
        state: "R".to_string(),
        cpu_time_ticks: 0,
      },
      ProcessMeta {
        pid: 103,
        ppid: 102,
        pgid: 900,
        name: "worker".to_string(),
        state: "S".to_string(),
        cpu_time_ticks: 0,
      },
      ProcessMeta {
        pid: 104,
        ppid: 1,
        pgid: 900,
        name: "unrelated".to_string(),
        state: "S".to_string(),
        cpu_time_ticks: 0,
      },
    ];

    let mut ids = session_process_ids(&processes, 100).into_iter().collect::<Vec<_>>();
    ids.sort_unstable();
    assert_eq!(ids, vec![100, 101, 102, 103]);
  }
}

#[cfg(target_os = "linux")]
fn read_process(process: ProcessMeta, target_pgid: u32) -> ProcessRecord {
  let ProcessMeta { pid, ppid, pgid, name, state, cpu_time_ticks } = process;
  let proc_dir = format!("/proc/{pid}");

  let path = std::fs::read_link(format!("{proc_dir}/cwd"))
    .ok()
    .map(|path| path.to_string_lossy().into_owned());
  let executable = std::fs::read_link(format!("{proc_dir}/exe"))
    .ok()
    .map(|path| path.to_string_lossy().into_owned());
  let command = std::fs::read(format!("{proc_dir}/cmdline"))
    .ok()
    .map(|bytes| {
      bytes
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
        .map(|part| String::from_utf8_lossy(part))
        .collect::<Vec<_>>()
        .join(" ")
    })
    .filter(|command| !command.is_empty());
  let memory_bytes = read_memory_bytes(&proc_dir);

  ProcessRecord {
    pid,
    ppid,
    pgid,
    name: name.clone(),
    path,
    executable,
    command,
    status: process_status(&state),
    state,
    memory_bytes,
    cpu_time_ticks,
    is_group_leader: pid == target_pgid,
  }
}

#[cfg(target_os = "linux")]
fn parse_stat(stat: &str) -> Option<(String, String, u32, u32, u64)> {
  // `comm` is wrapped in parentheses and may itself contain spaces. Parsing
  // from the final `) ` avoids splitting a valid command name incorrectly.
  let open = stat.find('(')?;
  let close = stat.rfind(") ")?;
  let name = stat.get(open + 1..close)?.to_string();
  let fields = stat.get(close + 2..)?.split_whitespace();
  let mut fields = fields;
  let state = fields.next()?.to_string();
  let ppid = fields.next()?.parse().ok()?;
  let pgid = fields.next()?.parse().ok()?;
  for _ in 0..8 {
    fields.next()?;
  }
  let utime = fields.next()?.parse::<u64>().ok()?;
  let stime = fields.next()?.parse::<u64>().ok()?;
  Some((name, state, ppid, pgid, utime + stime))
}

#[cfg(target_os = "linux")]
fn read_memory_bytes(proc_dir: &str) -> Option<u64> {
  let status = std::fs::read_to_string(format!("{proc_dir}/status")).ok()?;
  let resident_kb = status
    .lines()
    .find_map(|line| line.strip_prefix("VmRSS:")?.split_whitespace().next())?
    .parse::<u64>()
    .ok()?;
  Some(resident_kb * 1024)
}

#[cfg(target_os = "linux")]
fn process_status(state: &str) -> &'static str {
  match state.as_bytes().first().copied() {
    Some(b'R') => "running",
    Some(b'S' | b'D' | b'I') => "sleeping",
    Some(b'T' | b't') => "stopped",
    Some(b'Z') => "zombie",
    _ => "unknown",
  }
}

#[cfg(not(target_os = "linux"))]
pub fn list_processes(_pgid: Option<i64>) -> Vec<ProcessRecord> {
  Vec::new()
}
