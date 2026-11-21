import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { NotFoundError } from "@/storage/storage"
import { iife } from "@/util/iife"
import { NamedError } from "@opencode-ai/core/util/error"
import * as Log from "@opencode-ai/core/util/log"
import { Cause, Effect } from "effect"
import { HttpRouter, HttpServerError, HttpServerRespondable, HttpServerResponse } from "effect/unstable/http"

const log = Log.create({ service: "server" })

// HttpServerResponse.jsonUnsafe serializes with JSON.stringify, which throws
// on non-serializable values (BigInt, circular refs). Inside this error
// boundary a throw would replace the structured response with a dropped
// connection — fall back to a fixed body instead.
function errorResponse(body: unknown, status: number) {
  try {
    return HttpServerResponse.jsonUnsafe(body, { status })
  } catch {
    return HttpServerResponse.jsonUnsafe(new NamedError.Unknown({ message: "Internal server error" }).toObject(), {
      status: 500,
    })
  }
}

// Keep typed HttpApi failures on their declared error path; this boundary only replaces defect-only empty 500s.
export const errorLayer = HttpRouter.middleware<{ handles: unknown }>()((effect) =>
  effect.pipe(
    Effect.catchCause((cause) => {
      const defect = cause.reasons.filter(Cause.isDieReason).find((reason) => {
        if (HttpServerResponse.isHttpServerResponse(reason.defect)) return false
        if (HttpServerError.isHttpServerError(reason.defect)) return false
        if (HttpServerRespondable.isRespondable(reason.defect)) return false
        return true
      })
      if (!defect) return Effect.failCause(cause)

      const error = defect.defect
      log.error("failed", { error, cause: Cause.pretty(cause) })

      if (error instanceof NamedError) {
        const status = iife(() => {
          if (error instanceof NotFoundError) return 404
          if (error instanceof Provider.ModelNotFoundError) return 400
          if (error.name === "ProviderAuthValidationFailed") return 400
          if (error.name.startsWith("Worktree")) return 400
          return 500
        })
        return Effect.succeed(errorResponse(error.toObject(), status))
      }
      if (error instanceof Session.BusyError) {
        return Effect.succeed(errorResponse(new NamedError.Unknown({ message: error.message }).toObject(), 400))
      }

      return Effect.succeed(
        errorResponse(
          new NamedError.Unknown({
            // Never leak internal error details (absolute paths, command lines, stack traces)
            // to clients; the full detail is already logged server-side above.
            message: "Internal server error",
          }).toObject(),
          500,
        ),
      )
    }),
  ),
).layer
