import * as prompts from "@clack/prompts"
import { Effect, Option } from "effect"

export const intro = (msg: string) => Effect.sync(() => prompts.intro(msg))
export const outro = (msg: string) => Effect.sync(() => prompts.outro(msg))

export const log = {
  info: (msg: string) => Effect.sync(() => prompts.log.info(msg)),
  error: (msg: string) => Effect.sync(() => prompts.log.error(msg)),
  warn: (msg: string) => Effect.sync(() => prompts.log.warn(msg)),
  success: (msg: string) => Effect.sync(() => prompts.log.success(msg)),
}

const optional = <Value>(result: Value | symbol): Option.Option<Value> => {
  if (prompts.isCancel(result)) return Option.none()
  // isCancel() guards only the concrete CANCEL_SYMBOL, which TypeScript cannot subtract
  // from the wide `symbol` union member — cast to recover Value at this boundary.
  return Option.some(result as Value)
}

// Value is bound explicitly at each call site: tsgo's inference of the inner generic from
// `Value | unique symbol` arguments varies across platform builds and can widen callers'
// results to Option<Value | symbol>.
export const select = <Value>(opts: Parameters<typeof prompts.select<Value>>[0]) =>
  Effect.promise(() => prompts.select<Value>(opts)).pipe(Effect.map((result) => optional<Value>(result)))

export const autocomplete = <Value>(opts: Parameters<typeof prompts.autocomplete<Value>>[0]) =>
  Effect.promise(() => prompts.autocomplete<Value>(opts)).pipe(Effect.map((result) => optional<Value>(result)))

export const text = (opts: Parameters<typeof prompts.text>[0]) =>
  Effect.promise(() => prompts.text(opts)).pipe(Effect.map((result) => optional<string>(result)))

export const password = (opts: Parameters<typeof prompts.password>[0]) =>
  Effect.promise(() => prompts.password(opts)).pipe(Effect.map((result) => optional<string>(result)))

export const spinner = () => {
  const s = prompts.spinner()
  return {
    start: (msg: string) => Effect.sync(() => s.start(msg)),
    stop: (msg: string, code?: number) => Effect.sync(() => (code ? s.error(msg) : s.stop(msg))),
  }
}
