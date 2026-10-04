import { afterEach, describe, expect, test, mock } from "bun:test"
import { uuid } from "./uuid"

const originalCrypto = globalThis.crypto
const originalSecure = Object.getOwnPropertyDescriptor(globalThis, "isSecureContext")
const originalRandom = Math.random

const setCrypto = (value: Partial<Crypto> | undefined) => {
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
    Reflect.deleteProperty(globalThis, "isSecureContext")
  }

  Math.random = originalRandom
  mock.restore()
})

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe("uuid", () => {
  test("uses randomUUID in secure contexts", () => {
    setCrypto({ randomUUID: () => "00000000-0000-0000-0000-000000000000" })
    setSecure(true)
    expect(uuid()).toBe("00000000-0000-0000-0000-000000000000")
  })

  test("falls back to valid UUID v4 in insecure contexts", () => {
    setCrypto({ randomUUID: () => "00000000-0000-0000-0000-000000000000" })
    setSecure(false)
    const result = uuid()
    expect(result).toMatch(UUID_V4_REGEX)
  })

  test("falls back when randomUUID throws", () => {
    setCrypto({
      randomUUID: () => {
        throw new DOMException("Failed", "OperationError")
      },
    })
    setSecure(true)
    const result = uuid()
    expect(result).toMatch(UUID_V4_REGEX)
  })

  test("falls back when randomUUID is unavailable", () => {
    setCrypto({})
    setSecure(true)
    const result = uuid()
    expect(result).toMatch(UUID_V4_REGEX)
  })

  test("falls back when crypto is undefined", () => {
    setCrypto(undefined)
    setSecure(true)
    const result = uuid()
    expect(result).toMatch(UUID_V4_REGEX)
  })

  test("uses getRandomValues in fallback when randomUUID is missing", () => {
    let getRandomValuesCalled = false
    setCrypto({
      getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
        getRandomValuesCalled = true
        if (ArrayBuffer.isView(array)) {
          const arr = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
          for (let i = 0; i < arr.length; i++) arr[i] = i
        }
        return array
      },
    })
    setSecure(true)
    const result = uuid()
    expect(getRandomValuesCalled).toBe(true)
    expect(result).toMatch(UUID_V4_REGEX)
  })

  test("falls back when isSecureContext is undefined", () => {
    setCrypto({ randomUUID: () => "00000000-0000-0000-0000-000000000000" })
    setSecure(undefined)
    expect(uuid()).toBe("00000000-0000-0000-0000-000000000000")
  })
})
