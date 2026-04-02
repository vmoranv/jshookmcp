// Lightweight per-worker setup: env vars only — no registry, no global mocks.
// Used by the "pure" project for tests that do NOT depend on registry or PageController.

process.env.ENABLE_INJECTION_TOOLS = 'true';
process.env.NODE_ENV = 'test';
