import { describe, test, expect, beforeEach, afterEach, setSystemTime } from "bun:test"
import { getRelativeTime } from "./time"

type TranslateParams = Record<string, string | number>

describe("getRelativeTime", () => {
  const mockT = (key: string, params?: TranslateParams) => {
    if (params) {
      return `${key}:${JSON.stringify(params)}`
    }
    return key
  }

  beforeEach(() => {
    // Mock current time to 2024-01-01T12:00:00.000Z
    setSystemTime(new Date("2024-01-01T12:00:00.000Z"))
  })

  afterEach(() => {
    setSystemTime() // Reset system time
  })

  test("returns justNow for time less than 60 seconds ago", () => {
    const d1 = new Date("2024-01-01T11:59:01.000Z") // 59 seconds ago
    expect(getRelativeTime(d1.toISOString(), mockT as any)).toBe("common.time.justNow")

    const d2 = new Date("2024-01-01T12:00:00.000Z") // 0 seconds ago
    expect(getRelativeTime(d2.toISOString(), mockT as any)).toBe("common.time.justNow")
  })

  test("returns minutesAgo for time between 60 seconds and 59 minutes ago", () => {
    const d1 = new Date("2024-01-01T11:59:00.000Z") // exactly 60 seconds (1 minute) ago
    expect(getRelativeTime(d1.toISOString(), mockT as any)).toBe('common.time.minutesAgo.short:{"count":1}')

    const d2 = new Date("2024-01-01T11:01:00.000Z") // exactly 59 minutes ago
    expect(getRelativeTime(d2.toISOString(), mockT as any)).toBe('common.time.minutesAgo.short:{"count":59}')
  })

  test("returns hoursAgo for time between 60 minutes and 23 hours ago", () => {
    const d1 = new Date("2024-01-01T11:00:00.000Z") // exactly 60 minutes (1 hour) ago
    expect(getRelativeTime(d1.toISOString(), mockT as any)).toBe('common.time.hoursAgo.short:{"count":1}')

    const d2 = new Date("2023-12-31T13:00:00.000Z") // exactly 23 hours ago
    expect(getRelativeTime(d2.toISOString(), mockT as any)).toBe('common.time.hoursAgo.short:{"count":23}')
  })

  test("returns daysAgo for time 24 hours or more ago", () => {
    const d1 = new Date("2023-12-31T12:00:00.000Z") // exactly 24 hours (1 day) ago
    expect(getRelativeTime(d1.toISOString(), mockT as any)).toBe('common.time.daysAgo.short:{"count":1}')

    const d2 = new Date("2023-12-22T12:00:00.000Z") // exactly 10 days ago
    expect(getRelativeTime(d2.toISOString(), mockT as any)).toBe('common.time.daysAgo.short:{"count":10}')
  })

  test("handles future dates by treating them as justNow (negative diff)", () => {
    const d1 = new Date("2024-01-01T12:01:00.000Z") // 1 minute in the future
    expect(getRelativeTime(d1.toISOString(), mockT as any)).toBe("common.time.justNow")
  })
})
