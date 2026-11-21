import { Auth } from "@/auth"
import { ProviderID } from "@/provider/schema"
import * as Log from "@opencode-ai/core/util/log"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { LogInput } from "../groups/control"

const escapeNewlines = (text: string) => text.replace(/\r\n?|\n/g, "\\n")

export const controlHandlers = HttpApiBuilder.group(RootHttpApi, "control", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service

    const authSet = Effect.fn("ControlHttpApi.authSet")(function* (ctx: {
      params: { providerID: ProviderID }
      payload: Auth.Info
    }) {
      // The endpoint declares BadRequest: fail typed so a credentials-write
      // failure returns a structured 400 through the declared channel instead
      // of dying and relying on the errorLayer's defect heuristics. The write
      // error is logged first — mapError discards it, and the Auth service
      // does not log, so without this a disk-full/permission failure is
      // undiagnosable from the server side.
      yield* auth.set(ctx.params.providerID, ctx.payload).pipe(
        Effect.tapError((error) => Effect.sync(() => Log.Default.error("auth set failed", { error: String(error) }))),
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      return true
    })

    const authRemove = Effect.fn("ControlHttpApi.authRemove")(function* (ctx: { params: { providerID: ProviderID } }) {
      yield* auth.remove(ctx.params.providerID).pipe(
        Effect.tapError((error) =>
          Effect.sync(() =>
            Log.Default.error("auth remove failed", { providerID: ctx.params.providerID, error: String(error) }),
          ),
        ),
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      return true
    })

    const log = Effect.fn("ControlHttpApi.log")(function* (ctx: { payload: typeof LogInput.Type }) {
      // Remotely reachable endpoint: strip line breaks and control characters so
      // a crafted payload cannot forge additional lines in the structured log
      // output (log injection). Newlines are escaped, not dropped. String values
      // in `extra` are escaped too — the dev logger embeds primitives raw
      // (`prefix + value` in core/util/log.ts build()); objects are safe because
      // they go through JSON.stringify.
      const service = ctx.payload.service.replace(/[^\w.:-]+/g, "-").replace(/^-+|-+$/g, "") || "remote"
      const extra = ctx.payload.extra
        ? Object.fromEntries(
            Object.entries(ctx.payload.extra).map(([key, value]) => [
              key,
              typeof value === "string" ? escapeNewlines(value) : value,
            ]),
          )
        : undefined
      const logger = Log.create({ service })
      logger[ctx.payload.level](escapeNewlines(ctx.payload.message), extra)
      return true
    })

    return handlers.handle("authSet", authSet).handle("authRemove", authRemove).handle("log", log)
  }),
)
