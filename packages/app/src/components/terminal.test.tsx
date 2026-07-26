import { beforeAll, describe, expect, mock, test } from "bun:test"

let useTerminalUiBindings: typeof import("./terminal").useTerminalUiBindings
let persistTerminal: typeof import("./terminal").persistTerminal
let getTerminalColors: typeof import("./terminal").getTerminalColors
let debugTerminal: typeof import("./terminal").debugTerminal

beforeAll(async () => {
  mock.module("ghostty-web", () => ({
    Ghostty: { load: () => Promise.resolve({}) },
    Terminal: class {
      options = { cursorBlink: false }
      rows = 24
      cols = 80
      textarea = document.createElement("textarea")
      getSelection() { return null }
      paste() {}
      focus() {}
      attachCustomKeyEventHandler() { return () => true }
      loadAddon() {}
      open() {}
      onResize() { return () => {} }
      onData() { return () => {} }
      onKey() { return () => {} }
      dispose() {}
      getViewportY() { return 0 }
      scrollToLine() {}
      write() {}
    },
    FitAddon: class {
      fit() {}
      observeResize() {}
    },
  }))
  mock.module("@/addons/serialize", () => ({
    SerializeAddon: class {
      serialize() { return "buffer" }
    },
  }))
  mock.module("@/utils/terminal-writer", () => ({
    terminalWriter: (fn: (data: string, done: () => void) => void) => ({
      push: (data: string) => fn(data, () => {}),
      flush: (cb: () => void) => cb(),
    }),
  }))
  mock.module("@/utils/terminal-websocket-url", () => ({
    terminalWebSocketURL: (opts: unknown) => "ws://test",
  }))
  mock.module("@/context/command", () => ({
    matchKeybind: () => true,
    parseKeybind: () => ({}),
  }))
  mock.module("@/context/language", () => ({
    useLanguage: () => ({
      t: (key: string, opts?: unknown) => (opts ? `${key}:${JSON.stringify(opts)}` : key),
    }),
  }))
  mock.module("@/context/platform", () => ({
    usePlatform: () => ({ openLink: () => {}, webviewZoom: () => undefined }),
  }))
  mock.module("@/context/sdk", () => ({
    useSDK: () => ({
      directory: "/repo",
      url: "http://localhost",
      client: {
        pty: {
          update: () => Promise.resolve({}),
          get: () => Promise.resolve({ response: { status: 404 } }),
          connectToken: () => Promise.resolve({ response: { status: 200 }, data: { ticket: "t" } }),
        },
      },
    }),
  }))
  mock.module("@/context/server", () => ({
    useServer: () => ({ current: { http: { username: "user", password: "pwd" }, type: "http", authToken: false } }),
  }))
  mock.module("@/context/settings", () => ({
    useSettings: () => ({
      appearance: { terminalFont: () => "mono" },
      keybinds: new Map(),
    }),
    terminalFontFamily: (font: string) => font,
  }))
  mock.module("@opencode-ai/ui/theme/context", () => ({
    useTheme: () => ({
      mode: () => "dark",
      themes: () => ({}),
      themeId: () => "default",
    }),
  }))
  mock.module("@opencode-ai/ui/theme/resolve", () => ({
    resolveThemeVariant: () => ({}),
  }))
  mock.module("@opencode-ai/ui/theme/color", () => ({
    withAlpha: (color: string, _alpha: number) => color,
  }))
  mock.module("@opencode-ai/ui/toast", () => ({ showToast: () => {} }))
  mock.module("@/utils/runtime-adapters", () => ({
    disposeIfDisposable: (x: unknown) => {},
    getHoveredLinkText: () => "http://test",
    setOptionIfSupported: () => {},
  }))

  const mod = await import("./terminal")
  useTerminalUiBindings = mod.useTerminalUiBindings
  persistTerminal = mod.persistTerminal
  getTerminalColors = mod.getTerminalColors
  debugTerminal = mod.debugTerminal
})

describe("terminal pure helpers", () => {
  describe("debugTerminal", () => {
    test("does not throw in test mode", () => {
      expect(() => debugTerminal("x", 1)).not.toThrow()
    })
  })

  describe("getTerminalColors", () => {
    test("returns dark defaults when no theme is set", () => {
      const colors = getTerminalColors({
        mode: () => "dark",
        themes: () => ({}),
        themeId: () => "default",
      } as never)
      expect(colors.background).toBe("#191515")
      expect(colors.foreground).toBe("#d4d4d4")
      expect(colors.cursor).toBe("#d4d4d4")
    })

    test("returns light defaults when no theme is set", () => {
      const colors = getTerminalColors({
        mode: () => "light",
        themes: () => ({}),
        themeId: () => "default",
      } as never)
      expect(colors.background).toBe("#fcfcfc")
      expect(colors.foreground).toBe("#211e1e")
      expect(colors.cursor).toBe("#211e1e")
    })
  })

  describe("persistTerminal", () => {
    test("calls onCleanup with serialized state", () => {
      const onCleanup = (state: unknown) => {}
      const captured: unknown[] = []
      const addon = { serialize: () => "hello" }
      const term = { rows: 40, cols: 120, getViewportY: () => 5 }

      persistTerminal({
        term: term as never,
        addon: addon as never,
        cursor: 10,
        id: "term-1",
        onCleanup: (state) => captured.push(state),
      })

      expect(captured).toHaveLength(1)
      expect(captured[0]).toEqual({
        id: "term-1",
        buffer: "hello",
        cursor: 10,
        rows: 40,
        cols: 120,
        scrollY: 5,
      })
    })

    test("returns early when addon, term, or onCleanup is missing", () => {
      const onCleanup = (state: unknown) => {}
      const captured: unknown[] = []
      const term = { rows: 40, cols: 120, getViewportY: () => 0 }
      const addon = { serialize: () => "hello" }

      persistTerminal({ term: undefined as never, addon: addon as never, cursor: 0, id: "1", onCleanup: (state) => captured.push(state) })
      persistTerminal({ term: term as never, addon: undefined as never, cursor: 0, id: "2", onCleanup: (state) => captured.push(state) })
      persistTerminal({ term: term as never, addon: addon as never, cursor: 0, id: "3", onCleanup: undefined })

      expect(captured).toHaveLength(0)
    })
  })

  describe("useTerminalUiBindings", () => {
    test("registers copy/paste/pointer/link handlers and exposes cleanups", () => {
      let capturedPaste = ""
      const cleanups: VoidFunction[] = []
      const container = document.createElement("div")
      const term = {
        getSelection: () => "sel",
        paste: (text: string) => { capturedPaste = text },
        options: { cursorBlink: false },
        textarea: document.createElement("textarea"),
      }
      const handlePointerDown = () => {}
      const handleLinkClick = () => {}

      useTerminalUiBindings({
        container,
        term: term as never,
        cleanups,
        handlePointerDown,
        handleLinkClick,
      })

      expect(cleanups.length).toBeGreaterThanOrEqual(5)
      cleanups.forEach((fn) => fn())
      expect(container.querySelectorAll("*").length).toBe(0)
    })
  })
})
