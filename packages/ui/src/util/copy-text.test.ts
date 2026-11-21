import { afterEach, describe, expect, test } from "bun:test"
import { copyText } from "./copy-text"

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator")

function setClipboard(write?: (value: string) => Promise<void>) {
  Object.defineProperty(globalThis, "navigator", {
    value: write ? { clipboard: { writeText: write } } : undefined,
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator)
})

describe("util.copyText", () => {
  test("writes and returns true on success", async () => {
    let written: string | undefined
    setClipboard(async (value: string) => {
      written = value
    })
    expect(await copyText("hello")).toBe(true)
    expect(written).toBe("hello")
  })

  test("returns false on rejection instead of an unhandled rejection", async () => {
    setClipboard(() => Promise.reject(new Error("permission denied")))
    expect(await copyText("hello")).toBe(false)
  })

  test("returns false when no clipboard is available", async () => {
    setClipboard(undefined)
    expect(await copyText("hello")).toBe(false)
  })
})
