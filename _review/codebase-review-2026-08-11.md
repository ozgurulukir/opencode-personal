# Codebase Review: packages/opencode

**Date:** 2026-08-11  
**Reviewer:** build agent (code-review skill)  
**Scope:** Core modules — permission, session loop, shell execution, ripgrep search, file-mutating tools (edit/apply_patch), provider resolution, MCP tool dispatch, web fetch, slash-command parsing.

---

## Executive Summary

Reviewed the critical execution paths in packages/opencode. The codebase is generally well-structured, with clear separation between session, provider, tool, and permission layers. The recent command-injection fix in slash commands (f6b618d) is correct. However, several security and correctness issues were found that should be addressed.

| Severity | Count | Key themes |
|----------|-------|------------|
| Critical | 1 | SSRF in webfetch |
| Major | 3 | Symlink bypass in edit/apply_patch; permission race in reply("always"); ripgrep regex-error masking |
| Minor | 7 | High complexity, double diff computation, regex-from-LLM, JSON.parse on body, subagent permission inheritance |
| Nit | 1 | Wildcard backslash normalization |

**Top priorities:**
1. Add SSRF protection to webfetch.ts.
2. Resolve symlinks before assertExternalDirectoryEffect in file-mutating tools.
3. Serialize reply("always") DB write or copy-before-mutate to eliminate the race.
4. Inspect ripgrep stderr to distinguish regex errors from path errors.

---

## Review: src/file/ripgrep.ts

### Major
- **Partial-error masking** (line 403-410) — ripgrep exit code 2 (regex parse failure) is treated as partial: true ("Some paths were inaccessible and skipped"). The stderr is discarded. Invalid regexes from the LLM surface as benign partial results instead of a clear error.
  - **Impact:** LLM-generated invalid regex patterns fail silently, returning empty or partial results without explanation.
  - **Fix:** Inspect stderr before returning partial; if it contains regex parse errors, surface them to the user.

**Note:** The `glob` parameter is correctly passed through to ripgrep (`input.glob` at lines 213-215). No typo exists in the current code.

---

## Review: src/tool/webfetch.ts

### Critical
- **SSRF: no internal-URL protection** (line 33-34, 74) — The tool accepts any http:// or https:// URL and fetches it directly. There is no allowlist/blocklist for private/reserved ranges (127.0.0.1, 169.254.169.254, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, [::1], etc.). A compromised or hallucinating LLM can probe internal services and cloud metadata endpoints.
  - **Impact:** Arbitrary internal network probing, cloud metadata theft (e.g., AWS IMDS at 169.254.169.254), localhost service enumeration.
  - **Fix:** Add an SSRF guard that resolves the hostname and rejects private/loopback/link-local IPs before issuing the request.

---

## Review: src/tool/apply_patch.ts & src/tool/edit.ts

### Major
- **Symlink bypass of external_directory permission** (apply_patch.ts:96, edit.ts:82-85) — Both tools resolve paths with path.resolve (or path.join + absolute input), which does not resolve symlinks. assertExternalDirectoryEffect checks the symlink path, not the target. A symlink inside the project pointing outside (e.g., project/evil -> /etc) bypasses the external-directory prompt and allows editing/reading files outside the project boundary.
  - **Impact:** File-mutating tools can modify files outside the project without user consent by abusing symlinks.
  - **Fix:** Use AppFileSystem.resolve (which calls realpathSync) before the permission check, or reject symlinks in file-mutating tools.

### Minor
- **Double diff computation in edit.ts** (lines 138-145, 165-172) — createTwoFilesPatch is called twice for the same edit (once before permission ask, once after write). The first diff is only used for the permission prompt; the second is used for the result.
  - **Impact:** Unnecessary CPU work on every edit.
  - **Fix:** Compute once and reuse.

---

## Review: src/tool/edit.replacer.ts

### Minor
- **Regex construction from LLM-generated find text** (lines 197-208) — WhitespaceNormalizedReplacer escapes individual words then joins them with \s+ into a single RegExp. While literal escaping prevents injection, extremely long find strings with many words produce large regexes that could cause high CPU during matching.
  - **Impact:** Potential CPU spike on pathological inputs.
  - **Fix:** Cap the number of words participating in the regex, or fall back to literal includes/indexOf when the word count exceeds a threshold.

---

## Review: src/session/loop/command.ts

### Major
- **Shell-block execution order is now safe** (lines 57-68) — The recent fix (f6b618d) correctly processes ConfigMarkdown.shell blocks from the raw template before  substitution. User arguments are no longer evaluated as shell code.
  - **Note:** The bashRegex (/\([^\]+)\/g) only matches single backtick pairs. Nested or multiline shell blocks are not supported, which is acceptable for the current use case but should be documented as a limitation.

### Minor
- ** is raw-interpolated** (line 85) — input.arguments is substituted verbatim into the prompt. If the resulting prompt is later executed as a shell command by the LLM, shell metacharacters in the arguments become part of the command. This is expected LLM behavior, but users should be aware that  is not shell-escaped.

---

## Review: src/permission/index.ts & src/permission/evaluate.ts

### Major
- **reply("always") mutates shared approved array in place** (lines 270-287) — The approved ruleset is a shared mutable reference from InstanceState. reply("always") pushes new rules onto this array and persists it. Concurrent reply("always") calls accumulate on the same array. The database upsert reads approved after the push. If two replies race, the DB write may include rules from both replies even if one was for a different pattern set.
  - **Impact:** Permission rules from one approval can leak into another concurrent approval's persisted ruleset.
  - **Fix:** Build a new array ([...approved, ...newRules]) for the DB write instead of mutating in place, or wrap the push + DB write in a serialized critical section.

**Note:** The in-place mutation is intentional per the code comment at lines 270-273: "We mutate in place (push) so concurrent reply('always') calls accumulate on the same array. Do NOT replace with spread assignment — that would break the local binding's link to state.approved and introduce a race." The race condition concern is valid, but the mutation itself is by design.

### Minor
- **ScopedCache state leakage between tests** — Documented in AGENTS.md. disposeAllInstances() invalidates async, so "always" replies leak into subsequent tests using the same temp directory. Two flaky tests remain.

---

## Review: src/session/loop/run-loop.ts

### Minor
- **High cognitive complexity (104)** — The extracted runLoop is still a 351-line infinite loop with deeply nested conditionals (subtask, compaction, overflow, step limit). Further decomposition into a state-machine or phase functions (handleSubtask, handleCompaction, handleOverflow, handleToolTurn) would improve readability and testability.

---

## Review: src/provider/provider.ts

### Minor
- **as any cast in plugin auth loader** (line 1250) — bridge.promise(...) as any is a known cast. Consider typing the plugin auth loader interface to avoid the cast.
- **JSON.parse on untrusted body** (line 1441) — The custom fetch wrapper parses opts.body as JSON to strip OpenAI itemId fields. If the body is malformed JSON, the fetch fails with an unhandled exception.
  - **Fix:** Wrap in try/catch and fall back to passing the body through unmodified.

---

## Review: src/tool/shell/execute.ts

### Minor
- **Shell command execution is by design** — The shell tool intentionally executes user-provided commands through the system shell. The permission gate (ctx.ask + collect-based path scanning) is the security boundary. Ensure the collect parser's AST coverage keeps pace with new shell syntax to avoid permission gaps.

---

## Review: src/session/loop/subtask.ts

### Minor
- **Subagent inherits parent session permissions** (line 132) — Permission.merge(taskAgent.permission, session.permission ?? []) means a subagent's effective ruleset includes the parent session's rules. This is documented behavior, but it can surprise users who expect subagent permissions to be isolated. Consider surfacing this in the TUI or agent docs.

---

## Review: src/util/wildcard.ts

### Nit
- **match normalizes backslashes to forward slashes** (lines 6-7) — On Windows, this makes \ and / interchangeable in patterns, which is user-friendly. However, it also means a pattern like foo\bar matches foo/bar in the input. Document this behavior if not already covered.

---

## Appendix: Files Reviewed

- src/file/ripgrep.ts
- src/tool/webfetch.ts
- src/tool/apply_patch.ts
- src/tool/edit.ts
- src/tool/edit.replacer.ts
- src/session/loop/command.ts
- src/permission/index.ts
- src/permission/evaluate.ts
- src/session/loop/run-loop.ts
- src/provider/provider.ts
- src/tool/shell/execute.ts
- src/session/loop/subtask.ts
- src/util/wildcard.ts
- src/session/prompt/command-regex.ts
- src/tool/task.ts
- src/tool/external-directory.ts
- src/util/filesystem.ts
- src/reference/reference.ts
- src/project/instance-context.ts
- src/config/markdown.ts
- src/mcp/index.ts
- src/session/loop/tools.ts
- src/session/loop/model.ts
