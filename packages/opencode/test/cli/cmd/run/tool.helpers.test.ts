import { describe, expect, test } from "bun:test"
import {
  num,
  text,
  list,
  dict,
  info,
  span,
  fail,
  toolError,
  fallbackStart,
  fallbackFinal,
  fallbackInline,
  count,
  props,
  permission,
  toolFrame,
  textBody,
  markdownBody,
} from "../../../../src/cli/cmd/run/tool.helpers"

describe("num", () => {
  test("returns finite numbers", () => {
    expect(num(0)).toBe(0)
    expect(num(-0)).toBe(-0)
    expect(num(42)).toBe(42)
    expect(num(-100.5)).toBe(-100.5)
    expect(num(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
    expect(num(Number.MIN_VALUE)).toBe(Number.MIN_VALUE)
  })

  test("returns undefined for non-finite numbers", () => {
    expect(num(NaN)).toBeUndefined()
    expect(num(Infinity)).toBeUndefined()
    expect(num(-Infinity)).toBeUndefined()
  })

  test("returns undefined for non-number types", () => {
    expect(num("42")).toBeUndefined()
    expect(num(true)).toBeUndefined()
    expect(num(false)).toBeUndefined()
    expect(num(null)).toBeUndefined()
    expect(num(undefined)).toBeUndefined()
    expect(num({})).toBeUndefined()
    expect(num([1, 2, 3])).toBeUndefined()
    expect(num(Symbol("num"))).toBeUndefined()
    expect(num(BigInt(10))).toBeUndefined()
    expect(num(() => 42)).toBeUndefined()
  })
})

describe("text", () => {
  test("returns string for string input", () => {
    expect(text("hello")).toBe("hello")
    expect(text("")).toBe("")
  })

  test("returns empty string for non-string input", () => {
    expect(text(123)).toBe("")
    expect(text(null)).toBe("")
    expect(text(undefined)).toBe("")
    expect(text({})).toBe("")
  })
})

describe("list", () => {
  test("returns array when input is array", () => {
    const arr = [1, 2, 3]
    expect(list(arr)).toBe(arr)
  })

  test("returns empty array for non-array input", () => {
    expect(list(null)).toEqual([])
    expect(list(undefined)).toEqual([])
    expect(list("not array")).toEqual([])
    expect(list(123)).toEqual([])
    expect(list({})).toEqual([])
  })
})

describe("dict", () => {
  test("returns copy of object", () => {
    const obj = { a: 1, b: "test" }
    const result = dict(obj)
    expect(result).toEqual(obj)
    expect(result).not.toBe(obj)
  })

  test("returns empty object for falsy, primitive, or array input", () => {
    expect(dict(null)).toEqual({})
    expect(dict(undefined)).toEqual({})
    expect(dict("string")).toEqual({})
    expect(dict(123)).toEqual({})
    expect(dict([1, 2])).toEqual({})
  })
})

describe("info", () => {
  test("formats primitive dictionary entries into string", () => {
    const data = { name: "test", count: 5, active: true }
    expect(info(data)).toBe("[name=test, count=5, active=true]")
  })

  test("skips keys provided in skip parameter", () => {
    const data = { name: "test", count: 5, hidden: "secret" }
    expect(info(data, ["hidden"])).toBe("[name=test, count=5]")
  })

  test("ignores non-primitive values", () => {
    const data = { name: "test", obj: { nested: true }, arr: [1, 2], nullVal: null }
    expect(info(data)).toBe("[name=test]")
  })

  test("returns empty string when no key-value pairs match", () => {
    expect(info({})).toBe("")
    expect(info({ obj: {} })).toBe("")
  })
})

describe("span", () => {
  test("returns formatted duration when start and end are valid and end > start", () => {
    const state = { time: { start: 1000, end: 3500 } }
    expect(span(state)).toBe("2.5s")
  })

  test("returns empty string when missing start or end or end <= start", () => {
    expect(span({})).toBe("")
    expect(span({ time: { start: 1000 } })).toBe("")
    expect(span({ time: { end: 2000 } })).toBe("")
    expect(span({ time: { start: 2000, end: 1000 } })).toBe("")
    expect(span({ time: { start: 1000, end: 1000 } })).toBe("")
  })
})

describe("count", () => {
  test("pluralizes label correctly", () => {
    expect(count(1, "file")).toBe("1 file")
    expect(count(0, "file")).toBe("0 files")
    expect(count(2, "file")).toBe("2 files")
    expect(count(10, "item")).toBe("10 items")
  })
})

describe("props and permission", () => {
  test("props returns object with input, metadata, and frame", () => {
    const frame: any = { input: { a: 1 }, meta: { b: 2 } }
    const result = props(frame)
    expect(result.input).toEqual({ a: 1 })
    expect(result.metadata).toEqual({ b: 2 })
    expect(result.frame).toBe(frame)
  })

  test("permission returns object with input, metadata, and patterns", () => {
    const ctx = { input: { a: 1 }, meta: { b: 2 }, patterns: ["*.ts"] }
    const result = permission(ctx)
    expect(result.input).toEqual({ a: 1 })
    expect(result.metadata).toEqual({ b: 2 })
    expect(result.patterns).toEqual(["*.ts"])
  })
})

describe("fail and toolError", () => {
  test("toolError prioritizes ctx.error over state.error and raw", () => {
    const ctx: any = { error: "ctx error", state: { error: "state error" }, raw: "raw error" }
    expect(toolError(ctx)).toBe("ctx error")
  })

  test("toolError uses trimmed state.error if ctx.error is empty", () => {
    const ctx: any = { error: "", state: { error: "  state error  " }, raw: "raw error" }
    expect(toolError(ctx)).toBe("state error")
  })

  test("toolError falls back to trimmed raw", () => {
    const ctx: any = { error: "", state: { error: "   " }, raw: "  raw error  " }
    expect(toolError(ctx)).toBe("raw error")
  })

  test("fail formats failure string with error", () => {
    const ctx: any = { name: "bash", error: "command not found" }
    expect(fail(ctx)).toBe("✖ bash failed: command not found")
  })

  test("fail formats failure string without error", () => {
    const ctx: any = { name: "bash", error: "", state: {}, raw: "" }
    expect(fail(ctx)).toBe("✖ bash failed")
  })
})

describe("fallbackStart, fallbackFinal, fallbackInline", () => {
  test("fallbackStart formats with and without input info", () => {
    const ctx1: any = { name: "testTool", input: {} }
    expect(fallbackStart(ctx1)).toBe("⚙ testTool")

    const ctx2: any = { name: "testTool", input: { arg: "val" } }
    expect(fallbackStart(ctx2)).toBe("⚙ testTool [arg=val]")
  })

  test("fallbackFinal handles error, non-completed, and timing states", () => {
    const ctxError: any = { name: "testTool", status: "error", error: "failed" }
    expect(fallbackFinal(ctxError)).toBe("✖ testTool failed: failed")

    const ctxRunning: any = { name: "testTool", status: "running", raw: "running..." }
    expect(fallbackFinal(ctxRunning)).toBe("running...")

    const ctxNoTime: any = { name: "testTool", status: "completed", state: {} }
    expect(fallbackFinal(ctxNoTime)).toBe("testTool completed")

    const ctxWithTime: any = { name: "testTool", status: "completed", state: { time: { start: 1000, end: 2000 } } }
    expect(fallbackFinal(ctxWithTime)).toBe("testTool completed · 1.0s")
  })

  test("fallbackInline formats icon and title", () => {
    const ctx1: any = { name: "testTool", input: { key: "val" }, state: { title: "Custom Title" } }
    expect(fallbackInline(ctx1)).toEqual({ icon: "⚙", title: "testTool Custom Title" })

    const ctx2: any = { name: "testTool", input: { key: "val" }, state: {} }
    expect(fallbackInline(ctx2)).toEqual({ icon: "⚙", title: 'testTool {"key":"val"}' })

    const ctx3: any = { name: "testTool", input: {}, state: {} }
    expect(fallbackInline(ctx3)).toEqual({ icon: "⚙", title: "testTool Unknown" })
  })
})

describe("toolFrame, textBody, markdownBody", () => {
  test("toolFrame parses commit and raw into ToolFrame", () => {
    const commit: any = {
      tool: "read",
      toolState: "completed",
      toolError: "  ",
      part: {
        state: {
          input: { filePath: "/tmp/foo" },
          metadata: { metaKey: "metaVal" },
          status: "completed",
        },
      },
    }
    const frame = toolFrame(commit, "raw content")
    expect(frame).toEqual({
      raw: "raw content",
      name: "read",
      input: { filePath: "/tmp/foo" },
      meta: { metaKey: "metaVal" },
      state: commit.part.state,
      status: "completed",
      error: "",
    })
  })

  test("textBody returns undefined for empty string and object otherwise", () => {
    expect(textBody("")).toBeUndefined()
    expect(textBody("hello")).toEqual({ type: "text", content: "hello" })
  })

  test("markdownBody returns undefined for empty string and object otherwise", () => {
    expect(markdownBody("")).toBeUndefined()
    expect(markdownBody("# Title")).toEqual({ type: "markdown", content: "# Title" })
  })
})
