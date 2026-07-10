## 2026-07-10 - Release Notes Pagination Accessibility
**Learning:** Pagination dots in carousels/dialogs (like in `DialogReleaseNotes`) are often visually obvious but completely invisible to screen readers if they are just styled buttons without text.
**Action:** Always verify that purely visual navigation elements (like pagination dots) have `aria-label` (to describe the target page/slide) and `aria-current="true"` (on the active item) to ensure screen reader users can navigate them.
