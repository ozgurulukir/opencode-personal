## 2026-07-10 - Release Notes Pagination Accessibility
**Learning:** Pagination dots in carousels/dialogs (like in `DialogReleaseNotes`) are often visually obvious but completely invisible to screen readers if they are just styled buttons without text.
**Action:** Always verify that purely visual navigation elements (like pagination dots) have `aria-label` (to describe the target page/slide) and `aria-current="true"` (on the active item) to ensure screen reader users can navigate them.
## 2023-10-25 - ARIA labels for search clear buttons
**Learning:** Icon-only buttons used to clear inputs (e.g., using `circle-x` icons) often lack `aria-label` attributes, making them inaccessible to screen readers.
**Action:** Always ensure icon-only buttons have an `aria-label` that provides context, and reuse existing translation keys (like `dialog.server.default.clear`) when adding labels to avoid duplicating strings across multiple translation files.
