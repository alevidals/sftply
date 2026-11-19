import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PreviewDialog } from "@/features/files/components/preview-dialog"
import type { FsEntry, PreviewPayload_Serialize } from "@/lib/ipc/bindings"

const state = vi.hoisted(() => ({
  preview: vi.fn(),
}))

vi.mock("@/features/files/api", () => ({
  filesApi: () => ({ preview: state.preview }),
}))

vi.mock("@/features/settings/settings-context", () => ({
  useFormatPreferences: () => ({ sizeFormat: "binary", dateFormat: "friendly" }),
}))

function entry(name: string): FsEntry {
  return {
    name,
    path: `/remote/${name}`,
    kind: "file",
    size: 5,
    modifiedAt: null,
    permissions: null,
    owner: null,
    group: null,
    linkTarget: null,
    hidden: false,
    metadataComplete: true,
  }
}

function payload(overrides: Partial<PreviewPayload_Serialize>): PreviewPayload_Serialize {
  return {
    kind: "text",
    path: "/remote/file.txt",
    content: null,
    mimeType: null,
    dataUrl: null,
    size: 5,
    modifiedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  state.preview.mockReset()
})

describe("PreviewDialog", () => {
  it("renders a text preview as preformatted text", async () => {
    state.preview.mockResolvedValue(payload({ content: "hello preview" }))
    render(
      <PreviewDialog
        open
        scope={{ kind: "remote", sessionId: "s1" }}
        entry={entry("file.txt")}
        onOpenChange={vi.fn()}
      />,
    )

    expect(await screen.findByText("hello preview")).toBeInTheDocument()
  })

  it("renders an image preview as an img element", async () => {
    state.preview.mockResolvedValue(
      payload({
        kind: "image",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,AAAA",
      }),
    )
    render(
      <PreviewDialog
        open
        scope={{ kind: "remote", sessionId: "s1" }}
        entry={entry("photo.png")}
        onOpenChange={vi.fn()}
      />,
    )

    expect(await screen.findByRole("img", { name: "photo.png" })).toBeInTheDocument()
  })
})
