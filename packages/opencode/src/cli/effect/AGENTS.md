# CLI Effect Prompt Wrapper

## `@clack/prompts` spinner API

`spinner.stop(msg, code)` was changed to `spinner.stop(msg?)` only (the `code` parameter was silently removed in a minor bump). Use `spinner.error(msg?)` for error states instead. The wrapper in `prompt.ts` handles this transparently: `stop(msg, code)` maps `code` truthy to `s.error(msg)` and falsy to `s.stop(msg)`.
