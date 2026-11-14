/** Largest file the text editor will load, mirrored from the Rust backend. */
export const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024

/** Whether a listing entry is small enough to open in the editor. */
export function isEditableTextSize(size: number): boolean {
  return Number.isFinite(size) && size >= 0 && size <= MAX_TEXT_FILE_BYTES
}

/** Line and byte counts for the editor status bar. */
export function textStats(content: string): { lines: number; bytes: number } {
  const bytes = new TextEncoder().encode(content).length
  const lines = content.length === 0 ? 1 : content.split("\n").length
  return { lines, bytes }
}
