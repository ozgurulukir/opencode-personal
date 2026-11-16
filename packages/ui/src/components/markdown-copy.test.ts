import { describe, expect, test } from "bun:test"
import { setCopyState } from "./markdown"

// Regression test for the copy-button feedback bug: setCopyState executed the
// reset statements unconditionally, so data-copied/"copied" labels never
// persisted and the CSS swapped-icon rule was dead code.

function stubButton() {
  const attrs = new Map<string, string | null>()
  return {
    setAttribute(name: string, value: string) {
      attrs.set(name, value)
    },
    removeAttribute(name: string) {
      attrs.set(name, null)
    },
    attrs,
  } as unknown as HTMLButtonElement & { attrs: Map<string, string | null> }
}

describe("markdown copy state", () => {
  test("persists the copied state after a successful copy", () => {
    const button = stubButton()
    setCopyState(button, { copy: "copy", copied: "copied" }, true)
    expect(button.attrs.get("data-copied")).toBe("true")
    expect(button.attrs.get("aria-label")).toBe("copied")
    expect(button.attrs.get("data-tooltip")).toBe("copied")
  })

  test("resets to the idle copy state", () => {
    const button = stubButton()
    setCopyState(button, { copy: "copy", copied: "copied" }, true)
    setCopyState(button, { copy: "copy", copied: "copied" }, false)
    expect(button.attrs.get("data-copied")).toBeNull()
    expect(button.attrs.get("aria-label")).toBe("copy")
    expect(button.attrs.get("data-tooltip")).toBe("copy")
  })
})
