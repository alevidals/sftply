import { beforeEach, describe, expect, it } from "vitest"
import type { ActivityEntry } from "@/lib/ipc/bindings"
import { useActivityStore } from "@/stores/activity-store"

function entry(id: string, message = id): ActivityEntry {
  return { id, level: "info", message, timestamp: 1 }
}

beforeEach(() => {
  useActivityStore.setState({ entries: [] })
})

describe("activity store", () => {
  it("prepends new entries", () => {
    const { add } = useActivityStore.getState()
    add(entry("a"))
    add(entry("b"))

    expect(useActivityStore.getState().entries.map((item) => item.id)).toEqual(["b", "a"])
  })

  it("deduplicates events by id", () => {
    const { add } = useActivityStore.getState()
    add(entry("a"))
    add(entry("a", "duplicate"))

    expect(useActivityStore.getState().entries).toHaveLength(1)
    expect(useActivityStore.getState().entries[0]?.message).toBe("a")
  })

  it("caps retained history", () => {
    const { add } = useActivityStore.getState()
    for (let index = 0; index < 505; index += 1) {
      add(entry(`id-${index}`))
    }

    expect(useActivityStore.getState().entries).toHaveLength(500)
    expect(useActivityStore.getState().entries[0]?.id).toBe("id-504")
  })

  it("clears history", () => {
    useActivityStore.getState().add(entry("a"))
    useActivityStore.getState().clear()
    expect(useActivityStore.getState().entries).toEqual([])
  })
})
