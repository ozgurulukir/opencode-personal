## 2025-03-09 - XSS Vulnerability in Shiki HTML Rendering

**Vulnerability:** The `shiki.codeToHtml` output was being rendered directly via SolidJS's `innerHTML` without sanitization, exposing the application to Cross-Site Scripting (XSS) if user input (e.g. `command` or `output` props) could be manipulated to inject malicious scripts into the rendered HTML payload.

**Learning:** Although Shiki aims to output safe HTML representing source code, it's not a security guarantee against creatively crafted inputs designed to exploit `innerHTML`. External content injected into the DOM must always be considered untrusted.

**Prevention:** Always sanitize dynamically generated or external HTML payloads using a trusted sanitizer like `DOMPurify` (or `isomorphic-dompurify` for SSR-compatible components) before applying them to the DOM via properties like `innerHTML`.
