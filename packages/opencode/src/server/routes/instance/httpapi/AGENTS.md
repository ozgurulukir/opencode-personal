# HttpApi Route Patterns

Use `HttpApiBuilder.group(...)` for normal HTTP endpoints, including streaming HTTP responses such as server-sent events. Handlers should yield stable services once while building the handler layer, then close over those services in endpoint implementations.

```ts
export const sessionHandlers = HttpApiBuilder.group(InstanceHttpApi, "session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service

    return handlers.handle("list", () => session.list())
  }),
)
```

For SSE endpoints, stay in `HttpApiBuilder.group(...)` and return `HttpServerResponse.stream(...)` from the handler. Annotate the endpoint success schema with `HttpApiSchema.asText({ contentType: "text/event-stream" })` so OpenAPI documents the stream content type.

Use raw `HttpRouter.use(...)` only for routes that do not fit the request/response HttpApi model, such as WebSocket upgrade routes or catch-all fallback routes. Yield stable services at route-layer construction and close over them in `router.add(...)` callbacks.

```ts
export const rawRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const pty = yield* Pty.Service

    yield* router.add("GET", PtyPaths.connect, (request) => connectPty(request, pty))
  }),
)
```

Avoid `Effect.provide(SomeLayer)` inside request handlers or raw route callbacks. Stable layers should be provided once at the application/layer boundary, not rebuilt or scoped per request.

Avoid `HttpRouter.provideRequest(...)` unless the dependency is intentionally request-level. Prefer `HttpRouter.use(...)` for stable app services.

Use `Effect.provideService(...)` in middleware only for request-derived context, such as `WorkspaceRouteContext`, `InstanceRef`, or `WorkspaceRef`. Do not use it to smuggle stable services through request effects when they can be yielded at layer construction.

Public JSON errors should be explicit `Schema.ErrorClass` contracts declared on each endpoint. Use built-in `HttpApiError.*` classes only when their empty/tagged body is the intended wire shape; for SDK-visible errors with messages, define an API error schema such as `ApiNotFoundError` and fail with that exact declared error. Keep domain and storage services free of HttpApi types, and translate expected domain errors at the handler boundary.

When adding middleware, compose it at the layer boundary and keep the route tree explicit in `server.ts`. Shared router middleware such as auth, workspace routing, and instance context should stay visible where routes are assembled.

## Adding a new endpoint — three-file wiring

Adding an endpoint touches three files that must stay in sync:

1. **`groups/<resource>.ts`** — declare the endpoint with `HttpApiEndpoint.post("name", PathConst, { params, query, payload, success, error })`, mount it on the `HttpApi.make(...)` group, and add the `OpenApi.annotations({ identifier, summary, description })` block. The `identifier` becomes `client.<group>.<name>()` in the SDK.
2. **`handlers/<resource>.ts`** — add the handler inside the `HttpApiBuilder.group(...)` closure and register it with `.handle("name", handlerFn)`. Mismatched names between group and handler fail at runtime, not typecheck.
3. **`server.ts`** — usually no change needed; the group is already mounted. Only touch this file for cross-cutting middleware.

The `success` schema must be a `Schema` (not a TypeScript type). For OpenAPI metadata, wrap it with `described(Schema.Struct({...}), "description")`. Use `Schema.Literal` / `Schema.Literals` for enum-ish query parameters. Errors must be `HttpApiError.*` classes (for built-in wire shapes) or a custom `Schema.ErrorClass` declared in `errors.ts` (for SDK-visible errors with messages).

## Request-scoped services in handlers

`InstanceRef` and `WorkspaceRef` are request-scoped; yield them in each handler that needs them:

```ts
const handler = Effect.fn("SessionHttpApi.foo")(function* (ctx) {
  const instance = yield* InstanceState.context
  const workspace = yield* InstanceState.workspaceID
  // pass them into the service call:
  return yield* someSvc.run(args).pipe(
    Effect.provideService(InstanceRef, instance),
    Effect.provideService(WorkspaceRef, workspace),
  )
})
```

Stable services (like `SessionPrompt.Service`) are yielded once at handler-group construction and closed over. Don't `Effect.provide` layers inside handlers — provide them at the app boundary instead.
