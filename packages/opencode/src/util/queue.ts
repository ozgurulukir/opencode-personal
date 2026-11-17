export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((value: T) => void)[] = []

  push(item: T) {
    const resolve = this.resolvers.shift()
    if (resolve) resolve(item)
    else this.queue.push(item)
  }

  async next(signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError")
    }
    if (this.queue.length > 0) return this.queue.shift()!
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort)
      }
      const wrapped = (value: T) => {
        cleanup()
        resolve(value)
      }
      const onAbort = () => {
        const index = this.resolvers.indexOf(wrapped)
        if (index !== -1) this.resolvers.splice(index, 1)
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"))
      }
      this.resolvers.push(wrapped)
      signal?.addEventListener("abort", onAbort, { once: true })
    })
  }

  async *[Symbol.asyncIterator]() {
    while (true) yield await this.next()
  }
}

export async function work<T>(concurrency: number, items: T[], fn: (item: T) => Promise<void>) {
  const pending = [...items]
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const item = pending.pop()
        if (item === undefined) return
        await fn(item)
      }
    }),
  )
}
