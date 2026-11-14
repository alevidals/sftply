export interface SelectionState {
  selected: ReadonlySet<string>
  /** Row index where a shift-range starts. */
  anchor: number | null
  /** Row index that currently has keyboard focus/active styling. */
  active: number | null
}

export type SelectionMode = "replace" | "toggle" | "range" | "focus"

interface PathEntry {
  path: string
}

export const EMPTY_SELECTION: SelectionState = {
  selected: new Set<string>(),
  anchor: null,
  active: null,
}

function rangePaths(entries: readonly PathEntry[], from: number, to: number): Set<string> {
  const start = Math.min(from, to)
  const end = Math.max(from, to)
  const result = new Set<string>()
  for (let index = start; index <= end; index += 1) {
    const entry = entries[index]
    if (entry) result.add(entry.path)
  }
  return result
}

/** Apply a row click with the platform's modifier-key semantics. */
export function selectRow(
  entries: readonly PathEntry[],
  state: SelectionState,
  index: number,
  mode: SelectionMode,
): SelectionState {
  const entry = entries[index]
  if (!entry) return state

  if (mode === "focus") {
    return { selected: state.selected, anchor: index, active: index }
  }

  if (mode === "range" && state.anchor !== null) {
    return {
      selected: rangePaths(entries, state.anchor, index),
      anchor: state.anchor,
      active: index,
    }
  }

  if (mode === "toggle") {
    const selected = new Set(state.selected)
    if (selected.has(entry.path)) {
      selected.delete(entry.path)
    } else {
      selected.add(entry.path)
    }
    return { selected, anchor: index, active: index }
  }

  return {
    selected: new Set([entry.path]),
    anchor: index,
    active: index,
  }
}

export function selectAll(entries: readonly PathEntry[]): SelectionState {
  return {
    selected: new Set(entries.map((entry) => entry.path)),
    anchor: entries.length > 0 ? 0 : null,
    active: entries.length > 0 ? entries.length - 1 : null,
  }
}

export function clearSelection(entries: readonly PathEntry[]): SelectionState {
  const active = entries.length > 0 ? 0 : null
  return {
    selected: new Set<string>(),
    anchor: active,
    active,
  }
}

/** Move the active row, optionally extending the selection like Shift+Arrow. */
export function moveSelection(
  entries: readonly PathEntry[],
  state: SelectionState,
  delta: number,
  extend: boolean,
): SelectionState {
  if (entries.length === 0) return EMPTY_SELECTION

  const base = state.active ?? (delta > 0 ? -1 : entries.length)
  const next = Math.max(0, Math.min(entries.length - 1, base + delta))
  const entry = entries[next]
  if (!entry) return state

  if (extend) {
    const anchor = state.anchor ?? state.active ?? next
    return {
      selected: rangePaths(entries, anchor, next),
      anchor,
      active: next,
    }
  }

  return {
    selected: new Set([entry.path]),
    anchor: next,
    active: next,
  }
}

/** Focus a specific row without changing the selection (Home/End/scroll). */
export function focusRow(
  entries: readonly PathEntry[],
  state: SelectionState,
  index: number,
  extend: boolean,
): SelectionState {
  if (entries.length === 0) return EMPTY_SELECTION
  const next = Math.max(0, Math.min(entries.length - 1, index))
  const entry = entries[next]
  if (!entry) return state

  if (extend) {
    const anchor = state.anchor ?? state.active ?? next
    return {
      selected: rangePaths(entries, anchor, next),
      anchor,
      active: next,
    }
  }

  return {
    selected: new Set([entry.path]),
    anchor: next,
    active: next,
  }
}

/**
 * Incremental type-ahead. Searches from the row after the active one, wrapping
 * at the end, and selects the first match without clearing the buffer.
 */
export function selectByPrefix(
  entries: readonly PathEntry[],
  state: SelectionState,
  prefix: string,
): SelectionState | null {
  const needle = prefix.toLocaleLowerCase()
  if (!needle || entries.length === 0) return null

  const start = state.active === null ? 0 : (state.active + 1) % entries.length
  for (let offset = 0; offset < entries.length; offset += 1) {
    const index = (start + offset) % entries.length
    const entry = entries[index]
    if (!entry) continue
    if (entry.path.split(/[\\/]/).pop()?.toLocaleLowerCase().startsWith(needle)) {
      return {
        selected: new Set([entry.path]),
        anchor: index,
        active: index,
      }
    }
  }
  return null
}

/** Drop selected paths that are no longer present after a refetch. */
export function pruneSelection(
  entries: readonly PathEntry[],
  state: SelectionState,
): SelectionState {
  if (state.selected.size === 0) return state
  const paths = new Set(entries.map((entry) => entry.path))
  const selected = new Set([...state.selected].filter((path) => paths.has(path)))
  if (selected.size === state.selected.size) return state

  const activeEntry = state.active === null ? null : entries[state.active]
  return {
    selected,
    anchor: state.anchor,
    active: activeEntry && selected.has(activeEntry.path) ? state.active : null,
  }
}
