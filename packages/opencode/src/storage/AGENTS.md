# Database

## `Database.Client` is a lazy singleton

`Database.Client` (in `db.ts:91`) is a `lazy()` singleton — the SQLite connection is opened once and shared across the entire process lifetime. This means:

- Data written to any table by one test persists for subsequent tests in the same process.
- `Database.close()` resets the singleton, but tests rarely call it.
- `PermissionTable` upserts (`onConflictDoUpdate`) by `project_id` — if two tests share the same `project_id` (e.g., both use `ProjectID.global` because git detection failed), the second test reads the first test's approved ruleset from the DB.

## `Database.use` falls back to `Client()` when no transaction context exists

`Database.use()` (line 137) first tries to read from `LocalContext` (set by `Database.transaction()`). If no transaction context exists (common in tests), it falls back to `Client()` directly. This means `Database.use()` in `InstanceState.make` init functions reads from the global singleton, not from any test-scoped transaction.
