# ADR-0006: Folder comparison and one-way sync

- **Status:** Accepted
- **Date:** 2026-11-18

## Context

The 1.0 client can move files between panes, but it cannot answer "what is different between these two folders?" That is the next product step. A sync implementation is risky because timestamps are unreliable across FTP servers, same-size edits exist, and delete propagation can destroy data.

## Decision

1. **One direction in 1.1:** compare and sync local → remote only. Remote-only files and folders are kept. Delete propagation is explicitly out of scope.
2. **Dry-run first:** comparison returns a plan and never writes. Applying the plan is a separate user action through the existing transfer queue.
3. **Metadata first:** compare name, size and modification time. Timestamps within two seconds are considered equal to absorb FTP/SFTP precision and clock differences.
4. **Separate size and date differences:**
   - Different size is a real change and a default upload candidate.
   - Same size with a different date is review-only by default.
5. **Bounded content verification:** when sizes match but dates differ, hash both files. Limits are 4 MiB per file, 32 MiB and 200 files per comparison. Identical hashes become `Equal (content)` and are skipped. Larger or failed checks stay as `Date differs`.
6. **No silent conflict handling:** changed files are only uploaded when selected. Immediately before enqueueing, the remote targets are revalidated. If a target changed after the dry-run, the plan is refreshed instead of overwriting it.
7. **Filters are globs:** include and exclude patterns are relative to the compared roots. Excluded folders prune their subtree. Include filters prune local-only empty folders that no selected file needs.
8. **Bounded walk:** at most 50,000 entries and 64 levels. A cancellation token stops the walk or content verification when the dialog closes or the user stops the comparison.
9. **Reuse the transfer engine:** applying a plan creates missing folders and enqueues files through the normal queue. There is no separate copy implementation and no background daemon.

## Consequences

**Positive**

- Works against servers that cannot set modification times, for files within the verification budget.
- Same-size edits are detected by content instead of being trusted because the size matches.
- The user sees why an entry is a candidate, review-only, or already equal.
- A stale plan cannot silently overwrite a file that changed after the comparison.

**Negative / accepted**

- Small files cost an extra read on both sides when timestamps differ.
- Large files with only a timestamp difference require manual review or upload.
- 1.1 cannot remove remote-only content; that remains a 1.2 decision.
