import { describe, expect, test } from "bun:test"
import {
  ensureRunID,
  ensureProcessRole,
  ensureProcessMetadata,
  sanitizedProcessEnv,
  OPENCODE_RUN_ID,
  OPENCODE_PROCESS_ROLE,
} from "@opencode-ai/core/util/opencode-process"

describe("ensureRunID", () => {
  test("returns existing run id", () => {
    process.env[OPENCODE_RUN_ID] = "existing-id"
    expect(ensureRunID()).toBe("existing-id")
    delete process.env[OPENCODE_RUN_ID]
  })

  test("generates and stores a uuid when missing", () => {
    delete process.env[OPENCODE_RUN_ID]
    const id = ensureRunID()
    expect(typeof id).toBe("string")
    expect(id.length).toBeGreaterThan(0)
    expect(process.env[OPENCODE_RUN_ID]).toBe(id)
    delete process.env[OPENCODE_RUN_ID]
  })
})

describe("ensureProcessRole", () => {
  test("returns existing role", () => {
    process.env[OPENCODE_PROCESS_ROLE] = "worker"
    expect(ensureProcessRole("main")).toBe("worker")
    delete process.env[OPENCODE_PROCESS_ROLE]
  })

  test("falls back when missing", () => {
    delete process.env[OPENCODE_PROCESS_ROLE]
    expect(ensureProcessRole("main")).toBe("main")
  })

  test("does not override existing role with fallback", () => {
    process.env[OPENCODE_PROCESS_ROLE] = "worker"
    expect(ensureProcessRole("main")).toBe("worker")
    delete process.env[OPENCODE_PROCESS_ROLE]
  })
})

describe("ensureProcessMetadata", () => {
  test("returns run id and process role", () => {
    delete process.env[OPENCODE_RUN_ID]
    delete process.env[OPENCODE_PROCESS_ROLE]
    const metadata = ensureProcessMetadata("main")
    expect(metadata.runID).toBeDefined()
    expect(metadata.processRole).toBe("main")
    delete process.env[OPENCODE_RUN_ID]
    delete process.env[OPENCODE_PROCESS_ROLE]
  })
})

describe("sanitizedProcessEnv", () => {
  test("excludes undefined values", () => {
    const originalEntries = Object.entries
    Object.entries = (obj: any): [string, any][] => {
      if (obj === process.env) {
        return [["SOME_VAR", "value"], ["UNDEFINED_VAR", undefined as any]]
      }
      return originalEntries(obj)
    }
    try {
      const env = sanitizedProcessEnv()
      expect(env.SOME_VAR).toBe("value")
      expect("UNDEFINED_VAR" in env).toBe(false)
    } finally {
      Object.entries = originalEntries
    }
  })

  test("applies overrides", () => {
    process.env.EXISTING = "old"
    const env = sanitizedProcessEnv({ EXISTING: "new", ADDED: "added" })
    expect(env.EXISTING).toBe("new")
    expect(env.ADDED).toBe("added")
    delete process.env.EXISTING
  })
})
