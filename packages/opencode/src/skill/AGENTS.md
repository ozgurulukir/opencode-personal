# Skill

## Skill matching is LLM-driven, not algorithmic

The `skill` tool (`tool/skill.ts`) has no matching logic — it loads one or more skills by name. The LLM decides which skills to load based on the `<skills>` catalog in the system prompt. There is no regex, keyword, or embedding-based matching in the tool itself.

## Multi-skill loading contract

`tool/skill.ts` accepts both `name` (string, backward compatible) and `names` (string array). Execution order: normalize → dedupe → cap at `MAX_SKILLS_PER_CALL = 10` (fail-fast error before any lookup) → look up each name → fail fast with one error listing all unknown names → single permission ask covering all requested patterns → `markLoaded` loop → combined output with skills separated by `---`. Metadata is `{ names: string[], dirs: string[] }` (was `{ name, dir }`). The permission ask evaluates all requested patterns at once, so one "always" approval covers every skill in the call.

## Auto-match uses zvec, not brute-force

When `skills.autoMatch` is enabled in config, `matchBySemantics()` (`skill/index.ts`) queries a per-instance `ZvecIndex` (HNSW cosine similarity) rather than brute-force comparing against all skill embeddings. The zvec index is populated incrementally at instance init: only skills whose content hash changed since the last manifest are re-embedded and upserted. The manifest lives at `~/.cache/opencode/zvec/skills/{dirHash}_manifest.json` (derive via `manifestPathFor()` from `search/manifest.ts`).

State init ordering and failure semantics: `zi.open()` runs BEFORE the manifest is read (a dimension migration inside open wipes the manifest), and every zvec/embed step degrades instead of dying — an open/embed/index/delete failure logs a warning and keeps the manifest unchanged so the next session retries it. Manifest entries are only written after the corresponding zvec write succeeded, and only removed after a successful delete; `Event.Unloaded` still fires regardless (it reports the registry, not the index). `matchBySemantics()` returns `[]` when embedding fails rather than killing the system-prompt build. The index dimension comes from `() => embedder.dimension` (a getter — see `search/AGENTS.md` for why), and the index is closed via an `Effect.addFinalizer` in the `zvecIndex` InstanceState closure.

## `<skills>` block ordering differs by mode, intentionally

The system-prompt `<skills>` catalog is rendered at one site (`session/system.ts`
`renderSkills`), but the list order depends on the branch:

- **Fallback** (`skill.available(agent)`) — alphabetical by name (`available()` sorts).
- **Auto-match** (`skill.matchBySemantics(...)`) — relevance/score order from the zvec
  similarity search, capped at `count` (`skill/index.ts:626` breaks at the top-N).

The auto-match order is deliberately NOT re-sorted: it carries the ranking signal (best
match first) that the semantic search produces. `Skill.fmt()` preserves input order in both
cases; sorting lives only in `available()`.

## Loaded skills are excluded from auto-match

`Skill.Service` tracks which skills have been loaded via the `skill` tool in a `loadedSkills` Set. `matchBySemantics()` filters these out so the same skill is not injected both by auto-match and explicit user request. The set is per-instance (in-memory only), so it resets on instance restart.

## EmbeddingService must be captured at layer build time

`matchBySemantics()` uses `EmbeddingService` inside `Effect.fn`, which would add `EmbeddingService` to the Effect's `R` type parameter. To keep the `Interface` methods' `R = never`, the embedder reference is captured at layer build time (`yield* EmbeddingService` in the layer init closure) and closed over by the `Effect.fn` body. This is the same pattern used by `SearchService` in `search/indexer.ts`.

## Invalid skills are registered with `warnings` but hidden from the model

Skills with frontmatter issues (invalid schema, missing description, name/folder mismatch) are still registered in `state.skills` with a `warnings: string[]` field, but `all()` and `available()` filter them out. This lets the `skill` tool load them on demand and surface warnings inline, while keeping the `<skills>` catalog in the system prompt clean.

## `allIncludingInvalid()` exposes the full registry

Debug/validation commands that need to see every skill on disk (including invalid ones) should call `Skill.allIncludingInvalid()`, not `Skill.all()`. The public `all()` intentionally hides invalid skills.

## Skill tool prepends warnings to output

When the model invokes the `skill` tool on a skill that has `warnings`, the tool output starts with:
```
⚠️ Skill "name" has validation issues:
  - <warning text>
```
This gives the LLM immediate feedback about what's wrong, so it can fix the skill or stop using it.

## `skill.warning` bus events are for logging, not TUI toasts

`skill.warning` is emitted for non-critical frontmatter issues, but the TUI no longer shows a toast for it. The event is used by `debug skill validate` and internal logging. If you need to surface a skill problem to the user, do it in the `skill` tool output instead.

## Unsafe skill names are rejected at registration

`isSafeSkillName()` (`skill/index.ts`) gates every registered name — both the frontmatter `name` and the folderName fallback. Blocked: `*`, `?`, `\`, `<`, `>`, `"` and the exact name `__proto__`. Rationale: names become permission patterns (`Wildcard.match` treats `*`/`?` as wildcards and normalizes `\` to `/`, so an unsafe name persisted via permission "always" could match other skills) and are interpolated into XML-style output tags; `__proto__` would pollute the plain-object skills registry on assignment. Behavior: if the folder name is safe, the skill registers under the folder name with a warning; if both are unsafe, the skill is skipped entirely (warning event + log, no registration). `Skill.Service.get()` and `matchBySemantics()` additionally use `Object.hasOwn` lookups so prototype keys can never resolve as skills.
