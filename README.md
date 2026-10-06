# OpenCode Personal Fork

OpenCode is an open-source AI coding agent that works in your terminal and browser. This repository is a personal fork of [OpenCode](https://github.com/anomalyco/opencode), maintained independently from the upstream project. It is not an official OpenCode release and is not affiliated with the upstream team.

This fork keeps the core OpenCode experience while carrying changes maintained in this repository. Features, compatibility, support, and release timing may differ from upstream. For the official project, visit [opencode.ai](https://opencode.ai) or the [upstream repository](https://github.com/anomalyco/opencode).

## What it can do

- Connect to supported hosted and local model providers.
- Explore and modify a project with built-in tools, configurable permissions, and project instructions such as `AGENTS.md`.
- Create specialized agents and extend the agent with plugins, skills, and MCP servers.
- Index a workspace and search code semantically, alongside exact text search.
- Manage long sessions with automatic context compaction and tool-output pruning.
- Continue work through the terminal interface, browser app, and supported editor integrations.

See the [fork documentation](https://ozgurulukir.github.io/opencode-personal/) for usage, configuration, providers, and integrations. The generated [config schema](https://ozgurulukir.github.io/opencode-personal/config.json) and [TUI config schema](https://ozgurulukir.github.io/opencode-personal/tui.json) are also published there.

## What this fork adds

This fork starts from the OpenCode 1.14.48 source release. The items below describe changes and integrations maintained in this repository; they are not a complete upstream comparison:

- Provider usage & quotas in `/usage` — Anthropic (Claude), ChatGPT OAuth, ZAI, and ClinePass, including the limits, balances, and plan details exposed by each provider.
- Qwen3 compatibility, including thinking-mode configuration and provider-specific message handling.
- V1 compatibility alongside a V2 session architecture and SDK surface.
- Local semantic workspace search (zvec) with optional automatic skill matching.
- A hybrid diff layer (`packages/diff-wasm`): Rust/WASM-backed diff generation with JavaScript-compatible patch formatting, parsing, applying, and fallbacks.
- ACP (Agent Client Protocol) terminal backend support (e.g. Zed).
- TUI enhancements: ghost-text next-prompt suggestions, shell `!` output rendering, and a unified spinner.
- Permission system improvements: MCP tool keys, deny precedence in permission asks, persisted "always allow", and improved subagent permission handling.
- Security hardening includes SSRF protection in the webfetch tool, strict CORS origin validation, symlink-safe path containment, shell command parsing and permission checks, read-tool symlink-escape prevention, TUI output-leak prevention, and cryptographically seeded dialog/request IDs.
- Prompt/session engine refactors: prompt orchestration split across focused modules and provider message transforms split by concern.
- Auto-compaction improvements: `context_limit` config, summary budget, and metadata preservation.
- Performance-oriented changes include targeted session-summary queries, event-loop/backpressure handling, batched DB writes, and embedded-UI caching.
- Monorepo/build/CI maintenance: tracked package cleanup, a typecheck workflow, and tighter dependency-update checks.
- Tooling: multi-skill loading, skill validation with warnings, and hunk-diff integration with todo autoclose.

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

Pass `--version <v>` (bash) or `-Version <v>` (PowerShell) to pin a release (fork versions are calendar-based, e.g. `2026.9.29`), `--binary <path>` / `-Binary <path>` to install a local build (also copy the bundled `libopentui.*` / `opentui.dll` next to the binary in that case), and `--no-modify-path` (bash) to skip the PATH edit. Note: `install.ps1` has **no PATH-skip flag** — it always appends the install directory to your user PATH; remove it manually if unwanted. Windows binaries are unsigned, so SmartScreen may warn — choose "More info" → "Run anyway". Fork releases are calendar-versioned (`YYYY.M.D`, e.g. `2026.9.29`): re-releasing on the same day reuses the same version and tag and overwrites the release assets; a release on a later day is a new version.

Uninstall: delete `~/.opencode-personal` (Windows: `%USERPROFILE%\.opencode-personal`) and remove the `# opencode-personal` PATH line from your shell rc file (Windows: remove the directory from your user PATH).

### Manual download

Download an archive from the [releases page](https://github.com/ozgurulukir/opencode-personal/releases), extract it, rename the binary `opencode` to `opencode-personal` (keep the bundled native library `libopentui.*` / `opentui.dll` in the same directory), and put that directory on your PATH.

### Run from source

Install [Bun](https://bun.sh/) (the repository targets Bun 1.4.2), then clone and install the workspace:

```bash
git clone https://github.com/ozgurulukir/opencode-personal.git
cd opencode-personal
bun install
bun dev
```

Connect a model provider with `/connect` in the terminal interface, or configure a provider in `opencode.json`. You will need credentials for the provider you choose.

## Development

This repository is a Bun workspace monorepo. Common commands from the repository root:

| Command | Purpose |
| --- | --- |
| `bun dev` | Run OpenCode from source. |
| `bun run dev:web` | Start the browser app. |
| `bun run --cwd packages/web dev` | Start the Astro/Starlight documentation site. |
| `bun run dev:storybook` | Start the UI Storybook. |
| `bun run lint` | Lint the workspace. |
| `bun run typecheck` | Typecheck workspace packages. |
| `bun run --cwd packages/web build` | Build the static documentation site. |

## Repository layout

| Package | Contents |
| --- | --- |
| `packages/opencode` | CLI, terminal interface, server, tools, providers, and agent runtime. |
| `packages/app` | Browser application. |
| `packages/ui` | Shared interface components. |
| `packages/core` | Shared runtime utilities and primitives. |
| `packages/sdk/js` | JavaScript/TypeScript SDK. |
| `packages/web` | English and Turkish documentation site. |

## License

This project is distributed under the MIT License. See [LICENSE](./LICENSE) for the required copyright and permission notice. The upstream copyright attribution is retained there.
