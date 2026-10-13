export interface RetryOptions {
  attempts?: number
  delay?: number
  factor?: number
  maxDelay?: number
  retryIf?: (error: unknown) => boolean
}

const TRANSIENT_MESSAGES = [
  "load failed",
  "network connection was lost",
  "network request failed",
  "failed to fetch",
  "econnreset",
  "econnrefused",
  "etimedout",
  "socket hang up",
]

const TRANSIENT_CODES = new Set([
  "econnreset",
  "econnrefused",
  "etimedout",
  "ehostunreach",
  "eai_again",
  "und_err_connect_timeout",
  "fetch_error",
])

const TRANSIENT_STATUS_CODES = new Set([429, 502, 503, 504])

function isTransientError(error: unknown, depth = 0): boolean {
  if (!error || depth > 3) return false

  if (typeof error === "object" && error !== null) {
    const errObj = error as Record<string, unknown>

    if (typeof errObj.code === "string" && TRANSIENT_CODES.has(errObj.code.toLowerCase())) {
      return true
    }

    const status = errObj.status ?? errObj.statusCode
    if (typeof status === "number" && TRANSIENT_STATUS_CODES.has(status)) {
      return true
    }

    if ("cause" in errObj && errObj.cause && isTransientError(errObj.cause, depth + 1)) {
      return true
    }
  }

  // oxlint-disable-next-line no-base-to-string -- error is unknown, intentional coercion for message matching
  const message = String(error instanceof Error ? error.message : error).toLowerCase()
  return TRANSIENT_MESSAGES.some((m) => message.includes(m))
}

export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { attempts = 3, delay = 500, factor = 2, maxDelay = 10000, retryIf = isTransientError } = options

  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt === attempts - 1 || !retryIf(error)) throw error
      const wait = Math.min(delay * Math.pow(factor, attempt), maxDelay)
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
  throw lastError
}
