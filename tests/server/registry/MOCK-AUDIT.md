# Registry mock audit — why the v0.4.5 P0 slipped through 20,562 tests

Context: `search` tier could discover (`search_tools`) but not activate
(`activate_tools` → `notFound` / `totalDomainTools: 0`) any `workflow`/`full`
domain tool. Root cause: `ensureDomainLoaded` updated only `index.ts`'s local
`registrationsByName` map, not the shared read cache in `registry/state.ts`
that `getRegistrationByName` / `buildHandlerMapFromRegistry` actually read.

The full `pnpm test` suite (3 projects, 20,562 tests) passed. This audit records
why, so the same class of cross-layer state bug is not reintroduced silently.

## The three structural gaps

1. **Default `pnpm test` excludes all e2e** — `vitest.config.ts` sets
   `exclude: ['tests/e2e/**']` on all three projects. E2E runs only via
   `pnpm test:e2e` (build + `E2E_TARGET_URL`).
2. **The one e2e test that would have caught it used the wrong profile** —
   `tests/e2e/meta-tools-runtime.e2e.test.ts` asserts
   `activate_domain('browser')` yields `totalDomainTools > 0`, but
   `MCPTestClient.connect()` defaults `MCP_TOOL_PROFILE=full`. Under `full`,
   `initRegistry` loads the browser domain up front, so `totalDomainTools > 0`
   is always true. The bug needs `search` (zero domains at init + lazy load).
3. **No default-suite test exercised the real cross-layer path** — server-layer
   unit tests mock the registry modules; e2e is excluded. Nothing ran
   `initRegistry('search')` → `ensureDomainLoaded('browser')` →
   `getRegistrationByName('browser_attach')` against the real shared cache.

`tests/setup.registry.ts` is named "initializes registry" but does NOT call
`initRegistry`; it only sets env and mocks PageController. Do not assume a
server-project test has a real registry initialized.

## Files that mock the registry (classification)

Legend: **HIGH** = stubs `getRegistrationByName` / `ensureDomainLoaded` /
`loadSearchCatalog` with an always-succeeding or always-null fake, i.e. can
mask a cross-layer state bug like the v0.4.5 P0. **MED** = mocks the SDK/server
or `initRegistry`, so it is an isolated branch test, not a pipeline test.
**LOW** = mocks only build-time metadata / leaf validators; real registry logic
still runs.

| File | Mocked | Class |
|---|---|---|
| `MCPServer.search.handlers.activate.test.ts` | `ensureDomainLoaded`, `getRegistrationByName` (always returns a tool), `SearchCatalog`, `ToolHandlerMap`, `ToolCatalog` | **HIGH** — the exact functions that failed in production are faked to always succeed |
| `MCPServer.search.handlers.call.test.ts` | `ensureAllDomainsLoaded`, `SearchCatalog` | **HIGH** — auto-activate path fully faked |
| `MCPServer.search.handlers.domain.test.ts` | `ensureDomainLoaded` → null, `SearchCatalog` | **HIGH** |
| `MCPServer.search.test.ts` | `registry/index`, `registry/state`, `SearchCatalog`, `generated-domains` | **HIGH** — even `state` is mocked |
| `MCPServer.comprehensive.test.ts` | `initRegistry`, `ensureDomainLoaded` → null | MED |
| `architecture-integration.test.ts` | `registry/index` (fake registration list) | MED — misleading name, not a real integration |
| `MCPServer.test.ts` | whole `@modelcontextprotocol/server` | MED — constructs a half-mock server |
| `MCPServer.activation.ttl.test.ts` | `registry/views` | MED |
| `MCPServer.modern.session.test.ts` | `compiled-validators` | LOW |
| `MCPServer.search.helpers.test.ts` | `registry/index`, `SearchCatalog`, `generated-domains` | MED |
| `ServerRuntimeState.test.ts` | `ensureDomainLoaded` → null | MED |
| `ToolCatalog.cache.test.ts` | `getRegistrationByName` | MED |
| `ToolRouter.{test,coverage,policy}.test.ts` | `registry/views` / `index` / `state` (two call real `initRegistry()`) | MIXED |
| `extensions/ExtensionManager.test.ts` | `registry/views` | LOW |
| `modules/entry-and-barrels.test.ts`, `modules/process/ProcessManager.edge-cases.test.ts` | `initRegistry` no-op | LOW (import-safety tests) |
| `registry/discovery.test.ts`, `registry/index.test.ts` | `discovery` / `generated-domains` fixtures | LOW (real registry logic, fake manifests) |
| `domains/instrumentation/manifest.test.ts`, `domains/manifests.test.ts` | `ensure-browser-core` | LOW |

## What closes the gap

- `tests/server/registry/index.test.ts` — regression assertions that a lazily
  loaded domain's tools are resolvable via `getRegistrationByName` and present
  once in `getAllRegistrations()` (verified red when the fix is disabled).
- `tests/server/registry/pipeline.integration.test.ts` — no-mock in-process
  pipeline test (real `initRegistry('search')` + `activateToolNames`).
- `tests/e2e/meta-tools-runtime.e2e.test.ts` — real stdio MCP pipeline under
  `MCP_TOOL_PROFILE=search`: `activate_tools('browser_attach')` → `call_tool`.
- `pnpm check` / CI runs the e2e meta-tools subset so the real pipeline is
  gated, not just excluded.

Rule of thumb: a test that mocks `getRegistrationByName` to always return a
tool can never detect a registration-cache sync bug. Keep such mocks for pure
branch logic, but pair them with at least one no-mock integration test per
cross-layer invariant.
