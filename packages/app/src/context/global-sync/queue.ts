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

  const schedule = (delay = backoff) => {
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
    let taken: string[] = []
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
        taken = take(2)
        if (taken.length === 0) return
        await Promise.all(taken.map((dir) => input.bootstrapInstance(dir)))
        taken = []
        backoff = 0
        await tick()
      }
    } catch (err) {
      failed = true
      console.error("Refresh queue drain failed", err)
      // Restore directories taken before the failure so they are retried, and
      // leave `root` set so a rejected global refresh is not silently dropped.
      for (const dir of taken) queued.set(key(dir), dir)
      backoff = Math.min(backoff ? backoff * 2 : retryBase, RETRY_MAX_MS)
    } finally {
      running = false
      // oxlint-disable-next-line no-unsafe-finally -- intentional: early return skips schedule() when paused
      if (input.paused()) return
      if (root || queued.size) schedule(failed ? backoff : 0)
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
