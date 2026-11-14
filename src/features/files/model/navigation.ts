/** Maximum number of bookmarks kept per connection. */
export const MAX_REMOTE_BOOKMARKS = 100
/** Maximum number of recent folders kept per connection. */
export const MAX_RECENT_PATHS = 20

/**
 * Add a path to a bookmark list. Existing entries keep their order and the
 * list is capped; adding a path that is already present is a no-op.
 */
export function addBookmark(paths: readonly string[], path: string): string[] {
  if (!path || paths.includes(path)) return [...paths]
  return [...paths, path].slice(-MAX_REMOTE_BOOKMARKS)
}

/** Remove a bookmark by exact path. */
export function removeBookmark(paths: readonly string[], path: string): string[] {
  return paths.filter((candidate) => candidate !== path)
}

/**
 * Record a visit, newest first. Revisiting moves the path to the front instead
 * of duplicating it.
 */
export function addRecentPath(paths: readonly string[], path: string): string[] {
  if (!path) return [...paths]
  return [path, ...paths.filter((candidate) => candidate !== path)].slice(0, MAX_RECENT_PATHS)
}
