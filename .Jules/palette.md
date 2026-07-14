## 2024-07-11 - Adding ARIA labels to IconButtons
**Learning:** Found multiple instances of `<IconButton>` in the app components (like `settings-keybinds.tsx` and `settings-models.tsx`) being used as clear buttons but lacking `aria-label`s, which is an accessibility anti-pattern since the underlying `<button>` won't have an accessible name.
**Action:** When working with `<IconButton>` or similar icon-only interactive elements, ensure they are always provided with a localized `aria-label`.
