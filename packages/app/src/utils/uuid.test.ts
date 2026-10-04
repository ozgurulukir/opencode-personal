import { afterEach, describe, expect, spyOn, test, mock } from "bun:test"
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
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript(no-unsafe-type-assertion)
    delete (globalThis as Record<string, unknown>).isSecureContext
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

  test("falls back to secure v4 UUID in insecure contexts using getRandomValues", () => {
    const getRandomValues = mock((array: ArrayBufferView) => {
      const u8 = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
      u8.fill(1)
      return array
    })
    setCrypto({
      randomUUID: () => "00000000-0000-0000-0000-000000000000",
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript(no-unsafe-type-assertion)
      getRandomValues: getRandomValues as Crypto["getRandomValues"],
    })
    setSecure(false)
    const result = uuid()
    expect(getRandomValues).toHaveBeenCalled()
    expect(result).toMatch(UUID_V4_REGEX)
    expect(result).toBe("01010101-0101-4101-8101-010101010101")
  })

  test("falls back when randomUUID throws", () => {
    const getRandomValues = mock((array: ArrayBufferView) => {
      const u8 = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
      u8.fill(1)
      return array
    })
    setCrypto({
      randomUUID: () => {
        throw new DOMException("Failed", "OperationError")
      },
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript(no-unsafe-type-assertion)
      getRandomValues: getRandomValues as Crypto["getRandomValues"],
    })
    setSecure(true)
    const result = uuid()
    expect(getRandomValues).toHaveBeenCalled()
    expect(result).toMatch(UUID_V4_REGEX)
  })

  test("falls back when randomUUID is unavailable but getRandomValues is available", () => {
    const getRandomValues = mock((array: ArrayBufferView) => {
      const u8 = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
      u8.fill(2)
      return array
    })
    setCrypto({
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript(no-unsafe-type-assertion)
      getRandomValues: getRandomValues as Crypto["getRandomValues"],
    })
    setSecure(true)
    const result = uuid()
    expect(getRandomValues).toHaveBeenCalled()
    expect(result).toMatch(UUID_V4_REGEX)
    expect(result).toBe("02020202-0202-4202-8202-020202020202")
  })

  test("falls back to Math.random when crypto is undefined", () => {
    setCrypto(undefined)
    setSecure(true)
    spyOn(Math, "random").mockImplementation(() => 0.5)
    const result = uuid()
    expect(result).toMatch(UUID_V4_REGEX)
  })

  test("falls back when isSecureContext is undefined", () => {
    setCrypto({ randomUUID: () => "00000000-0000-0000-0000-000000000000" })
    setSecure(undefined)
    expect(uuid()).toBe("00000000-0000-0000-0000-000000000000")
  })
})
