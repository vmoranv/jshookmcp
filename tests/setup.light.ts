// Lightweight per-worker setup: env vars only — no registry, no global mocks.
// Used by the "pure" project for tests that do NOT depend on registry or PageController.

process.env.NODE_ENV = 'test';
// eval-trace-capture: keep any server started under this setup from flushing
// tool-call traces into the real .ccg/traces directory.
process.env.MCP_TRACE_DISABLE = '1';
