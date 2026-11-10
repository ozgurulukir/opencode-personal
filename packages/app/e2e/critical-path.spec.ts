import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { FAKE_DIR, installMockApi, SERVER_MESSAGE_ID, SESSION_ID } from "./mock-api"

/**
 * Critical-path smoke for issue #381: boot → open session → send prompt →
 * optimistic bubble resolves to the server message.
 *
 * Limitations (documented subset — AC 1b):
 * - Transport is mocked via Playwright `page.route` (REST + two-phase SSE).
 * - No real `opencode serve`, no real LLM, no real SQLite/projector path.
 * - Unit suite (~539 tests) remains the server/persistence safety net.
 *
 * @see https://github.com/ozgurulukir/opencode-personal/issues/381
 */
test.describe("critical path", () => {
  test.beforeEach(async ({ page }) => {
    await installMockApi(page)
    await page.goto("/")
  })

  test("boot → open session → send prompt → optimistic resolves to server message", async ({ page }) => {
    // Step A: mocked global bootstrap settles with an empty project list.
    await expect(page.getByText("No recent projects")).toBeVisible()

    // Step B: direct session URL avoids command-palette / recent-project flake.
    const slug = base64Encode(FAKE_DIR)
    await page.goto(`/${slug}/session/${SESSION_ID}`)
    const editor = page.getByRole("textbox", { name: /ask anything/i })
    await expect(editor).toBeVisible()

    // Step C: unique prompt → optimistic `msg_*` row appears before SSE resolve.
    const text = `E2E critical path ${Date.now()}`
    await editor.fill(text)
    await page.keyboard.press("Enter")

    const rowsWithText = page.locator("[data-message-id]").filter({ hasText: text })
    const optimistic = page.locator('[data-message-id^="msg_"]').filter({ hasText: text })
    await expect(optimistic).toBeVisible()

    // Step D: server row (`evt_e2e_0001`) replaces optimistic; exactly one node.
    await expect(page.locator(`[data-message-id="${SERVER_MESSAGE_ID}"]`)).toContainText(text)
    await expect(rowsWithText).toHaveCount(1)
    await expect(rowsWithText).toHaveAttribute("data-message-id", SERVER_MESSAGE_ID)
  })
})
