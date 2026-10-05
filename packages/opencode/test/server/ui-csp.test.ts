import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { DEFAULT_CSP, csp, cspForHtml, themePreloadHash } from "../../src/server/shared/ui"

describe("UI CSP utilities", () => {
  describe("csp", () => {
    test("returns default CSP when no hash is provided", () => {
      const result = csp()
      expect(result).toBe(
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src * data:",
      )
      expect(DEFAULT_CSP).toBe(result)
    })

    test("includes sha256 script hash when provided", () => {
      const hash = "dGhpcyBpcyBhIHRlc3Q="
      const result = csp(hash)
      expect(result).toBe(
        `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-${hash}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src * data:`,
      )
    })
  })

  describe("themePreloadHash", () => {
    test("extracts script content for oc-theme-preload-script", () => {
      const scriptContent = 'document.documentElement.dataset.theme = "dark"'
      const html = `<html><head><script id="oc-theme-preload-script">${scriptContent}</script></head></html>`
      const match = themePreloadHash(html)
      expect(match).not.toBeNull()
      expect(match![2]).toBe(scriptContent)
    })

    test("supports single quotes around id", () => {
      const scriptContent = 'console.log("theme")'
      const html = `<script id='oc-theme-preload-script'>${scriptContent}</script>`
      const match = themePreloadHash(html)
      expect(match).not.toBeNull()
      expect(match![2]).toBe(scriptContent)
    })

    test("returns null if script has src attribute", () => {
      const html = `<script src="/theme.js" id="oc-theme-preload-script">console.log("test")</script>`
      const match = themePreloadHash(html)
      expect(match).toBeNull()
    })

    test("returns null if id does not match", () => {
      const html = `<script id="other-script">console.log("test")</script>`
      const match = themePreloadHash(html)
      expect(match).toBeNull()
    })
  })

  describe("cspForHtml", () => {
    test("returns default CSP when no theme preload script is present", () => {
      const html = "<html><head></head><body><h1>Hello</h1></body></html>"
      const result = cspForHtml(html)
      expect(result).toBe(DEFAULT_CSP)
    })

    test("computes and injects sha256 hash of theme preload script", () => {
      const scriptContent = 'document.documentElement.dataset.theme = "dark"'
      const html = `<html><head><script id="oc-theme-preload-script">${scriptContent}</script></head></html>`

      const expectedHash = createHash("sha256").update(scriptContent).digest("base64")
      const result = cspForHtml(html)

      expect(result).toBe(csp(expectedHash))
      expect(result).toContain(`'sha256-${expectedHash}'`)
    })

    test("uses cached CSP for identical HTML bodies", () => {
      const html = `<html><body data-cache-test="1">test</body></html>`
      const result1 = cspForHtml(html)
      const result2 = cspForHtml(html)

      expect(result1).toBe(result2)
    })

    test("evicts oldest cache entries when exceeding cache capacity (256 items)", () => {
      // Fill cache beyond limit
      for (let i = 0; i < 260; i++) {
        cspForHtml(`<html><body>cache-test-${i}</body></html>`)
      }

      // The early items should have been evicted without error
      const htmlNew = "<html><body>cache-test-new</body></html>"
      expect(cspForHtml(htmlNew)).toBe(DEFAULT_CSP)
    })
  })
})
