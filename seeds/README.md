# Seeds Directory

`seeds/` only keeps component taxonomy data that is still used by local smoke and component-context checks.

Company entity fixtures moved to `tests/fixtures/dev-entities/`. They are dev-only fixtures for CI, local smoke, and preview workflows; production entity coverage must come from registry bootstrap.
