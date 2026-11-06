# ADR-0004: Transfer engine and resumability

- **Status:** Proposed
- **Date:** 2026-11-05

## Context

Transfers are the highest-risk user-facing feature: they involve long-running I/O, unreliable networks, protocol-specific finalization, concurrency, cancellation, conflicts, and user expectations about progress and resume. FTP and SFTP differ significantly in what can be guaranteed.

## Decision

1. **Job/item model:** folder transfers are jobs with file-level items; UI can show both aggregate and per-file progress.
2. **Global scheduler:** bounded semaphore (default 3, range 1–8) over file items, FIFO job expansion. One failed item does not stop unrelated items unless the job policy says so.
3. **Streaming pipeline:** `open_read` → counting reader → 64 KiB chunks → bandwidth limiter → counting writer → `finish()`. Completion is emitted only after `finish()` succeeds.
4. **Explicit finalization:** reader/writer handles expose `finish()`/`abort()`; FTP data connections and SFTP handles are never abandoned implicitly.
5. **Downloads are atomic:** write to `.sftply-part-<id>` beside the target, then rename after success. Cancel/failure cleans up unless the user is keeping the partial for a supported resume.
6. **Uploads are direct** by default; atomic temp+rename upload is a later, protocol-gated option.
7. **Resume is negotiated, not assumed:**
   - FTP: only when the server's `REST` behavior is verified; upload resume only when semantics are reliable. Otherwise offer retry-from-start.
   - SFTP: seek on the file handle where the server supports it.
   - Pause is shown only when it can be implemented without corrupting data; otherwise disabled with a tooltip.
8. **Cancellation:** every operation carries a `CancellationToken`; cancellation stops scheduling children, aborts the stream, finalizes/cleans up, and reports `cancelled` — never `completed`.
9. **Progress:** backend samples actual bytes, computes EWMA speed and ETA, batches events to 4–10/s, and never emits per-chunk events.
10. **Conflicts:** backend preflights target existence; UI applies overwrite/skip/rename/apply-to-all. No silent overwrite. Folder merges are explicit.
11. **Retry:** explicit retry with deterministic conflict policy; no hidden file-level retries. Automatic reconnection may be attempted for the control session, but the file transfer result must still be verified.
12. **History:** bounded JSONL, no secrets, separate clear action from the in-session queue.

## Consequences

**Positive**

- Progress and completion reflect reality.
- Protocol limitations are visible rather than papered over.
- Cancellation and failure leave predictable filesystem state.
- The same engine serves uploads, downloads, sync and drag-and-drop.

**Negative / accepted**

- More explicit state than a naive `copy` loop.
- Atomic download requires same-filesystem temp file and rename semantics.
- Some servers cannot support pause/resume; those actions remain unavailable.
- Bandwidth limiting adds a small per-chunk overhead.

## Alternatives considered

- **Unbounded parallelism / one connection per file:** risks server limits, memory spikes, and unfair queue behavior.
- **Optimistic completion on write:** can report success before FTP/SFTP finalization; rejected.
- **Pause by destroying and recreating the connection:** acceptable only when resume is verified; not presented as universal pause.
- **Third-party download manager crate:** none handles FTP+SFTP+finalization+capabilities in our abstraction.
