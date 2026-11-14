use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

use crate::config::paths::AppPaths;
use crate::error::AppError;

/// Initialize logging to stderr and a daily rolling file in the app log dir.
/// The returned guard must be kept alive for the lifetime of the app.
pub fn init(paths: &AppPaths) -> Result<WorkerGuard, AppError> {
    std::fs::create_dir_all(&paths.log_dir).map_err(|error| {
        AppError::internal(
            "Could not create the log directory.",
            format!("{}: {error}", paths.log_dir.display()),
        )
    })?;

    let file_appender = tracing_appender::rolling::daily(&paths.log_dir, "sftply.log");
    let (file_writer, guard) = tracing_appender::non_blocking(file_appender);

    // Protocol crates log protocol traffic at trace level; suppaftp logs the
    // raw command line, including `PASS`, so clamp them to info even when a
    // developer sets RUST_LOG=trace for our own crates.
    let base = std::env::var("RUST_LOG").unwrap_or_else(|_| "info,sftply_lib=debug".to_string());
    let filter = EnvFilter::new(format!("{base},suppaftp=info,russh=info,russh_sftp=info"));

    let file_layer = tracing_subscriber::fmt::layer()
        .with_writer(file_writer)
        .with_ansi(false)
        .with_target(true);

    let console_layer = tracing_subscriber::fmt::layer()
        .with_writer(std::io::stderr)
        .with_target(true);

    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(console_layer)
        .with(file_layer)
        .try_init();

    tracing::info!(log_dir = %paths.log_dir.display(), "logging initialized");
    Ok(guard)
}

/// Redact values that must never appear in logs. Logging call sites should
/// still avoid passing secrets; this is defense in depth for diagnostics.
#[allow(dead_code)] // Used by Phase 3 connection diagnostics.
pub fn redact_secret(_value: &str) -> &'static str {
    "[redacted]"
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    #[test]
    fn secrets_are_redacted() {
        assert_eq!(redact_secret("hunter2"), "[redacted]");
    }

    /// Static guard: no log or console call may interpolate a credential.
    #[test]
    fn logging_never_mentions_credentials() {
        fn visit(dir: &Path, hits: &mut Vec<String>) {
            let entries = std::fs::read_dir(dir).expect("read source directory");
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    visit(&path, hits);
                    continue;
                }
                if path.extension().and_then(|value| value.to_str()) != Some("rs") {
                    continue;
                }
                let source = std::fs::read_to_string(&path).expect("read source file");
                for (index, line) in source.lines().enumerate() {
                    let lower = line.to_lowercase();
                    let logs = lower.contains("tracing::")
                        || lower.contains("println!")
                        || lower.contains("eprintln!");
                    let credential = ["password", "passphrase", "secret"]
                        .iter()
                        .any(|word| lower.contains(word));
                    if logs && credential {
                        hits.push(format!("{}:{}", path.display(), index + 1));
                    }
                }
            }
        }

        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut hits = Vec::new();
        visit(&root, &mut hits);
        assert!(
            hits.is_empty(),
            "log calls must not interpolate credentials: {hits:?}"
        );
    }
}
