import { useCallback, useState } from "react"

const MAX_HISTORY = 100

interface NavigationState {
  path: string
  history: string[]
  index: number
}

/** Per-pane browser history. The initial path seeds the history once. */
export function usePathNavigation(initialPath: string) {
  const [state, setState] = useState<NavigationState>({
    path: initialPath,
    history: [initialPath],
    index: 0,
  })

  const navigate = useCallback((next: string, replace = false) => {
    setState((current) => {
      if (next === current.path) return current

      const base = replace
        ? current.history.slice(0, current.index)
        : current.history.slice(0, current.index + 1)
      const history = [...base, next].slice(-MAX_HISTORY)
      return { path: next, history, index: history.length - 1 }
    })
  }, [])

  const back = useCallback(() => {
    setState((current) => {
      if (current.index <= 0) return current
      const index = current.index - 1
      const path = current.history[index]
      return path ? { ...current, path, index } : current
    })
  }, [])

  const forward = useCallback(() => {
    setState((current) => {
      if (current.index >= current.history.length - 1) return current
      const index = current.index + 1
      const path = current.history[index]
      return path ? { ...current, path, index } : current
    })
  }, [])

  return {
    path: state.path,
    canBack: state.index > 0,
    canForward: state.index >= 0 && state.index < state.history.length - 1,
    navigate,
    back,
    forward,
  }
}
