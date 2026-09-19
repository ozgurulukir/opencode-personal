# OpenCode Personal Fork

This repository is a personal fork of [OpenCode](https://github.com/anomalyco/opencode), an open source AI coding agent. It is maintained independently and is not an official OpenCode release or affiliated with the OpenCode team.

This fork follows the upstream project while carrying personal changes. Features, compatibility, release timing, and support may differ from upstream. For the official project, documentation, and releases, see [opencode.ai](https://opencode.ai) and the [upstream repository](https://github.com/anomalyco/opencode).

## Develop

The project is a Bun workspace monorepo. Install [Bun](https://bun.sh/) and then run:

```bash
bun install
bun dev
```

Useful development commands:

```bash
bun run dev:web       # Start the web app
bun run dev:storybook # Start Storybook
bun run lint          # Lint the workspace
bun run typecheck     # Typecheck the workspace
```

To build a standalone executable, run:

```bash
bun run build -- --single
```

The core CLI and server are in `packages/opencode`; shared web UI is in `packages/app`; the JavaScript SDK is in `packages/sdk/js`.

## License

This project is distributed under the MIT License. See [LICENSE](./LICENSE) for the required copyright and permission notice. The upstream copyright attribution is retained there.
