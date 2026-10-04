import { afterEach, describe, expect, mock, spyOn, it } from "bun:test"
import { uuid } from "./uuid"

const originalCrypto = globalThis.crypto
const originalSecure = Object.getOwnPropertyDescriptor(globalThis, "isSecureContext")
const originalRandom = Math.random

interface MockCrypto {
  randomUUID?: () => string
  getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T
}

const setCrypto = (value: MockCrypto | undefined) => {
  if (value === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
      writable: true,
    })
  } else {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value,
      writable: true,
    })
  }
}

const setSecure = (value: boolean | undefined) => {
  if (value === undefined) {
    Object.defineProperty(globalThis, "isSecureContext", {
      value: undefined,
      configurable: true,
      writable: true,
    })
  } else {
    Object.defineProperty(globalThis, "isSecureContext", {
      configurable: true,
      value,
      writable: true,
    })
  }
}

afterEach(() => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: originalCrypto,
    writable: true,
  })

  if (originalSecure) {
    Object.defineProperty(globalThis, "isSecureContext", originalSecure)
  } else {
    delete (globalThis as Record<string, unknown>).isSecureContext
  }

  Math.random = originalRandom
  mock.restore()
})

const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe("uuid", () => {
  it("uses randomUUID in secure contexts", () => {
    setCrypto({ randomUUID: () => "00000000-0000-0000-0000-000000000000" })
    setSecure(true)
    expect(uuid()).toBe("00000000-0000-0000-0000-000000000000")
  })

  it("uses getRandomValues fallback in insecure contexts", () => {
    let called = false
    const getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
      called = true
      if (array instanceof Uint8Array) {
        array.fill(1)
      }
      return array
    }
    setCrypto({
      randomUUID: () => "00000000-0000-0000-0000-000000000000",
      getRandomValues,
    })
    setSecure(false)

    const result = uuid()
    expect(called).toBe(true)
    expect(result).toMatch(uuidV4Regex)
  })

  it("uses getRandomValues fallback when randomUUID throws", () => {
    let called = false
    const getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
      called = true
      if (array instanceof Uint8Array) {
        array.fill(2)
      }
      return array
    }
    setCrypto({
      randomUUID: () => {
        throw new DOMException("Failed", "OperationError")
      },
      getRandomValues,
    })
    setSecure(true)

    const result = uuid()
    expect(called).toBe(true)
    expect(result).toMatch(uuidV4Regex)
  })

  it("uses getRandomValues fallback when randomUUID is unavailable", () => {
    let called = false
    const getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
      called = true
      if (array instanceof Uint8Array) {
        array.fill(3)
      }
      return array
    }
    setCrypto({
      getRandomValues,
    })
    setSecure(true)

    const result = uuid()
    expect(called).toBe(true)
    expect(result).toMatch(uuidV4Regex)
  })

  it("falls back to Math.random when crypto is undefined", () => {
    setCrypto(undefined)
    setSecure(true)
    spyOn(Math, "random").mockImplementation(() => 0.5)

    const result = uuid()
    expect(result).toMatch(uuidV4Regex)
  })

  it("uses randomUUID when isSecureContext is undefined", () => {
    setCrypto({ randomUUID: () => "00000000-0000-0000-0000-000000000000" })
    setSecure(undefined)
    expect(uuid()).toBe("00000000-0000-0000-0000-000000000000")
  })
})
