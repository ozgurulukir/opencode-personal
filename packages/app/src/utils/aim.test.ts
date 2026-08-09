import { describe, expect, test, mock } from "bun:test"
import { createAim } from "./aim"

function createMockEvent(x: number, y: number): MouseEvent {
  return {
    clientX: x,
    clientY: y,
  } as MouseEvent
}

describe("createAim", () => {
  test("activates immediately when no item is active", () => {
    const onActivate = mock()
    const aim = createAim({
      enabled: () => true,
      active: () => undefined,
      el: () => ({ getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }) }) as any,
      onActivate,
    })

    aim.enter("item-1", createMockEvent(50, 50))

    expect(onActivate).toHaveBeenCalledWith("item-1")
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  test("does nothing when disabled", () => {
    const onActivate = mock()
    const aim = createAim({
      enabled: () => false,
      active: () => undefined,
      el: () => undefined,
      onActivate,
    })

    aim.enter("item-1", createMockEvent(50, 50))
    expect(onActivate).not.toHaveBeenCalled()
  })

  test("activates immediately if no el is provided (even if active)", () => {
    const onActivate = mock()
    const aim = createAim({
      enabled: () => true,
      active: () => "item-0",
      el: () => undefined,
      onActivate,
    })

    aim.enter("item-1", createMockEvent(50, 50))
    expect(onActivate).toHaveBeenCalledWith("item-1")
  })

  test("delays activation when moving towards the right edge (aiming at submenu)", async () => {
    const onActivate = mock()
    const el = {
      getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }),
    } as HTMLElement

    const aim = createAim({
      enabled: () => true,
      active: () => "item-0",
      el: () => el,
      onActivate,
      delay: 10,
    })

    // Move horizontally to the right
    aim.move(createMockEvent(10, 50))
    aim.enter("item-1", createMockEvent(50, 50))

    // Should be delayed
    expect(onActivate).not.toHaveBeenCalled()

    await new Promise((r) => setTimeout(r, 20))
    expect(onActivate).toHaveBeenCalledWith("item-1")
  })

  test("cancels delayed activation when leave is called", async () => {
    const onActivate = mock()
    const el = {
      getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }),
    } as HTMLElement

    const aim = createAim({
      enabled: () => true,
      active: () => "item-0",
      el: () => el,
      onActivate,
      delay: 10,
    })

    aim.move(createMockEvent(10, 50))
    aim.enter("item-1", createMockEvent(50, 50))

    expect(onActivate).not.toHaveBeenCalled()

    aim.leave("item-1")

    await new Promise((r) => setTimeout(r, 20))
    expect(onActivate).not.toHaveBeenCalled()
  })

  test("activates immediately when moving away from the edge (moving left)", () => {
    const onActivate = mock()
    const el = {
      getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }),
    } as HTMLElement

    const aim = createAim({
      enabled: () => true,
      active: () => "item-0",
      el: () => el,
      onActivate,
      delay: 10,
    })

    // Move horizontally to the left
    aim.move(createMockEvent(50, 50))
    aim.enter("item-1", createMockEvent(10, 50))

    expect(onActivate).toHaveBeenCalledWith("item-1")
  })

  test("activates immediately if within the edge tolerance distance", async () => {
    const onActivate = mock()
    const el = {
      getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }),
    } as HTMLElement

    const aim = createAim({
      enabled: () => true,
      active: () => "item-0",
      el: () => el,
      onActivate,
      delay: 10,
      edge: 20,
    })

    aim.move(createMockEvent(95, 50))
    // x = 90, which is right - 90 = 10, <= edge (20)
    aim.enter("item-1", createMockEvent(90, 50))

    // Within edge distance it delays activation so user can cross into the submenu safely
    expect(onActivate).not.toHaveBeenCalled()

    await new Promise((r) => setTimeout(r, 20))
    expect(onActivate).toHaveBeenCalledWith("item-1")
  })
})
