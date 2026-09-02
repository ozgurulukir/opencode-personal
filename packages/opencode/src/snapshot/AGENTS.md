# Snapshot

## `track()` is called on every LLM step

`processor.ts:122` calls `snapshot.track()` before every LLM stream; `processor.ts:500` calls it on `finish-step`. Each `track()` spawns multiple git processes (`diff-files`, `ls-files`, `check-ignore`, `add`, `write-tree`). In large repos this is the primary source of latency between LLM steps.

## `lastHash` cache — skip `write-tree` when nothing changed

`track()` caches the last `write-tree` hash in `state.lastHash`. When `add()` returns 0 (no files changed), `track()` returns `state.lastHash` without spawning `git write-tree`. `lastHash` is invalidated by `restore()` and `revert()` (both set `state.lastHash = undefined`) because they modify the worktree.

## `add()` return value — changed file count

`add()` returns the number of changed files (not void). When all changed files are gitignored, `add()` returns `all.length` (not 0) because `drop()` may have modified the index — `track()` must run `write-tree` to refresh `lastHash`.

## Snapshot gitdir is per-worktree

`gitdir = path.join(Global.Path.data, "snapshot", project.id, Hash.fast(worktree))` — each worktree (branch) gets a separate snapshot git repo. Branch switching creates a new snapshot repo from scratch (`git init` + full `add()`), which is the primary cause of branch-switch freezes in large repos.

## `fs.stat` concurrency

`add()` checks file sizes via `fs.stat` per file with `{ concurrency: 32 }`. The previous value was 8; increasing it helps with repos that have thousands of changed files.
