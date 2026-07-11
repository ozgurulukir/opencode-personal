import {
  AuthError,
  BlackUsageLimitError,
  CreditsError,
  FreeUsageLimitError,
  GoUsageLimitError,
  ModelError,
  MonthlyLimitError,
  RateLimitError,
  UserLimitError,
} from "./error"

export function mapErrorToResponse(
  error: unknown,
  logger: {
    metric: (values: Record<string, any>) => void
  },
): Response {
  const errorType = error instanceof Error ? error.constructor.name : "Error"
  const errorMessage = error instanceof Error ? error.message : String(error)
  const errorCause = error instanceof Error ? error.cause?.toString() : undefined

  logger.metric({
    "error.type": errorType,
    "error.message": errorMessage,
    "error.cause": errorCause,
  })

  if (error instanceof Error && error.message.startsWith("Failed query")) {
    try {
      logger.metric({
        "error.cause2": JSON.stringify(error.cause),
      })
    } catch {}
  }

  // Note: both top level "type" and "error.type" fields are used by the @ai-sdk/anthropic client to render the error message.
  if (
    error instanceof AuthError ||
    error instanceof CreditsError ||
    error instanceof MonthlyLimitError ||
    error instanceof UserLimitError ||
    error instanceof ModelError
  )
    return new Response(
      JSON.stringify({
        type: "error",
        error: { type: error.constructor.name, message: error.message },
      }),
      { status: 401 },
    )

  if (
    error instanceof RateLimitError ||
    error instanceof FreeUsageLimitError ||
    error instanceof GoUsageLimitError ||
    error instanceof BlackUsageLimitError
  ) {
    const headers = new Headers()
    if (error.retryAfter) {
      headers.set("retry-after", String(error.retryAfter))
    }
    return new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: error.constructor.name,
          message: error.message,
        },
        metadata:
          error instanceof GoUsageLimitError
            ? {
                workspace: error.workspace,
                limitName: error.limitName,
              }
            : {},
      }),
      { status: 429, headers },
    )
  }

  return new Response(
    JSON.stringify({
      type: "error",
      error: {
        type: "error",
        message: "Internal server error",
      },
    }),
    { status: 500 },
  )
}
