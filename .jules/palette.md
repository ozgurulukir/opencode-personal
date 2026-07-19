## 2026-07-10 - Release Notes Pagination Accessibility
**Learning:** Pagination dots in carousels/dialogs (like in `DialogReleaseNotes`) are often visually obvious but completely invisible to screen readers if they are just styled buttons without text.
**Action:** Always verify that purely visual navigation elements (like pagination dots) have `aria-label` (to describe the target page/slide) and `aria-current="true"` (on the active item) to ensure screen reader users can navigate them.

## 2026-07-17 - Added ARIA labels to MessageNav buttons
**Learning:** SolidJS components in `packages/ui` must use explicit `aria-label`s, especially on dynamically generated list items or buttons without visible text content.
**Action:** Always provide localized `aria-label` fallbacks using the provided `useI18n` hook and pass correct parameters dynamically, avoiding `aria-label=""` when strings are nullable or empty.

## 2026-07-17 - Standardized loading states in dialog submit buttons (#26)
**Learning:** Async submit actions in dialogs (provider connect, edit project, server select) need a consistent pending state to prevent double-submits and give clear feedback. The established pattern in `packages/app` is a `pending` boolean in the form store (or `mutation.isPending`) wired to `disabled={pending}` plus a `<Spinner class="size-4" />` next to the action label, all wrapped in `try/finally` so `pending` resets on both success and error paths.
**Action:** When adding async submit handlers, set a `pending` flag before the await and reset it in a `finally` block; disable the submit button on `pending`; render `<Spinner class="size-4" />` alongside the existing i18n label inside a `flex items-center gap-2` wrapper. Use the shared `Spinner` from `@opencode-ai/ui/spinner` rather than text-only states like "Saving...". All i18n keys used (`common.continue`, `common.saving`, `common.save`, `dialog.server.add.checking`) already exist in `packages/app/src/i18n/en.ts`.

## 2026-07-28 - ARIA Current for Navigation State
**Learning:** Adding `data-active` attributes to items provides clear visual styling for the currently selected item, but screen readers require `aria-current="true"` to denote the active state of interactive list elements or navigation items. This helps users relying on assistive tech understand their current location within a widget or list (like the message timeline/nav).
**Action:** When applying a `data-active` or similar state-tracking property to a focusable or interactive element inside a navigation context or list, always supplement it with `aria-current={isActive ? "true" : undefined}`.
## 2026-07-19 - Model visibility toggles missing ARIA label
**Learning:** The `Switch` component uses `<Kobalte.Input />` under the hood. When used without children (e.g. just as a toggle element next to text), it has no accessible name unless `aria-label` is provided. This meant the model visibility toggles were announced just as generic switches to screen readers.
**Action:** When using `Switch` components purely as UI toggles without textual children, always provide children and use `hideLabel` (such as the name of the item being toggled) so screen readers can announce what the toggle controls.
