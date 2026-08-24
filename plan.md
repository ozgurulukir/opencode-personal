1. **Fix Insecure CORS Validation in `packages/opencode/src/server/cors.ts`**:
   - The functions checking for localhost origins (`input.startsWith("http://localhost:")` and `input.startsWith("http://127.0.0.1:")`) are vulnerable to bypass because they allow any domain starting with that string (e.g., `http://localhost:3000.evil.com`).
   - Replace these checks with a robust URL parsing check that strictly validates `url.hostname` is exactly `localhost` or `127.0.0.1`.
   - Ensure `oc://renderer` is checked exactly or parsed properly if it expects a port. `startsWith("oc://renderer")` might also be vulnerable to `oc://renderer.evil.com`. But custom schemes are not typically sent cross-origin from the web. Using `^oc:\/\/renderer$` or parsing is safer.

2. **Verify Changes**:
   - Run `bun run oxlint packages/opencode/src/server/` and `bun run turbo typecheck` from the repository root to verify the changes.
   - Run tests if there are any related to the server/CORS.

3. Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.

4. **Submit PR**:
   - Call the `submit` tool.
   - `branch_name`: "sentinel/cors-localhost-regex-fix"
   - `commit_message`: "fix: prevent CORS bypass via insecure origin validation"
   - `title`: "🛡️ Sentinel: [HIGH] Fix Insecure CORS Origin Validation"
   - `description`: "🚨 Severity: HIGH\n💡 Vulnerability: The CORS validation logic used `startsWith('http://localhost:')` and `startsWith('http://127.0.0.1:')`, which incorrectly allows any domain starting with that string (e.g., `http://localhost:3000.evil.com`). This allows malicious websites to bypass CORS protections and access the local API.\n🎯 Impact: Malicious actors could host a website on a similarly named domain and bypass local security restrictions.\n🔧 Fix: Updated the origin check to parse the URL and strictly validate that the `hostname` is exactly `localhost` or `127.0.0.1`.\n✅ Verification: Code runs locally and typechecks pass."
