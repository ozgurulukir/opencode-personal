# Skill

## Skill matching is LLM-driven, not algorithmic

The `skill` tool (`tool/skill.ts`) has no matching logic — it simply loads a skill by name. The LLM decides which skill to load based on the `<skills>` catalog in the system prompt. There is no regex, keyword, or embedding-based matching in the tool itself.

## Auto-match uses zvec, not brute-force

When `skills.autoMatch` is enabled in config, `matchBySemantics()` (`skill/index.ts`) queries a per-instance `ZvecIndex` (HNSW cosine similarity) rather than brute-force comparing against all skill embeddings. The zvec index is populated incrementally at instance init: only skills whose content hash changed since the last manifest are re-embedded and upserted. The manifest lives at `~/.cache/opencode/zvec/skills/{dirHash}_manifest.json`.

## Loaded skills are excluded from auto-match

`Skill.Service` tracks which skills have been loaded via the `skill` tool in a `loadedSkills` Set. `matchBySemantics()` filters these out so the same skill is not injected both by auto-match and explicit user request. The set is per-instance (in-memory only), so it resets on instance restart.

## EmbeddingService must be captured at layer build time

`matchBySemantics()` uses `EmbeddingService` inside `Effect.fn`, which would add `EmbeddingService` to the Effect's `R` type parameter. To keep the `Interface` methods' `R = never`, the embedder reference is captured at layer build time (`yield* EmbeddingService` in the layer init closure) and closed over by the `Effect.fn` body. This is the same pattern used by `SearchService` in `search/indexer.ts`.
