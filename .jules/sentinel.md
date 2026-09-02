## 2025-03-09 - Insecure Math.random() Usage for Dialog IDs
**Vulnerability:** Weak PRNG `Math.random()` was used for tracking internal Dialog component IDs. While not currently used in a security context, it is an anti-pattern.
**Learning:** `globalThis.crypto.randomUUID()` is preferred, but *must* be implemented with a fallback (e.g. `Math.random`) in frontend components, as `randomUUID` is undefined in non-secure contexts (e.g., local HTTP development) and will throw a `TypeError`.
**Prevention:** Always use `crypto.randomUUID()` with a safe fallback in frontend code, or just use a monotonically increasing counter for purely internal DOM/component IDs where security is not a concern, to avoid security theater.
