## 2025-03-05 - Fix TUI Plugin Error Leak
**Vulnerability:** TUI plugin runtime error handling leaked sensitive API request/response bodies (in the `cause` object) to the terminal because `console.error` in Bun bypasses standard stderr interception.
**Learning:** In Bun-based TUI applications, `console.error` and `console.warn` write directly to file descriptors, circumventing user-land stdout/stderr hooks. Relying on interceptors to sanitize or suppress logs is insufficient.
**Prevention:** Do not use `console.error` or `console.warn` for handling potentially sensitive internal errors in the TUI plugin runtime. Rely strictly on the configured, file-bound `log.error` / `log.warn` utilities.

## 2025-05-18 - Fix DOMPurify Fallback Unsafe Render
**Vulnerability:** Assigning unsanitized string `content` to `.innerHTML` in unsupported environments acts as an open fallback for XSS.
**Learning:** Security fixes must fail safely. Using `DOMPurify.isSupported` correctly ensures if not supported, it does not fallback to unsafe rendering. Furthermore, utilizing existing helper methods like `sanitize(content)` avoids duplication and leverages their built-in fallback mechanisms correctly.
**Prevention:** Always fail safe when parsing potentially malicious input (e.g., return empty string when sanitization library is missing). Ensure helper methods like `sanitize()` are leveraged instead of raw assignments.
