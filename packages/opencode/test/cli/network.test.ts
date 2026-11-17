import { afterEach, describe, expect, test } from "bun:test"
import { insecureBindingError } from "../../src/cli/network"

describe("cli/network insecureBindingError", () => {
  const prevPassword = process.env.OPENCODE_SERVER_PASSWORD
  const prevAllow = process.env.OPENCODE_ALLOW_INSECURE_REMOTE

  afterEach(() => {
    if (prevPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
    else process.env.OPENCODE_SERVER_PASSWORD = prevPassword
    if (prevAllow === undefined) delete process.env.OPENCODE_ALLOW_INSECURE_REMOTE
    else process.env.OPENCODE_ALLOW_INSECURE_REMOTE = prevAllow
  })

  test("rejects :: and [::] without a server password", () => {
    delete process.env.OPENCODE_SERVER_PASSWORD
    delete process.env.OPENCODE_ALLOW_INSECURE_REMOTE

    expect(insecureBindingError("::")).toContain("Refusing to bind")
    expect(insecureBindingError("[::]")).toContain("Refusing to bind")
    expect(insecureBindingError("0.0.0.0")).toContain("Refusing to bind")
  })

  test("allows loopback hostnames without a password", () => {
    delete process.env.OPENCODE_SERVER_PASSWORD
    delete process.env.OPENCODE_ALLOW_INSECURE_REMOTE

    expect(insecureBindingError("127.0.0.1")).toBeUndefined()
    expect(insecureBindingError("localhost")).toBeUndefined()
    expect(insecureBindingError("::1")).toBeUndefined()
    expect(insecureBindingError("[::1]")).toBeUndefined()
  })
})
