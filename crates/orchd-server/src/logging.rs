use std::fmt;

use time::OffsetDateTime;
use tracing::{
  Event, Level, Subscriber,
  field::{Field, Visit},
};
use tracing_subscriber::{
  fmt::{FmtContext, FormatEvent, FormatFields, format::Writer},
  layer::SubscriberExt,
  registry::LookupSpan,
  util::SubscriberInitExt,
};

const RESET: &str = "\x1b[0m";
const DIM: &str = "\x1b[2m";

/// Initializes a compact, colored console logger. Respects `RUST_LOG`
/// (falling back to `info` for orchd's own crates) and disables color
/// automatically when the output isn't a terminal.
pub fn init() {
  let filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
    tracing_subscriber::EnvFilter::new(
      "orchd=info,orchd_api=info,orchd_session=info,orchd_store=info,orchd_cli=info",
    )
  });

  tracing_subscriber::registry()
    .with(filter)
    .with(tracing_subscriber::fmt::layer().event_format(PrettyFormatter))
    .init();
}

struct PrettyFormatter;

impl<S, N> FormatEvent<S, N> for PrettyFormatter
where
  S: Subscriber + for<'a> LookupSpan<'a>,
  N: for<'a> FormatFields<'a> + 'static,
{
  fn format_event(
    &self,
    _ctx: &FmtContext<'_, S, N>,
    mut writer: Writer<'_>,
    event: &Event<'_>,
  ) -> fmt::Result {
    let ansi = writer.has_ansi_escapes();
    let meta = event.metadata();
    let now = OffsetDateTime::now_utc();

    if ansi {
      write!(
        writer,
        "{DIM}{:02}:{:02}:{:02}.{:03}{RESET} ",
        now.hour(),
        now.minute(),
        now.second(),
        now.millisecond()
      )?;
    } else {
      write!(
        writer,
        "{:02}:{:02}:{:02}.{:03} ",
        now.hour(),
        now.minute(),
        now.second(),
        now.millisecond()
      )?;
    }

    let (label, color) = level_style(*meta.level());
    if ansi {
      write!(writer, "{color}{label}{RESET} ")?;
    } else {
      write!(writer, "{label} ")?;
    }

    if ansi {
      write!(writer, "{DIM}{:<24}{RESET} ", meta.target())?;
    } else {
      write!(writer, "{:<24} ", meta.target())?;
    }

    let mut visitor = FieldVisitor::default();
    event.record(&mut visitor);
    write!(writer, "{}", visitor.message)?;

    if !visitor.fields.is_empty() {
      if ansi {
        write!(writer, " {DIM}{}{RESET}", visitor.fields)?;
      } else {
        write!(writer, " {}", visitor.fields)?;
      }
    }

    writeln!(writer)
  }
}

fn level_style(level: Level) -> (&'static str, &'static str) {
  match level {
    Level::TRACE => ("TRACE", "\x1b[35m"),
    Level::DEBUG => ("DEBUG", "\x1b[34m"),
    Level::INFO => ("INFO ", "\x1b[32m"),
    Level::WARN => ("WARN ", "\x1b[33m"),
    Level::ERROR => ("ERROR", "\x1b[1;31m"),
  }
}

/// Pulls the `message` field out on its own (printed unquoted, right
/// after the target) and renders every other field as `key=value` for
/// the dimmed tail of the line.
#[derive(Default)]
struct FieldVisitor {
  message: String,
  fields: String,
}

impl FieldVisitor {
  fn push_field(&mut self, name: &str, value: impl fmt::Display) {
    use std::fmt::Write;
    if !self.fields.is_empty() {
      self.fields.push(' ');
    }
    let _ = write!(self.fields, "{name}={value}");
  }
}

impl Visit for FieldVisitor {
  fn record_str(&mut self, field: &Field, value: &str) {
    if field.name() == "message" {
      self.message.push_str(value);
    } else {
      self.push_field(field.name(), format_args!("{value:?}"));
    }
  }

  fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
    use std::fmt::Write;
    if field.name() == "message" {
      let _ = write!(self.message, "{value:?}");
    } else {
      self.push_field(field.name(), format_args!("{value:?}"));
    }
  }
}
