import { describe, expect, spyOn, test } from "bun:test"
import * as prompts from "@clack/prompts"
import { Effect, Option } from "effect"
import { autocomplete, intro, log, outro, password, select, spinner, text } from "../../../src/cli/effect/prompt"

describe("cli/effect/prompt", () => {
  describe("log", () => {
    test("log.info invokes prompts.log.info", () => {
      const spy = spyOn(prompts.log, "info").mockImplementation(() => {})
      try {
        Effect.runSync(log.info("test info message"))
        expect(spy).toHaveBeenCalledWith("test info message")
      } finally {
        spy.mockRestore()
      }
    })

    test("log.error invokes prompts.log.error", () => {
      const spy = spyOn(prompts.log, "error").mockImplementation(() => {})
      try {
        Effect.runSync(log.error("test error message"))
        expect(spy).toHaveBeenCalledWith("test error message")
      } finally {
        spy.mockRestore()
      }
    })

    test("log.warn invokes prompts.log.warn", () => {
      const spy = spyOn(prompts.log, "warn").mockImplementation(() => {})
      try {
        Effect.runSync(log.warn("test warn message"))
        expect(spy).toHaveBeenCalledWith("test warn message")
      } finally {
        spy.mockRestore()
      }
    })

    test("log.success invokes prompts.log.success", () => {
      const spy = spyOn(prompts.log, "success").mockImplementation(() => {})
      try {
        Effect.runSync(log.success("test success message"))
        expect(spy).toHaveBeenCalledWith("test success message")
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe("intro & outro", () => {
    test("intro invokes prompts.intro", () => {
      const spy = spyOn(prompts, "intro").mockImplementation(() => {})
      try {
        Effect.runSync(intro("Welcome"))
        expect(spy).toHaveBeenCalledWith("Welcome")
      } finally {
        spy.mockRestore()
      }
    })

    test("outro invokes prompts.outro", () => {
      const spy = spyOn(prompts, "outro").mockImplementation(() => {})
      try {
        Effect.runSync(outro("Goodbye"))
        expect(spy).toHaveBeenCalledWith("Goodbye")
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe("spinner", () => {
    test("spinner start and stop without error code", () => {
      const mockSpinner = {
        start: (_msg?: string) => {},
        stop: (_msg?: string) => {},
        error: (_msg?: string) => {},
        message: (_msg?: string) => {},
        cancel: (_msg?: string) => {},
        clear: () => {},
        isCancelled: false,
      }
      const spinnerSpy = spyOn(prompts, "spinner").mockReturnValue(mockSpinner)

      try {
        const mockStart = spyOn(mockSpinner, "start")
        const mockStop = spyOn(mockSpinner, "stop")
        const mockError = spyOn(mockSpinner, "error")

        const s = spinner()
        Effect.runSync(s.start("loading..."))
        expect(mockStart).toHaveBeenCalledWith("loading...")

        Effect.runSync(s.stop("done"))
        expect(mockStop).toHaveBeenCalledWith("done")
        expect(mockError).not.toHaveBeenCalled()
      } finally {
        spinnerSpy.mockRestore()
      }
    })

    test("spinner stop with non-zero error code invokes spinner.error", () => {
      const mockSpinner = {
        start: (_msg?: string) => {},
        stop: (_msg?: string) => {},
        error: (_msg?: string) => {},
        message: (_msg?: string) => {},
        cancel: (_msg?: string) => {},
        clear: () => {},
        isCancelled: false,
      }
      const spinnerSpy = spyOn(prompts, "spinner").mockReturnValue(mockSpinner)

      try {
        const mockStop = spyOn(mockSpinner, "stop")
        const mockError = spyOn(mockSpinner, "error")

        const s = spinner()
        Effect.runSync(s.stop("failed", 1))
        expect(mockError).toHaveBeenCalledWith("failed")
        expect(mockStop).not.toHaveBeenCalled()
      } finally {
        spinnerSpy.mockRestore()
      }
    })
  })

  describe("prompts returning Option", () => {
    test("select returns Option.some when selected and Option.none on cancel", async () => {
      const selectSpy = spyOn(prompts, "select").mockResolvedValue("opt1")
      try {
        const res1 = await Effect.runPromise(select({ message: "Pick one", options: [] }))
        expect(Option.isSome(res1)).toBe(true)
        if (Option.isSome(res1)) {
          expect(res1.value).toBe("opt1")
        }

        const isCancelSpy = spyOn(prompts, "isCancel").mockReturnValue(true)
        selectSpy.mockResolvedValue(prompts.CANCEL_SYMBOL)

        const res2 = await Effect.runPromise(select({ message: "Pick one", options: [] }))
        expect(Option.isNone(res2)).toBe(true)

        isCancelSpy.mockRestore()
      } finally {
        selectSpy.mockRestore()
      }
    })

    test("autocomplete returns Option.some when value provided and Option.none on cancel", async () => {
      const autoSpy = spyOn(prompts, "autocomplete").mockResolvedValue("selected-item")
      try {
        const res1 = await Effect.runPromise(autocomplete({ message: "Search", options: () => [] }))
        expect(Option.isSome(res1)).toBe(true)
        if (Option.isSome(res1)) {
          expect(res1.value).toBe("selected-item")
        }

        const isCancelSpy = spyOn(prompts, "isCancel").mockReturnValue(true)
        autoSpy.mockResolvedValue(prompts.CANCEL_SYMBOL)

        const res2 = await Effect.runPromise(autocomplete({ message: "Search", options: () => [] }))
        expect(Option.isNone(res2)).toBe(true)

        isCancelSpy.mockRestore()
      } finally {
        autoSpy.mockRestore()
      }
    })

    test("text returns Option.some when value entered and Option.none on cancel", async () => {
      const textSpy = spyOn(prompts, "text").mockResolvedValue("hello")
      try {
        const res1 = await Effect.runPromise(text({ message: "Enter text" }))
        expect(Option.isSome(res1)).toBe(true)
        if (Option.isSome(res1)) {
          expect(res1.value).toBe("hello")
        }

        const isCancelSpy = spyOn(prompts, "isCancel").mockReturnValue(true)
        textSpy.mockResolvedValue(prompts.CANCEL_SYMBOL)

        const res2 = await Effect.runPromise(text({ message: "Enter text" }))
        expect(Option.isNone(res2)).toBe(true)

        isCancelSpy.mockRestore()
      } finally {
        textSpy.mockRestore()
      }
    })

    test("password returns Option.some when value entered and Option.none on cancel", async () => {
      const passSpy = spyOn(prompts, "password").mockResolvedValue("secret")
      try {
        const res1 = await Effect.runPromise(password({ message: "Enter password" }))
        expect(Option.isSome(res1)).toBe(true)
        if (Option.isSome(res1)) {
          expect(res1.value).toBe("secret")
        }

        const isCancelSpy = spyOn(prompts, "isCancel").mockReturnValue(true)
        passSpy.mockResolvedValue(prompts.CANCEL_SYMBOL)

        const res2 = await Effect.runPromise(password({ message: "Enter password" }))
        expect(Option.isNone(res2)).toBe(true)

        isCancelSpy.mockRestore()
      } finally {
        passSpy.mockRestore()
      }
    })
  })
})
