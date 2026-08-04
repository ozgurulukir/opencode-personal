## 2025-03-05 - Fix TUI Plugin Error Leak
**Vulnerability:** TUI plugin runtime error handling leaked sensitive API request/response bodies (in the `cause` object) to the terminal because `console.error` in Bun bypasses standard stderr interception.
**Learning:** In Bun-based TUI applications, `console.error` and `console.warn` write directly to file descriptors, circumventing user-land stdout/stderr hooks. Relying on interceptors to sanitize or suppress logs is insufficient.
**Prevention:** Do not use `console.error` or `console.warn` for handling potentially sensitive internal errors in the TUI plugin runtime. Rely strictly on the configured, file-bound `log.error` / `log.warn` utilities.
