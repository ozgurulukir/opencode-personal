## 2025-02-18 - Added ARIA labels to MessageNav buttons
**Learning:** SolidJS components in `packages/ui` must use explicit `aria-label`s, especially on dynamically generated list items or buttons without visible text content.
**Action:** Always provide localized `aria-label` fallbacks using the provided `useI18n` hook and pass correct parameters dynamically, avoiding `aria-label=""` when strings are nullable or empty.
