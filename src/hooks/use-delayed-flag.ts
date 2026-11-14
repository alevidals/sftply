import { useEffect, useState } from "react"

/**
 * Report a busy flag only after it has lasted `delayMs`. Saves that finish in a
 * few milliseconds otherwise flash a spinner for one frame, which reads as a
 * glitch rather than progress.
 */
export function useDelayedFlag(active: boolean, delayMs = 200): boolean {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!active) {
      setVisible(false)
      return
    }
    const timer = setTimeout(() => setVisible(true), delayMs)
    return () => clearTimeout(timer)
  }, [active, delayMs])

  return visible
}
