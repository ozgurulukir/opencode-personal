import { describe, expect, test } from "bun:test"
import { LoadAPIKeyError } from "ai"
import { rethrowAuthAware } from "../../src/acp/agent"

/**
 * Characterization of the auth-aware catch mapping shared by the ACP agent's
 * session handlers (newSession/loadSession/listSessions/fork/resume).
 *
 * Current behavior: MessageV2.fromError always returns a serialized plain
 * object, so LoadAPIKeyError.isInstance(error) is false even when the original
 * error is a LoadAPIKeyError — the authRequired branch never fires and every
 * error is rethrown as-is. These tests pin that reality; if fromError is ever
 * changed to preserve error instances, the first test will fail and force a
 * deliberate decision about the authRequired mapping.
 */
describe("rethrowAuthAware (characterization)", () => {
  test("rethrows a LoadAPIKeyError unchanged (authRequired branch unreachable today)", () => {
    const err = new LoadAPIKeyError({ message: "API key missing" })
    expect(() => rethrowAuthAware(err, "anthropic")).toThrow(err)
  })

  test("rethrows a generic Error unchanged", () => {
    const err = new Error("boom")
    expect(() => rethrowAuthAware(err, undefined)).toThrow(err)
  })

  test("rethrows non-Error throwables", () => {
    expect(() => rethrowAuthAware("plain string", "openai")).toThrow("plain string")
  })
})
