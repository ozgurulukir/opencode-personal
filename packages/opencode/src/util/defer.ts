import { safeCatch } from "./error"

export function defer(fn: () => void | Promise<void>): AsyncDisposable & Disposable {
  return {
    [Symbol.dispose]() {
      // A rejected promise during synchronous scope exit would otherwise be unhandled.
      void Promise.resolve(fn()).catch((error) => safeCatch("defer", error))
    },
    [Symbol.asyncDispose]() {
      return Promise.resolve(fn())
    },
  }
}
