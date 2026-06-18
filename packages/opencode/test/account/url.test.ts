import { test, expect } from "bun:test"
import { normalizeServerUrl } from "../../src/account/url"

test("passes through a clean URL", () => {
  expect(normalizeServerUrl("https://example.com")).toBe("https://example.com")
})

test("passes through a URL with a non-empty pathname", () => {
  expect(normalizeServerUrl("https://example.com/api")).toBe("https://example.com/api")
})

test("strips a single trailing slash", () => {
  expect(normalizeServerUrl("https://example.com/")).toBe("https://example.com")
})

test("strips multiple trailing slashes", () => {
  expect(normalizeServerUrl("https://example.com///")).toBe("https://example.com")
})

test("strips trailing slash from a path", () => {
  expect(normalizeServerUrl("https://example.com/api/")).toBe("https://example.com/api")
})

test("removes query parameters", () => {
  expect(normalizeServerUrl("https://example.com?foo=bar")).toBe("https://example.com")
})

test("removes the hash fragment", () => {
  expect(normalizeServerUrl("https://example.com#section")).toBe("https://example.com")
})

test("removes both query and hash", () => {
  expect(normalizeServerUrl("https://example.com/api?foo=bar#section")).toBe("https://example.com/api")
})

test("strips trailing slash before a query string", () => {
  expect(normalizeServerUrl("https://example.com/?foo=bar")).toBe("https://example.com")
})
