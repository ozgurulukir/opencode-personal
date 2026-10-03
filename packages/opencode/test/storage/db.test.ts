import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { InstallationChannel } from "@opencode-ai/core/installation/version"
import { Database } from "@/storage/db"

describe("Database.Path", () => {
  test("returns database path for the current channel", () => {
    const expected = ["latest", "beta"].includes(InstallationChannel)
      ? path.join(Global.Path.data, "opencode.db")
      : path.join(Global.Path.data, `opencode-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
    expect(Database.getChannelPath()).toBe(expected)
  })
})

describe("Database post-commit effects", () => {
  test("a throwing effect does not fail the transaction nor skip later effects", () => {
    const ran: string[] = []
    const result = Database.transaction(() => {
      Database.effect(() => {
        ran.push("first")
      })
      Database.effect(() => {
        throw new Error("post-commit boom")
      })
      Database.effect(() => {
        ran.push("third")
      })
      return "committed"
    })
    // The transaction has already committed when effects run: a throwing
    // effect must be isolated (caller succeeds) and must not skip the rest.
    expect(result).toBe("committed")
    expect(ran).toEqual(["first", "third"])
  })
})
