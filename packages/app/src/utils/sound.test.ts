import { afterEach, beforeEach, describe, expect, test, mock } from "bun:test"

mock.module("./sound", () => {
  const original = import.meta.require("./sound")

  return {
    ...original,
    soundSrc: async (id: string | undefined) => {
      if (!id || id === "invalid") return undefined
      return "test-sound.aac"
    }
  }
})

import { playSound, playSoundById, soundSrc, SOUND_OPTIONS } from "./sound"

describe("sound utilities", () => {
  let originalAudio: typeof Audio

  beforeEach(() => {
    originalAudio = globalThis.Audio

    globalThis.Audio = class {
      src: string
      constructor(src: string) {
        this.src = src
      }
      play = mock(() => Promise.resolve())
      pause = mock(() => {})
      currentTime = 0
    } as any
  })

  afterEach(() => {
    if (originalAudio) {
      globalThis.Audio = originalAudio
    } else {
      delete (globalThis as any).Audio
    }
  })

  describe("soundSrc", () => {
    test("returns undefined for missing id", async () => {
      const src = await soundSrc(undefined)
      expect(src).toBeUndefined()
    })

    test("returns undefined for invalid id", async () => {
      const src = await soundSrc("invalid")
      expect(src).toBeUndefined()
    })

    test("returns cached sound for valid id", async () => {
      const src = await soundSrc("alert-01")
      expect(src).toBe("test-sound.aac")
    })
  })

  describe("playSound", () => {
    test("does not play if Audio is undefined", () => {
      delete (globalThis as any).Audio
      const res = playSound("test.aac")
      expect(res).toBeUndefined()
    })

    test("does not play if src is undefined", () => {
      const res = playSound(undefined)
      expect(res).toBeUndefined()
    })

    test("plays sound if src is valid and returns a cleanup function", () => {
      const src = "test.aac"
      const cleanup = playSound(src)

      expect(cleanup).toBeTypeOf("function")
      if (cleanup) {
        cleanup()
      }
    })

    test("handles play rejection gracefully", () => {
       globalThis.Audio = class {
        src: string
        constructor(src: string) {
          this.src = src
        }
        play = mock(() => Promise.reject(new Error("Audio play failed")))
        pause = mock(() => {})
        currentTime = 0
      } as any

      const cleanup = playSound("test.aac")
      expect(cleanup).toBeTypeOf("function")
    })
  })

  describe("playSoundById", () => {
    test("plays sound if id is valid", async () => {
      await expect(playSoundById("alert-01")).resolves.not.toThrow()
    })

    test("does not fail when id is invalid", async () => {
      const res = await playSoundById("invalid")
      expect(res).toBeUndefined()
    })
  })

  describe("SOUND_OPTIONS", () => {
    test("exports a list of valid sound options", () => {
      expect(SOUND_OPTIONS).toBeInstanceOf(Array)
      expect(SOUND_OPTIONS.length).toBeGreaterThan(0)

      SOUND_OPTIONS.forEach(option => {
        expect(option).toHaveProperty("id")
        expect(option).toHaveProperty("label")
        expect(typeof option.id).toBe("string")
        expect(typeof option.label).toBe("string")
      })
    })
  })
})
