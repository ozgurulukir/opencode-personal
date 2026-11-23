import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { handleNotificationClick, setNavigate } from "./notification-click"

const setURL = (url: string) =>
  (window as unknown as { happyDOM: { setURL(value: string): void } }).happyDOM.setURL(url)

describe("notification click", () => {
  beforeEach(() => {
    setURL("http://localhost:3000/")
  })

  afterEach(() => {
    setNavigate(undefined as unknown as (href: string) => void)
  })

  test("navigates via registered navigate function", () => {
    const calls: string[] = []
    setNavigate((href) => calls.push(href))
    handleNotificationClick("/abc/session/123")
    expect(calls).toEqual(["/abc/session/123"])
  })

  test("does not navigate when href is missing", () => {
    const calls: string[] = []
    setNavigate((href) => calls.push(href))
    handleNotificationClick(undefined)
    expect(calls).toEqual([])
  })

  test("falls back to location.assign for same-origin paths without registered navigate", () => {
    handleNotificationClick("/abc/session/123")
    expect(window.location.pathname).toBe("/abc/session/123")
  })

  test("refuses absolute, scheme-relative, and escaped hrefs without registered navigate", () => {
    for (const href of [
      "https://evil.example/session/1",
      "//evil.example/session/1",
      "/\\evil.example/session/1",
      "/\t/evil.example/session/1",
    ]) {
      handleNotificationClick(href)
      expect(window.location.pathname).toBe("/")
    }
  })
})
