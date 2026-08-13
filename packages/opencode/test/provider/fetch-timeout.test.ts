import { describe, expect, test } from "bun:test"
import {
  DEFAULT_CHUNK_TIMEOUT,
  DEFAULT_HTTP_TIMEOUT,
  resolveChunkTimeout,
  resolveHttpTimeout,
} from "../../src/provider/provider"
import { ConfigProvider } from "../../src/config/provider"

describe("resolveHttpTimeout", () => {
  test("undefined resolves to the documented default", () => {
    expect(resolveHttpTimeout(undefined)).toBe(DEFAULT_HTTP_TIMEOUT)
  })

  test("null resolves to the documented default", () => {
    expect(resolveHttpTimeout(null)).toBe(DEFAULT_HTTP_TIMEOUT)
  })

  test("false preserves the opt-out (unbounded)", () => {
    expect(resolveHttpTimeout(false)).toBe(false)
  })

  test("an explicit positive number is honored verbatim", () => {
    expect(resolveHttpTimeout(30000)).toBe(30000)
  })
})

describe("resolveChunkTimeout", () => {
  test("undefined resolves to the documented default", () => {
    expect(resolveChunkTimeout(undefined)).toBe(DEFAULT_CHUNK_TIMEOUT)
  })

  test("false preserves the new opt-out (watchdog suppressed)", () => {
    expect(resolveChunkTimeout(false)).toBe(false)
  })

  test("an explicit positive number is honored verbatim", () => {
    expect(resolveChunkTimeout(15000)).toBe(15000)
  })

  test("0 and negative numbers fall back to the default", () => {
    expect(resolveChunkTimeout(0)).toBe(DEFAULT_CHUNK_TIMEOUT)
    expect(resolveChunkTimeout(-5)).toBe(DEFAULT_CHUNK_TIMEOUT)
  })
})

describe("ProviderConfig chunkTimeout/timeout schema (false opt-outs)", () => {
  const parse = (options: Record<string, unknown>) =>
    ConfigProvider.Info.zod.safeParse({ provider: { test: { options } } })

  test("accepts timeout: false and chunkTimeout: false", () => {
    expect(parse({ timeout: false, chunkTimeout: false }).success).toBe(true)
  })

  test("accepts explicit positive numbers for both fields", () => {
    expect(parse({ timeout: 30000, chunkTimeout: 15000 }).success).toBe(true)
  })

  test("accepts omitted fields", () => {
    expect(parse({}).success).toBe(true)
  })
})