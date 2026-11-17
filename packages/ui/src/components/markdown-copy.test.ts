import { describe, expect, test } from "bun:test"
import { decorate, setCopyState } from "./markdown"

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

  test("decorate keeps exactly one copy button on every code block", () => {
    class StubElement {
      tagName: string
      attrs = new Map<string, string>()
      children: StubElement[] = []
      parentElement: StubElement | null = null
      textContent: string | null = ""
      type = ""
      innerHTML = ""
      constructor(tagName: string) {
        this.tagName = tagName.toLowerCase()
      }
      setAttribute(name: string, value: string) {
        this.attrs.set(name, value)
      }
      getAttribute(name: string) {
        return this.attrs.get(name) ?? null
      }
      removeAttribute(name: string) {
        this.attrs.delete(name)
      }
      appendChild(child: StubElement) {
        child.parentElement = this
        this.children.push(child)
        return child
      }
      replaceChild(next: StubElement, prev: StubElement) {
        const idx = this.children.indexOf(prev)
        if (idx === -1) return prev
        next.parentElement = this
        prev.parentElement = null
        this.children[idx] = next
        return prev
      }
      remove() {
        if (!this.parentElement) return
        this.parentElement.children = this.parentElement.children.filter((c) => c !== this)
        this.parentElement = null
      }
      querySelectorAll(selector: string): StubElement[] {
        const out: StubElement[] = []
        const visit = (node: StubElement) => {
          for (const child of node.children) {
            if (selector === "pre" && child.tagName === "pre") out.push(child)
            if (selector === '[data-slot="markdown-copy-button"]' && child.getAttribute("data-slot") === "markdown-copy-button") {
              out.push(child)
            }
            visit(child)
          }
        }
        visit(this)
        return out
      }
    }
    class StubButton extends StubElement {
      constructor() {
        super("button")
      }
    }

    const prevDocument = globalThis.document
    const prevButton = globalThis.HTMLButtonElement
    ;(globalThis as Record<string, unknown>).HTMLButtonElement = StubButton
    ;(globalThis as Record<string, unknown>).document = {
      createElement: (tag: string) => (tag === "button" ? new StubButton() : new StubElement(tag)),
      createElementNS: (_ns: string, tag: string) => new StubElement(tag),
    }

    try {
      const root = new StubElement("div")
      root.appendChild(new StubElement("pre"))
      root.appendChild(new StubElement("pre"))
      root.appendChild(new StubElement("pre"))

      decorate(root as unknown as HTMLDivElement, { copy: "copy", copied: "copied" })

      const wrappers = root.children.filter((c) => c.getAttribute("data-component") === "markdown-code")
      expect(wrappers.length).toBe(3)
      for (const wrapper of wrappers) {
        const buttons = wrapper.querySelectorAll('[data-slot="markdown-copy-button"]')
        expect(buttons.length).toBe(1)
      }
    } finally {
      ;(globalThis as Record<string, unknown>).document = prevDocument
      ;(globalThis as Record<string, unknown>).HTMLButtonElement = prevButton
    }
  })
})
