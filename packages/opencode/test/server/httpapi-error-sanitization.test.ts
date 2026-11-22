import { NamedError } from "@opencode-ai/core/util/error"
import { afterAll, describe, expect, test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import z from "zod"
import { Auth } from "@/auth"
import { RootHttpApi } from "../../src/server/routes/instance/httpapi/api"
import { ControlPaths } from "../../src/server/routes/instance/httpapi/groups/control"
import { controlHandlers } from "../../src/server/routes/instance/httpapi/handlers/control"
import { Authorization } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { errorLayer } from "../../src/server/routes/instance/httpapi/middleware/error"
import { schemaErrorLayer } from "../../src/server/routes/instance/httpapi/middleware/schema-error"

const LeakyError = NamedError.create(
  "LeakyError",
  z.object({
    message: z.string(),
    cause: z.unknown().optional(),
    stack: z.string().optional(),
    stackTrace: z.string().optional(),
    nested: z
      .object({
        detail: z.string(),
        cause: z.unknown().optional(),
        stack: z.string().optional(),
      })
      .optional(),
  }),
)

const dyingRoutes = HttpRouter.use((router) =>
  router.add("GET", "/boom", () =>
    Effect.die(
      new LeakyError({
        message: "operation failed",
        cause: { path: "/etc/secret/file", code: "EACCES" },
        stack: "Error: secret\n    at /home/user/src/secret.ts:42:10",
        stackTrace: "internal trace",
        nested: {
          detail: "safe detail",
          cause: "inner cause",
          stack: "inner stack",
        },
      }),
    ),
  ),
)

const failingAuth = Layer.succeed(
  Auth.Service,
  Auth.Service.of({
    get: () => Effect.succeed(undefined),
    all: () => Effect.succeed({}),
    set: () =>
      Effect.fail(
        new Auth.AuthError({
          message: "Failed to write auth data",
          cause: new Error("EACCES: permission denied, open '/var/lib/opencode/auth.json'"),
        }),
      ),
    remove: () =>
      Effect.fail(
        new Auth.AuthError({
          message: "Failed to write auth data",
          cause: new Error("ENOSPC: no space left on device"),
        }),
      ),
  }),
)

const stubGlobalHandlers = HttpApiBuilder.group(RootHttpApi, "global", (handlers) =>
  Effect.succeed(
    handlers
      .handle("health", () => Effect.die("unexpected global.health"))
      .handle("event", () => Effect.die("unexpected global.event"))
      .handle("configGet", () => Effect.die("unexpected global.configGet"))
      .handle("configUpdate", () => Effect.die("unexpected global.configUpdate"))
      .handle("dispose", () => Effect.die("unexpected global.dispose")),
  ),
)

const passthroughAuthorization = Layer.succeed(
  Authorization,
  Authorization.of((effect) => effect),
)

const appLayer = Layer.mergeAll(
  dyingRoutes,
  HttpApiBuilder.layer(RootHttpApi).pipe(
    Layer.provide(controlHandlers),
    Layer.provide(stubGlobalHandlers),
    Layer.provide([failingAuth, passthroughAuthorization, schemaErrorLayer]),
  ),
).pipe(Layer.provide([errorLayer, HttpServer.layerServices]))

const web = HttpRouter.toWebHandler(appLayer)
const handle = (request: Request) => web.handler(request, Context.empty() as Context.Context<unknown>)

afterAll(async () => {
  await web.dispose()
})

describe("httpapi error sanitization and 5xx auth handling", () => {
  test("strips cause and stack fields from NamedError data in error responses", async () => {
    const response = await handle(new Request("http://localhost/boom"))
    expect(response.status).toBe(500)
    const body = (await response.json()) as { name: string; data: Record<string, unknown> }
    expect(body).toEqual({
      name: "LeakyError",
      data: {
        message: "operation failed",
        nested: {
          detail: "safe detail",
        },
      },
    })
  })

  test("authSet returns 500 without leaking fs cause when storage fails", async () => {
    const response = await handle(
      new Request(`http://localhost${ControlPaths.auth.replace(":providerID", "test")}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "api", key: "secret-key" }),
      }),
    )
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(text).not.toContain("/var/lib/opencode")
    expect(text).not.toContain("EACCES")
  })

  test("authRemove returns 500 without leaking fs cause when storage fails", async () => {
    const response = await handle(
      new Request(`http://localhost${ControlPaths.auth.replace(":providerID", "test")}`, {
        method: "DELETE",
      }),
    )
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(text).not.toContain("ENOSPC")
  })

  test("authSet still returns 400 on invalid payload schema", async () => {
    const response = await handle(
      new Request(`http://localhost${ControlPaths.auth.replace(":providerID", "test")}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invalid: true }),
      }),
    )
    expect(response.status).toBe(400)
  })
})
