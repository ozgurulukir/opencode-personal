# Plan: Fork-owned Binary Releases via GitHub Releases + Installers (opencode-personal coexistence edition)

Date: 2026-09-29 (rev 2 — in-place revision after review rejection; same-day)
Scope: user-approved option **A** — release workflow + installer scripts + README/docs update. No upstream workflow changes. **No app source-code change** (installer-only isolation).

## Revision summary

**Rev 1 (coexistence rework):** channel `latest` → `personal`; command `opencode` → `opencode-personal` in `~/.opencode-personal/bin`; asset names keep upstream `opencode-<target>.*` (installer-side rename); non-interference installers; hermetic isolation tests; README/docs updates.

**Rev 2 (review fixes, this revision):**
1. **CRITICAL fixed — `verify-isolation.ps1` PATH assertion was impossible to pass** (post-install PATH was read *after* `finally` had restored it → `isolation-test-windows` always failed → `release` unpublishable). Now: post-install PATH is snapshotted **inside `try`, immediately after the installer returns, before `finally`**; `finally` only restores; assertions use the snapshot. The test now also runs safely on machines that already have an upstream install (real profile never touched — see 3).
2. **MAJOR fixed — `install.sh` Windows combo removed.** The whitelist no longer admits `windows-x64`: the windows archive carries `opencode.exe`, which the extract→rename→chmod path cannot handle under `set -euo pipefail` on MINGW/MSYS. Windows users are redirected to `install.ps1`. The limitation note now states the real gap (previously it misleadingly cited `windows-arm64`, which was already excluded).
3. **Minors:** PowerShell isolation test made filesystem-hermetic (child `pwsh` with `USERPROFILE`/`HOME`/`HOMEDRIVE`/`HOMEPATH` overridden to a temp profile; the one non-redirectable surface — the registry-backed user PATH — is explicitly documented as a temporarily-accepted real mutation with all cleanup in `finally`); bash verification extended to the **archive path** (extract → rename → copy-all incl. native lib) via a curl shim + local `.tar.gz`, still no network; `Script.preview` claim corrected (also `Script.channel` at 4 more anchors; the accurate statement is "none of these publish scripts are invoked by `bun run build`"); smoke-test set stated precisely (**two** targets: `linux-x64` and `linux-x64-baseline`); `on.push.tags` mirror-safety addressed via a mandated fork-version suffix `-p.N` (tighter trigger `v*-p.*` **and** an explicit version assertion).
4. **Nits:** fork-appropriate example versions (`1.14.48-p.1`); README notes the Windows install dir and that `install.ps1` has no PATH-skip flag.

---

## Goal

Distribute prebuilt standalone binaries from `ozgurulukir/opencode-personal` as GitHub Release assets, with fork-owned install scripts (bash + PowerShell) and README/docs that document them — installed as a **distinct command `opencode-personal`** in a **distinct directory `~/.opencode-personal/bin`**, running under build-time channel **`personal`**.

**Hard requirement:** installing/running this fork must NOT affect a system that already has upstream `opencode` — not the binary, not PATH, not rc files, not the DB. Today the fork has no release pipeline: upstream's `.github/workflows/publish.yml` no-ops here (every job guarded `if: github.repository == 'anomalyco/opencode'` at `publish.yml:36,73,117`) and uses paid `blacksmith-*` runners. `README.md:38` currently states the fork "does not publish its own prebuilt release packages" (same stale claim at `packages/web/src/content/docs/index.mdx:32` + Turkish mirror).

---

## Coexistence contract (the precise guarantee)

Installing or running the fork on a system that already has upstream `opencode`:

| Surface | Guarantee | Mechanism |
| --- | --- | --- |
| Upstream binary `~/.opencode/bin/opencode`, `~/.local/bin/opencode`, npm-installed `opencode` | **Never read, written, moved, or deleted** | Fork installs only into `~/.opencode-personal/bin` as `opencode-personal`; version probe uses the absolute fork path only |
| Shell rc files (`.bashrc`/`.zshrc`/…) | **Append-only**: exactly one marker line `# opencode-personal` + one `export PATH=…/.opencode-personal/bin:$PATH` line; existing lines byte-preserved; never removes/edits/reorders anything | `add_to_path` with distinct marker; dedupe keyed on the fork's own command line |
| Windows user PATH | **Append-only**: gains exactly `%USERPROFILE%\.opencode-personal\bin`, loses nothing | `[Environment]::SetEnvironmentVariable` with before/after entry diff |
| Session DB | **Separate file**: fork uses `opencode-personal.db`, upstream keeps `opencode.db` | Build-time channel `personal` → `getChannelPath()` sanitizer (`db.ts:30-35`) |
| Experimental flags | **Identical to `latest`**: `personal` ∉ `UNSTABLE_CHANNELS` ⇒ unstable features stay opt-in | `flag.ts:16-19` |
| Release assets | Upstream asset names untouched; no upstream release is ever written to | `GH_REPO` points at the fork; upload gated on `Script.release` |
| Config, cache, log, state, tmp dirs | **Intentionally shared** (installer-only scope) — see Risks for the residual list | `core/global.ts:9-14` (`app = "opencode"`) |

**Not covered by the guarantee (user-managed env):** if the user exports `OPENCODE_DISABLE_CHANNEL_DB` (truthy) or `OPENCODE_DB`, the fork may use the shared DB — documented, not fixed in app source (out of scope).

---

## Verified evidence base (file:line)

| Claim | Evidence |
| --- | --- |
| Channel chain: `OPENCODE_CHANNEL=personal` env → `Script.channel` (explicit env wins) → baked `define` → `InstallationChannel` | `packages/script/src/index.ts:26-31` → `packages/opencode/script/build.ts:380` → `packages/core/src/installation/version.ts:6-8` |
| DB separation: `getChannelPath()` returns `Global.Path.data/opencode.db` ONLY when channel ∈ `{latest,beta,prod}` **or** `Flag.OPENCODE_DISABLE_CHANNEL_DB` truthy; otherwise `opencode-<safe>.db` with `safe = channel.replace(/[^a-zA-Z0-9._-]/g, "-")`. **`personal` passes the sanitizer ⇒ `opencode-personal.db`** | `packages/opencode/src/storage/db.ts:30-35` |
| `personal` ∉ `UNSTABLE_CHANNELS = {dev,beta,local}` ⇒ `unstableDefault()` behaves exactly as for `latest` (experimental features stay opt-in) | `packages/core/src/flag/flag.ts:16-19` |
| `Flag.OPENCODE_DISABLE_CHANNEL_DB` default falsy — nothing forces the shared DB | `flag.ts:90` |
| Release/upload path is channel-independent: archive+`gh release upload v${Script.version} … --repo ${GH_REPO}` gated on `Script.release` = `!!OPENCODE_RELEASE` | `build.ts:426-435`; `script/index.ts:70-72` |
| Channel surfaces in publish scripts (corrected rev 2): `Script.preview` at `packages/opencode/script/publish.ts:70` (docker-push gate); `Script.channel` at `packages/opencode/script/publish.ts:23,66`, `packages/plugin/script/publish.ts:34`, `packages/sdk/js/script/publish.ts:41` (npm dist-tag / docker tag). **None of these publish scripts are invoked by `bun run build`** — they are separate, manually/upstream-CI-run scripts — so the release/upload path is unaffected by channel `personal` | grep sweep, verified rev 2 |
| `OPENCODE_VERSION` set ⇒ no npm `opencode-ai/latest` fetch | `script/index.ts:34-35` |
| Shared dirs by design: `app = "opencode"` ⇒ `data`, `cache`, `config`, `state`, `tmp` all under `…/opencode`; `bin = cache/bin`; `log = data/log` | `packages/core/src/global.ts:9-14,21-22` |
| 12 build targets, exact list | `packages/opencode/script/build.ts:114-175` |
| Asset name = `opencode-<os>-<arch>[-baseline][-musl]` (baseline **before** musl), from `pkg.name = "opencode"` | `build.ts:334-343`; `packages/opencode/package.json` |
| Outfile hardcoded `dist/${name}/bin/opencode` (no extension in the string; Bun compile appends `.exe` for windows targets — **assumption, verified at first release**) | `build.ts:365` |
| Archive = contents of `dist/<name>/bin/` at **top level** (`tar -czf … *` / `zip -r … *` with cwd = the bin dir) ⇒ binary + native lib only (`package.json` is written one level up at `build.ts:411`; `tui/` removed pre-archive at `build.ts:398`) | `build.ts:426-433` |
| Native lib names: `libopentui.so` (linux) / `libopentui.dylib` (darwin) / `opentui.dll` (win32), copied next to the binary as the runtime dlopen fallback | `build.ts:400-409` (libExt at `:403-405`) |
| **Renaming the binary at install time is runtime-safe** — channel/DB/data-dir are build-time baked (`OPENCODE_CHANNEL` define), not derived from the binary name | `packages/opencode/AGENTS.md` → "Local build & install" |
| Smoke test runs for **two** targets on an ubuntu-x64 runner, not one: `item.os===process.platform && item.arch===process.arch && !item.abi` matches `linux-x64` **and** `linux-x64-baseline` (both carry no `abi`); the musl variants carry `abi: "musl"` and are excluded | `build.ts:386-396` (condition at `:386`, verified rev 2) |
| `build.ts` runs diff-wasm `build:wasm` (rust + wasm-pack needed) | `build.ts:105-107`; `packages/diff-wasm/package.json:13` |
| `build.ts` installs all-platform native deps unless `--skip-install` | `build.ts:216-219` |
| Env vars: `OPENCODE_CHANNEL`, `OPENCODE_BUMP`, `OPENCODE_VERSION`, `OPENCODE_RELEASE` | `packages/script/src/index.ts:20-25` |
| `@opencode-ai/script` unconditionally reads `.github/TEAM_MEMBERS` (exists in fork) | `index.ts:51-58` |
| Upstream `build-cli` cross-compiles windows targets on ubuntu ⇒ Linux-runner cross-compile proven | `publish.yml:70-108` |
| Windows signing = separate paid-runner job — out of scope | `publish.yml:112-202` |
| Root installer anchors: `APP=opencode` `:3`; `INSTALL_DIR=$HOME/.opencode/bin` `:68-69`; combo whitelist `:104` (admits `windows-x64` — removed in the fork, rev 2); AVX2 `IsProcessorFeaturePresent(40)` `:146-152`; target order `-baseline` then `-musl` `:160-168`; `filename="$APP-$target$archive_ext"` `:168`; `anomalyco/opencode` URLs `:184,185,194,198,201`; `check_version()` probes `command -v opencode`/`which opencode`/bare `opencode --version` `:221-235`; tmp dir `opencode_install_$$` `:278,:329`; `mv "$tmp_dir/opencode"` (drops native lib) `:343`; `install_from_binary` writes `${INSTALL_DIR}/opencode` `:350`; dedupe `grep -Fxq "$command"` `:366`; rc marker `# opencode` `:369` | root `install` |
| Nix fileset references `../install` — root `install` stays **byte-untouched**; **adding** new root files is safe (explicit union) | `nix/node_modules.nix:27-36` (`:33`) |
| README statement to replace | `README.md:36-47` (claim at `:38`) |
| Docs-site claim to replace + Turkish mirror (both verified) | `packages/web/src/content/docs/index.mdx:32`; `packages/web/src/content/docs/tr/index.mdx:32` |
| Docs translation rule: English page + `tr/` mirror change together; prose translated, code blocks byte-identical | `packages/web/AGENTS.md` |
| Existing workflows to avoid colliding with: `release-github-action.yml`, `publish-github-action.yml`; no `release-binaries.yml` yet | `.github/workflows/` listing |
| Fork-owned reusable setup action: bun from `packageManager` (1.3.14) + install + cache | `.github/actions/setup-bun/action.yml` |
| No auto-update command exists that would fetch upstream binaries; hardcoded `anomalyco` strings live only in prompts/tips/github-action templates (not install/run-affecting) | grep sweep (prior plan pass) |
| Tag-mirror exposure (rev 2): the fork tracks upstream; a branch/tag sync could push upstream tags (plain semver, e.g. `v1.14.48`). Upstream uses no `-p.` suffixes (tags are `v<semver>` / `v<semver>-alpha.N` / `-beta.N` / `-rc.N`) | upstream tag convention; mitigation designed in D1 |

---

## Architecture Decisions

### D1 — Trigger: fork-convention tag push + `workflow_dispatch` (REVISED rev 2 — mirror safety)
- **Fork-version convention (mandated):** every fork release version is semver with a required `-p.N` suffix — e.g. `1.14.48-p.1`, `0.1.0-p.1`. The base number stays a user decision (Open Question 1); the suffix is not negotiable.
- **Why:** the fork tracks upstream, so a branch/tag sync could push mirrored upstream tags. Two independent defenses:
  1. **Tighter trigger:** `on.push.tags: ["v*-p.*"]` — mirrored upstream tags (`v1.14.48`, `v1.0.0-alpha.5`) cannot match, so a tag sync can never mint a fork release.
  2. **Explicit assertion:** the `Resolve version` step validates the semver + `-p.N` shape and fails fast with a clear error before any release is created (second line of defense, also covers `workflow_dispatch` input).
- **Residual:** if upstream ever adopts `-p.` suffixes itself, the trigger must be revisited (recorded in Risks).
- `workflow_dispatch` remains for test releases and re-runs; on dispatch, `gh release create --target $GITHUB_SHA` creates the missing tag. Upstream-style branch-push channels (`ci`/`dev`/`beta`) rejected — unnecessary, and `beta`/`dev` would also flip `UNSTABLE_CHANNELS` behavior.

### D2 — Runner: single `ubuntu-latest` job, all 12 targets cross-compiled
- **Why:** upstream's `build-cli` produces `opencode-windows*` on ubuntu (`publish.yml:70-108`); Bun `--compile` cross-targeting is proven. No Windows runner needed for the build (signing out of scope; the zips are final).
- **Trade-off (precise, rev 2):** the automated smoke test (`build.ts:386-396`) covers exactly **two** targets on this runner — `linux-x64` and `linux-x64-baseline` (the condition `item.os===process.platform && item.arch===process.arch && !item.abi` matches both glibc x64 variants; musl carries `abi` and is excluded). darwin/windows/arm64/musl binaries are verified manually after the first release.

### D3 — Channel `personal`, version explicit
- Workflow sets `OPENCODE_VERSION=<semver>-p.N` (never `0.0.0-*`), **`OPENCODE_CHANNEL=personal`**, `OPENCODE_RELEASE=1`, `GH_REPO=${{ github.repository }}`.
- **Verified chain:** `OPENCODE_CHANNEL=personal` → `Script.channel` (`index.ts:26-31`, explicit env wins) → baked define `OPENCODE_CHANNEL: 'personal'` (`build.ts:380`) → `InstallationChannel = "personal"` (`version.ts:6-8`) → `getChannelPath()` yields `opencode-personal.db` because `personal` ∉ `{latest,beta,prod}` and passes the `[^a-zA-Z0-9._-]` sanitizer unchanged (`db.ts:30-35`). **Separate DB from upstream's `opencode.db`, with zero app-source changes.**
- **`personal` is deliberately not in `UNSTABLE_CHANNELS`** (`{dev,beta,local}`, `flag.ts:16-19`) ⇒ `unstableDefault()` behaves identically to `latest` — strictly better than `beta`/`dev`/`local`, which would flip experimental defaults AND share the DB.
- **Release path unaffected by the channel:** archive+upload is gated on `Script.release` (`!!OPENCODE_RELEASE`, `index.ts:70-72`) only (`build.ts:426-435`); `OPENCODE_VERSION` set ⇒ no npm fetch (`index.ts:34-35`). The channel does surface in publish scripts (`Script.preview` at `opencode/script/publish.ts:70`; `Script.channel` at `opencode/script/publish.ts:23,66`, `plugin/script/publish.ts:34`, `sdk/js/script/publish.ts:41`), but **none of those scripts are invoked by `bun run build`**, so nothing in our pipeline reads them.
- **`script/version.ts` deliberately not used:** its `latest` path runs `script/changelog.ts` (upstream-history-oriented) and creates the draft release; a workflow-native `gh release create` is smaller and fork-owned.

### D4 — Release lifecycle: draft → upload → publish
1. Create draft release `v<version>` (idempotent reuse; assets upload with `--clobber` per `build.ts:434`).
2. Build + upload (build.ts does the upload).
3. `gh release edit --draft=false --latest` — `--latest` makes `releases/latest/download/...` resolve to it, which both installers rely on.
- **Why draft-first:** a failed build never leaves a published empty release.

### D5 — CI prerequisites
- Reuse fork-owned composite `./.github/actions/setup-bun`.
- Rust: `dtolnay/rust-toolchain@stable` + `wasm32-unknown-unknown` target, then wasm-pack via the official installer.
- **No explicit `build:wasm` step** (`build.ts:105-107` runs it). **No explicit `@opentui/core` step** (`build.ts:216-219` handles it; we do *not* pass `--skip-install`).
- Embedded web UI: keep the default (parity with upstream binaries).
- Two hermetic isolation-test jobs (ubuntu + windows) gate the release job via `needs` — see D9.

### D6 — Installer strategy: keep asset names, rename at install time
- **Asset names stay `opencode-<target>.*`:** renaming assets would require touching `build.ts` (`pkg.name` feeds `build.ts:334-343`) — forbidden by scope. Instead the installer **extracts all archive contents and renames the binary `opencode` → `opencode-personal`**, which is runtime-safe (channel/DB/data-dir are build-time baked, `packages/opencode/AGENTS.md`).
- **Copy ALL archive contents** (binary + `libopentui.*`/`opentui.dll`): the native lib is the runtime dlopen fallback (`build.ts:400-409`). Upstream's `mv "$tmp_dir/opencode"` (`install:343`) drops it — fork improvement.
- Root `install` stays **byte-untouched** (nix fileset, `nix/node_modules.nix:33`). New root `install.sh` = copy of `install` + 10 targeted edits (exact diff in Step 2). New root `install.ps1` = native PowerShell (Windows is where the bash script is weakest — see the whitelist decision in Edit 10).
- One-liners served from `raw.githubusercontent.com` (stable, no Pages dependency). Pages hosting is an optional follow-up.
- **Non-interference properties (both installers):** distinct install dir; distinct tmp dir names; version probe by absolute fork path only; rc marker `# opencode-personal`; append-only PATH edits; never `command -v opencode` / bare `opencode --version`.
- **Windows support lives in `install.ps1` only (rev 2):** `install.sh` refuses every `windows-*` combo. The windows archive contains `opencode.exe`; the bash extract→rename→chmod path would fail under `set -euo pipefail` on MINGW/MSYS (no reliable `.exe` handling), so rather than maintain a fragile suffix-aware bash path, the script redirects Windows users to the native installer.

### D7 — Repo guard
- Job-level `if: github.repository == 'ozgurulukir/opencode-personal'` on **all three jobs**. The file will never exist upstream; the guard protects against fork-of-fork runs where `GH_REPO`/token wouldn't match.

### D8 — Code signing: explicitly out of scope
- Unsigned Windows binaries → SmartScreen warning. Upstream uses Azure Trusted Signing (`publish.yml:112-202`) with paid secrets. Stated in README; optional future work.

### D9 — Hermetic non-interference verification (rev 2)
- **Why:** the coexistence guarantee is the product; it needs a test that proves it, deterministically, with no network and no real upstream.
- **Bash (`script/verify-isolation.sh`) — two scenarios, both no-network:**
  - **Scenario A (`--binary`):** fake upstream + rc entry in a temp `HOME`; install a local dummy binary; assert upstream byte-untouched, rc append-only, fork name/dir correct.
  - **Scenario B (archive path):** a **curl shim** on `PATH` serves a pre-made local `.tar.gz` (binary + `libopentui.so` stub) and canned API responses, exercising the full download flow — extract → rename → copy-all — including the native-lib copy that upstream's installer drops.
- **PowerShell (`script/verify-isolation.ps1`):**
  - **Filesystem: fully hermetic.** The installer runs in a **child `pwsh` process** with `USERPROFILE`, `HOME`, `HOMEDRIVE`, `HOMEPATH` overridden to a temp profile — so the fake upstream (`<temp>\.opencode`) and the fork install (`<temp>\.opencode-personal`) both land in the temp profile. The real `%USERPROFILE%` is never touched ⇒ **the test passes on machines that already have an upstream install** (the rev-1 "refuse if real upstream exists" guard is gone). A child process is required because `$HOME` is a PowerShell automatic variable fixed at session start — only a fresh pwsh recomputes it from the overridden environment; all four vars are overridden because their resolution order is version-dependent.
  - **User PATH: real mutation, temporarily accepted, fully cleaned up.** `[Environment]::SetEnvironmentVariable(…, "User")` writes to the registry (`HKCU\Environment`), which env-var overrides **cannot** redirect — a child-process override alone therefore cannot isolate this surface. The test snapshots the user PATH before the child runs, snapshots it again **immediately after the child returns, inside `try` (before `finally`)**, and restores it in `finally`. All cleanup (PATH, env vars, temp dirs) lives in `finally`, so a `Fail` can never leave artifacts. This is stated explicitly here as the one accepted real-env mutation.
- **Delivery:** both scripts run as CI jobs in the same workflow, **gating the release job** (`needs`).

---

## Steps

### Step 1 — Add `.github/workflows/release-binaries.yml` (new file, full content)

```yaml
name: release-binaries

on:
  push:
    tags:
      # Fork-version convention only (-p.N suffix). Mirrored upstream tags
      # (plain semver, e.g. v1.14.48) do NOT match this pattern, so a tag
      # sync from upstream can never mint a fork release.
      - "v*-p.*"
  workflow_dispatch:
    inputs:
      version:
        description: "Version to release, e.g. 1.14.48-p.1 (fork convention: semver + -p.N suffix; tag v<version> is created if missing)"
        required: true
        type: string

concurrency:
  group: release-binaries-${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  isolation-test:
    # Hermetic non-interference checks for the fork installers (no network, no build).
    if: github.repository == 'ozgurulukir/opencode-personal'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - name: Bash installer syntax check
        run: bash -n install.sh
      - name: Bash installer non-interference test
        run: bash script/verify-isolation.sh

  isolation-test-windows:
    if: github.repository == 'ozgurulukir/opencode-personal'
    runs-on: windows-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - name: PowerShell installer non-interference test
        shell: pwsh
        run: ./script/verify-isolation.ps1

  release:
    if: github.repository == 'ozgurulukir/opencode-personal'
    needs: [isolation-test, isolation-test-windows]
    runs-on: ubuntu-latest
    timeout-minutes: 180
    env:
      GH_REPO: ${{ github.repository }}
      OPENCODE_CHANNEL: personal
      OPENCODE_RELEASE: "1"
    steps:
      - uses: actions/checkout@v4

      - uses: ./.github/actions/setup-bun

      - name: Setup Rust (wasm32 target for diff-wasm)
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown

      - name: Install wasm-pack
        run: curl -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh

      - name: Resolve version (fork convention: semver + required -p.N suffix)
        id: version
        run: |
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            v="${{ inputs.version }}"
          else
            v="${GITHUB_REF_NAME#v}"
          fi
          v="${v#v}"
          # Second line of defense against mirrored upstream tags: even if a
          # plain-semver tag ever reached this workflow, it fails here before
          # any release is created.
          if ! grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+-p\.[0-9]+$' <<<"$v"; then
            echo "::error::Invalid version '$v' - fork releases must be semver with a -p.N suffix (e.g. 1.14.48-p.1)"
            exit 1
          fi
          echo "version=$v" >> "$GITHUB_OUTPUT"

      - name: Create draft release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          tag="v${{ steps.version.outputs.version }}"
          if gh release view "$tag" --repo "$GH_REPO" >/dev/null 2>&1; then
            echo "Release $tag already exists - reusing it (assets upload with --clobber)"
          else
            gh release create "$tag" --draft --target "$GITHUB_SHA" \
              --title "$tag" \
              --notes "Prebuilt binaries for the opencode-personal fork ($tag). Installs as the command opencode-personal - safe alongside an existing upstream opencode. See the README for install instructions." \
              --repo "$GH_REPO"
          fi

      - name: Build all targets and upload release assets
        working-directory: packages/opencode
        env:
          GH_TOKEN: ${{ github.token }}
          OPENCODE_VERSION: ${{ steps.version.outputs.version }}
        run: bun run build

      - name: Publish release
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release edit "v${{ steps.version.outputs.version }}" --draft=false --latest --repo "$GH_REPO"
```

Notes:
- **`OPENCODE_CHANNEL: personal`** (job-level env) is the isolation keystone: bakes `InstallationChannel = "personal"` into every binary ⇒ `opencode-personal.db`, unstable-flag defaults identical to `latest` (chain in D3).
- `bun run build` runs the full pipeline: embedded web UI → diff-wasm → 12 targets → archives → `gh release upload` (`build.ts:434` picks up job-level `GH_REPO`/`GH_TOKEN`).
- The smoke test (`build.ts:386-396`) runs for the **two** linux-x64 glibc variants (`linux-x64`, `linux-x64-baseline`) inside the build step and fails the job on a broken binary.
- `OPENCODE_RELEASE: "1"` flips `Script.release` (`index.ts:70-72`) → upload block (`build.ts:426-435`).
- The release job is **gated on both isolation jobs** (`needs`) — a coexistence regression blocks the release.
- The `-p.N` version suffix is valid semver and flows through `Script.version` harmlessly (baked `--version` string, `gh release upload v…`, dist `package.json`); asset names don't contain the version.

### Step 2 — Add root `install.sh` (copy of root `install` + 10 edits — exact diff)

Copy `install` → `install.sh` verbatim, then apply these edits (line numbers refer to root `install`):

**Edit 1 — header (lines 1-3):**
```bash
#!/usr/bin/env bash
set -euo pipefail
APP=opencode
```
→
```bash
#!/usr/bin/env bash
set -euo pipefail
# opencode-personal installer - fork of the upstream `install` script.
# Coexistence: installs the command `opencode-personal` into ~/.opencode-personal/bin.
# Never touches an existing upstream install (~/.opencode/**, ~/.local/bin/opencode).
# Windows is NOT supported by this script - use install.ps1 (see the combo whitelist).
APP=opencode            # asset prefix - release assets keep upstream names (build.ts untouched)
REPO=ozgurulukir/opencode-personal
COMMAND=opencode-personal
```

**Edit 2 — usage (lines 10-27, whole `usage()` body):**
```bash
usage() {
    cat <<EOF
OpenCode Personal Installer

Usage: install.sh [options]

Options:
    -h, --help              Display this help message
    -v, --version <version> Install a specific version (e.g., 1.14.48-p.1)
    -b, --binary <path>     Install from a local binary instead of downloading
        --no-modify-path    Don't modify shell config files (.zshrc, .bashrc, etc.)

Examples:
    curl -fsSL https://raw.githubusercontent.com/ozgurulukir/opencode-personal/main/install.sh | bash
    curl -fsSL https://raw.githubusercontent.com/ozgurulukir/opencode-personal/main/install.sh | bash -s -- --version 1.14.48-p.1
    ./install.sh --binary /path/to/opencode-personal

Installs the command 'opencode-personal' into ~/.opencode-personal/bin.
Safe alongside an existing upstream 'opencode' install.
Windows: this script does not support Windows - use install.ps1 instead.
EOF
}
```

**Edit 3 — install dir (line 68):**
```bash
INSTALL_DIR=$HOME/.opencode-personal/bin
```

**Edit 4 — repo URLs (lines 184, 185, 194, 198, 201):** replace all five `anomalyco/opencode` occurrences with `$REPO` (`$filename` at :184/:194 unchanged — `APP` stays `opencode` so asset names match the release):
```bash
url="https://github.com/$REPO/releases/latest/download/$filename"
specific_version=$(curl -s https://api.github.com/repos/$REPO/releases/latest | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p')
...
url="https://github.com/$REPO/releases/download/v${requested_version}/$filename"
...
http_status=$(curl -sI -o /dev/null -w "%{http_code}" "https://github.com/$REPO/releases/tag/v${requested_version}")
...
echo -e "${MUTED}Available releases: https://github.com/$REPO/releases${NC}"
```

**Edit 5 — tracefile basename (line 278):** `opencode_install_$$` → `opencode_personal_install_$$` (distinct tmp names).

**Edit 6 — `check_version()` (lines 221-235, whole function):** probe the fork binary by **absolute path only** — never `command -v opencode` / `which opencode` / bare `opencode --version`, which would find and run the upstream install:
```bash
check_version() {
    # Probe ONLY the fork binary by absolute path. Never `command -v opencode` /
    # bare `opencode --version` - on a system with upstream opencode installed
    # those would find and run the upstream binary.
    local fork_bin="${INSTALL_DIR}/${COMMAND}"
    if [ -x "$fork_bin" ]; then
        installed_version=$("$fork_bin" --version 2>/dev/null || echo "")

        if [[ "$installed_version" != "$specific_version" ]]; then
            print_message info "${MUTED}Installed version: ${NC}$installed_version."
        else
            print_message info "${MUTED}Version ${NC}$specific_version${MUTED} already installed"
            exit 0
        fi
    fi
}
```

**Edit 7 — `download_and_install()` (lines 327-346, whole function):** distinct tmp dir; extract into a subdirectory (so the archive file itself is never copied); rename the binary; copy ALL contents (binary + native lib):
```bash
download_and_install() {
    print_message info "\n${MUTED}Installing ${NC}opencode-personal ${MUTED}version: ${NC}$specific_version"
    local tmp_dir="${TMPDIR:-/tmp}/opencode_personal_install_$$"
    mkdir -p "$tmp_dir"

    if [[ "$os" == "windows" ]] || ! [ -t 2 ] || ! download_with_progress "$url" "$tmp_dir/$filename"; then
        # Fallback to standard curl on Windows, non-TTY environments, or if custom progress fails
        curl -# -L -o "$tmp_dir/$filename" "$url"
    fi

    # Extract into a subdirectory so the archive file itself is never copied into INSTALL_DIR.
    mkdir -p "$tmp_dir/x"
    if [ "$os" = "linux" ]; then
        tar -xzf "$tmp_dir/$filename" -C "$tmp_dir/x"
    else
        unzip -q "$tmp_dir/$filename" -d "$tmp_dir/x"
    fi

    # Rename the compiled binary to the fork command name, then copy ALL archive
    # contents (binary + OpenTUI native lib) - the binary needs the lib next to it
    # at runtime (build.ts:400-409). Upstream's `mv` drops the lib.
    mv "$tmp_dir/x/opencode" "$tmp_dir/x/$COMMAND"
    cp -a "$tmp_dir/x/." "$INSTALL_DIR/"
    chmod 755 "${INSTALL_DIR}/${COMMAND}"
    rm -rf "$tmp_dir"
}
```

**Edit 8 — `install_from_binary()` (lines 348-352):**
```bash
install_from_binary() {
    print_message info "\n${MUTED}Installing ${NC}opencode-personal ${MUTED}from: ${NC}$binary_path"
    cp "$binary_path" "${INSTALL_DIR}/${COMMAND}"
    chmod 755 "${INSTALL_DIR}/${COMMAND}"
}
```

**Edit 9 — rc marker + footer (lines 369, 371, 456, 458):**
```bash
# line 369 (add_to_path): distinct rc marker - NOT the upstream `# opencode`
echo -e "\n# opencode-personal" >> "$config_file"
# line 371:
print_message info "${MUTED}Successfully added ${NC}opencode-personal ${MUTED}to \$PATH in ${NC}$config_file"
# line 456 (footer):
echo -e "$COMMAND  ${MUTED}# Run command${NC}"
# line 458:
echo -e "${MUTED}For more information visit ${NC}https://github.com/ozgurulukir/opencode-personal#install"
```
ASCII art (lines 447-450) kept as-is. The `export PATH=$INSTALL_DIR:\$PATH` command lines (:414, :421-430, :433) need **no edit** — they resolve to the fork dir automatically because `$INSTALL_DIR` changed. The `GITHUB_ACTIONS` block (:441-444) needs no edit — it writes the fork dir to `$GITHUB_PATH`.

**Edit 10 — combo whitelist: refuse ALL Windows combos (lines 102-110) + delete the now-dead windows AVX2 block (lines 145-157):**
```bash
# lines 102-110: drop windows-x64 from the whitelist, redirect to install.ps1
combo="$os-$arch"
case "$combo" in
  linux-x64|linux-arm64|darwin-x64|darwin-arm64)
    ;;
  *)
    echo -e "${RED}Unsupported OS/Arch: $os/$arch${NC}"
    if [ "$os" = "windows" ]; then
      echo -e "${ORANGE}Windows is not supported by this script - use the PowerShell installer:${NC}"
      echo -e "${ORANGE}  irm https://raw.githubusercontent.com/$REPO/main/install.ps1 | iex${NC}"
    fi
    exit 1
    ;;
esac
```
Also **delete lines 145-157** (the `if [ "$os" = "windows" ]` branch inside the `needs_baseline` detection) — unreachable dead code once windows is refused at the whitelist.

**Why (rev 2):** the windows archive contains `opencode.exe`; the extract→rename→chmod path above assumes the un-suffixed `opencode` name and would fail under `set -euo pipefail` on MINGW/MSYS. Rather than maintain a fragile `.exe`-aware bash path, Windows is served exclusively by `install.ps1`. The MINGW/MSYS/CYGWIN os detection (`:84`) is kept — it is what makes the redirect message possible.

**Inherited non-interference properties (verified against the diff):** `add_to_path` only ever appends (`>>`) and dedupes on its own exact command line (`grep -Fxq`, `:366`); the PATH-guard `[[ ":$PATH:" != *":$INSTALL_DIR:"* ]]` (`:415`) keys on the fork dir; no code path writes outside `$INSTALL_DIR` + the one rc append.

**Limitation note (corrected rev 2):** `install.sh` deliberately refuses **all** Windows combos, `windows-x64` included — the real gap was never `windows-arm64` (that combo was already absent from the upstream whitelist); it is that the bash extract→rename→chmod flow cannot handle the `.exe`-suffixed archive contents reliably on MINGW/MSYS. Windows users must use `install.ps1`.

### Step 3 — Add root `install.ps1` (new file, full content)

```powershell
#requires -Version 5.1
<#
.SYNOPSIS
  opencode-personal installer (fork). Installs the command `opencode-personal`
  into %USERPROFILE%\.opencode-personal\bin.
.NOTES
  Coexistence: never touches an existing upstream install (~\.opencode\**,
  ~\.local\bin\opencode*). Appends only its own directory to the USER PATH.
#>
param(
    [string]$Version = "",   # pin a release, e.g. -Version 1.14.48-p.1
    [string]$Binary = ""     # install from a local binary instead of downloading
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Repo       = "ozgurulukir/opencode-personal"
$Command    = "opencode-personal"
$InstallDir = Join-Path $HOME ".opencode-personal\bin"

# --- arch ---
$arch = if ("$env:PROCESSOR_ARCHITECTURE" -eq "ARM64") { "arm64" } else { "x64" }

# --- AVX2 baseline detection (mirrors install.sh; IsProcessorFeaturePresent(40)) ---
$needsBaseline = $false
if ($arch -eq "x64") {
    try {
        $sig = '[DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);'
        $k32 = Add-Type -MemberDefinition $sig -Name Kernel32Avx2Personal -Namespace Win32 -PassThru
        if (-not $k32::IsProcessorFeaturePresent(40)) { $needsBaseline = $true }
    } catch { $needsBaseline = $false }
}
$target = "windows-$arch"
if ($needsBaseline) { $target = "$target-baseline" }

# --- resolve what to install ---
if ($Binary) {
    if (-not (Test-Path -LiteralPath $Binary)) { throw "Binary not found at $Binary" }
    $Version = "local"
} else {
    if (-not $Version) {
        $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest"
        $Version = $rel.tag_name.TrimStart("v")
    }
    $Version = $Version.TrimStart("v")
}

Write-Host "Installing $Command $Version ($target)..."

# Distinct tmp dir (never collides with an upstream installer's temp files)
$tmp = Join-Path ([IO.Path]::GetTempPath()) "opencode-personal-install-$PID"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

try {
    if ($Binary) {
        Copy-Item -LiteralPath $Binary -Destination (Join-Path $InstallDir "$Command.exe") -Force
    } else {
        $asset = "opencode-$target.zip"   # asset names keep the upstream 'opencode' prefix
        $url   = "https://github.com/$Repo/releases/download/v$Version/$asset"
        $zip   = Join-Path $tmp $asset
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
        $x = Join-Path $tmp "x"
        Expand-Archive -Path $zip -DestinationPath $x -Force
        # Rename the compiled binary to the fork command name, then copy ALL archive
        # contents (binary + opentui.dll) - the binary needs the DLL next to it.
        Move-Item -LiteralPath (Join-Path $x "opencode.exe") -Destination (Join-Path $x "$Command.exe") -Force
        Copy-Item -Path (Join-Path $x "*") -Destination $InstallDir -Force
    }
    Write-Host "Installed to $InstallDir"
} finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# --- user PATH (append-only; never removes or reorders existing entries) ---
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (($userPath -split ";") -notcontains $InstallDir) {
    $newPath = if ($userPath) { "$userPath;$InstallDir" } else { $InstallDir }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    $env:Path = "$env:Path;$InstallDir"
    Write-Host "Added $InstallDir to your user PATH. Restart your terminal for it to take effect."
}

Write-Host ""
Write-Host "$Command $Version installed. Run '$Command' in a project directory to start."
Write-Host "Installs alongside any existing upstream 'opencode' - this script never touches ~\.opencode or the upstream binary."
```

### Step 4 — README update (replace `README.md:36-47`)

Replace the `## Get started from source` section (lines 36-47) with:

````markdown
## Install

Prebuilt binaries are published on this fork's [GitHub Releases](https://github.com/ozgurulukir/opencode-personal/releases) for Linux (x64/arm64, glibc and musl), macOS (x64/arm64), and Windows (x64/arm64).

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/ozgurulukir/opencode-personal/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/ozgurulukir/opencode-personal/main/install.ps1 | iex
```

Both install the command **`opencode-personal`** and append only their own directory to your PATH: `~/.opencode-personal/bin` on macOS/Linux, `%USERPROFILE%\.opencode-personal\bin` on Windows. The fork is designed to coexist with an existing upstream `opencode` install: it never touches `~/.opencode`, `~/.local/bin/opencode`, or any existing PATH entry, and it stores sessions in its own database (`opencode-personal.db`) via the build-time channel `personal`. Configuration (`opencode.json`, auth) is shared with upstream by design. Caveat: if you export `OPENCODE_DISABLE_CHANNEL_DB` or `OPENCODE_DB`, DB separation is yours to manage.

Pass `--version <v>` (bash) or `-Version <v>` (PowerShell) to pin a release (fork versions carry a `-p.N` suffix, e.g. `1.14.48-p.1`), `--binary <path>` / `-Binary <path>` to install a local build (also copy the bundled `libopentui.*` / `opentui.dll` next to the binary in that case), and `--no-modify-path` (bash) to skip the PATH edit. Note: `install.ps1` has **no PATH-skip flag** — it always appends the install directory to your user PATH; remove it manually if unwanted. Windows binaries are unsigned, so SmartScreen may warn — choose "More info" → "Run anyway".

Uninstall: delete `~/.opencode-personal` (Windows: `%USERPROFILE%\.opencode-personal`) and remove the `# opencode-personal` PATH line from your shell rc file (Windows: remove the directory from your user PATH).

### Manual download

Download an archive from the [releases page](https://github.com/ozgurulukir/opencode-personal/releases), extract it, rename the binary `opencode` to `opencode-personal` (keep the bundled native library `libopentui.*` / `opentui.dll` in the same directory), and put that directory on your PATH.

### Run from source

Install [Bun](https://bun.sh/) (the repository targets Bun 1.3.14), then clone and install the workspace:

```bash
git clone https://github.com/ozgurulukir/opencode-personal.git
cd opencode-personal
bun install
bun dev
```

Connect a model provider with `/connect` in the terminal interface, or configure a provider in `opencode.json`. You will need credentials for the provider you choose.
````

### Step 5 — Docs-site update (included, docs-only)

The stale claim ships to Pages, so update both locales now (per `packages/web/AGENTS.md`: prose translated, structure identical).

**`packages/web/src/content/docs/index.mdx:32`** — replace:
```mdx
This fork does not publish separate package manager builds. Clone the [personal fork repository](https://github.com/ozgurulukir/opencode-personal), then follow its setup and build instructions.
```
with:
```mdx
This fork publishes prebuilt binaries on its [GitHub Releases](https://github.com/ozgurulukir/opencode-personal/releases). The installers install the command `opencode-personal` into `~/.opencode-personal/bin` — safe alongside an existing upstream `opencode` install (separate session database via the `personal` channel). See the fork's README for one-liners and manual download.
```

**`packages/web/src/content/docs/tr/index.mdx:32`** — replace:
```mdx
Bu fork ayrı paket yöneticisi sürümleri yayımlamıyor. [Kişisel fork deposunu](https://github.com/ozgurulukir/opencode-personal) klonlayın ve depodaki kurulum ile derleme yönergelerini izleyin.
```
with:
```mdx
Bu fork, derlenmiş ikili dosyalarını [GitHub Releases](https://github.com/ozgurulukir/opencode-personal/releases) sayfasında yayımlar. Kurulumcular `opencode-personal` komutunu `~/.opencode-personal/bin` dizinine kurar — mevcut bir upstream `opencode` kurulumuyla birlikte güvenle kullanılır (`personal` kanalı sayesinde ayrı oturum veritabanı). Tek satırlık kurulum komutları ve manuel indirme için fork'un README'sine bakın.
```

### Step 6 — Add `script/verify-isolation.sh` (new file, full content — hermetic, no network, two scenarios)

```bash
#!/usr/bin/env bash
# Hermetic (no-network) non-interference tests for install.sh.
#
# Scenario A (--binary): fake upstream + rc entry in a temp HOME; install a
#   local dummy binary; assert upstream untouched + append-only rc + fork name.
# Scenario B (archive): a curl shim serves a pre-made local .tar.gz, exercising
#   the full download path: extract -> rename -> copy-all (incl. native lib).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }

sha256() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
    else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# fresh_home <name>: temp HOME with a simulated upstream install + rc entry
fresh_home() {
    local h="$WORK/$1"
    mkdir -p "$h/.opencode/bin" "$h/.local/bin"
    printf '#!/bin/sh\necho upstream-1.0.0\n' > "$h/.opencode/bin/opencode"
    chmod 755 "$h/.opencode/bin/opencode"
    printf 'export PATH="$HOME/.opencode/bin:$PATH"\n' > "$h/.bashrc"
    echo "$h"
}

assert_upstream_untouched() {
    local h="$1" before="$2"
    [ "$(sha256 "$h/.opencode/bin/opencode")" = "$before" ] \
        || fail "upstream ~/.opencode/bin/opencode was modified"
    [ ! -e "$h/.local/bin/opencode" ] || fail "~/.local/bin/opencode was created"
    [ ! -e "$h/.opencode/bin/opencode-personal" ] || fail "fork binary leaked into upstream dir"
}

assert_rc_append_only() {
    local h="$1"
    [ "$(sed -n '1p' "$h/.bashrc")" = 'export PATH="$HOME/.opencode/bin:$PATH"' ] \
        || fail "existing rc line was modified"
    [ "$(wc -l < "$h/.bashrc")" -eq 4 ] || fail "rc file gained unexpected lines (expected 4)"
    grep -Fxq '# opencode-personal' "$h/.bashrc" || fail "fork rc marker missing"
    grep -Fxq "export PATH=$h/.opencode-personal/bin:\$PATH" "$h/.bashrc" \
        || fail "fork PATH line missing"
    ! grep -Fxq '# opencode' "$h/.bashrc" || fail "upstream rc marker was written"
}

# --- Scenario A: --binary install ---------------------------------------------
HOME_A="$(fresh_home home-a)"
UPSTREAM_A="$(sha256 "$HOME_A/.opencode/bin/opencode")"
printf '#!/bin/sh\necho personal-1.14.48-p.1\n' > "$WORK/opencode-fake"
chmod 755 "$WORK/opencode-fake"

HOME="$HOME_A" SHELL=/bin/bash bash "$ROOT/install.sh" --binary "$WORK/opencode-fake"

assert_upstream_untouched "$HOME_A" "$UPSTREAM_A"
assert_rc_append_only "$HOME_A"
[ -x "$HOME_A/.opencode-personal/bin/opencode-personal" ] \
    || fail "A: opencode-personal not installed in ~/.opencode-personal/bin"
[ ! -e "$HOME_A/.opencode-personal/bin/opencode" ] \
    || fail "A: an 'opencode'-named file leaked into the fork dir"
[ "$("$HOME_A/.opencode-personal/bin/opencode-personal" --version)" = "personal-1.14.48-p.1" ] \
    || fail "A: fork binary does not run"
echo "PASS: scenario A (--binary) coexists with an existing upstream install"

# --- Scenario B: archive install via curl shim (extract -> rename -> copy-all) --
HOME_B="$(fresh_home home-b)"
UPSTREAM_B="$(sha256 "$HOME_B/.opencode/bin/opencode")"

# Pre-made local "release" archive: binary + native lib at top level (like build.ts)
ARCH="$WORK/archive"
mkdir -p "$ARCH"
printf '#!/bin/sh\necho 1.14.48-p.1\n' > "$ARCH/opencode"
printf 'native-lib-stub\n' > "$ARCH/libopentui.so"
tar -czf "$WORK/opencode-linux-x64.tar.gz" -C "$ARCH" .

# curl shim: serves the local archive / canned API responses instead of the network
SHIM_VERSION="1.14.48-p.1"
SHIM_ARCHIVE="$WORK/opencode-linux-x64.tar.gz"
export SHIM_VERSION SHIM_ARCHIVE
mkdir -p "$WORK/shim"
cat > "$WORK/shim/curl" <<'SH'
#!/bin/sh
url=""; out=""; prev=""
for arg in "$@"; do
    [ "$prev" = "-o" ] && out="$arg"
    case "$arg" in http://*|https://*) url="$arg" ;; esac
    prev="$arg"
done
case "$url" in
    *"/releases/download/"*|*"/releases/latest/download/"*)
        cat "$SHIM_ARCHIVE" > "${out:-/dev/null}" ;;
    *"api.github.com/repos/"*"releases/latest"*)
        printf '{"tag_name": "v%s"}' "$SHIM_VERSION" ;;
    *"/releases/tag/"*)
        printf '200' ;;
    *) exit 1 ;;
esac
SH
chmod 755 "$WORK/shim/curl"

HOME="$HOME_B" SHELL=/bin/bash PATH="$WORK/shim:$PATH" \
    bash "$ROOT/install.sh" --version "$SHIM_VERSION"

assert_upstream_untouched "$HOME_B" "$UPSTREAM_B"
assert_rc_append_only "$HOME_B"
[ -x "$HOME_B/.opencode-personal/bin/opencode-personal" ] \
    || fail "B: opencode-personal not installed in ~/.opencode-personal/bin"
[ -f "$HOME_B/.opencode-personal/bin/libopentui.so" ] \
    || fail "B: native lib was not copied next to the binary (copy-all regression)"
[ ! -e "$HOME_B/.opencode-personal/bin/opencode" ] \
    || fail "B: unrenamed 'opencode' binary leaked into the fork dir"
[ "$("$HOME_B/.opencode-personal/bin/opencode-personal" --version)" = "1.14.48-p.1" ] \
    || fail "B: renamed binary does not run"
echo "PASS: scenario B (archive) extracts, renames, and copies all contents"

echo "PASS: install.sh coexists with an existing upstream opencode install"
```

Notes:
- Scenario B uses the **pinned-version** flow (`--version`), which needs no API call — the shim only answers the tag-existence probe (`200`) and the download. Works in both TTY (progress path: shim's empty trace file → no progress output → success) and non-TTY (plain-curl fallback) modes.
- The shim is prepended to `PATH` for the installer invocation only; `tar`/`grep`/`uname` still resolve normally.

### Step 7 — Add `script/verify-isolation.ps1` (new file, full content — Windows analog, rev 2)

```powershell
#requires -Version 5.1
# Hermetic non-interference test for install.ps1.
#
# Filesystem: fully hermetic. The installer runs in a CHILD pwsh process with
# USERPROFILE/HOME/HOMEDRIVE/HOMEPATH overridden to a temp profile, so the fake
# upstream (~\.opencode) and the fork install (~\.opencode-personal) both land
# in the temp profile. The real %USERPROFILE% is never touched, so this test is
# safe on machines that already have an upstream install.
#
# User PATH: [Environment]::SetEnvironmentVariable(..., "User") writes to the
# REGISTRY (HKCU\Environment), which env-var overrides CANNOT redirect. This
# one real mutation is temporarily accepted: snapshot before the child runs,
# snapshot again immediately after the child returns (inside try, BEFORE
# finally restores), restore in finally. All cleanup lives in finally so a
# failure can never leave artifacts.
#
# Why a child process: $HOME is a PowerShell automatic variable fixed at
# session start; only a fresh pwsh recomputes it from the overridden env.
# All four vars are overridden because their resolution order is
# version-dependent (pwsh 7 consults HOME; Windows PowerShell 5.1 consults
# HOMEDRIVE+HOMEPATH, else USERPROFILE).
$ErrorActionPreference = "Stop"

function Fail([string]$msg) { Write-Host "FAIL: $msg" -ForegroundColor Red; exit 1 }

if (-not (Get-Command pwsh -ErrorAction SilentlyContinue)) {
    Fail "pwsh (PowerShell 7+) is required to run this test"
}

$repoRoot     = Resolve-Path (Join-Path $PSScriptRoot "..")
$installer    = Resolve-Path (Join-Path $repoRoot "install.ps1")
$tempProfile  = Join-Path ([IO.Path]::GetTempPath()) "ocp-isolation-profile-$PID"
$work         = Join-Path ([IO.Path]::GetTempPath()) "ocp-isolation-work-$PID"
$forkDir      = Join-Path $tempProfile ".opencode-personal\bin"

# 1. Simulated upstream + fake release binary, both inside the TEMP profile
New-Item -ItemType Directory -Force -Path (Join-Path $tempProfile ".opencode\bin") | Out-Null
$upstream = Join-Path $tempProfile ".opencode\bin\opencode.exe"
Set-Content -LiteralPath $upstream -Value "fake upstream binary" -Encoding Ascii
$upstreamShaBefore = (Get-FileHash -LiteralPath $upstream -Algorithm SHA256).Hash
New-Item -ItemType Directory -Force -Path $work | Out-Null
$fake = Join-Path $work "opencode-personal.exe"
Copy-Item -LiteralPath $upstream -Destination $fake -Force

# 2. Snapshot the real user PATH (the one surface env overrides cannot isolate)
$userPathBefore = [Environment]::GetEnvironmentVariable("Path", "User")

# 3. Env override (all four vars pwsh may consult for $HOME)
$realUserProfile = $env:USERPROFILE; $realHome     = $env:HOME
$realHomeDrive   = $env:HOMEDRIVE;   $realHomePath = $env:HOMEPATH
$homeDrive = [IO.Path]::GetPathRoot($tempProfile).TrimEnd("\")
$homePath  = $tempProfile.Substring($homeDrive.Length)

$userPathAfter = $null
try {
    $env:USERPROFILE = $tempProfile
    $env:HOME        = $tempProfile
    $env:HOMEDRIVE   = $homeDrive
    $env:HOMEPATH    = $homePath

    # Run the installer in a child pwsh so $HOME is recomputed from the override
    & pwsh -NoProfile -File $installer -Binary $fake

    # CRITICAL: snapshot the post-install user PATH NOW, inside try, BEFORE
    # finally restores it. Reading it after finally would compare the restored
    # value, so the +1-entry assertion could never pass.
    $userPathAfter = [Environment]::GetEnvironmentVariable("Path", "User")
} finally {
    # Restore EVERYTHING the test touched - runs even when assertions fail
    [Environment]::SetEnvironmentVariable("Path", $userPathBefore, "User")
    $env:USERPROFILE = $realUserProfile; $env:HOME     = $realHome
    $env:HOMEDRIVE   = $realHomeDrive;   $env:HOMEPATH = $realHomePath
}

# 4. Assertions (against snapshots; no live environment reads)
if ($null -eq $userPathAfter) { Fail "installer did not run" }
if ((Get-FileHash -LiteralPath $upstream -Algorithm SHA256).Hash -ne $upstreamShaBefore) {
    Fail "upstream binary was modified"
}
if (-not (Test-Path -LiteralPath (Join-Path $forkDir "opencode-personal.exe"))) {
    Fail "opencode-personal.exe not installed in $forkDir"
}
if (Test-Path -LiteralPath (Join-Path $forkDir "opencode.exe")) {
    Fail "an 'opencode.exe' leaked into the fork dir"
}

$before = @($userPathBefore -split ";" | Where-Object { $_ })
$after  = @($userPathAfter  -split ";" | Where-Object { $_ })
if ($after.Count -ne $before.Count + 1) {
    Fail "user PATH entry count changed unexpectedly ($($before.Count) -> $($after.Count))"
}
if ($after -notcontains $forkDir) { Fail "fork dir not appended to user PATH" }
foreach ($e in $before) { if ($after -notcontains $e) { Fail "existing PATH entry removed: $e" } }

# 5. Cleanup of temp artifacts - in finally so Fail cannot leave them behind
try {
    Write-Host "PASS: install.ps1 coexists with an existing upstream opencode install"
} finally {
    Remove-Item $tempProfile -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
```

Notes:
- The child writes `<tempProfile>\.opencode-personal\bin` into the **real** user PATH (registry); the `finally` restore removes it. If the process is killed hard between child-write and restore, a stale temp-path entry could remain — accepted, documented residual (temp dirs are OS-cleaned).
- The old rev-1 guard ("refuse if real `%USERPROFILE%\.opencode` exists") is **removed**: the real profile is never touched anymore, so the test runs on dev boxes with a real upstream install.

### Step 8 — Asset-name parity contract (12 assets) + exact user commands

`build.ts` emits exactly these 12 archives (names from `build.ts:334-343`, targets from `:114-175`); **asset names keep the upstream `opencode` prefix** (build.ts untouched); every installer maps them to the installed command `opencode-personal` (`install:160-168` appends `-baseline` then `-musl`, same order):

| Asset (release asset name) | Archive contents (top level) | Installer selects it via |
| --- | --- | --- |
| `opencode-linux-arm64.tar.gz` | `opencode` + `libopentui.so` | linux + arm64 |
| `opencode-linux-x64.tar.gz` | `opencode` + `libopentui.so` | linux + x64 + avx2 |
| `opencode-linux-x64-baseline.tar.gz` | `opencode` + `libopentui.so` | linux + x64, no avx2 |
| `opencode-linux-arm64-musl.tar.gz` | `opencode` + `libopentui.so` | linux + arm64 + musl |
| `opencode-linux-x64-musl.tar.gz` | `opencode` + `libopentui.so` | linux + x64 + avx2 + musl |
| `opencode-linux-x64-baseline-musl.tar.gz` | `opencode` + `libopentui.so` | linux + x64, no avx2 + musl |
| `opencode-darwin-arm64.zip` | `opencode` + `libopentui.dylib` | darwin + arm64 (incl. Rosetta redirect, `install:95-100`) |
| `opencode-darwin-x64.zip` | `opencode` + `libopentui.dylib` | darwin + x64 + avx2 |
| `opencode-darwin-x64-baseline.zip` | `opencode` + `libopentui.dylib` | darwin + x64, no avx2 |
| `opencode-windows-arm64.zip` | `opencode.exe` + `opentui.dll` | `install.ps1` only (install.sh refuses all windows combos, rev 2) |
| `opencode-windows-x64.zip` | `opencode.exe` + `opentui.dll` | `install.ps1` x64 + avx2 |
| `opencode-windows-x64-baseline.zip` | `opencode.exe` + `opentui.dll` | `install.ps1` x64, no avx2 |

All installers rename the binary to `opencode-personal` (`.exe` on Windows) at install time — runtime-safe (`packages/opencode/AGENTS.md`).

**Exact user commands:**

One-liners (pinned and local variants in README/usage):
```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/ozgurulukir/opencode-personal/main/install.sh | bash
curl -fsSL https://raw.githubusercontent.com/ozgurulukir/opencode-personal/main/install.sh | bash -s -- --version 1.14.48-p.1   # pinned
./install.sh --binary /path/to/opencode --no-modify-path                                                         # local build
```
```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/ozgurulukir/opencode-personal/main/install.ps1 | iex
./install.ps1 -Version 1.14.48-p.1        # pinned (after downloading the script)
./install.ps1 -Binary C:\path\to\opencode.exe   # local build
```

Manual download (any OS):
```bash
curl -fsSLO https://github.com/ozgurulukir/opencode-personal/releases/latest/download/opencode-linux-x64.tar.gz
tar -xzf opencode-linux-x64.tar.gz
mv opencode opencode-personal          # keep libopentui.so in the same directory
./opencode-personal --version
```

---

## Verification

1. **Static checks (local, before push):**
   - YAML: `actionlint .github/workflows/release-binaries.yml` (or `yamllint`; at minimum a YAML parse).
   - `bash -n install.sh` and `bash -n script/verify-isolation.sh`.
   - PowerShell parse: `pwsh -NoProfile -Command "$e=$null; [System.Management.Automation.Language.Parser]::ParseFile('<path>\install.ps1',[ref]$null,[ref]$e)|Out-Null; $e"` (same for `verify-isolation.ps1`).
2. **Hermetic non-interference test (local + CI):**
   - `bash script/verify-isolation.sh` — two scenarios (binary + archive via curl shim), temp HOMEs, no network; must print both `PASS:` lines.
   - `pwsh ./script/verify-isolation.ps1` — child-process env override; must print `PASS`. **Safe on machines that already have an upstream install** (real profile untouched; only the user-PATH registry write is real, restored in `finally`).
   - Both run automatically as CI jobs on every tag push and dispatch, **gating the release job**.
3. **Local single-target build sanity** (`packages/opencode/AGENTS.md`): `bun run build -- --single --skip-install --skip-embed-web-ui` from `packages/opencode`; then `ln -sf` or copy the binary as `opencode-personal` and run it once — confirm the platform data dir now contains **`opencode-personal.db`** and no `opencode.db` was created (direct DB-isolation check; Linux example: `~/.local/share/opencode/`).
4. **End-to-end test release:**
   - `gh workflow run release-binaries -f version=0.0.1-p.1` → wait for green (isolation jobs + release job).
   - Negative trigger check: push a plain-semver tag (e.g. `v9.9.9-mirror-sim`) to a scratch branch — the workflow must NOT run (tag pattern `v*-p.*`); delete the tag afterwards.
   - Asset names: `gh release view v0.0.1-p.1 --repo ozgurulukir/opencode-personal --json assets --jq '.assets[].name'` → diff against the Step-8 table (exactly 12).
   - Download `opencode-linux-x64.tar.gz`, extract, **list contents** (expect `opencode` + `libopentui.so` at top level), run `./opencode --version` → expect `0.0.1-p.1`.
   - Download `opencode-windows-x64.zip`, list contents — **verify `opencode.exe` + `opentui.dll`** (confirms the `.exe`-naming assumption behind install.ps1's `Move-Item`).
   - Run `install.sh --version 0.0.1-p.1` on a Linux/macOS box → `opencode-personal --version` works from a fresh shell; `~/.opencode-personal/bin/` contains `opencode-personal` + `libopentui.*`; **no `~/.opencode` was created or modified**.
   - Run `install.ps1 -Version 0.0.1-p.1` on Windows → `opencode-personal --version` in a new terminal.
   - **Coexistence e2e (machine with real upstream):** install the fork, then verify `opencode --version` still resolves to upstream, `opencode-personal --version` resolves to the fork, upstream `~/.opencode/bin/opencode` byte-unchanged, upstream rc lines untouched, and the fork created `opencode-personal.db` while upstream's `opencode.db` is untouched.
   - Check the workflow log contains the **two** smoke-test lines (`linux-x64` and `linux-x64-baseline`) and **no** `Embedded UI build failed` warning (`build.ts:98`).
   - Cleanup: `gh release delete v0.0.1-p.1 --yes --cleanup-tag`.
5. **First real release:** tag `v<chosen-base>-p.1` → same checks; manually spot-check one darwin and one windows asset (extract + `--version`) since only the two linux-x64 glibc variants are smoke-tested in CI.

---

## Risks & Unknowns

- **Cross-compile coverage:** all 12 targets build on one ubuntu runner (upstream-proven), but only the **two linux-x64 glibc variants** (`linux-x64`, `linux-x64-baseline`) are smoke-tested (`build.ts:386-396`). darwin/windows/arm64/musl binaries untested until a human runs them. Mitigation: first-release manual spot checks; optional per-OS smoke matrix later.
- **Duration/size unknown until first run:** 12 Bun compiles + vite build + wasm-pack on a free 4-core runner — estimate 30–90 min (timeout 180). Each binary likely 80–200 MB; GitHub's 2 GB per-asset limit is safe but download size is real. Optional trim: drop `*-baseline-musl` / `windows-arm64` later.
- **Baseline Bun artifact flakiness:** `build.ts:184` comment notes baseline compile targets "can be flaky to download" — transient network failures → re-run the job (draft reuse makes this safe).
- **Silent embedded-UI degradation:** if `packages/app` build fails, the binary ships without the web UI and only warns (`build.ts:97-100`). Check logs on every release.
- **Unsigned Windows binaries:** SmartScreen warning; no signing planned (paid Azure Trusted Signing, `publish.yml:112-202`).
- **Windows archive exe name (assumption):** `outfile` is extensionless (`build.ts:365`); Bun compile is expected to emit `opencode.exe` for windows targets. If wrong, install.ps1's `Move-Item` fails loudly (good). Verified explicitly in the e2e test (Verification §4).
- **Tag-mirror residual:** the `v*-p.*` trigger + `-p.N` assertion make an accidental mirrored-tag release practically impossible; if upstream ever adopts `-p.` suffixes itself, the trigger must be revisited (D1).
- **`check_version` output format** (`install:221-235` → fork variant): if `opencode-personal --version` output ever differs from the bare version string, the installer just reinstalls — harmless. It probes only the fork binary by absolute path, so upstream is never executed.
- **Upstream `publish.yml` quirk (not touched):** its final `publish` job lacks the repo guard (`publish.yml:212-218`) — a manual dispatch of *that* workflow in the fork would fail harmlessly. Out of scope.
- **Residual shared-state items (intentional, installer-only scope — `core/global.ts:9-14,21-22`):**
  - **Config shared:** both binaries read/write the same `Global.Path.config` (`opencode.json`, `auth.json`). Logging in via one binary makes credentials visible to the other. Accepted; no clobbering (same schema, same file).
  - **Data dir shared, DB separated:** `Global.Path.data` is shared, but the DB file differs by channel (`db.ts:30-35`): fork → `opencode-personal.db`, upstream → `opencode.db`. Sessions never collide.
  - **Cache/bin shared:** `Global.Path.bin = cache/bin` (`global.ts:21`) — auxiliary downloaded tool binaries are shared. Cache semantics; worst case both write the same tool. Accepted.
  - **Log/state/tmp shared:** `global.ts:11-14,22` — accepted; worst case interleaved log files, no functional collision identified.
  - **Env caveat:** if a user exports `OPENCODE_DISABLE_CHANNEL_DB` (truthy) or `OPENCODE_DB`, the fork may use the shared DB — user-managed; documented in README, deliberately not "fixed" in app source (scope).
- **PowerShell isolation test residual:** the user-PATH registry write is a real (temporarily accepted) mutation, restored in `finally`; a hard kill between child-write and restore could leave a stale temp-path entry (harmless, OS-cleaned temp dir). Everything else — filesystem, env vars — is fully hermetic. Stated explicitly in D9/Step 7.
- **Runner image assumptions:** `gh`, `zip`, `tar`, `node` (setup-bun composite, `action.yml:16`) preinstalled on `ubuntu-latest`; rust pinned via `dtolnay` action.
- **`bun install --os="*" --cpu="*"`** (`build.ts:217-218`) mutates CI `node_modules` — expected, upstream-identical.
- **Windows isolation test scope:** `verify-isolation.ps1` exercises the `-Binary` path + user-PATH append (the non-interference surface). The download path (`Invoke-WebRequest`/`Expand-Archive`/`Move-Item`) is covered by the e2e release test, not the hermetic test — acceptable split (network in CI is fine there).

---

## Open Questions

1. **Version scheme (narrowed rev 2):** the `-p.N` suffix is now **mandated** (mirror-safety mitigation, D1); the base number is still a user decision — e.g. `0.1.0-p.1` (standalone) or `1.14.48-p.1` (mirrors upstream base). Needs a user decision before the first tag.
2. **Pages hosting of installers:** serve `install.sh`/`install.ps1` from `packages/web/public/` for pretty URLs? Deferred — raw URLs chosen for minimalism; if added later, `pages.yml` auto-deploys (path filter covers `packages/web/**`). *(Former open question "docs-site claim" is resolved: included as Step 5.)*
3. **Target trimming:** keep all 12 targets (parity) or drop rarely-used ones (`linux-x64-baseline-musl`, `windows-arm64`) to halve release weight? Default: keep all.
