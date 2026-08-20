import { Auth } from "@/auth"
import { ProviderID } from "@/provider/schema"
import * as Log from "@opencode-ai/core/util/log"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { LogInput } from "../groups/control"

export const controlHandlers = HttpApiBuilder.group(RootHttpApi, "control", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service

    const authSet = Effect.fn("ControlHttpApi.authSet")(function* (ctx: {
      params: { providerID: ProviderID }
      payload: Auth.Info
    }) {
      yield* auth.set(ctx.params.providerID, ctx.payload).pipe(Effect.orDie)
      return true
    })

    const authRemove = Effect.fn("ControlHttpApi.authRemove")(function* (ctx: { params: { providerID: ProviderID } }) {
      yield* auth.remove(ctx.params.providerID).pipe(Effect.orDie)
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
      const escape = (text: string) => text.replace(/\r\n?|\n/g, "\\n")
      const extra = ctx.payload.extra
        ? Object.fromEntries(
            Object.entries(ctx.payload.extra).map(([key, value]) => [key, typeof value === "string" ? escape(value) : value]),
          )
        : undefined
      const logger = Log.create({ service })
      logger[ctx.payload.level](escape(ctx.payload.message), extra)
      return true
    })

    return handlers.handle("authSet", authSet).handle("authRemove", authRemove).handle("log", log)
  }),
)
