//! Manual update check against the public GitHub releases API.
//!
//! Nothing runs in the background: the user presses a button in Settings, one
//! HTTPS request is made to a fixed host, and the result is display-only. No
//! download or install happens without the user leaving the app.

use std::cmp::Ordering;
use std::time::Duration;

use serde::Deserialize;
use specta::Type;

use crate::error::{AppError, ErrorCode};

const LATEST_RELEASE_API: &str = "https://api.github.com/repos/alevidals/sftply/releases/latest";
pub const RELEASES_URL: &str = "https://github.com/alevidals/sftply/releases";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    /// Release page for the newest published version.
    pub release_url: String,
}

#[derive(Debug, Deserialize)]
struct ReleaseResponse {
    tag_name: String,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    draft: bool,
}

/// Perform the check on the calling thread. Call it from `spawn_blocking`.
pub fn check(current_version: &str) -> Result<UpdateStatus, AppError> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(8)))
        .user_agent(concat!("sftply/", env!("CARGO_PKG_VERSION")))
        .build()
        .into();

    let body = agent
        .get(LATEST_RELEASE_API)
        .header("Accept", "application/vnd.github+json")
        .call()
        .map_err(|error| {
            AppError::new(ErrorCode::Network, "Could not reach the release server.")
                .with_detail(error.to_string())
                .retryable()
        })?
        .body_mut()
        .read_to_string()
        .map_err(|error| {
            AppError::new(
                ErrorCode::Network,
                "The release server sent an unreadable answer.",
            )
            .with_detail(error.to_string())
            .retryable()
        })?;

    parse_release(&body, current_version)
}

pub fn parse_release(body: &str, current_version: &str) -> Result<UpdateStatus, AppError> {
    let release: ReleaseResponse = serde_json::from_str(body).map_err(|error| {
        AppError::new(
            ErrorCode::Internal,
            "The release answer could not be parsed.",
        )
        .with_detail(error.to_string())
    })?;

    if release.draft {
        return Err(AppError::internal(
            "The newest release is still a draft.",
            "draft release returned by /releases/latest",
        ));
    }

    let latest_version = release.tag_name.trim_start_matches('v').to_string();
    Ok(UpdateStatus {
        update_available: compare_versions(&latest_version, current_version) == Ordering::Greater,
        release_url: release.html_url.unwrap_or_else(|| RELEASES_URL.to_string()),
        current_version: current_version.to_string(),
        latest_version,
    })
}

/// Compare two versions numerically, treating a pre-release as older than the
/// matching release. Only the shapes sftply publishes are supported.
pub fn compare_versions(left: &str, right: &str) -> Ordering {
    fn split(version: &str) -> (&str, Option<&str>) {
        match version.split_once('-') {
            Some((core, pre)) => (core, Some(pre)),
            None => (version, None),
        }
    }

    let (left_core, left_pre) = split(left.trim_start_matches('v'));
    let (right_core, right_pre) = split(right.trim_start_matches('v'));

    let left_parts: Vec<u64> = left_core
        .split('.')
        .map(|part| part.parse().unwrap_or(0))
        .collect();
    let right_parts: Vec<u64> = right_core
        .split('.')
        .map(|part| part.parse().unwrap_or(0))
        .collect();

    let length = left_parts.len().max(right_parts.len());
    for index in 0..length {
        let left = left_parts.get(index).copied().unwrap_or(0);
        let right = right_parts.get(index).copied().unwrap_or(0);
        match left.cmp(&right) {
            Ordering::Equal => {}
            other => return other,
        }
    }

    match (left_pre, right_pre) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(left), Some(right)) => left.cmp(right),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_release_versions() {
        assert_eq!(compare_versions("0.2.0", "0.1.0"), Ordering::Greater);
        assert_eq!(compare_versions("v0.2.0", "0.2.0"), Ordering::Equal);
        assert_eq!(compare_versions("0.1.9", "0.1.10"), Ordering::Less);
        assert_eq!(compare_versions("1.0", "1.0.0"), Ordering::Equal);
        assert_eq!(compare_versions("0.2.0", "0.2"), Ordering::Equal);
    }

    #[test]
    fn pre_releases_are_older_than_the_release() {
        assert_eq!(compare_versions("0.9.0-beta.1", "0.9.0"), Ordering::Less);
        assert_eq!(compare_versions("0.9.0", "0.9.0-beta.1"), Ordering::Greater);
        assert_eq!(
            compare_versions("0.9.0-beta.2", "0.9.0-beta.1"),
            Ordering::Greater
        );
    }

    #[test]
    fn parses_a_release_answer() {
        let body = r#"{
            "tag_name": "v0.2.0",
            "html_url": "https://github.com/alevidals/sftply/releases/tag/v0.2.0",
            "draft": false
        }"#;

        let status = parse_release(body, "0.1.0").unwrap();
        assert_eq!(status.latest_version, "0.2.0");
        assert_eq!(status.current_version, "0.1.0");
        assert!(status.update_available);
        assert!(status.release_url.ends_with("v0.2.0"));
    }

    #[test]
    fn reports_when_the_running_version_is_current() {
        let body = r#"{"tag_name": "v0.1.0", "draft": false}"#;
        let status = parse_release(body, "0.1.0").unwrap();
        assert!(!status.update_available);
        assert_eq!(status.release_url, RELEASES_URL);
    }

    #[test]
    fn rejects_drafts_and_garbage() {
        let draft = parse_release(r#"{"tag_name": "v0.3.0", "draft": true}"#, "0.1.0");
        assert_eq!(draft.unwrap_err().code, ErrorCode::Internal);

        let garbage = parse_release("not json", "0.1.0");
        assert_eq!(garbage.unwrap_err().code, ErrorCode::Internal);
    }
}
