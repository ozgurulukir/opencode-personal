// Characterization tests (Rule 3, #380 Phase 1/2): lock the paced-text machinery
// in message-part-paced.tsx. The reactive createPacedValue runs headless under
// Solid's createRoot — no DOM needed.
import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"

const { createPacedValue, next, step } = await import("./message-part-paced")

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe("step", () => {
  test("short remainder advances by 2", () => {
    expect(step(0)).toBe(2)
    expect(step(1)).toBe(2)
    expect(step(12)).toBe(2)
  })

  test("medium remainder advances by 4", () => {
    expect(step(13)).toBe(4)
    expect(step(48)).toBe(4)
  })

  test("large remainder advances by 8", () => {
    expect(step(49)).toBe(8)
    expect(step(96)).toBe(8)
  })

  test("huge remainder scales linearly, capped at 24", () => {
    expect(step(97)).toBe(Math.min(24, Math.ceil(97 / 8)))
    expect(step(1000)).toBe(24)
    expect(step(160)).toBe(20)
  })
})

describe("next", () => {
  test("advances by step when no snap character within the lookahead window", () => {
    // 200 chars of 'a' (no snap chars): end = start + step(200) = 24, max = end + 8
    expect(next("a".repeat(200), 0)).toBe(24)
  })

  test("snaps forward to just past the first snap character in the lookahead", () => {
    const text = "a".repeat(30) + "." + "b".repeat(200)
    // step(234) = 24 -> end at 24 which is 'a'; lookahead window [24,32) contains '.' at 30
    expect(next(text, 0)).toBe(31)
  })

  test("snap character beyond lookahead is ignored", () => {
    const text = "a".repeat(100) + "." + "b".repeat(100)
    // end = 24, window [24,32) all 'a' -> returns end
    expect(next(text, 0)).toBe(24)
  })

  test("clamps to text length and snaps on trailing punctuation", () => {
    expect(next("hi.", 0)).toBe(3)
    expect(next("hello", 0)).toBe(2)
    expect(next("abc", 99)).toBe(3)
  })
})

describe("createPacedValue", () => {
  test("non-live source syncs via effect, so updates land after the microtask flush", async () => {
    const [text, setText] = createSignal("hello")
    let value: () => string = () => ""
    let dispose: (() => void) | undefined
    createRoot((d) => {
      dispose = d
      value = createPacedValue(text)
      expect(value()).toBe("hello")
      setText("hello world")
      // sync runs in createEffect (flushed on the microtask queue), not synchronously
      expect(value()).toBe("hello")
    })
    await flush()
    expect(value()).toBe("hello world")
    dispose!()
  })

  test("live source reveals extension progressively, then completes", async () => {
    const [text, setText] = createSignal("")
    const [live, setLive] = createSignal(true)
    let shown: string[] = []
    createRoot((dispose) => {
      const value = createPacedValue(text, live)
      // track reveals via a tiny subscription through the accessor
      const check = () => shown.push(value())
      const id = setInterval(check, 5)
      setTimeout(() => {
        setText("hello world")
        setTimeout(() => {
          setLive(false)
          setTimeout(() => {
            clearInterval(id)
            dispose()
          }, 60)
        }, 60)
      }, 10)
    })
    await flush()
    await new Promise((resolve) => setTimeout(resolve, 200))
    // either empty (never started) or a prefix chain finishing at the full text
    expect(shown.length).toBeGreaterThan(0)
    expect(shown[shown.length - 1]).toBe("hello world")
    for (const s of shown) {
      expect("hello world".startsWith(s)).toBe(true)
    }
  })

  test("live source with rewritten (non-prefix) text snaps immediately", async () => {
    const [text, setText] = createSignal("first draft")
    const [live] = createSignal(true)
    createRoot((dispose) => {
      const value = createPacedValue(text, live)
      // effect hasn't run yet in this microtask context; value is the initial signal value
      expect(value()).toBe("first draft")
      dispose()
    })
    await flush()
    createRoot((dispose) => {
      const value = createPacedValue(text, live)
      expect(value()).toBe("first draft")
      setText("completely different")
      // allow the effect to run
      setTimeout(() => {
        expect(value()).toBe("completely different")
        dispose()
      }, 60)
    })
    await flush()
    await new Promise((resolve) => setTimeout(resolve, 120))
  })

  test("non-live extension while a live reveal is pending snaps to full text", async () => {
    const [text, setText] = createSignal("a")
    const [live, setLive] = createSignal(true)
    createRoot((dispose) => {
      const value = createPacedValue(text, live)
      setTimeout(() => {
        setText("a longer streamed tail")
        setTimeout(() => {
          setLive(false)
          setTimeout(() => {
            expect(value()).toBe("a longer streamed tail")
            dispose()
          }, 60)
        }, 60)
      }, 10)
    })
    await flush()
    await new Promise((resolve) => setTimeout(resolve, 250))
  })
})
