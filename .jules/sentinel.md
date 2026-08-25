## 2023-10-27 - Insecure CORS Origin Regex Allowing Arbitrary Subdomains

**Vulnerability:** The CORS origin regex `^https:\/\/([a-z0-9-]+\.)*opencode\.ai$` incorrectly allows ANY subdomain of `opencode.ai` (e.g. `https://evil.com.opencode.ai`, `https://user1.opencode.ai`). In environments where subdomains can be taken over, or where user-generated content is hosted on arbitrary subdomains, this allows malicious scripts on those subdomains to bypass CORS and access the API with credentials.

**Learning:** When defining CORS rules using regular expressions, wildcard domain matching (`([a-z0-9-]+\.)*`) is often overly permissive and a security risk. Origin whitelists should be as strict as possible.

**Prevention:** Use exact string matching or highly restrictive regexes that explicitly enumerate allowed subdomains (e.g., `^https:\/\/(app\.)?opencode\.ai$`). Avoid `*` quantifiers on subdomain segments unless you have strict control over all DNS records under the TLD.

## 2025-03-05 - Fix TUI Plugin Error Leak
**Vulnerability:** TUI plugin runtime error handling leaked sensitive API request/response bodies (in the `cause` object) to the terminal because `console.error` in Bun bypasses standard stderr interception.
**Learning:** In Bun-based TUI applications, `console.error` and `console.warn` write directly to file descriptors, circumventing user-land stdout/stderr hooks. Relying on interceptors to sanitize or suppress logs is insufficient.
**Prevention:** Do not use `console.error` or `console.warn` for handling potentially sensitive internal errors in the TUI plugin runtime. Rely strictly on the configured, file-bound `log.error` / `log.warn` utilities.

## 2025-05-18 - Fix DOMPurify Fallback Unsafe Render
**Vulnerability:** Assigning unsanitized string `content` to `.innerHTML` in unsupported environments acts as an open fallback for XSS.
**Learning:** Security fixes must fail safely. Using `DOMPurify.isSupported` correctly ensures if not supported, it does not fallback to unsafe rendering. Furthermore, utilizing existing helper methods like `sanitize(content)` avoids duplication and leverages their built-in fallback mechanisms correctly.
**Prevention:** Always fail safe when parsing potentially malicious input (e.g., return empty string when sanitization library is missing). Ensure helper methods like `sanitize()` are leveraged instead of raw assignments.

## 2024-05-24 - DOM-based XSS in Drag Image Generation
**Vulnerability:** A DOM-based XSS vulnerability existed in `packages/app/src/components/file-tree.tsx` where file drag images were generated using string concatenation of `outerHTML` and assigning it via `innerHTML` (`image.innerHTML = icon.outerHTML + text.outerHTML`).
**Learning:** Concatenating `outerHTML` strings and injecting them via `innerHTML` can execute unintended scripts if the source DOM nodes contain unsanitized or unexpectedly manipulated content.
**Prevention:** Always use safe DOM APIs like `cloneNode(true)` followed by `appendChild()` to copy DOM elements safely without executing embedded scripts or falling back to string parsing.

## 2026-08-18 - DOM-based XSS vulnerabilities with DOMPurify and Shiki
**Vulnerability:** Using DOMPurify to sanitize HTML and directly assigning it via `innerHTML` can lead to Mutation XSS (mXSS) vulnerabilities. **Learning:** For unsafe dynamically generated HTML, sanitize using `DOMPurify` with `RETURN_DOM_FRAGMENT: true` and inject the result using `appendChild` instead of `innerHTML`. Shiki output destined for raw `innerHTML` injection must still pass through `DOMPurify` (preferably with `RETURN_DOM_FRAGMENT: true`); only skip sanitization when the output is never injected as HTML.
**Prevention:** Always verify if an external library already handles escaping (like Shiki) before adding DOMPurify. When using DOMPurify, prefer injecting the sanitized output as a `DocumentFragment` rather than a raw HTML string.

## 2026-08-22 - SSR XSS with DOMPurify in SolidJS
**Vulnerability:** Sending raw DOMPurify sanitized strings over SSR via `innerHTML` is inherently vulnerable to Mutation XSS (mXSS). Even if the string looks safe on the server, the browser's parser can mutate it into an executable script payload upon hydration, before client-side SolidJS code can safely parse or mount it as a `DocumentFragment`.
**Learning:** Do not render untrusted HTML strings using `innerHTML` on the server (SSR), even if sanitized by a library like DOMPurify. SSR strings are fully evaluated by the browser parser prior to any client-side safe DOM insertion patterns (like `RETURN_DOM_FRAGMENT`).
**Prevention:** Completely remove `innerHTML` on the server for untrusted markdown (e.g., render an empty `<div>`). Rely exclusively on the client-side `createEffect` and `appendChild` with `DOMPurify.sanitize(..., { RETURN_DOM_FRAGMENT: true })` to safely mount the parsed payload.
