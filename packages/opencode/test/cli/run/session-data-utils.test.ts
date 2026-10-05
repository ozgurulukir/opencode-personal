import { describe, expect, test } from "bun:test"
import { formatUsage, key, modelKey, remove, upsert } from "@/cli/cmd/run/session-data/utils"

describe("session data utils", () => {
  describe("key", () => {
    test("formats messageID and callID into a key string", () => {
      expect(key("msg1", "call1")).toBe("msg1:call1")
      expect(key("", "")).toBe(":")
    })
  })

  describe("modelKey", () => {
    test("formats provider and model into provider/model string", () => {
      expect(modelKey("openai", "gpt-4o")).toBe("openai/gpt-4o")
    })
  })

  describe("remove", () => {
    test("removes item by id when found and returns true", () => {
      const list = [{ id: "a" }, { id: "b" }, { id: "c" }]
      const result = remove(list, "b")
      expect(result).toBe(true)
      expect(list).toEqual([{ id: "a" }, { id: "c" }])
    })

    test("returns false when item is not found", () => {
      const list = [{ id: "a" }, { id: "b" }]
      const result = remove(list, "c")
      expect(result).toBe(false)
      expect(list).toEqual([{ id: "a" }, { id: "b" }])
    })
  })

  describe("upsert", () => {
    test("appends item when id is not in list", () => {
      const list = [{ id: "a", val: 1 }]
      upsert(list, { id: "b", val: 2 })
      expect(list).toEqual([
        { id: "a", val: 1 },
        { id: "b", val: 2 },
      ])
    })

    test("replaces existing item when id matches", () => {
      const list = [{ id: "a", val: 1 }]
      upsert(list, { id: "a", val: 99 })
      expect(list).toEqual([{ id: "a", val: 99 }])
    })
  })

  describe("formatUsage", () => {
    test("returns undefined when token total is 0 or negative and cost is not provided", () => {
      expect(formatUsage(undefined, undefined, undefined)).toBeUndefined()
      expect(
        formatUsage(
          { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          undefined,
          undefined,
        ),
      ).toBeUndefined()
    })

    test("returns formatted cost when total tokens <= 0 and cost > 0", () => {
      expect(formatUsage(undefined, undefined, 1.5)).toBe("$1.50")
    })

    test("formats total token count without percentage when limit is absent", () => {
      const tokens = { input: 1000, output: 500, reasoning: 0, cache: { read: 0, write: 0 } }
      expect(formatUsage(tokens, undefined, undefined)).toBe("1.5K")
    })

    test("formats token count and usage percentage when limit is provided", () => {
      const tokens = { input: 1000, output: 500, reasoning: 0, cache: { read: 0, write: 0 } }
      expect(formatUsage(tokens, 3000, undefined)).toBe("1.5K (50%)")
    })

    test("appends cost when tokens and cost are both present", () => {
      const tokens = { input: 1000, output: 500, reasoning: 0, cache: { read: 0, write: 0 } }
      expect(formatUsage(tokens, 3000, 0.25)).toBe("1.5K (50%) · $0.25")
    })
  })
})
