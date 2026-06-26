import { describe, expect, test } from "bun:test"
import { retry } from "@opencode-ai/core/util/retry"

describe("retry", () => {
  test("returns result on first success", async () => {
    const result = await retry(async () => "ok")
    expect(result).toBe("ok")
  })

  test("retries and succeeds after transient failure", async () => {
    let attempts = 0
    const result = await retry(
      async () => {
        attempts++
        if (attempts < 2) throw new Error("network connection was lost")
        return "recovered"
      },
      { attempts: 3, delay: 0 },
    )
    expect(result).toBe("recovered")
    expect(attempts).toBe(2)
  })

  test("throws final error after all attempts exhausted", async () => {
    const error = new Error("load failed")
    await expect(
      retry(
        async () => {
          throw error
        },
        { attempts: 2, delay: 0 },
      ),
    ).rejects.toThrow("load failed")
  })

  test("does not retry non-transient error", async () => {
    let attempts = 0
    await expect(
      retry(
        async () => {
          attempts++
          throw new Error("validation failed")
        },
        { attempts: 5, delay: 0 },
      ),
    ).rejects.toThrow("validation failed")
    expect(attempts).toBe(1)
  })

  test("throws the last error after exhausting retries", async () => {
    let attempt = 0
    const errors = [new Error("err-a"), new Error("err-b"), new Error("err-c")]
    await expect(
      retry(
        async () => {
          throw errors[attempt++]!
        },
        { attempts: 3, delay: 0, retryIf: () => true },
      ),
    ).rejects.toThrow("err-c")
  })
})
