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

## 2026-07-19 - Redundant Nested Tab Stops

**Learning:** When using custom container components that act as a button (like `div role="button"`), nesting an `IconButton` inside it creates a double tab-stop and redundant screen reader announcement. Keyboard users have to press tab twice to pass through a single logical action.

**Action:** Added `tabIndex={-1}` to the inner `IconButton` elements inside the `session-*-dock` collapsible headers. This keeps the icon clickable by mouse but removes it from the keyboard focus order, letting the parent `div role="button"` handle all keyboard interaction.

## 2026-07-19 - Missing ARIA Expansion States on Docks
**Learning:** Collapsible side/dock panels that manage state using purely visual indicators (`data-collapsed="true"`) miss screen reader cues because `aria-expanded` is not set on their respective toggle buttons.
**Action:** When implementing expandable or toggleable sections, alongside custom state attributes like `data-collapsed` or `data-active`, always include corresponding semantic ARIA attributes (`aria-expanded`, `aria-current`) for screen readers.
WebUI is UX-ready
## 2024-07-20 - [WebUI Polish Audit]

**Major Findings:**
- No major missing ARIA labels on IconButtons (`aria-label` used broadly via `language.t(...)`).
- Focus traps and `tabIndex` are managed correctly (e.g., hidden links, off-screen dialog controls, empty terminals).
- No obvious regression in visual polish that would be high-impact.

**Patterns to Repeat:**
- Comprehensive use of `i18n.t()` or `language.t()` for dynamically generated ARIA labels.
- Using Kobalte for core components effectively manages accessibility states like `aria-expanded` and focus.

**Patterns to Avoid:**
- None found during this audit.

**Lessons Learned:**
- WebUI is already highly polished and accessible. Suggest future user testing to find real friction points.
## 2025-03-24 - WebUI Polish Audit: Focus Management in Dialogs

**Major Findings:**
- The custom focus trap logic in `packages/ui/src/components/dialog.tsx` relies on querying the `[autofocus]` DOM attribute (`target?.querySelector("[autofocus]")`).
- The `TextField` component did not explicitly accept an `autofocus` prop, causing it to fall into the `...others` spread which was applied to the outer wrapper (`Kobalte.Input` or `Kobalte.TextArea` inner components didn't receive it properly to let the Dialog trap mechanism target the actual input).
- This resulted in modals (e.g. "Connect Provider", "Edit Project") not auto-focusing on the first relevant input as intended by developers adding `autofocus` to `<TextField>`.

**Patterns to Repeat:**
- Explicitly separating functional native DOM properties (like `autofocus`, `name`, `disabled`) via `splitProps` in wrapper components to guarantee they get forwarded down to the lowest-level inner HTML element (like `<input>`) where they are actually respected by native browser events and generic queries.

**Patterns to Avoid:**
- Implicitly relying on generic prop spreading (`...others`) to attach important accessibility/focus attributes on complex components, as the attribute may end up on a non-interactive wrapper div.

**Lessons Learned:**
- SolidJS `splitProps` operates strictly. If an attribute isn't explicitly intercepted and forwarded, it goes to the wrapper. For focus management targeting the `[autofocus]` attribute to work with Kobalte dialogs, we need to ensure interactive inputs actually get the attribute.
