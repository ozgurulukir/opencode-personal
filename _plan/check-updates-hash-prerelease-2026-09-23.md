# Plan: `script/check-updates.ts` — hash-aware prerelease ordering (drizzle downgrade fix)

**Date:** 2026-09-23
**Status:** ✅ EXECUTED (2026-09-23) — landed in `0cb59f1` (hash-aware prerelease ordering in `comparePrerelease`); rev 2 (follow-up to [check-updates-hardening](./check-updates-hardening-2026-09-23.md), landed in `c25068d`) fixed @review findings: executable control fixtures, invariant note, test count, proof prose.
**Provenance:** Follow-up plan. Trigger: the hardened script reports a bogus downgrade `drizzle-orm`/`drizzle-kit` `1.0.0-beta.19-d95b7a4 → 1.0.0-beta.9-e89174b`. Cause verified against the tree (not re-litigated here): the comparator is semver-CORRECT; the version scheme is not. In `1.0.0-beta.19-d95b7a4` the second identifier `19-d95b7a4` is ALPHANUMERIC (contains `-` + letters), so per semver §11.4 it outranks any numeric identifier — hence `9-e89174b` beats both `19-d95b7a4` and clean `beta.22`/`beta.24`. npm publish times confirm the true newest is `1.0.0-beta.24` (`beta.9-e89174b` 2026-01-06, `beta.19-d95b7a4` 2026-03-18, `beta.22` 2026-04-16, `beta.24` 2026-04-30). The narrow fix is a deliberate heuristic deviation from strict semver inside `comparePrerelease` only.

---

## Goal

Make prerelease ordering hash-aware so commit-hash-suffixed numeric segments (`beta.<N>-<hex>`) order by `<N>`, fixing the drizzle bogus downgrade: the report becomes `1.0.0-beta.19-d95b7a4 → 1.0.0-beta.24` (or no row if already newest). Change touches **only** `script/check-updates.ts` and `script/check-updates.test.ts`. No new flags, no dependency versions change, no behavior change beyond prerelease ordering.

## Scope

**IN —**
- Normalize the hash-suffixed prerelease identifier inside `comparePrerelease` (the ordering primitive), per A1.
- New test cases locking the drizzle fix, the tie-break, and the no-regression controls, in `script/check-updates.test.ts`.

**OUT — `sameChannelVersion` channel/base filtering: unchanged.** Channel = `prerelease.split(".")[0]` (`beta` for both `beta.19-d95b7a4` and `beta.24`) and the same major.minor.patch base rule already select the right candidate set; the bug is purely in within-channel ordering.

**OUT — `isPinned` / `parseSemver`: unchanged.** Both already handle hyphenated prereleases (`isPinned` regex `script/check-updates.ts:116`, `parseSemver` capture `:133` — char class `[0-9A-Za-z.-]` includes `-`).

**OUT — `compareParsed` / `sameChannelVersion` exports: unchanged.** Testing through the exported `sameChannelVersion` is sufficient; `comparePrerelease` stays private (see A1 placement).

**OUT — index maintenance in this diff (deferred):** adding a `_plan/index.md` row for this plan and flipping the stale hardening row (index `:47` says ⬜ PENDING, but `c25068d` landed → should be ✅ EXECUTED) both happen at execution time, together with the code commit. Rationale: the index row's Notes cell should cite the landing commit; writing it before the fix exists would be immediately stale. Flagged in Deliberately deferred.

## Verified anchors (all re-verified against the tree, 2026-09-24)

All in `script/check-updates.ts` (497 lines) unless noted:

- `comparePrerelease(a, b)` — `:138-159`. NOT exported. Splits on `.`; both-numeric → numeric compare (`:149-152`); one-numeric → numeric < alphanumeric (`:154-155`); both non-numeric → lexical (`:156`); missing identifier → shorter sorts lower (`:145-146`). **This is the sole function modified.**
- `compareParsed(a, b)` — `:161-169`. NOT exported. Delegates prerelease comparison to `comparePrerelease` (`:168`); untouched.
- `sameChannelVersion(current, candidates)` — `:178-191`. Exported. Channel = first prerelease dot-segment (`:179`); same major.minor.patch base + same channel filter (`:184-185`); strict-newer filter via `compareParsed > 0` (`:188`); `reduce` max (`:190`); `null` when nothing strictly newer (`:189`). Non-null is the sole emission signal (caller `:411-412`). **Untouched — the fix flows through it via `comparePrerelease`.**
- `isPinned(version)` — `:115-117`; regex `^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$` — already matches `1.0.0-beta.19-d95b7a4`.
- `parseSemver(v)` — `:132-136`; prerelease capture `[0-9A-Za-z.-]+` — already parses the full `19-d95b7a4` identifier into one string.
- Test file `script/check-updates.test.ts` (256 lines): imports exported fns from `./check-updates` (`:3-11`); `describe("sameChannelVersion")` block at `:53-84` — new ordering tests extend this block.
- `script/bunfig.toml` = `[test] root = "."` (exists from the hardening; enables `cd script; bun test check-updates.test.ts`).

## Architecture decisions

### A1 — Normalization rule: EXPAND `N-hex` into two identifiers, inside `comparePrerelease`

**The version scheme is non-conformant, not the comparator.** `1.0.0-beta.19-d95b7a4` abuses semver by embedding a commit hash inside a dot-delimited numeric position; the author's intent is clearly "build 19, hash d95b7a4". Strict semver ranks alphanumeric identifiers above numeric ones, which inverts the intended order. Because the scheme itself deviates from semver, a narrow, well-documented heuristic deviation inside the ordering primitive is the correct response — not a rewrite of the comparator.

**Rule:** before kind-detection, each identifier matching `^\d+-[0-9a-f]{7,}$` (case-insensitive hex, i.e. `/i`) is split at the FIRST `-` into two identifiers: the numeric part, then the hash. So `19-d95b7a4` → `["19", "d95b7a4"]`, `9-e89174b` → `["9", "e89174b"]`. A plain numeric (`24`, `19`) or a plain alphanumeric (`dev`, `fix`) is left as-is.

- **Case-sensitivity:** hash suffix matched case-insensitively (`[0-9a-f]` + `i` flag) — npm publishes both casings; comparison of two hash strings remains plain lexical (deterministic regardless of case; equal hashes from different casings of the same commit is not a real-world case worth normalizing further).
- **Leading part must be fully numeric** (`\d+` before the `-`): identifiers like `1-fix` or a bare `1` do NOT match (see controls). Rationale: real hash-suffixed builds on npm (drizzle, and the `N-hex` convention generally) are `buildNumber-hash`; requiring an all-digit prefix keeps the heuristic tight.
- **Minimum hash length 7** (short-git-SHA convention): `9-abc` is NOT matched — a short alphanumeric tail could be a legitimate semver identifier (e.g. `1.0.0-beta.2-x64`-style metadata would be mis-split). 7+ hex chars is unambiguous.
- **Why expansion, not strip-only:** `strip-only` (`19-d95b7a4` → `19`) makes `1.0.0-beta.19` and `1.0.0-beta.19-d95b7a4` compare EQUAL — both normalize to `["beta", "19"]`, and the fewer-identifiers rule (`:145-146`) cannot separate them (identical arrays). npm publishes BOTH `1.0.0-beta.19` and `1.0.0-beta.19-d95b7a4`; under strip-only, `sameChannelVersion(parsed("1.0.0-beta.19"), ["1.0.0-beta.19-d95b7a4"])` returns `null` (equal, not strictly newer), silently ignoring a real in-channel release. Expansion yields `["beta", "19"]` vs `["beta", "19", "d95b7a4"]` → the shorter array sorts lower → `beta.19 < beta.19-d95b7a4`, matching semver's own "larger set of fields has higher precedence when all preceding identifiers are equal" rule (§11.4.4). **Decision: EXPANSION.**
- **Placement:** inside `comparePrerelease` only — it is the ordering primitive used by `compareParsed` → `sameChannelVersion`, so one localized change fixes the chain end-to-end. `sameChannelVersion`'s channel/base logic is untouched (channel `beta` is unaffected by identifier #2's shape). `comparePrerelease` stays non-exported; tests exercise it via the exported `sameChannelVersion` (minimal — per the brief, "a normalizer helper may be exported for direct tests, or test only via `sameChannelVersion` (minimal is fine)"). If the implementation prefers a tiny named helper for readability, it may live adjacent to `comparePrerelease` but need not be exported.

**Mechanically:** in `comparePrerelease`, replace the plain `a.split(".")` / `b.split(".")` with `normalizePrereleaseIdentifiers(s)` = `s.split(".").flatMap((id) => (hashSuffixed.test(id) ? [id.slice(0, id.indexOf("-")), id.slice(id.indexOf("-") + 1)] : [id]))`. The existing loop body (`:142-157`) is unchanged: it already implements numeric-numeric, numeric<alnum, and lexical comparison over the (now longer) arrays, and its missing-identifier rule handles the length difference introduced by expansion.

**Total-order proof (the `reduce` max is deterministic):** after normalization, comparing two prerelease strings is a lexicographic comparison of identifier arrays over a per-identifier total order: tag every identifier as (0, numericValue) or (1, string) — numeric < alphanumeric encodes as tag 0 < tag 1, and within each tag the order is the standard total order on ℚ/strings. Lexicographic extension of a total order over finite sequences is a total order; padding the shorter array with a bottom (−∞) sentinel (the existing "missing identifier sorts lower" rule) preserves transitivity (it is exactly lexicographic order over an alphabet extended with a least element). Therefore for any candidate set, `compareParsed` induces a strict total preorder on the channel, the strict-newer filter (`:188`) and `reduce` max (`:190`) pick a unique maximum, and `sameChannelVersion` remains deterministic. Concretely, the drizzle chain orders `beta.9-e89174b` < `beta.19-d95b7a4` < `beta.22` < `beta.24`, each pair decided by the numeric comparison of its leading numeric segments: `9 < 19 < 22 < 24` (for the hash-suffixed forms the hash is the trailing expanded identifier and never overrides the numeric decision). All four now sort in publish-time order.

## Step-by-step execution

### Step 1 — Normalizer in `comparePrerelease` (`script/check-updates.ts`)

1. Add a module-level constant next to the prerelease helpers: `const HASH_SUFFIXED = /^\d+-[0-9a-f]{7,}$/i`.
2. Add a small private helper `normalizePrereleaseIdentifiers(prerelease: string): string[]` = split on `.`, `flatMap` the expansion rule above (expand only the FIRST `-` of a matching identifier; non-matching identifiers pass through).
3. In `comparePrerelease` (`:139-141`), replace `a.split(".")` / `b.split(".")` with calls to the helper. **No other line of `comparePrerelease`, `compareParsed`, or `sameChannelVersion` changes.**
4. Add one JSDoc line on `comparePrerelease` documenting the deliberate deviation: hash-suffixed numeric identifiers (`19-d95b7a4`) are expanded so they order numerically by build number, deviating from strict semver for this non-conformant version scheme.

### Step 2 — Test cases in `script/check-updates.test.ts`

**Invariant for every control fixture:** each must share BOTH the major.minor.patch base AND the first prerelease segment (channel) with the current pin — `sameChannelVersion` filters on both before any identifier comparison runs, so a fixture differing in either returns `null` regardless of ordering and is not an executable assertion.

Extend `describe("sameChannelVersion")` (`:53-84`) with:

1. **Drizzle ascending chain (the fix):** `sameChannelVersion(parsed("1.0.0-beta.19-d95b7a4"), ["1.0.0-beta.9-e89174b", "1.0.0-beta.19-d95b7a4", "1.0.0-beta.22", "1.0.0-beta.24"])` → `"1.0.0-beta.24"`; and the pairwise form `sameChannelVersion(parsed("1.0.0-beta.9-e89174b"), ["1.0.0-beta.19-d95b7a4"])` → `"1.0.0-beta.19-d95b7a4"`.
2. **Tie-break:** `sameChannelVersion(parsed("1.0.0-beta.19"), ["1.0.0-beta.19-d95b7a4"])` → `"1.0.0-beta.19-d95b7a4"` (expansion, not equality/strip).
3. **No-regression — numeric, not lexical (three chains):** `beta.9` → `beta.10` (already exists at `:77-79`, keep); add `sameChannelVersion(parsed("4.0.0-beta.65"), ["4.0.0-beta.107"])` → `"4.0.0-beta.107"`; and a hash-suffixed numeric chain `sameChannelVersion(parsed("1.0.0-beta.9-e89174b"), ["1.0.0-beta.10-abcdef1", "1.0.0-beta.24"])` → `"1.0.0-beta.24"` (10 > 9 despite `10-abcdef1` containing a hash; 24 > 10).
4. **Semver-standard controls:** numeric < alphanumeric within one channel: `sameChannelVersion(parsed("1.0.0-beta.1"), ["1.0.0-beta.a"])` → `"1.0.0-beta.a"` (non-hash numeric < alphanumeric still holds); `sameChannelVersion(parsed("1.0.0-alpha"), ["1.0.0-alpha.1"])` → `"1.0.0-alpha.1"` (missing identifier sorts lower). Note: `alpha` vs `beta` is cross-channel and returns `null` through `sameChannelVersion` — it is NOT a usable ordering control here.
5. **Short-hash / non-hex controls:** `sameChannelVersion(parsed("1.0.0-beta.10"), ["1.0.0-beta.9-deadbe"])` → `"1.0.0-beta.9-deadbe"` (6 hex chars ⇒ `9-deadbe` is NOT expanded ⇒ it stays one alphanumeric identifier, which outranks numeric `10`; if wrongly expanded it would order `9 < 10` and return `null` — a sharp discriminator for the 7-char minimum); `sameChannelVersion(parsed("1.0.0-beta.2"), ["1.0.0-beta.10-abc"])` → `"1.0.0-beta.10-abc"` (3-char tail, not expanded, but still lexically above numeric `2` — locks that short tails behave as plain alphanumerics). Rationale note: `f` IS a hex character, so `1-fix` fails the pattern because of `i`/`x` (non-hex) and the 7-char minimum; `1-abc`/`1-abcd` fail on length only.
6. **Pierre unaffected:** `sameChannelVersion(parsed("1.1.0-beta.18"), ["1.1.0-beta.22"])` → `"1.1.0-beta.22"` (plain numeric chain; explicitly the `@pierre/diffs` real-world case).

Style: no semicolons, 120 printWidth, no `any`, functional array methods; no mocks, no network.

### Step 3 — `_plan/index.md` maintenance (at execution time, with the code commit)

1. Add one row after `:47`:
   `| [check-updates-hash-prerelease](./check-updates-hash-prerelease-2026-09-23.md) | 2026-09-23 | Hash-aware prerelease ordering (drizzle downgrade fix) | ⬜ PENDING | — |`
   (flip to ✅ EXECUTED + commit SHA in the same edit that lands the code).
2. Update the stale hardening row (`:47`): ⬜ PENDING → ✅ EXECUTED with Notes `c25068d` — the index is authoritative on status and currently contradicts git history.

## Verification plan

**(a) Unit tests — exact invocation:**

```powershell
cd script; bun test check-updates.test.ts
```

All existing 23 tests plus the new cases must pass (`bun test` currently reports `23 pass, 0 fail, 41 expect() calls`). Explicit new-case checklist: drizzle ascending chain (test 1), `beta.19` vs `beta.19-d95b7a4` tie-break (test 2), three numeric chains no-regression (test 3), semver-standard controls `beta.1 < beta.a` and `alpha < alpha.1` (test 4), short-hash/non-hex controls (test 5), `@pierre/diffs` chain (test 6).

**(b) Report-only dry-run (safe, zero writes — never `--apply`):**

```powershell
bun run script/check-updates.ts
```

Expected: the drizzle line reads `drizzle-orm: 1.0.0-beta.19-d95b7a4 → 1.0.0-beta.24` (and the analogous `drizzle-kit` line) — or the dep is absent from the report if the catalog already sits at the newest in-channel version; either way the bogus `→ 1.0.0-beta.9-e89174b` downgrade must be GONE. No other dep's reported direction may flip (spot-check `effect` still reports upward, `@pierre/diffs` unchanged).

**(c) Negative control:**

```powershell
git status
```

Must show exactly `script/check-updates.ts` and `script/check-updates.test.ts` modified (plus `_plan/` docs in the eventual commit) — zero modified `package.json` files anywhere.

**(d) Typecheck note:** `script/` is outside every package typecheck graph (accepted gap, unchanged from the hardening plan — Verification 2 there). `bun run lint` (oxlint covers `script/`) as the static check.

## Risks

- **Heuristic mis-classification:** a real semver prerelease identifier that happens to match `\d+-[0-9a-f]{7,}` (e.g. `1.0.0-20260101-deadbee`-style date-hash) would be split and ordered by `20260101` numerically. Worst case is a different-but-deterministic within-channel order for exotic schemes; the same-channel/base filters bound the blast radius to "a different max in one channel", never a cross-channel or cross-base jump. Accepted: the drizzle-class scheme is common, the date-hash shape is not.
- **Expansion changes existing comparisons:** any channel where a hash-suffixed identifier previously ranked ABOVE clean numeric identifiers now ranks below the larger numbers — that inversion is exactly the intended fix, but it can flip a previously-reported row (e.g. the current bogus downgrade disappears). Locked by tests 1 and 6.
- **Total-order regression:** if the normalizer were applied asymmetrically (only one side) the comparison would be inconsistent — the implementation must normalize BOTH arrays before the loop (the helper-per-side structure guarantees this).

## Open questions

- None blocking. The tie-break (A1 expansion vs strip-only) is resolved in-plan: expansion, for the §11.4.4-conformance and strict-newer reasons stated.

## Deliberately deferred (with reasons)

- **`_plan/index.md` row + hardening status refresh (Step 3):** performed at execution time together with the code commit, so the Notes cell can cite the real landing SHA. Not done in this planning action (single-file constraint).
- **Exporting `comparePrerelease`/`normalizePrereleaseIdentifiers` for direct unit tests:** rejected as unnecessary surface; `sameChannelVersion` is the exported behavioral contract and exercises the full chain.
- **General "commit-hash metadata" handling beyond `\d+-hex`** (e.g. `+build` metadata, `1.0.0-beta.abcd123` bare-hash identifiers): no real-world instance in this repo's dependency set; extend when one appears.
- **Teaching `sameChannelVersion` about cross-base hash builds:** the same-base restriction (hardening A1) stays; a `4.0.1-beta.1-hex` after a `4.0.0-beta.65` pin remains a human decision.
