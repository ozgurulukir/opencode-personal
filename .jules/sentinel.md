## 2023-10-27 - Insecure CORS Origin Regex Allowing Arbitrary Subdomains

**Vulnerability:** The CORS origin regex `^https:\/\/([a-z0-9-]+\.)*opencode\.ai$` incorrectly allows ANY subdomain of `opencode.ai` (e.g. `https://evil.com.opencode.ai`, `https://user1.opencode.ai`). In environments where subdomains can be taken over, or where user-generated content is hosted on arbitrary subdomains, this allows malicious scripts on those subdomains to bypass CORS and access the API with credentials.

**Learning:** When defining CORS rules using regular expressions, wildcard domain matching (`([a-z0-9-]+\.)*`) is often overly permissive and a security risk. Origin whitelists should be as strict as possible.

**Prevention:** Use exact string matching or highly restrictive regexes that explicitly enumerate allowed subdomains (e.g., `^https:\/\/(app\.)?opencode\.ai$`). Avoid `*` quantifiers on subdomain segments unless you have strict control over all DNS records under the TLD.
