# Requirements: jshookmcp v2.0

**Defined:** 2026-03-21
**Core Value:** Transform 240+ tool arsenal into intelligent autonomous agent for real-world reverse engineering against top-tier WAFs

## v2.0 Requirements

### Hybrid Semantic Routing

- [x] **ROUTE-01**: System performs dual-path retrieval combining BM25 (sparse) and vector embedding (dense) for tool search ✅
- [x] **ROUTE-02**: RRF (Reciprocal Rank Fusion) algorithm merges sparse and dense results with configurable weights ✅
- [x] **ROUTE-03**: Local in-process embedding model loads at startup (<50MB, <100ms inference) ✅
- [x] **ROUTE-04**: Tool description embeddings are pre-computed and cached at server initialization ✅
- [x] **ROUTE-05**: Embedding inference runs in WorkerThread to prevent event loop starvation ✅
- [x] **ROUTE-06**: Domain-specific semantic matching handles security/RE terminology (e.g., "fake fingerprint" → `evasion_anti_bot`) ✅
- [x] **ROUTE-07**: Cross-language semantic matching supports Chinese/English intent queries ✅

### State-Driven Auto-Boost

- [x] **BOOST-01**: EventBus emits typed events for tool calls, breakpoints, navigation, and memory scan results ✅
- [x] **BOOST-02**: ActivationController observes event patterns and auto-elevates session profile ✅
- [x] **BOOST-03**: Platform-specific tools are automatically filtered based on runtime OS detection ✅
- [x] **BOOST-04**: Domain boost has debounced cool-down period (30s) to prevent feedback loops ✅
- [x] **BOOST-05**: Multi-stage context awareness boosts tools based on compound conditions (e.g., "WASM inside Chrome on macOS") ✅
- [x] **BOOST-06**: Predictive boosting analyzes LLM call history to pre-load likely next tools ✅
- [x] **BOOST-07**: Auto-pruning removes irrelevant tools from context when leaving a domain state ✅

### Ephemeral Tool-as-Code

- [ ] **EXEC-01**: `execute_sandbox_script` tool accepts JS code and executes in WASM-isolated quickjs-emscripten sandbox
- [ ] **EXEC-02**: Sandbox enforces strict timeout (default 1000ms) and memory limits
- [ ] **EXEC-03**: Sandboxed scripts access internal tools via injected SDK (`mcp.call("tool_name", params)`)
- [ ] **EXEC-04**: Dynamic tool registration allows sandbox-created tools to appear in search results at runtime
- [ ] **EXEC-05**: LLM auto-correction loop retries with fixed code when sandbox script errors
- [ ] **EXEC-06**: Pre-built helper libraries (Lodash, CryptoJS) available inside sandbox
- [ ] **EXEC-07**: Session-local scratchpad persists variables across script executions within a session

### Sub-Agent Macro Workflows

- [ ] **MACRO-01**: `deobfuscate_ast_flow` composite tool chains: fetch_source → parse_ast → rename_variables → constant_folding → generate_code
- [ ] **MACRO-02**: `unpacker_flow` composite tool handles packed/webpack/eval-based code extraction
- [ ] **MACRO-03**: Macro failures are atomic — early bailout with partial result reporting on step error
- [ ] **MACRO-04**: Status streaming provides per-stage progress feedback to the LLM during macro execution
- [ ] **MACRO-05**: Dynamic DAG generation detects target obfuscation type and selects appropriate workflow
- [ ] **MACRO-06**: User-definable macros via JSON configuration files

### Time-Travel Debugging

- [ ] **TRACE-01**: TraceRecorder captures CDP events, function calls, and memory writes during target execution
- [ ] **TRACE-02**: Trace data stored in SQLite (better-sqlite3) with indexed columns for address, timestamp, and event type
- [ ] **TRACE-03**: `query_trace_sql` tool allows SQL queries against recorded traces
- [ ] **TRACE-04**: Differential tracing records only deltas (register/memory changes) to minimize storage
- [ ] **TRACE-05**: Trace export/import supports Chrome Trace Event JSON format
- [ ] **TRACE-06**: Heap snapshot diffing compares two points in time to identify state changes
- [ ] **TRACE-07**: `seek_to_timestamp` restores debugger state to a specific point in recorded trace

### Anti-Detection Hardening

- [ ] **STEALTH-01**: CDP fingerprint spoofing hides `navigator.webdriver`, `cdc_` variables, and DevTools protocol markers
- [ ] **STEALTH-02**: User-agent rotation with consistent hardware profile matching
- [ ] **STEALTH-03**: Stealth scripts injected via `Page.addScriptToEvaluateOnNewDocument` before first script execution
- [ ] **STEALTH-04**: Camoufox/Patchright integration for C++-level automation trace removal
- [ ] **STEALTH-05**: Timing jitter on CDP commands mimics human/natural network latency
- [ ] **STEALTH-06**: Real-world fingerprint dataset injection (fingerprint-injector) prevents "Franken-Browser" detection

## Future Requirements

### Advanced Analysis (deferred to v2.1+)

- **ADV-01**: JSVMP opcode-level dynamic taint analysis engine
- **ADV-02**: Kernel-level timing mitigation for anti-debug bypass
- **ADV-03**: Low-level CDP protocol hooking to hide debugger existence entirely

## Out of Scope

| Feature | Reason |
|---------|--------|
| JSVMP bytecode decompiler | Requires custom VM analysis engine beyond LLM capability |
| Real-time synchronous hook with LLM in loop | Physical latency constraint (~seconds) makes this impossible against timing checks |
| Linux native memory support | Separate milestone (v3.0) |
| Mobile platform (Android/iOS) RE | Fundamentally different architecture |
| Cloud-hosted embedding API | Privacy risk for reverse engineering workflows |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ROUTE-01 | Phase 8 | Done ✅ |
| ROUTE-02 | Phase 8 | Done ✅ |
| ROUTE-03 | Phase 8 | Done ✅ |
| ROUTE-04 | Phase 8 | Done ✅ |
| ROUTE-05 | Phase 8 | Done ✅ |
| ROUTE-06 | Phase 8 | Done ✅ |
| ROUTE-07 | Phase 8 | Done ✅ |
| BOOST-01 | Phase 9 | Done ✅ |
| BOOST-02 | Phase 9 | Done ✅ |
| BOOST-03 | Phase 9 | Done ✅ |
| BOOST-04 | Phase 9 | Done ✅ |
| BOOST-05 | Phase 9 | Done ✅ |
| BOOST-06 | Phase 9 | Done ✅ |
| BOOST-07 | Phase 9 | Done ✅ |
| EXEC-01 | Phase 10 | Pending |
| EXEC-02 | Phase 10 | Pending |
| EXEC-03 | Phase 10 | Pending |
| EXEC-04 | Phase 10 | Pending |
| EXEC-05 | Phase 10 | Pending |
| EXEC-06 | Phase 10 | Pending |
| EXEC-07 | Phase 10 | Pending |
| MACRO-01 | Phase 11 | Pending |
| MACRO-02 | Phase 11 | Pending |
| MACRO-03 | Phase 11 | Pending |
| MACRO-04 | Phase 11 | Pending |
| MACRO-05 | Phase 11 | Pending |
| MACRO-06 | Phase 11 | Pending |
| TRACE-01 | Phase 12 | Pending |
| TRACE-02 | Phase 12 | Pending |
| TRACE-03 | Phase 12 | Pending |
| TRACE-04 | Phase 12 | Pending |
| TRACE-05 | Phase 12 | Pending |
| TRACE-06 | Phase 12 | Pending |
| TRACE-07 | Phase 12 | Pending |
| STEALTH-01 | Phase 13 | Pending |
| STEALTH-02 | Phase 13 | Pending |
| STEALTH-03 | Phase 13 | Pending |
| STEALTH-04 | Phase 13 | Pending |
| STEALTH-05 | Phase 13 | Pending |
| STEALTH-06 | Phase 13 | Pending |

**Coverage:**
- v2.0 requirements: 40 total
- Mapped to phases: 40 ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-21*
*Last updated: 2026-03-21 after roadmap creation*

