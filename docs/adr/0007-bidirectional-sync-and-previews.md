# ADR-0007: Bidirectional sync, explicit deletes and previews

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

1.1 compared folders in one direction and never deleted target-only items. 1.2
adds the reverse direction, an opt-in delete flow and read-only previews. The
delete step is the riskiest part because FTP and SFTP deletions are immediate
and cannot be undone.

## Decision

1. **Direction is part of the plan.** Every comparison is either `upload`
   (local → remote) or `download` (remote → local). Actions, counts, target
   paths, validation and queue scopes all follow that direction.
2. **The dry-run remains mandatory.** Both directions build the same plan model,
   apply include/exclude globs, run bounded content verification and revalidate
   the target before enqueueing.
3. **Deletion is a separate action.** Normal Sync never deletes. Target-only
   items are kept by default. The user opens a delete flow from a row trash
   action or **Delete all**, reviews the paths, acknowledges that the operation
   is permanent, and only then can confirm.
4. **Delete safety:** the backend re-checks every path, refuses entries that are
   not target-only, blocks the root, and deletes folders recursively only after
   the confirmation says that folder contents are included.
5. **Previews are read-only:** UTF-8 text is capped at 2 MiB; raster images are
   capped at 8 MiB and rendered as `img` data URLs. SVG and HTML are treated as
   text, never rendered or executed.
6. **Tests cover both directions:** classification is exercised against real
   FTP, explicit/implicit FTPS and SFTP in the integration suite.

## Consequences

**Positive**

- Users can move changes in either direction with the same dry-run and content
  verification.
- Deletion is discoverable but cannot happen accidentally.
- Previews avoid downloading a file into the working folder just to inspect it.

**Negative / accepted**

- A confirmed delete is immediate and irreversible.
- Image previews travel through IPC as base64, so the cap keeps memory bounded.
- PDF and other document previews remain out of scope.
