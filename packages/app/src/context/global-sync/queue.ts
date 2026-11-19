type QueueInput = {
  paused: () => boolean
  bootstrap: () => Promise<void>
  bootstrapInstance: (directory: string) => Promise<void> | void
  key?: (directory: string) => string
  retryBaseMs?: number
}

const RETRY_MAX_MS = 30_000

export function createRefreshQueue(input: QueueInput) {
  const queued = new Map<string, string>()
  let root = false
  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let backoff = 0

  const key = input.key ?? ((directory: string) => directory)
  const retryBase = input.retryBaseMs ?? 500

  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  const take = (count: number) => {
    if (queued.size === 0) return [] as string[]
    const items: string[] = []
    for (const [id, directory] of queued) {
      queued.delete(id)
      items.push(directory)
      if (items.length >= count) break
    }
    return items
  }

  const schedule = (delay = 0) => {
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      void drain()
    }, delay)
  }

  const push = (directory: string) => {
    if (!directory) return
    queued.set(key(directory), directory)
    if (input.paused()) return
    schedule()
  }

  const refresh = () => {
    root = true
    if (input.paused()) return
    schedule()
  }

  async function drain() {
    if (running) return
    running = true
    let retry: string[] = []
    let failed = false
    try {
      while (true) {
        if (input.paused()) return
        if (root) {
          await input.bootstrap()
          root = false
          backoff = 0
          await tick()
          continue
        }
        const taken = take(2)
        if (taken.length === 0) return
        const results = await Promise.allSettled(taken.map(async (dir) => input.bootstrapInstance(dir)))
        retry = taken.filter((_, index) => results[index].status === "rejected")
        const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected")
        if (rejected) throw rejected.reason
        backoff = 0
        await tick()
      }
    } catch (err) {
      failed = true
      console.error("Refresh queue drain failed", err)
      // Restore only the directories that failed so successful ones are not
      // bootstrapped twice, and leave `root` set so a rejected global refresh
      // is not silently dropped.
      for (const dir of retry) queued.set(key(dir), dir)
      backoff = Math.min(backoff ? backoff * 2 : retryBase, RETRY_MAX_MS)
    } finally {
      running = false
      // oxlint-disable-next-line no-unsafe-finally -- intentional: early return skips schedule() when paused
      if (input.paused()) return
      if (root || queued.size) {
        // A push/refresh during the failed await may have left a 0-delay timer
        // pending. Replace it so the retry honors the backoff instead of firing immediately.
        if (failed && timer) {
          clearTimeout(timer)
          timer = undefined
        }
        schedule(failed ? backoff : 0)
      }
    }
  }

  return {
    push,
    refresh,
    clear(directory: string) {
      queued.delete(key(directory))
    },
    dispose() {
      if (!timer) return
      clearTimeout(timer)
      timer = undefined
    },
  }
}
