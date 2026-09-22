# Graceful SSE Retry on Connection Drop

**Status:** ✅ EXECUTED (reviewed 2026-09-22) — PR #119 merged as `1795d16` (2026-08-29); evidence `cli/cmd/run/stream.transport.ts:670` (`recover()`) and updated `test/cli/run/stream.transport.test.ts`.

## Goal

Prevent SSE connection drops from permanently killing the session. When the global event stream ends or errors, reconnect transparently instead of setting `state.fault` and failing all subsequent prompt turns.

## Root Cause Analysis

### SDK Layer: Built-in Retry Already Exists

The SDK's `createSseClient` (`packages/sdk/js/src/v2/gen/core/serverSentEvents.gen.ts:78-237`) wraps the SSE fetch in a `while(true)` loop with exponential backoff:

- **Line 224**: `if (sseMaxRetryAttempts !== undefined && attempt >= sseMaxRetryAttempts) break` — when `sseMaxRetryAttempts` is `undefined` (default), the loop retries **infinitely**.
- The consumer (async generator) never sees errors for transient drops — the retry is transparent.

This means `stream.transport.ts`'s `watch()` only sees stream end when:
1. The SDK retry exhausts (only if `sseMaxRetryAttempts` is set to a finite number)
2. The server permanently closes the connection (normal shutdown)
3. The abort signal fires

### Transport Layer: Fatal on Stream End

In `stream.transport.ts`, the `watch()` function (lines 741-823) wraps the event stream in an Effect `Stream`:

```
lines 814-823:
  Effect.catch((error) => (abort.signal.aborted ? Effect.void : fail(error))),
  Effect.ensuring(
    Effect.gen(function* () {
      if (!abort.signal.aborted && !state.fault) {
        yield* fail(new Error("global event stream closed"))
      }
      closeStream()
    }),
  ),
```

- `fail(error)` (lines 670-683) sets `state.fault = error` and fails the current turn's `Deferred`.
- `runPromptTurn()` (line 834) checks `if (state.fault) yield* Effect.fail(state.fault)` — the session is permanently dead.
- The `Effect.ensuring` block also calls `fail()` if the stream ends without an error and without abort.

### TUI Context: Disables SDK Retry

In `sdk.tsx:85`, `sseMaxRetryAttempts: 0` disables the SDK's built-in retry. The TUI's own `startSSE()` outer loop (lines 74-108) has exponential backoff, but every transient drop causes the entire subscription to restart, losing in-flight events.

## Change Descriptions

### File 1: `packages/opencode/src/cli/cmd/run/stream.transport.ts`

#### 1a. Extract `recover()` from `bootstrap()` (around line 596)

`bootstrap()` (lines 596-658) does:
1. Fetch messages, children, permissions, questions
2. Call `bootstrapSessionData()` and `bootstrapSubagentData()`
3. Seed blockers
4. Sync footer
5. Fork subagent history bootstrap

For reconnection, we need a lighter `recover()` that re-fetches state WITHOUT:
- Re-fetching children (subagent sessions persist in `state.subagent.tabs`)
- Re-forking subagent history bootstrap (already running)
- Recreating the full layer

**New `recover()` function** (inserted after `bootstrap()`):

```ts
const recover = Effect.fn("RunStreamTransport.recover")(function* () {
  const [messagesList, permissions, questions] = yield* Effect.all(
    [
      messages(input.sessionID, SUBAGENT_BOOTSTRAP_LIMIT),
      Effect.promise(() => input.sdk.permission.list()).pipe(
        Effect.map((item) => item.data ?? []),
        Effect.orElseSucceed(() => []),
      ),
      Effect.promise(() => input.sdk.question.list()).pipe(
        Effect.map((item) => item.data ?? []),
        Effect.orElseSucceed(() => []),
      ),
    ],
    { concurrency: "unbounded" },
  )

  bootstrapSessionData({
    data: state.data,
    messages: messagesList,
    permissions: permissions.filter((item) => item.sessionID === input.sessionID),
    questions: questions.filter((item) => item.sessionID === input.sessionID),
  })
  bootstrapSubagentData({
    data: state.subagent,
    messages: messagesList,
    children: [...state.subagent.tabs.keys()].map((id) => ({ id, slug: id, projectID: "", directory: "", title: id, version: "1", time: { created: 0, updated: 0 } })),
    permissions,
    questions,
  })

  for (const request of [
    ...state.data.permissions,
    ...listSubagentPermissions(state.subagent),
    ...state.data.questions,
    ...listSubagentQuestions(state.subagent),
  ].sort((a, b) => a.id.localeCompare(b.id))) {
    seedBlocker(request.id)
  }

  syncFooter([], undefined, currentSubagentState())
})
```

**Key differences from `bootstrap()`:**
- No `children` API call — uses existing `state.subagent.tabs` keys
- No `bootstrapSubagentHistory` fork — subagent history is already being tracked
- Same `bootstrapSessionData`/`bootstrapSubagentData` calls to reset state from fresh data

#### 1b. Modify `watch()` to add reconnection loop (lines 741-823)

Replace the fatal `Effect.catch` + `Effect.ensuring` with a reconnection loop:

```ts
const watch = Effect.fn("RunStreamTransport.watch")(() => {
  const loop = Effect.fn("RunStreamTransport.watchLoop")(function* (stream: AsyncIterable<unknown>) {
    yield* Stream.fromAsyncIterable(stream, (error) =>
      error instanceof Error ? error : new Error(String(error)),
    ).pipe(
      Stream.takeUntil(() => input.footer.isClosed || abort.signal.aborted),
      Stream.runForEach(
        Effect.fn("RunStreamTransport.event")(function* (item: unknown) {
          // ... existing event processing (lines 748-811) ...
        }),
      ),
    )
  })

  const reconnect = Effect.fn("RunStreamTransport.reconnect")(function* () {
    let attempt = 0
    const maxAttempts = 3
    const baseDelay = 1000

    while (!abort.signal.aborted && !input.footer.isClosed) {
      attempt++
      input.trace?.write("sse.reconnect", { attempt })

      try {
        // Re-fetch session state before reconnecting
        yield* recover()

        // Create new stream
        const newEvents = yield* Effect.promise(() =>
          input.sdk.global.event({
            signal: abort.signal,
          }),
        )

        // Update closeStream to point at new stream
        closeStream = () => {
          void newEvents.stream.return(undefined).catch(() => {})
        }

        // Restart the watch loop on the new stream
        yield* loop(newEvents.stream)
        return // success — stream ended normally
      } catch (error) {
        input.trace?.write("sse.reconnect.error", {
          attempt,
          error: formatUnknownError(error),
        })

        if (attempt >= maxAttempts) {
          yield* fail(error)
          return
        }

        const backoff = Math.min(baseDelay * 2 ** (attempt - 1), 30000)
        yield* Effect.sleep(backoff)
      }
    }
  })

  return loop(events.stream).pipe(
    Effect.catch((error) => {
      if (abort.signal.aborted) return Effect.void
      return reconnect()
    }),
    Effect.ensuring(
      Effect.sync(() => {
        if (!abort.signal.aborted && !state.fault) {
          // Stream ended without error and reconnect didn't help
          // This shouldn't happen since reconnect handles it, but be safe
        }
        closeStream()
      }),
    ),
  )
})
```

**Key changes:**
- Extract the event processing into an inner `loop()` function
- Add a `reconnect()` function with exponential backoff (max 3 attempts)
- On stream error, call `reconnect()` instead of `fail()`
- `reconnect()` calls `recover()` to re-fetch state, then creates a new stream
- Only call `fail()` if all reconnection attempts fail
- Remove the `Effect.ensuring` block that called `fail()` on clean stream end — the reconnection loop handles this

**Edge cases handled:**
- `abort.signal.aborted` — skip reconnection, let the abort propagate
- `input.footer.isClosed` — skip reconnection, session is being torn down
- `state.fault` already set — don't overwrite
- SDK's own retry handles transient drops first; this is a secondary safety net

#### 1c. Update `closeStream` reference

The `closeStream` variable (line 385, reassigned at line 420) needs to be reassignable so `reconnect()` can update it to point at the new stream. Currently it's a `let` (line 385: `let closeStream = () => {}`), so reassignment is already possible.

### File 2: `packages/opencode/src/cli/cmd/tui/context/sdk.tsx`

#### 2a. Remove `sseMaxRetryAttempts: 0` (line 85)

**Before (line 83-86):**
```ts
const events = await sdk.global.event({
  signal: ctrl.signal,
  sseMaxRetryAttempts: 0,
})
```

**After:**
```ts
const events = await sdk.global.event({
  signal: ctrl.signal,
})
```

**Rationale:** With `sseMaxRetryAttempts` undefined, the SDK's `createSseClient` uses infinite retry (line 224: `if (sseMaxRetryAttempts !== undefined && attempt >= sseMaxRetryAttempts)` → condition is false → never breaks). Transient connection drops are handled transparently within the async generator. The TUI's own `startSSE()` outer loop remains as a safety net for permanent failures (server shutdown, unrecoverable errors).

## Implementation Order

1. **`stream.transport.ts` — Extract `recover()`** — pure extraction, no behavior change, easy to verify
2. **`stream.transport.ts` — Modify `watch()`** — the main logic change, add reconnection loop
3. **`sdk.tsx` — Remove `sseMaxRetryAttempts: 0`** — one-line change, independent of the above
4. **Run tests** — verify existing tests pass

## Testing Notes

### Existing Test Coverage

`test/cli/run/stream.transport.test.ts` has 11 tests covering:
- Bootstrap (child tabs, blocker input, child history)
- Event streaming (subagent output, text updates)
- Question recovery
- Prompt turn lifecycle (includeFiles, abort, close, concurrent turns)
- **Stream fault handling** — `"rejects the active turn when the event stream faults"` (line 1285) and `"rejects the active turn when the backing instance is disposed"` (line 1327)

### Test Impact

**Tests that should still pass:**
- All bootstrap tests — `recover()` uses the same `bootstrapSessionData`/`bootstrapSubagentData` calls
- All event streaming tests — the inner `loop()` function is identical to the current event processing
- All prompt turn lifecycle tests — `runPromptTurn()` logic is unchanged
- `"rejects the active turn when the backing instance is disposed"` — `isMatchingDisposeEvent` still calls `fail()` directly (line 754), bypassing the reconnection loop

**Test that needs updating:**
- `"rejects the active turn when the event stream faults"` (line 1285-1325) — currently expects the stream error to propagate as a rejection. With the reconnection loop, the error will trigger a reconnect attempt instead. This test needs to be updated to either:
  - Make the stream fail repeatedly (exhaust the 3 reconnection attempts) to still test the fatal path, OR
  - Test that reconnection happens and the session recovers

**New tests to add:**
- Stream ends cleanly → reconnection loop creates new stream → session continues
- Stream errors repeatedly → after 3 attempts, session faults
- Reconnection calls `recover()` → state is refreshed after reconnect
- Abort during reconnection → reconnection is skipped

### Running Tests

```bash
cd packages/opencode
bun test test/cli/run/stream.transport.test.ts
```

Run the full suite after changes to catch order-dependent failures:
```bash
bun test
```

## Architecture Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Extract `recover()` from `bootstrap()` | Avoids recreating subagent tabs and re-forking history bootstrap | Calling `bootstrap()` directly would re-fetch children and re-fork subagent history, causing redundant work and potential race conditions |
| Max 3 reconnection attempts with exponential backoff | Prevents infinite reconnect loops on permanent failures; SDK's own retry handles transient drops | Infinite retry would mask permanent server failures; no backoff would hammer the server |
| Reconnection is a secondary safety net | SDK's `createSseClient` already retries infinitely by default; this only triggers when SDK retry exhausts | Relying solely on SDK retry would leave a gap if the server closes the connection cleanly (no error, just stream end) |
| Remove `sseMaxRetryAttempts: 0` in TUI | Lets SDK handle transient drops transparently; TUI outer loop remains as ultimate safety net | Keeping `0` forces every transient drop to restart the entire subscription, losing in-flight events |

## Open Questions

1. **Should `recover()` also re-fetch children?** Currently it uses existing `state.subagent.tabs` keys. If a subagent was created during the disconnection, its tab won't appear until the next bootstrap. This is acceptable because subagents are created by the session itself — if the session was disconnected, no new subagents were created.

2. **Should the reconnection loop preserve `Last-Event-ID`?** The SDK's `createSseClient` already tracks `lastEventId` and sends it via the `Last-Event-ID` header on reconnect (line 110-112). The transport layer doesn't need to handle this.

3. **What about the `events.stream.return()` call in `closeStream`?** The current `closeStream` (line 420-422) calls `events.stream.return(undefined)`. After reconnection, `closeStream` is updated to point at the new stream. The old stream's cleanup is handled by the SDK's retry loop (the old fetch is abandoned when the abort signal fires or when the async generator is garbage collected).