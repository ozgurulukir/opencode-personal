# OpenCode Web

This package contains the documentation site for the `ozgurulukir/opencode-personal` fork. It is built with Astro and Starlight and published through GitHub Pages.

The documentation is maintained in English and Turkish under `src/content/docs/`. The published site is configured at <https://ozgurulukir.github.io/opencode-personal/>.

## Development

Install workspace dependencies from the repository root with `bun install`. Then run the site commands from `packages/web`:

| Command | Description |
| --- | --- |
| `bun run dev` | Start the local Astro development server. |
| `bun run build` | Build the static site into `dist/`. |
| `bun run preview` | Preview the production build locally. |
