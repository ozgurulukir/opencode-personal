import type { Page, Route } from "@playwright/test"
import type { Agent, Model, Path, Project, Provider, ProviderListResponse, Session } from "@opencode-ai/sdk/v2/client"

/**
 * Mocked opencode transport for Playwright e2e (issue #381).
 *
 * REST is intercepted via `page.route`. SSE (`GET /global/event`) is two-phase:
 * hold the first connection until `prompt_async` is observed, then fulfill with a
 * scripted `session.next.prompted` frame; later reconnects hang (client reconnects
 * every 250ms — assertions do not depend on a long-lived stream).
 *
 * Fallback if `route.fulfill` streaming proves flaky: serve the `/global/event`
 * SSE route from a tiny local `Bun.serve` endpoint started/stopped here (REST
 * stays on `page.route`) and add a second `webServer` in `playwright.config.ts`.
 * Note: never write a glob (two stars then a slash) for that route inside this
 * comment — the star-slash pair would terminate the block comment early.
 *
 * `E2E_FAIL_PROMPT_ASYNC=1` → prompt_async returns 500, `promptSent` never
 * resolves, prompted SSE frame is never delivered (negative regression check).
 */

export const FAKE_DIR = "/e2e-project"
export const SESSION_ID = "ses_e2e_0001"
export const SERVER_MESSAGE_ID = "evt_e2e_0001"

const mockModel: Model = {
  id: "mock-model",
  providerID: "mock",
  api: {
    id: "openai-compatible",
    url: "https://example.invalid/v1",
    npm: "@ai-sdk/openai-compatible",
  },
  name: "Mock Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: {
    input: 0,
    output: 0,
    cache: { read: 0, write: 0 },
  },
  limit: {
    context: 128_000,
    output: 4_096,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

const mockProvider: Provider = {
  id: "mock",
  name: "Mock",
  source: "config",
  env: [],
  options: {},
  models: { "mock-model": mockModel },
}

const providerList: ProviderListResponse = {
  all: [mockProvider],
  default: { mock: "mock-model" },
  connected: ["mock"],
}

const mockAgent: Agent = {
  name: "build",
  mode: "primary",
  permission: [],
  options: {},
}

const mockProject: Project = {
  id: "prj_e2e",
  worktree: FAKE_DIR,
  time: { created: 1, updated: 1 },
  sandboxes: [],
}

const mockPath: Path = {
  home: "/e2e-home",
  state: "/e2e-home/.local/state/opencode",
  config: "/e2e-home/.config/opencode",
  worktree: FAKE_DIR,
  directory: FAKE_DIR,
}

const mockSession: Session = {
  id: SESSION_ID,
  slug: "e2e-session",
  projectID: mockProject.id,
  directory: FAKE_DIR,
  title: "E2E critical path",
  version: "1",
  time: { created: 1, updated: 1 },
}

export type MockApiHandles = {
  lastPrompt: string
  serverMessageId: string
  promptSent: Promise<void>
}

type PromptAsyncBody = {
  parts?: Array<{ type?: string; text?: string }>
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  })

export async function installMockApi(page: Page): Promise<MockApiHandles> {
  const failMode = process.env.E2E_FAIL_PROMPT_ASYNC === "1"
  // Declared before `handles`: the Promise executor runs synchronously during
  // construction, so a later `let` would hit the temporal dead zone.
  let resolvePromptSent: () => void = () => {}
  const handles: MockApiHandles = {
    lastPrompt: "",
    serverMessageId: SERVER_MESSAGE_ID,
    promptSent: new Promise<void>((resolve) => {
      resolvePromptSent = resolve
    }),
  }
  // Latest SSE route wins: SPA navigation (page.goto) cancels the previous
  // document's held request, so only the newest held route may be fulfilled.
  let latestEventRoute: Route | undefined
  let delivered = false

  // Lowest priority — registered first, checked last. Catches unknown API
  // calls (any origin) so the app fails fast instead of hanging. Must NOT
  // touch the document or Vite's static assets: those are `script`/`document`
  // resource types served by the dev server, and fulfilling them with JSON
  // would blank the app.
  await page.route(
    () => true,
    async (route) => {
      const request = route.request()
      const type = request.resourceType()
      if (type !== "fetch" && type !== "xhr" && type !== "eventsource") {
        await route.fallback()
        return
      }
      const url = new URL(request.url())
      if (request.method() !== "GET") {
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: `No mock for ${request.method()} ${url.pathname}` }) })
        return
      }
      await json(route, {})
    },
  )

  await page.route((url) => url.pathname === "/global/health", (route) => json(route, { healthy: true, version: "e2e" }))
  await page.route((url) => url.pathname === "/global/config", (route) => json(route, {}))
  await page.route((url) => url.pathname === "/provider", (route) => json(route, providerList))
  await page.route((url) => url.pathname === "/path", (route) => json(route, mockPath))
  // Empty list → home empty state; directory bootstrap falls through to /project/current.
  await page.route((url) => url.pathname === "/project", (route) => json(route, []))
  await page.route((url) => url.pathname === "/project/current", (route) => json(route, mockProject))
  await page.route((url) => url.pathname === "/agent", (route) => json(route, [mockAgent]))
  await page.route((url) => url.pathname === "/config", (route) => json(route, {}))
  await page.route((url) => url.pathname === "/vcs", (route) => json(route, null))
  await page.route((url) => url.pathname === "/command", (route) => json(route, []))
  await page.route((url) => url.pathname === "/permission", (route) => json(route, []))
  await page.route((url) => url.pathname === "/question", (route) => json(route, []))
  await page.route((url) => url.pathname === "/mcp", (route) => json(route, {}))

  await page.route((url) => url.pathname === "/api/session", (route) => json(route, { items: [], cursor: {} }))
  await page.route(
    (url) => /^\/api\/session\/[^/]+\/message$/.test(url.pathname),
    (route) => json(route, { items: [], cursor: {} }),
  )
  // Busy-turn todo poll (`sync.session.todo`): must be an array — a `{}` body
  // truthily passes `todo.data ?? []` and crashes the todo dock's `<Index>`.
  await page.route((url) => /^\/api\/session\/[^/]+\/todo$/.test(url.pathname), (route) => json(route, []))
  await page.route(
    (url) => /^\/api\/session\/[^/]+\/prompt_async$/.test(url.pathname),
    async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback()
        return
      }
      if (failMode) {
        await json(route, { message: "E2E_FAIL_PROMPT_ASYNC" }, 500)
        return
      }
      const body = (await route.request().postDataJSON()) as PromptAsyncBody
      const text = (body.parts ?? [])
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("")
      handles.lastPrompt = text
      resolvePromptSent()
      await route.fulfill({ status: 204 })
    },
  )
  await page.route(
    (url) => /^\/api\/session\/[^/]+$/.test(url.pathname),
    (route) => json(route, mockSession),
  )
  // Registered after the single-segment detail route: Playwright checks the
  // most recently registered route first, so status must win over the detail
  // pattern (both match `/api/session/status`).
  await page.route((url) => url.pathname === "/api/session/status", (route) => json(route, {}))

  await page.route(
    (url) => url.pathname === "/global/event",
    async (route) => {
      latestEventRoute = route
      // Fail mode: never fulfill → the prompted frame is never delivered.
      if (failMode) return
      await handles.promptSent
      // Superseded by a newer connection (navigation tore this one down) or
      // already delivered — hang instead of fulfilling a dead/wrong stream.
      if (delivered || route !== latestEventRoute) return
      // Widen the optimistic-row window before resolveOptimistic runs.
      await new Promise((resolve) => setTimeout(resolve, 150))
      if (route !== latestEventRoute) return
      const frame = {
        directory: FAKE_DIR,
        payload: {
          id: SERVER_MESSAGE_ID,
          type: "session.next.prompted",
          properties: {
            timestamp: Date.now(),
            sessionID: SESSION_ID,
            prompt: { text: handles.lastPrompt },
            agent: mockAgent.name,
            model: { id: mockModel.id, providerID: mockProvider.id, variant: "default" },
          },
        },
      }
      try {
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: `data: ${JSON.stringify(frame)}\n\n`,
        })
        delivered = true
      } catch {
        // Connection was canceled (navigation or heartbeat abort) mid-flight.
        // Leave `delivered` false so a later live connection can still deliver.
      }
    },
  )

  return handles
}
