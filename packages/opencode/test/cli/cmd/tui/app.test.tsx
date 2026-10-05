import { describe, expect, test, mock } from "bun:test"
import { errorMessage, rendererConfig, tui } from "@/cli/cmd/tui/app"
import { AccountTransportError } from "@/account/schema"
import { Flag } from "@opencode-ai/core/flag/flag"
import type { TuiConfig } from "@/cli/cmd/tui/config/tui"
import { FormatUnknownError } from "@/cli/error"

describe("tui app", () => {
  describe("rendererConfig", () => {
    test("returns expected default configuration", () => {
      const config = { mouse: true } as TuiConfig.Resolved
      const result = rendererConfig(config)

      expect(result.externalOutputMode).toBe("passthrough")
      expect(result.targetFps).toBe(60)
      expect(result.gatherStats).toBe(false)
      expect(result.exitOnCtrlC).toBe(false)
      expect(result.autoFocus).toBe(false)
      expect(result.openConsoleOnError).toBe(false)
      expect(result.useMouse).toBe(true)
      expect(result.consoleOptions?.keyBindings).toEqual([{ name: "y", ctrl: true, action: "copy-selection" }])
    })

    test("disables mouse when config mouse is false", () => {
      const config = { mouse: false } as TuiConfig.Resolved
      const result = rendererConfig(config)
      expect(result.useMouse).toBe(false)
    })

    test("disables mouse when OPENCODE_DISABLE_MOUSE flag is set", () => {
      const previous = Flag.OPENCODE_DISABLE_MOUSE
      try {
        Flag.OPENCODE_DISABLE_MOUSE = true
        const config = { mouse: true } as TuiConfig.Resolved
        const result = rendererConfig(config)
        expect(result.useMouse).toBe(false)
      } finally {
        Flag.OPENCODE_DISABLE_MOUSE = previous
      }
    })
  })

  describe("errorMessage", () => {
    test("formats account transport error using FormatError", () => {
      const error = new AccountTransportError({
        method: "POST",
        url: "https://console.opencode.ai/auth/device/code",
      })
      const message = errorMessage(error)
      expect(message).toContain("Could not reach POST https://console.opencode.ai/auth/device/code.")
    })

    test("extracts data.message when error contains structured data", () => {
      const error = {
        data: {
          message: "Structured error message",
        },
      }
      expect(errorMessage(error)).toBe("Structured error message")
    })

    test("falls back to FormatUnknownError for arbitrary errors", () => {
      const errObj = new Error("Standard exception")
      expect(errorMessage(errObj)).toBe(FormatUnknownError(errObj))

      const errString = "Plain string error"
      expect(errorMessage(errString)).toBe(FormatUnknownError(errString))
    })
  })

  describe("tui", () => {
    test("is exported as a function", () => {
      expect(typeof tui).toBe("function")
    })
  })
})
