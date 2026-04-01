# CLAUDE.md — jshookmcp

> MCP server with 23 domains, 327+ tools for AI-assisted JavaScript analysis — browser automation, CDP debugging, network monitoring, JS hooks, deobfuscation, and workflow orchestration.
>
> **Generated**: 2026-04-01 12:13:54 | **Version**: 0.2.5 | **License**: AGPL-3.0-only

---

## Quick Navigation

| Layer | Path | Purpose |
|-------|------|---------|
| Entry | `src/index.ts` | CLI bootstrap, signal handling, graceful shutdown |
| Server | `src/server/MCPServer.ts` | God-class split — core orchestrator |
| Registry | `src/server/registry/` | Runtime domain discovery & tool registration |
| Domains | `src/server/domains/*/manifest.ts` | 23 domain manifests (tool definitions + handlers) |
| Modules | `src/modules/` | Business logic (17 sub-modules) |
| Native | `src/native/` | FFI via koffi (Win32/Darwin memory, PE analysis) |
| Utils | `src/utils/` | Shared utilities (cache, config, logging, workers) |
| Types | `src/types/` | Shared type definitions |
| Tests | `tests/` | 609 test files, vitest v4.x |
| E2E | `tests/e2e/` | End-to-end tests (separate config) |
| Docs | `docs/` | VitePress documentation (zh + en) |
| Workflows | `workflows/` | Extension mount point (workflows installed via registry) |
| SDK | `packages/extension-sdk/` | Extension SDK for plugins/workflows |

---

## Architecture Overview

```mermaid
graph TB
    CLI["src/index.ts<br/>CLI Entry"]
    MCP["MCPServer<br/>(split: .tools, .search, .domain,<br/>.transport, .context, .resources)"]
    REG["Registry<br/>discovery.ts → contracts.ts"]
    BUS["EventBus"]
    ROUTER["ToolRouter<br/>.intent / .probe / .policy / .renderer"]
    SEARCH["ToolSearchEngine<br/>BM25 + Trigram + Embedding + Affinity"]
    ACT["ActivationController<br/>AutoPruner / PredictiveBooster"]
    GUARD["ToolCallContextGuard"]

    subgraph Domains["23 Domain Manifests"]
        D_BROWSER["browser"]
        D_DEBUG["debugger"]
        D_NET["network"]
        D_HOOK["hooks"]
        D_ANALYSIS["core/analysis"]
        D_ENCODE["encoding"]
        D_GRAPH["graphql"]
        D_STREAM["streaming"]
        D_WASM["wasm"]
        D_PROC["process"]
        D_MEM["memory"]
        D_PLAT["platform"]
        D_ANTI["antidebug"]
        D_TRANS["transform"]
        D_SMAP["sourcemap"]
        D_WF["workflow"]
        D_TRACE["trace"]
        D_EVID["evidence"]
        D_INSTR["instrumentation"]
        D_COORD["coordination"]
        D_MAINT["maintenance"]
        D_MACRO["macro"]
        D_SAND["sandbox"]
    end

    subgraph Modules["Business Logic Modules"]
        M_BROWSER["browser/"]
        M_COLLECT["collector/"]
        M_DEBUG["debugger/"]
        M_DEOBF["deobfuscator/"]
        M_HOOK["hook/"]
        M_MONITOR["monitor/"]
        M_PROCESS["process/"]
        M_CRYPTO["crypto/"]
        M_ANALYZE["analyzer/"]
        M_CAPTCHA["captcha/"]
        M_STEALTH["stealth/"]
        M_EMULAT["emulator/"]
        M_SYMBOL["symbolic/"]
        M_TRACE["trace/"]
    end

    subgraph Native["Native FFI (koffi)"]
        N_MEM["MemoryScanner/Controller"]
        N_PE["PEAnalyzer"]
        N_HW["HardwareBreakpoint"]
        N_WIN["Win32API/Debug"]
        N_DARWIN["DarwinAPI"]
    end

    CLI --> MCP
    MCP --> REG
    MCP --> BUS
    MCP --> ROUTER
    MCP --> SEARCH
    MCP --> ACT
    MCP --> GUARD
    REG -->|discoverDomainManifests| Domains
    Domains -->|ensure() factory| Modules
    Modules --> Native
```

---

## Core Architectural Patterns

### 1. Runtime Domain Discovery
```
src/server/registry/discovery.ts
  → scans src/server/domains/*/manifest.ts
  → validates DomainManifest contract (kind, version, domain, depKey, profiles, registrations, ensure)
  → builds tool groups, domain map, handler map
```
**Add a new domain**: Create `src/server/domains/<name>/manifest.ts` exporting a `DomainManifest`. No manual imports needed.

### 2. Lazy Proxy Pattern
```
MCPServer.domain.ts → createDomainProxy(ctx, domain, label, factory)
  → Proxy intercepts property access
  → first access triggers ensure(ctx) factory
  → supports sync and async factories
  → instance cached in domainInstanceMap
```

### 3. Domain Manifest Contract (`src/server/registry/contracts.ts`)
```typescript
interface DomainManifest {
  kind: 'domain-manifest';
  version: 1;
  domain: string;           // e.g. 'browser'
  depKey: string;            // e.g. 'browserHandlers'
  profiles: ToolProfileId[]; // 'search' | 'workflow' | 'full'
  registrations: ToolRegistration[];
  ensure: (ctx: MCPServerContext) => T | Promise<T>;
  workflowRule?: { patterns, priority, tools, hint };
  prerequisites?: Record<string, Array<{condition, fix}>>;
  toolDependencies?: Array<{from, to, relation, weight}>;
}
```

### 4. MCPServer God-Class Split
Split into focused modules — all attached to `MCPServer` via composition:
| File | Responsibility |
|------|---------------|
| `MCPServer.ts` | Core class, domain instance map, lifecycle |
| `MCPServer.context.ts` | `MCPServerContext` interface (sub-interfaces: ServerCore, ToolRegistryState, ActivationState, TransportState, ExtensionState, DomainInstances, ServerMethods) |
| `MCPServer.domain.ts` | `createDomainProxy()`, `resolveEnabledDomains()` |
| `MCPServer.transport.ts` | stdio + HTTP transport setup |
| `MCPServer.tools.ts` | Tool registration |
| `MCPServer.search.ts` | Search meta-tools |
| `MCPServer.resources.ts` | MCP resource registration |
| `MCPServer.activation.ttl.ts` | Domain TTL management |
| `MCPServer.schema.ts` | Schema generation |
| `MCPServer.registration.ts` | Tool resolution for registration |

### 5. parseArgs Utility (`src/server/domains/shared/parse-args.ts`)
Type-safe arg extraction replacing `as` assertions:
- `argString(args, key)` / `argString(args, key, fallback)` — non-throwing
- `argStringRequired(args, key)` — throws if missing (use only in try-catch)
- `argNumber`, `argBool`, `argEnum`, `argStringArray`, `argObject`
- **argEnum error format**: `Invalid ${key}: "${v}". Expected one of: ...`

---

## 23 Domains

| # | Domain | Profile Tier | Manifest Path |
|---|--------|-------------|---------------|
| 1 | `core` (analysis) | workflow, full | `domains/analysis/manifest.ts` |
| 2 | `antidebug` | full | `domains/antidebug/manifest.ts` |
| 3 | `browser` | workflow, full | `domains/browser/manifest.ts` |
| 4 | `coordination` | workflow, full | `domains/coordination/manifest.ts` |
| 5 | `debugger` | workflow, full | `domains/debugger/manifest.ts` |
| 6 | `encoding` | workflow, full | `domains/encoding/manifest.ts` |
| 7 | `evidence` | workflow, full | `domains/evidence/manifest.ts` |
| 8 | `graphql` | workflow, full | `domains/graphql/manifest.ts` |
| 9 | `hooks` | workflow, full | `domains/hooks/manifest.ts` |
| 10 | `instrumentation` | workflow, full | `domains/instrumentation/manifest.ts` |
| 11 | `macro` | full | `domains/macro/manifest.ts` |
| 12 | `maintenance` | search, workflow, full | `domains/maintenance/manifest.ts` |
| 13 | `memory` | workflow, full | `domains/memory/manifest.ts` |
| 14 | `network` | workflow, full | `domains/network/manifest.ts` |
| 15 | `platform` | full | `domains/platform/manifest.ts` |
| 16 | `process` | full | `domains/process/manifest.ts` |
| 17 | `sandbox` | full | `domains/sandbox/manifest.ts` |
| 18 | `sourcemap` | workflow, full | `domains/sourcemap/manifest.ts` |
| 19 | `streaming` | workflow, full | `domains/streaming/manifest.ts` |
| 20 | `trace` | workflow, full | `domains/trace/manifest.ts` |
| 21 | `transform` | workflow, full | `domains/transform/manifest.ts` |
| 22 | `wasm` | full | `domains/wasm/manifest.ts` |
| 23 | `workflow` | workflow, full | `domains/workflow/manifest.ts` |

Plus: `native-bridge` (inline in `domains/native-bridge/index.ts`, no manifest — IDA/Ghidra bridge)

---

## Build & Dev

```bash
# Install
pnpm install

# Dev (tsx watch)
pnpm dev

# Build (tsc + tsc-alias + copy native scripts + generate entry re-exports)
pnpm build

# Full quality check
pnpm check    # = metadata:check + lint + format:check + typecheck + test

# Test
pnpm test                    # unit tests (vitest, pool: forks)
pnpm test:e2e                # E2E tests (requires browser)
pnpm test:coverage           # with v8 coverage

# Lint & Format
pnpm lint                    # oxlint
pnpm format                  # oxfmt

# Docs
pnpm docs:dev                # VitePress dev server
pnpm docs:build              # Build docs
```

---

## TypeScript Configuration

| Setting | Value | Notes |
|---------|-------|-------|
| `target` | ES2023 | |
| `module` | ESNext | |
| `moduleResolution` | bundler | |
| `strict` | true | |
| `noUncheckedIndexedAccess` | true | Record/array indexing returns `T \| undefined` |
| `verbatimModuleSyntax` | true | Must use `import type` for type-only imports |
| `noUnusedLocals` | true | |
| `noUnusedParameters` | true | |
| `noImplicitReturns` | true | |
| `isolatedModules` | true | |

### Path Aliases
| Alias | Maps To |
|-------|---------|
| `@src/*` | `src/*` |
| `@modules/*` | `src/modules/*` |
| `@server/*` | `src/server/*` |
| `@utils/*` | `src/utils/*` |
| `@native/*` | `src/native/*` |
| `@internal-types/*` | `src/types/*` |
| `@errors/*` | `src/errors/*` |
| `@services/*` | `src/services/*` |
| `@tests/*` | `tests/*` |
| `@extension-sdk/*` | `packages/extension-sdk/src/*` |

---

## Testing

- **Framework**: Vitest 4.x, pool: forks
- **Files**: 609 test files in `tests/`
- **Coverage thresholds**: lines 95%, functions 95%, branches 85%, statements 95%
- **Setup**: `tests/setup.ts` — initializes registry, mocks PageController evaluate wrappers
- **E2E**: Separate config at `tests/e2e/vitest.e2e.config.ts`
  - Only runs when `E2E_TARGET_URL` env var is set
  - Target: `https://vmoranv.github.io/jshookmcp/`
  - `perToolTimeout: 60000ms`
- **Coverage exclusions**: types, index barrels, manifests, definition-only files, pure re-export handlers

### Test Naming Conventions
| Pattern | Purpose |
|---------|---------|
| `*.test.ts` | Standard unit tests |
| `*.coverage.test.ts` | Coverage expansion tests (added 2026-04-01) |
| `*.additional.test.ts` | Edge case / supplementary tests |
| `*.extended.test.ts` | Extended scenario tests |

### Known Skip Categories
- Dynamic `import('node:fs')` cannot be mocked with `vi.mock`
- `@babel/traverse` visitor hoisting conflicts
- Vitest microtask timing edge cases

---

## Key Conventions

### Code Style
1. **No `as` assertions** — use `parseArgs` utilities instead
2. **No `satisfies`** on objects needing string indexing (removes index signature)
3. **Re-export chains flattened** — `handlers.ts` re-exports directly from implementation
4. **`import type`** required for type-only imports (`verbatimModuleSyntax`)

### Persistent Injection Pattern
All injection tools (fetch/XHR/SSE/scriptMonitor/functionTracer/propertyWatcher) support `persistent: true` via:
- CDP: `Page.addScriptToEvaluateOnNewDocument`
- Playwright: `page.evaluateOnNewDocument()`

### Environment Variables
Runtime-tunable via `src/constants.ts` — every constant reads from env with fallback:
```typescript
const SHUTDOWN_TIMEOUT_MS = int('SHUTDOWN_TIMEOUT_MS', 10_000);
```

### Error Handling
- `ToolError` (`src/errors/ToolError.ts`) — standard tool error
- `PrerequisiteError` (`src/errors/PrerequisiteError.ts`) — missing prerequisites
- `asErrorResponse()` — wraps errors for MCP response format

---

## Extension System

### Plugin SDK (`packages/extension-sdk/`)
- Entry: `packages/extension-sdk/src/index.ts`
- Exports: plugin builder, workflow builder, bridge utilities
- Build: separate TSC in `packages/extension-sdk/`

### Extension Manager (`src/server/extensions/ExtensionManager.ts`)
Split sub-modules:
| Sub-module | Responsibility |
|-----------|---------------|
| `ExtensionManager.roots.ts` | Path resolution |
| `ExtensionManager.version.ts` | Semver compatibility |
| `ExtensionManager.integrity.ts` | Digest allowlist, env guards |
| `ExtensionManager.guards.ts` | Type guards |
| `ExtensionManager.discovery.ts` | File scanning |
| `ExtensionManager.lifecycle.ts` | Cleanup, config, list building |

### Workflow Engine (`src/server/workflows/`)
- `WorkflowEngine.ts` — Execution engine
- `WorkflowContract.ts` — Contract definitions
- `workflows/` (root) — Extension mount point (empty; workflows installed from external repos via registry)

---

## Tool Search Engine (`src/server/search/`)

Multi-signal search pipeline:
```
QueryNormalizer → SynonymExpander → BM25Scorer + TrigramIndex
    → EmbeddingEngine → IntentBoost → AffinityGraph
    → FeedbackTracker → ToolSearchEngineImpl (orchestrator)
```

---

## Activation System (`src/server/activation/`)

- `ActivationController` — Manages dynamic tool activation/deactivation
- `AutoPruner` — Auto-expires unused tools
- `PredictiveBooster` — Pre-activates tools based on patterns
- `CompoundConditionEngine` — Evaluates activation conditions
- Profile tiers: `search` ⊂ `workflow` ⊂ `full`

---

## Native FFI Layer (`src/native/`)

Cross-platform memory operations via [koffi](https://koffi.dev/):
| Module | Purpose |
|--------|---------|
| `NativeMemoryManager` | Memory read/write/scan orchestrator |
| `MemoryScanner` + `MemoryScanSession` | Pattern scanning with comparators |
| `MemoryController` | Memory region management |
| `HeapAnalyzer` | Heap inspection |
| `HardwareBreakpoint` | Hardware breakpoints (Win32) |
| `PEAnalyzer` | PE file analysis |
| `PointerChainEngine` | Pointer chain resolution |
| `StructureAnalyzer` | Memory structure analysis |
| `CodeInjector` | Code injection |
| `Speedhack` | Time manipulation |
| `AntiCheatDetector` | Anti-cheat detection |
| `Win32API` / `Win32Debug` | Windows API wrappers |
| `platform/darwin/DarwinAPI` | macOS API wrappers |

---

## File Statistics

| Category | Count |
|----------|-------|
| Source files (`src/**/*.ts`) | 549 |
| Source lines | ~90,000 |
| Test files (`tests/**/*.test.ts`) | 609 |
| Domain manifests | 23 |
| Pre-built workflows | 0 (moved to external repos) |
| Build scripts | 12 |
| Doc pages (md) | ~80 |

---

## Module-Level CLAUDE.md Files

- [`src/server/CLAUDE.md`](src/server/CLAUDE.md) — Server infrastructure
- [`src/modules/CLAUDE.md`](src/modules/CLAUDE.md) — Business logic modules
- [`src/native/CLAUDE.md`](src/native/CLAUDE.md) — Native FFI layer
- [`src/utils/CLAUDE.md`](src/utils/CLAUDE.md) — Shared utilities (cache, workers, config, serialization)
- [`src/server/domains/browser/CLAUDE.md`](src/server/domains/browser/CLAUDE.md) — Browser domain (largest, ~7,300 lines)
- [`src/server/domains/network/CLAUDE.md`](src/server/domains/network/CLAUDE.md) — Network domain (~3,100 lines)
- [`src/server/domains/debugger/CLAUDE.md`](src/server/domains/debugger/CLAUDE.md) — Debugger domain (~2,600 lines)
- [`tests/CLAUDE.md`](tests/CLAUDE.md) — Test organization, mock strategies, coverage
