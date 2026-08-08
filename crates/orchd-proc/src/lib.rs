mod framing;
mod process;

pub use framing::framed_stream;
#[cfg(unix)]
pub use process::kill_orphan_pgid;
pub use process::{ChildPipes, ManagedProcess, ProcError};
