import { describe, expect, test } from "bun:test"
import { forwardKeyDown, shouldClearOnEscape, TextField } from "./text-field"

const escape = { key: "Escape" } as KeyboardEvent

describe("TextField", () => {
  test("module resolves cleanly", () => {
    expect(TextField).toBeDefined()
  })
})

describe("shouldClearOnEscape", () => {
  test("clears on Escape when clearable and has value", () => {
    expect(shouldClearOnEscape("Escape", true, true)).toBe(true)
  })

  test("does not clear on Escape when input is empty", () => {
    expect(shouldClearOnEscape("Escape", true, false)).toBe(false)
  })

  test("does not clear on Escape without onClear", () => {
    expect(shouldClearOnEscape("Escape", false, true)).toBe(false)
  })

  test("does not clear on non-Escape keys", () => {
    expect(shouldClearOnEscape("Enter", true, true)).toBe(false)
  })
})

describe("forwardKeyDown", () => {
  test("forwards event to function handler", () => {
    let received: KeyboardEvent | undefined
    forwardKeyDown((e: KeyboardEvent) => {
      received = e
    }, escape)
    expect(received).toBe(escape)
  })

  test("forwards event to SolidJS bound tuple handler as [handler, argument]", () => {
    let receivedArg: unknown
    let receivedEvent: unknown
    forwardKeyDown([(arg: string, e: KeyboardEvent) => {
      receivedArg = arg
      receivedEvent = e
    }, "data"], escape)
    expect(receivedArg).toBe("data")
    expect(receivedEvent).toBe(escape)
  })

  test("ignores missing user handler", () => {
    expect(() => forwardKeyDown(undefined, escape)).not.toThrow()
  })
})
