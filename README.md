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
