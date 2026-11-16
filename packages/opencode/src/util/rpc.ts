type Definition = {
  [method: string]: (input: any) => any
}

export function listen(rpc: Definition) {
  onmessage = async (evt) => {
    let parsed: any
    try {
      parsed = JSON.parse(evt.data)
    } catch {
      return // malformed message: swallow instead of killing the worker with an unhandled rejection
    }
    if (parsed.type === "rpc.request") {
      let result: unknown
      try {
        result = await rpc[parsed.method](parsed.input)
      } catch (error) {
        // Post the failure back instead of swallowing it: without an error
        // result the caller's promise hangs forever and the pending map leaks.
        postMessage(
          JSON.stringify({
            type: "rpc.error",
            id: parsed.id,
            message: error instanceof Error ? error.message : String(error),
          }),
        )
        return
      }
      postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
    }
  }
}

export function emit(event: string, data: unknown) {
  postMessage(JSON.stringify({ type: "rpc.event", event, data }))
}

export function client<T extends Definition>(target: {
  postMessage: (data: string) => void | null
  onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
}) {
  const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>()
  const listeners = new Map<string, Set<(data: any) => void>>()
  let id = 0

  const rejectAll = (error: Error) => {
    for (const [requestId, entry] of pending) {
      entry.reject(error)
      pending.delete(requestId)
    }
  }

  target.onmessage = async (evt) => {
    let parsed: any
    try {
      parsed = JSON.parse(evt.data)
    } catch {
      return // malformed message: swallow instead of an unhandled rejection crashing the host
    }
    if (parsed.type === "rpc.result") {
      const entry = pending.get(parsed.id)
      if (entry) {
        entry.resolve(parsed.result)
        pending.delete(parsed.id)
        return
      }
    }
    if (parsed.type === "rpc.error") {
      const entry = pending.get(parsed.id)
      if (entry) {
        entry.reject(new Error(parsed.message ?? "rpc call failed"))
        pending.delete(parsed.id)
        return
      }
    }
    if (parsed.type === "rpc.event") {
      const handlers = listeners.get(parsed.event)
      if (handlers) {
        for (const handler of handlers) {
          handler(parsed.data)
        }
      }
    }
  }

  return {
    call<Method extends keyof T>(method: Method, input: Parameters<T[Method]>[0]): Promise<ReturnType<T[Method]>> {
      const requestId = id++
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject })
        target.postMessage(JSON.stringify({ type: "rpc.request", method, input, id: requestId }))
      })
    },
    on<Data>(event: string, handler: (data: Data) => void) {
      let handlers = listeners.get(event)
      if (!handlers) {
        handlers = new Set()
        listeners.set(event, handlers)
      }
      handlers.add(handler)
      return () => {
        handlers!.delete(handler)
      }
    },
    /**
     * Rejects every in-flight call — call when the worker dies or errors so
     * callers' promises do not hang forever (the pending map was previously
     * leak-only: a dead worker never produced a result).
     */
    rejectPending: rejectAll,
    pendingCount: () => pending.size,
  }
}

export * as Rpc from "./rpc"
