// Characterization tests (Rule 3, #380 Phase 2): lock getDiagnostics — the pure
// diagnostics filter inside message-part.tsx — before the god-file split. They
// import from message-part.tsx now and follow the helper into
// message-part-diagnostics.tsx.
import { afterAll, describe, expect, mock, test } from "bun:test"

// message-part.tsx imports @solidjs/router, which reads window.history at module
// load (node_modules/@solidjs/router/dist/index.js:43) — bun test has no DOM.
mock.module("@solidjs/router", () => ({
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => () => {},
}))
// The module graph reaches useData(), which throws outside a provider.
mock.module("../context", () => ({
  useData: () => ({ directory: "/proj", store: {} }),
}))
afterAll(() => mock.restore())

// Static import would run before mock.module (imports are hoisted) — dynamic
// import after the mock is required.
const { getDiagnostics } = await import("./message-part")
import type { Diagnostic } from "./message-part"

const diagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
  message: "boom",
  severity: 1,
  ...overrides,
})

describe("getDiagnostics", () => {
  test("returns an empty array when there are no diagnostics", () => {
    expect(getDiagnostics(undefined, "/proj/a.ts")).toEqual([])
  })

  test("returns an empty array when there is no file path", () => {
    expect(getDiagnostics({ "/proj/a.ts": [diagnostic()] }, undefined)).toEqual([])
  })

  test("returns an empty array when the file has no entry", () => {
    expect(getDiagnostics({ "/proj/other.ts": [diagnostic()] }, "/proj/a.ts")).toEqual([])
  })

  test("keeps only errors (severity 1)", () => {
    const diagnostics: Diagnostic[] = [
      diagnostic({ message: "warn", severity: 2 }),
      diagnostic({ message: "info", severity: 3 }),
      diagnostic({ message: "hint", severity: 4 }),
      diagnostic({ message: "error", severity: 1 }),
    ]
    expect(getDiagnostics({ "/proj/a.ts": diagnostics }, "/proj/a.ts")).toEqual([
      diagnostic({ message: "error", severity: 1 }),
    ])
  })

  test("keeps entries without a severity (undefined matches the === 1 filter contract only for 1)", () => {
    const diagnostics: Diagnostic[] = [diagnostic({ message: "no severity", severity: undefined })]
    expect(getDiagnostics({ "/proj/a.ts": diagnostics }, "/proj/a.ts")).toEqual([])
  })

  test("caps the result at three diagnostics", () => {
    const diagnostics: Diagnostic[] = [1, 2, 3, 4, 5].map((n) => diagnostic({ message: "e" + n }))
    expect(getDiagnostics({ "/proj/a.ts": diagnostics }, "/proj/a.ts")).toEqual([
      diagnostic({ message: "e1" }),
      diagnostic({ message: "e2" }),
      diagnostic({ message: "e3" }),
    ])
  })

  test("preserves the file's diagnostic order", () => {
    const diagnostics: Diagnostic[] = [diagnostic({ message: "first" }), diagnostic({ message: "second" })]
    expect(getDiagnostics({ "/proj/a.ts": diagnostics }, "/proj/a.ts")).toEqual(diagnostics)
  })
})
