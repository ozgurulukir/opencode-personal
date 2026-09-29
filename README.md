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

This fork is built on top of the OpenCode 1.14.48 source release. Notable changes maintained in this repository:

- Provider usage & quotas in `/usage` — Anthropic (Claude), ZAI, and ClinePass (5-hour/weekly/monthly limits, credit balance, and plan info).
- Unified V1/V2 session architecture with a single V2 SDK surface.
- Local semantic workspace search (zvec) with automatic skill matching.
- A Rust/WASM diff engine (`packages/diff-wasm`).
- ACP (Agent Client Protocol) terminal backend support (e.g. Zed).
- TUI enhancements: ghost-text next-prompt suggestions, shell `!` output rendering, and a unified spinner.
- Permission system hardening: MCP tool keys, deny-first evaluation, persisted "always allow", and subagent parity.
- Security hardening: SSRF protection in the webfetch tool, strict CORS origin validation, command-injection and path-traversal fixes, read-tool symlink-escape prevention, TUI log-leak prevention, and cryptographically strong dialog IDs.
- Prompt/session engine refactors: decomposed `prompt.ts` (2146 → 374 lines) and split provider message transforms.
- Auto-compaction improvements: `context_limit` config, summary budget, and metadata preservation.
- Performance work: event-loop starvation fixes, O(1) session summarize, batched DB writes, and embedded-UI caching.
- Monorepo pruning & build/CI hardening: removed unused packages, a personal-fork typecheck workflow, and a hardened dependency-update checker.
- Tooling: multi-skill loading, strict skill validation, and hunk-diff integration with todo autoclose.

## Get started from source

This personal fork does not publish its own prebuilt release packages. To run it from source, install [Bun](https://bun.sh/) (the repository targets Bun 1.3.14), then clone and install the workspace:

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
