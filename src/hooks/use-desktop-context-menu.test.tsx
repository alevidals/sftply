import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useDesktopContextMenu } from "@/hooks/use-desktop-context-menu"

function Harness() {
  useDesktopContextMenu()
  return (
    <div>
      <p data-testid="plain">plain</p>
      <input data-testid="field" aria-label="field" />
      <div data-testid="editable" contentEditable />
    </div>
  )
}

function contextMenuOn(element: Element): boolean {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
  element.dispatchEvent(event)
  return event.defaultPrevented
}

describe("useDesktopContextMenu", () => {
  it("suppresses the webview menu outside editable fields", () => {
    const { getByTestId } = render(<Harness />)
    expect(contextMenuOn(getByTestId("plain"))).toBe(true)
  })

  it("keeps cut/copy/paste available in inputs and editable content", () => {
    const { getByTestId } = render(<Harness />)
    expect(contextMenuOn(getByTestId("field"))).toBe(false)
    expect(contextMenuOn(getByTestId("editable"))).toBe(false)
  })
})
