# Plan: Regression test for subtask prompt-parts passthrough (issue #383)

**Branch:** `issue-383-subtask-parts-test` · **Scope:** TEST-ONLY · **Date:** 2026-11-08

## Goal

Pin the contract that `session/loop/command.ts`'s `isSubtask` branch forwards caller-supplied `input.parts` into the `deps.prompt(...)` call alongside the synthetic `subtask` part (the spread at `command.ts:126`, added in PR #382). Today no test under `packages/opencode/test/` exercises `command()` at all, so a refactor that deletes `...(input.parts ?? [])` stays green and the bug resurfaces as the pinned fallback error `Subagent produced no output parts.` (`src/agent/subagent-spawn.ts:60`, produced by `subagentResultText()`).

**Verified on this branch (no guessing):**

- The fix **is present** at `packages/opencode/src/session/loop/command.ts:126` — no production changes needed.
- `grep "session/loop/command" packages/opencode/test` → **0 matches**; `grep "input.parts" packages/opencode/test` only hits generic prompt stubs (`test/agent/subagent-parity.test.ts`, `test/v2/session.test.ts`) that read parts to build a result, never asserting command-level passthrough.
- `test/session/subtask.test.ts` tests `handleSubtask` (the *consumer* of subtask parts) with `onPrompt` assertions on session id / permission re-sync — not the parts array built by `command()`.

## Steps

### 1. Create `packages/opencode/test/session/command-passthrough.test.ts`

**Why a new file** (not extending `subtask.test.ts`): `subtask.test.ts` covers `handleSubtask` — a different unit with a heavy `makeSubtaskLayer` harness (V2 projection, tool registry, search stubs). `command()` is a deps-object function (`CommandDeps` in `command.ts:28-38`) explicitly designed for direct invocation with injected callables; a focused file keeps one unit per test file and reuses only the *patterns* from `subtask.test.ts` (stub `resolvePromptParts`, capture-`prompt`/`onPrompt`, `reply()`-shaped result).

**Harness — plain deps stubs, no Effect layers, no instance/DB:**

Read-through of `command()` proves that with the input shaped below, the only deps ever invoked are: `commands.get`, `agents.get`, `provider.getModel`, `resolvePromptParts`, `plugin.trigger`, `prompt`, `bus.publish`. Specifically short-circuited:

- `currentModel` (both call sites) → skipped by setting `input.model` (`command.ts:99`, `:132`) → `sessions` and `Database.use` never touched.
- `config.get` / `Process.text` → skipped by a template with no `` !`…` `` blocks (`ConfigMarkdown.shell`, `config/markdown.ts:7`) and no `$1`/`$ARGUMENTS` placeholders.
- `agents.defaultAgent` → skipped by setting `input.agent` (`command.ts:50`, `:130`).

This follows the repo's deps-object precedent (`handleSubtask` + `stubOps`, `runLoop`, `shellImpl`) and the plain `test()` + `await Effect.runPromise(...)` pattern already used across `test/`. It avoids `it.instance`/tmpdir/DB and the `Plugin.defaultLayer` server-import timeout hazard documented in `packages/opencode/AGENTS.md`.

**Code sketch (complete file):**

```ts
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { command, type CommandDeps } from "../../src/session/loop/command"
import type { CommandInput, PromptInput } from "../../src/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { Agent } from "../../src/agent/agent"
import type { Command } from "../../src/command"
import type { Provider } from "../../src/provider/provider"

const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

const dummyModel: Provider.Model = { /* same shape as subtask.test.ts:41-65 */ }

// Captures the parts array that command() assembles and passes to deps.prompt.
function makeDeps(captured: { input?: PromptInput }): CommandDeps {
  const subagent: Agent.Info = {
    name: "build",
    mode: "subagent",
    permission: [],
    options: {},
  }
  const cmd: Command.Info = {
    name: "review",
    description: "review changes",
    source: "command",
    template: "Review the changes",   // no !`...` blocks, no $placeholders
    hints: [],
    // subtask intentionally undefined → isSubtask via agent.mode === "subagent"
  }
  return {
    commands: { get: () => Effect.succeed(cmd), list: () => Effect.succeed([]) },
    agents: {
      get: (name) => Effect.succeed({ ...subagent, name }),
      list: () => Effect.succeed([subagent]),
      defaultAgent: () => Effect.succeed("build"),
    },
    // Only getModel is called (input.model set → currentModel never runs);
    // config/sessions likewise never called — stubs are type-satisfiers only.
    provider: { getModel: () => Effect.succeed(dummyModel) } as unknown as Provider.Interface,
    config: {} as CommandDeps["config"],      // never called: template has no shell blocks
    sessions: {} as CommandDeps["sessions"],  // never called: input.model short-circuits currentModel
    plugin: { trigger: (_n, _i, output) => Effect.succeed(output), list: () => Effect.succeed([]), init: () => Effect.void },
    bus: { publish: () => Effect.void } as unknown as CommandDeps["bus"],
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) => {
      captured.input = input
      const id = MessageID.ascending()
      return Effect.succeed({
        info: { id, role: "assistant", parentID: input.messageID ?? MessageID.ascending(),
          sessionID: input.sessionID, mode: input.agent ?? "general", agent: input.agent ?? "general",
          cost: 0, path: { cwd: "/tmp", root: "/tmp" },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: input.model?.modelID ?? ref.modelID, providerID: input.model?.providerID ?? ref.providerID,
          time: { created: Date.now() }, finish: "stop" },
        parts: [{ id: PartID.ascending(), messageID: id, sessionID: input.sessionID,
          type: "text" as const, text: "stub output" }],
      } satisfies MessageV2.WithParts)   // same reply() shape as subtask.test.ts / task.test.ts
    },
  } satisfies CommandDeps
}

describe("session.loop.command", () => {
  test("subtask command forwards caller prompt parts alongside the synthetic subtask part", async () => {
    const captured: { input?: PromptInput } = {}
    const callerParts = [
      { type: "text" as const, text: "caller prompt text" },
      { type: "file" as const, mime: "text/plain", filename: "notes.txt", url: "file:///tmp/notes.txt" },
    ]
    const input: CommandInput = {
      sessionID: SessionID.make("ses_cmd_test"),
      command: "review",
      arguments: "",
      agent: "build",
      model: "test/test-model",
      // CommandInput.parts is typed file-only (prompt.ts:379-392); command() forwards
      // the array opaquely, so a text part is included to pin type-agnostic passthrough.
      parts: callerParts as unknown as CommandInput["parts"],
    }

    await Effect.runPromise(command(makeDeps(captured), input))

    const parts = captured.input!.parts
    expect(parts).toHaveLength(1 + callerParts.length)
    // 1. Synthetic subtask part comes FIRST with template-derived prompt
    expect(parts[0]).toMatchObject({
      type: "subtask",
      agent: "build",
      command: "review",
      description: "review changes",
      model: { providerID: "test", modelID: "test-model" },
      prompt: "Review the changes",
    })
    // 2. Caller parts follow IN ORDER, by identity (spread preserves references)
    expect(parts[1]).toBe(callerParts[0])   // text part
    expect(parts[2]).toBe(callerParts[1])   // file part
    // 3. Sanity on the rest of the prompt call (cheap, pins userAgent/userModel)
    expect(captured.input!.agent).toBe("build")
    expect(captured.input!.model).toEqual(ref)
  })
})
```

Notes on the sketch:

- **`as unknown as` casts** (provider, config, sessions, bus): repo-sanctioned over `as any` (`AGENTS.md` → "Type casts at library boundaries"); each gets the explanatory comment shown. `config`/`sessions` are *never called* on this path — if a future change routes execution through them, the missing-method access fails loudly (fail-fast). If reviewers prefer, `Layer.mock(Session.Service, {})`-style loud stubs are the alternative, but that drags a layer runtime back in for zero coverage gain.
- **Text + file parts**: file is the production shape (`CommandInput` schema is file-only; `stream.transport.ts:1001-1004` filters caller prompt parts to `type === "file"`). The text part proves the spread is type-opaque — see Open Questions.
- **Identity assertions (`toBe`)**: the spread copies references; `toEqual` would also pass on clones, `toBe` pins *exact* passthrough + ordering.

### 2. (Optional, recommended) Add the complementary non-subtask branch test

Same file/harness, one more `test()`: agent `mode: "primary"` + `subtask` undefined → `isSubtask === false` → assert `parts` is `[templateTextPart, ...callerParts]` (line 128 branch), i.e. template parts AND caller parts both present, synthetic `subtask` part **absent**. Cheap, and stops a future "fix" to the subtask branch from silently breaking the other one. Not required by the issue's acceptance criteria.

### 3. Verification

1. **Targeted run** (from the package dir, never repo root — root `test` script intentionally fails):
   ```powershell
   cd packages/opencode; bun test test/session/command-passthrough.test.ts
   ```
   Expect: pass (package script `bun test --timeout 30000` applies the same timeout).
2. **Typecheck** the changed package: `bun typecheck` from `packages/opencode` (trust `tsgo` over LSP `@/` false positives).
3. **Sanity mutation** (acceptance criterion 3): temporarily delete the `...(input.parts ?? [])` spread at `command.ts:126` (keep the synthetic part) → re-run the targeted test → **must fail** on `toHaveLength` / `toBe` assertions → restore via `git checkout -- packages/opencode/src/session/loop/command.ts` and re-run → green.
4. **No-production-change proof:** `git status` shows only the new test file (and this plan) after restore.
5. Optional: `bun test test/session/subtask.test.ts` to confirm no cross-file interference (new file shares no state; no `mock.module()` used, so no `mock.restore()` needed).

## Architecture Decisions

| Decision | Choice | Rationale / alternatives |
| --- | --- | --- |
| File placement | **New** `test/session/command-passthrough.test.ts` | Single-contract file next to `subtask.test.ts`. Alternative: extend `subtask.test.ts` — rejected: different unit (`handleSubtask` vs `command`), its `makeSubtaskLayer` (V2 projection, tool registry, search/embedding stubs) is dead weight for a pure array-assembly assertion. A generic `command.test.ts` name is left free for future command tests. |
| Invocation style | **Direct `command(deps, input)`** with fully stubbed `CommandDeps` + plain `test()`/`Effect.runPromise` | The deps-object pattern (`command.ts:1-7` header) exists exactly for this. Alternative: `it.instance` + real `Agent`/`Session`/`Config` layers mirroring `makeSubtaskLayer` + `Layer.mock(Provider.Service, { getModel })` — more "real", but adds tmpdir/DB/skill-registry init (documented flake sources) while asserting the same array assembly; agent-mode resolution is a one-line stub either way. Rejected as the default; documented here as the fallback if review demands real agent lookup. |
| Capture point | **`deps.prompt` stub** recording its `input` | This is literally "the parts array received by the prompt call" per the acceptance criteria. Alternative: observe persisted user-message parts through the real Engine + test LLM server (`prompt.test.ts` harness) — end-to-end but slower, and asserts the contract only indirectly (createUserMessage → persistence → query). |
| Assertions | length + synthetic-first `toMatchObject` + caller parts `toBe` (identity, in order) | `toBe` fails if a refactor clones parts or reorders; `toMatchObject` on the synthetic part pins `agent`/`command`/`model`/`prompt` so the subtask branch itself can't drift. |
| Production code | **None** | Fix verified present at `command.ts:126` on this branch; issue is test-gap only. |

## Open Questions

1. **Text parts vs the `CommandInput` schema:** `CommandInput.parts` (`prompt.ts:379-392`) is a single-member union of **file** parts only, and every production caller passes files exclusively (`stream.transport.ts:1001-1004` filters to `type === "file"`). The test includes a text part (per the issue) via `as unknown as` + comment because `command()`'s spread is type-opaque and direct invocation bypasses schema validation. If text parts are meant to be *schema-reachable* input, that is a `CommandInput` schema change — out of scope for this test-only issue; flagged, not planned.
2. **Optional branch-2 test** (Step 2): include or keep the file single-purpose? Recommended: include — it is ~20 lines on the same harness.
3. **Never-called dep stubs** (`config: {} as …`, `sessions: {} as …`): acceptable loud-fail stubs, or should review require real layers for them? Recommended: keep stubs; they document the short-circuit paths (`input.model`, shell-free template) that the test deliberately exercises.
