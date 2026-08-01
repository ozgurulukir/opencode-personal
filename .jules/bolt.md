## 2024-05-24 - Avoid duplicated derived checks in event handlers
**Learning:** Calculating complex state (like validating if an input is "blank" via array mapping, mapping, and joining) inside high-frequency event handlers like `onKeyDown` creates enormous GC pressure.
**Action:** Always check if a `createMemo` already computes the necessary state. Reuse existing memos instead of redundantly defining the check within the event handler.
