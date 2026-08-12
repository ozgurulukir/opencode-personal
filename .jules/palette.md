## 2025-02-12 - Remove Negative TabIndex from Input Buttons

**Learning:** When adding interactive actions (like copy to clipboard) inside a readonly or standard input element, using `tabIndex={-1}` makes the button unreachable for keyboard-only users.
**Action:** Remove `tabIndex={-1}` from nested buttons inside inputs unless they are explicitly within a clickable wrapper (like a parent `<div role="button">`) where focus is delegated.
