import { describe, expect, test } from "bun:test"
import { createTestKeymap } from "@opentui/keymap/testing"
import { registerDefaultKeys, registerEnabledFields } from "@opentui/keymap/addons"

/**
 * Characterization test for the session.interrupt escape binding.
 *
 * The keymap resolves command `enabled` in two ways:
 *   - boolean → frozen at registration time, never re-evaluated
 *   - function → evaluated lazily on every key-press
 *
 * With a static boolean, every status change forces the SolidJS memo to
 * re-create the command object and the layer to be disposed + re-registered.
 * During that churn a key-press can land in the gap and be silently swallowed.
 *
 * With a function the keymap calls `enabled()` at dispatch time, so the value
 * is always current without layer churn.
 */
describe("session.interrupt enabled strategy", () => {
  test("static boolean is frozen — does not reflect later status changes", () => {
    const harness = createTestKeymap({ defaultKeys: true })
    registerEnabledFields(harness.keymap)
    let ran = 0

    // Simulate the OLD pattern: enabled evaluated once at registration
    const status = { type: "busy" }
    harness.keymap.registerLayer({
      commands: [
        {
          name: "session.interrupt",
          enabled: status.type !== "idle", // true at registration
          run: () => {
            ran++
          },
        },
      ],
      bindings: [{ key: "escape", cmd: "session.interrupt" }],
    })

    // Status changes to idle AFTER registration
    status.type = "idle"

    // Keymap dispatches — the boolean was frozen as `true`
    harness.host.press("escape")
    expect(ran).toBe(1) // still fires despite status being idle

    harness.cleanup()
  })

  test("function is lazy — reflects current status on every key-press", () => {
    const harness = createTestKeymap({ defaultKeys: true })
    registerEnabledFields(harness.keymap)
    let ran = 0

    const status = { type: "busy" }

    // Simulate the FIXED pattern: enabled is a function
    harness.keymap.registerLayer({
      commands: [
        {
          name: "session.interrupt",
          enabled: () => status.type !== "idle",
          run: () => {
            ran++
          },
        },
      ],
      bindings: [{ key: "escape", cmd: "session.interrupt" }],
    })

    // busy → escape fires
    harness.host.press("escape")
    expect(ran).toBe(1)

    // idle → escape does NOT fire
    status.type = "idle"
    harness.host.press("escape")
    expect(ran).toBe(1)

    // busy again → escape fires
    status.type = "busy"
    harness.host.press("escape")
    expect(ran).toBe(2)

    harness.cleanup()
  })

  test("function avoids layer churn — no re-registration needed", () => {
    const harness = createTestKeymap({ defaultKeys: true })
    registerEnabledFields(harness.keymap)
    let ran = 0

    const status = { type: "busy" }

    // Register once with a function — layer stays stable
    const dispose = harness.keymap.registerLayer({
      commands: [
        {
          name: "session.interrupt",
          enabled: () => status.type !== "idle",
          run: () => {
            ran++
          },
        },
      ],
      bindings: [{ key: "escape", cmd: "session.interrupt" }],
    })

    // Rapidly flip status without disposing/re-registering the layer
    status.type = "idle"
    status.type = "busy"
    status.type = "idle"
    status.type = "busy"

    // Layer was registered exactly once, never disposed
    harness.host.press("escape")
    expect(ran).toBe(1)

    dispose()
    harness.cleanup()
  })
})
