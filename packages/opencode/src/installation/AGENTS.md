# installation

Method-detection only. The upgrade / auto-update feature was removed from this fork, so this module no longer checks, downloads, or replaces the binary.

- `Installation.method()` + `Installation.Method` are load-bearing for `opencode uninstall` (`cli/cmd/uninstall.ts`); `isLocal()` is used by the TUI worker (`cli/cmd/tui/worker.ts`).
- `Installation.Service` / `defaultLayer` have zero yield sites after the upgrade handler was deleted, but they are NOT dead code: `defaultLayer` is wired through the instance httpapi server and `app-runtime.ts`. Do not delete the module or these exports.
- `packages/core/src/installation/version.ts` (`InstallationVersion` / `InstallationChannel` / `InstallationLocal`) is a separate shared module (~15+ importers) — keep untouched.
