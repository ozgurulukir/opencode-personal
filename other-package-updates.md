# Other Packages — Minor/Patch Upgrade Report

Scope: minor/patch upgrades only, no major version changes.
Source: npm registry live checks via parallel subagent research.

---

## Executive Summary

Out of ~50 non-AI-SDK dependencies:

- **Already at latest (no action):** 18 packages
- **Safe minor/patch upgrades:** 22 packages
- **Needs review before upgrade:** 5 packages (breaking changes or alpha→stable migration)
- **Out of scope (major version available):** 5 packages

---

## Safe Upgrades (recommended)

### High Impact / Notable Fixes

| Package                  | Current | Latest      | Key Changes                                                                                                                                                                                                   |
| ------------------------ | ------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun-pty`                | 0.4.8   | **0.4.10**  | 0.4.9: Fixed PTY read/write EINTR/EWOULDBLOCK — signal-heavy hosts could cause PTYs to go "deaf", silently dropping input. 0.4.10: Added musl libc support.                                                   |
| `immer`                  | 11.1.4  | **11.1.8**  | 11.1.5: Fixed nested proxies after spread + array insert. 11.1.6: Removed invalid curried producer type. 11.1.7: Improved higher-order type inference. 11.1.8: Fixed current/original typings. All bug fixes. |
| `prettier`               | 3.6.2   | **3.9.3**   | 3.9.0–3.9.3: Liquid syntax fix, decorators on declare class fields, ignored file caching fix.                                                                                                                 |
| `semver`                 | ^7.6.3  | **7.8.5**   | 7.8.0: New `truncate()` function. 7.8.4: Reject numeric segments after x-ranges. 7.8.5: Include prereleases in tilde range lower bound.                                                                       |
| `web-tree-sitter`        | 0.25.10 | **0.26.10** | 10 patch releases of WASM bug fixes in the 0.26.x line.                                                                                                                                                       |
| `tree-sitter-powershell` | 0.25.10 | **0.26.4**  | Minor bump to 0.26.x line.                                                                                                                                                                                    |
| `tree-sitter-bash`       | 0.25.0  | **0.25.1**  | Grammar bugfix.                                                                                                                                                                                               |
| `@zip.js/zip.js`         | 2.7.62  | **2.8.26**  | Minor + 64 patches. Apr 2026 release.                                                                                                                                                                         |

### Standard Patch/Minor Upgrades

| Package                       | Current | Latest     | Key Changes                                                                                |
| ----------------------------- | ------- | ---------- | ------------------------------------------------------------------------------------------ |
| `@octokit/graphql`            | 9.0.2   | **9.0.3**  | Patch only.                                                                                |
| `@solid-primitives/event-bus` | 1.1.2   | **1.1.3**  | Patch only.                                                                                |
| `@solid-primitives/scheduled` | 1.5.2   | **1.5.3**  | Patch only.                                                                                |
| `glob`                        | 13.0.5  | **13.0.6** | Reverted tsgo compiler; updated deps.                                                      |
| `decimal.js`                  | 10.5.0  | **10.6.0** | Added `BigInt` support to TypeScript definitions.                                          |
| `open`                        | 10.1.2  | **10.2.0** | Minor bump.                                                                                |
| `opencode-poe-auth`           | 0.0.1   | **0.0.4**  | 3 patch releases. Early-stage package.                                                     |
| `turndown`                    | 7.2.0   | **7.2.4**  | 4 patch releases.                                                                          |
| `vscode-languageserver-types` | 3.17.5  | **3.18.0** | Minor bump.                                                                                |
| `@standard-schema/spec`       | 1.0.0   | **1.1.0**  | Added `StandardJSONSchemaV1` interface.                                                    |
| `bonjour-service`             | 1.3.0   | **1.4.2**  | Minor + 2 patches.                                                                         |
| `google-auth-library`         | 10.5.0  | **10.9.0** | 4 minor releases: X509 cert auth, Cloud Run Jobs detection, scopes from impersonated JSON. |
| `minimatch`                   | 10.0.3  | **10.2.5** | 2 minor + 2 patches. General maintenance.                                                  |
| `opencode-gitlab-auth`        | 2.0.1   | **2.1.0**  | Minor bump (+ 2.0.2 patch).                                                                |

---

## Needs Review Before Upgrade

| Package                                   | Current       | Latest      | Risk      | Why Review                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ------------- | ----------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@clack/prompts`                          | 1.0.0-alpha.1 | **1.6.0**   | 🔴 High   | Alpha → stable migration. API almost certainly changed. Review [CHANGELOG](https://github.com/bombshell-dev/clack/blob/main/packages/cli/src/lib/prompts/CHANGELOG.md) and test all CLI prompts.                                                                                                                                                     |
| `@agentclientprotocol/sdk`                | 0.21.0        | **0.29.0**  | 🟡 Medium | 8 minor versions of active development (~weekly cadence since Apr 2026). Review v0.22–0.29 changelog. v1.0.0 also exists.                                                                                                                                                                                                                            |
| `@opentelemetry/exporter-trace-otlp-http` | 0.214.0       | **0.219.0** | 🟡 Medium | **Breaking changes:** `OTEL_CONFIG_FILE` replaces `OTEL_EXPERIMENTAL_CONFIG_FILE`; `scopeAttributes` → `attributes`; `LogRecordExporter` now requires `forceFlush()`; `null` values no longer stripped from config. Review [CHANGELOG](https://github.com/open-telemetry/opentelemetry-js/blob/main/packages/exporter-trace-otlp-http/CHANGELOG.md). |
| `@opentelemetry/sdk-trace-base`           | 2.6.1         | **2.8.0**   | 🟡 Medium | **Breaking behavior change** (2.7.1): `TraceState` parsing — most-recent key wins when duplicates present. Safe if you don't manipulate `TraceState` directly.                                                                                                                                                                                       |
| `@opentelemetry/sdk-trace-node`           | 2.6.1         | **2.8.0**   | 🟡 Medium | Same `TraceState` behavior change as sdk-trace-base.                                                                                                                                                                                                                                                                                                 |

---

## Already at Latest (no action needed)

| Package                        | Version          |
| ------------------------------ | ---------------- |
| `@actions/core`                | 1.11.1           |
| `@actions/github`              | 6.0.1            |
| `@gitlab/opencode-gitlab-auth` | 1.3.3 (upgraded) |
| `@octokit/webhooks-types`      | 7.6.1            |
| `@silvia-odwyer/photon-node`   | 0.3.4            |
| `chokidar`                     | 4.0.3            |
| `cli-sound`                    | 1.1.3            |
| `clipboardy`                   | 4.0.0            |
| `fuzzysort`                    | 3.1.0            |
| `gray-matter`                  | 4.0.3            |
| `ignore`                       | 7.0.5            |
| `jsonc-parser`                 | 3.3.1            |
| `mime-types`                   | 3.0.2            |
| `npm-package-arg`              | 13.0.2           |
| `partial-json`                 | 0.1.7            |
| `strip-ansi`                   | 7.1.2            |
| `vscode-jsonrpc`               | 8.2.1            |
| `which`                        | 6.0.1            |
| `why-is-node-running`          | 3.2.2            |
| `xdg-basedir`                  | 5.1.0            |
| `yargs`                        | 18.0.0           |

---

## Out of Scope (major version available)

| Package                    | Current       | New Major | Note                         |
| -------------------------- | ------------- | --------- | ---------------------------- |
| `@actions/core`            | 1.11.1        | **3.x**   | v2 was skipped entirely      |
| `@actions/github`          | 6.0.1         | **9.x**   |                              |
| `@babel/core`              | 7.28.4        | **8.0.1** | Released Jun 2026            |
| `@agentclientprotocol/sdk` | 0.21.0        | **1.x**   |                              |
| `@clack/prompts`           | 1.0.0-alpha.1 | —         | Stable is same major (1.6.0) |

---

## Recommended Upgrade Order

1. **`bun-pty` 0.4.8 → 0.4.10** — fixes real PTY "deaf" bug that affects interactive sessions
2. **`immer` 11.1.4 → 11.1.8** — type inference bug fixes
3. **`prettier` 3.6.2 → 3.9.3** — formatting fixes
4. **`semver` 7.6.3 → 7.8.5** — already allowed by `^` range, safe
5. **`web-tree-sitter` 0.25.10 → 0.26.10`** — WASM fixes
6. **`tree-sitter-powershell` + `tree-sitter-bash`** — grammar updates (keep in sync with web-tree-sitter)
7. Remaining safe upgrades (patch-level, low risk)
8. **`@clack/prompts`** — review changelog for API changes before upgrading
9. Skip OTel packages unless you specifically need the new features and can handle the breaking changes
