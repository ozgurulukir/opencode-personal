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
        writable: true
    })
  } else {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: value as Crypto,
    })
  }
}

const setSecure = (value: boolean | undefined) => {
  if (value === undefined) {
    Object.defineProperty(globalThis, "isSecureContext", {
        value: undefined,
        configurable: true,
        writable: true
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
    delete (globalThis as any).isSecureContext
  }

  Math.random = originalRandom
  mock.restore()
})

describe("uuid", () => {
  test("uses randomUUID in secure contexts", () => {
    setCrypto({ randomUUID: () => "00000000-0000-0000-0000-000000000000" })
    setSecure(true)
    expect(uuid()).toBe("00000000-0000-0000-0000-000000000000")
  })

  test("falls back in insecure contexts", () => {
    setCrypto({ randomUUID: () => "00000000-0000-0000-0000-000000000000" })
    setSecure(false)
    spyOn(Math, "random").mockImplementation(() => 0.5)
    expect(uuid()).toBe("8")
  })

  test("falls back when randomUUID throws", () => {
    setCrypto({
      randomUUID: () => {
        throw new DOMException("Failed", "OperationError")
      },
    })
    setSecure(true)
    spyOn(Math, "random").mockImplementation(() => 0.5)
    expect(uuid()).toBe("8")
  })

  test("falls back when randomUUID is unavailable", () => {
    setCrypto({})
    setSecure(true)
    spyOn(Math, "random").mockImplementation(() => 0.5)
    expect(uuid()).toBe("8")
  })

  test("falls back when crypto is undefined", () => {
    setCrypto(undefined)
    setSecure(true)
    spyOn(Math, "random").mockImplementation(() => 0.5)
    expect(uuid()).toBe("8")
  })

  test("falls back when isSecureContext is undefined", () => {
    setCrypto({ randomUUID: () => "00000000-0000-0000-0000-000000000000" })
    setSecure(undefined)
    spyOn(Math, "random").mockImplementation(() => 0.5)
    expect(uuid()).toBe("00000000-0000-0000-0000-000000000000")
  })
})
