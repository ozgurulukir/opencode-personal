## Testing

- Tests are co-located in `src/components/` alongside source files (not in a separate `test/` directory). This is a deviation from the root AGENTS.md convention.
- Run tests from `packages/ui` with `bun test <filename>` (e.g., `bun test message-part-utils.test.ts`). Do not prefix with `./src/components/` — bun resolves the filename against the package directory.
