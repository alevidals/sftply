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

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,sftply_lib=debug"));

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
    use super::*;

    #[test]
    fn secrets_are_redacted() {
        assert_eq!(redact_secret("hunter2"), "[redacted]");
    }
}
