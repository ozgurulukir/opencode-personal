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
    // oxlint-disable-next-line typescript(await-thenable)
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
    // oxlint-disable-next-line typescript(await-thenable)
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
    // oxlint-disable-next-line typescript(await-thenable)
    await expect(
      retry(
        async () => {
          throw errors[attempt++]
        },
        { attempts: 3, delay: 0, retryIf: () => true },
      ),
    ).rejects.toThrow("err-c")
  })

  test("retries error with transient error code", async () => {
    let attempts = 0
    const result = await retry(
      async () => {
        attempts++
        if (attempts < 2) {
          const err = new Error("Custom system error")
          // oxlint-disable-next-line typescript(no-unsafe-type-assertion)
          ;(err as unknown as { code: string }).code = "ECONNRESET"
          throw err
        }
        return "recovered-code"
      },
      { attempts: 3, delay: 0 },
    )
    expect(result).toBe("recovered-code")
    expect(attempts).toBe(2)
  })

  test("retries error with transient HTTP status code", async () => {
    let attempts = 0
    const result = await retry(
      async () => {
        attempts++
        if (attempts < 2) {
          const err = new Error("Service Unavailable")
          // oxlint-disable-next-line typescript(no-unsafe-type-assertion)
          ;(err as unknown as { status: number }).status = 503
          throw err
        }
        return "recovered-status"
      },
      { attempts: 3, delay: 0 },
    )
    expect(result).toBe("recovered-status")
    expect(attempts).toBe(2)
  })

  test("retries error with nested transient cause", async () => {
    let attempts = 0
    const result = await retry(
      async () => {
        attempts++
        if (attempts < 2) {
          const cause = new Error("network connection was lost")
          throw new Error("Wrapper error", { cause })
        }
        return "recovered-cause"
      },
      { attempts: 3, delay: 0 },
    )
    expect(result).toBe("recovered-cause")
    expect(attempts).toBe(2)
  })
})
