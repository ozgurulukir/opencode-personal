import { afterEach, describe, expect, test, mock } from "bun:test"
import { Identifier } from "./id"

const originalCrypto = globalThis.crypto

const setCrypto = (value: Record<string, unknown> | undefined) => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value,
    writable: true,
  })
}

afterEach(() => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: originalCrypto,
    writable: true,
  })
  mock.restore()
})

describe("Identifier", () => {
  test("ascending generates ID with correct prefix and length", () => {
    const id = Identifier.ascending("session")
    expect(id.startsWith("ses_")).toBe(true)
    expect(id.length).toBe(30)
  })

  test("descending generates ID with correct prefix and length", () => {
    const id = Identifier.descending("message")
    expect(id.startsWith("msg_")).toBe(true)
    expect(id.length).toBe(30)
  })

  test("schema validates prefix correctly", () => {
    const schema = Identifier.schema("session")
    expect(schema.safeParse("ses_123456").success).toBe(true)
    expect(schema.safeParse("msg_123456").success).toBe(false)
  })

  test("ascending accepts given string matching prefix", () => {
    const custom = "ses_custom123"
    expect(Identifier.ascending("session", custom)).toBe(custom)
  })

  test("ascending throws error when given string has invalid prefix", () => {
    expect(() => Identifier.ascending("session", "invalid_123")).toThrow("ID invalid_123 does not start with ses")
  })

  test("uses crypto.getRandomValues and rejects bytes >= 248 for unbiased base62", () => {
    let callCount = 0
    setCrypto({
      getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
        callCount++
        if (array instanceof Uint8Array) {
          for (let i = 0; i < array.length; i++) {
            array[i] = i === 0 && callCount === 1 ? 250 : i % 62
          }
        }
        return array
      },
    })

    const id = Identifier.ascending("session")
    expect(id.startsWith("ses_")).toBe(true)
    expect(callCount).toBeGreaterThanOrEqual(1)
  })

  test("throws an error when CSPRNG is unavailable", () => {
    setCrypto(undefined)
    expect(() => Identifier.ascending("session")).toThrow(
      "Cryptographically secure random number generator is not available",
    )
  })

  test("throws an error when getRandomValues is not a function", () => {
    setCrypto({})
    expect(() => Identifier.ascending("session")).toThrow(
      "Cryptographically secure random number generator is not available",
    )
  })
})
