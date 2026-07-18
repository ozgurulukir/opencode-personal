## 2024-05-18 - Missing ARIA Expansion States on Docks
**Learning:** Collapsible side/dock panels that manage state using purely visual indicators (`data-collapsed="true"`) miss screen reader cues because `aria-expanded` is not set on their respective toggle buttons.
**Action:** When implementing expandable or toggleable sections, alongside custom state attributes like `data-collapsed` or `data-active`, always include corresponding semantic ARIA attributes (`aria-expanded`, `aria-current`) for screen readers.
