import { afterEach, describe, expect, test } from "bun:test"
import { handleNotificationClick, setNavigate } from "./notification-click"

describe("notification click", () => {
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

  test("falls back to location.assign without registered navigate", () => {
    handleNotificationClick("/abc/session/123")
    // falls back to window.location.assign — no error thrown
  })

  test("refuses absolute and scheme-relative hrefs without registered navigate", () => {
    const before = window.location.href
    handleNotificationClick("https://evil.example/session/1")
    handleNotificationClick("//evil.example/session/1")
    expect(window.location.href).toBe(before)
  })
})
