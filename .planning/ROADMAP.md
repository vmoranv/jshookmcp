# Roadmap — jshookmcp

## Milestones

- ✅ **v1.0 macOS Native Memory Support** — Phases 1-7 (shipped 2026-03-21)
- 🚀 **v2.0 Next-Gen Intelligent RE Agent** — Phases 8-13 (in progress)

## Phases

<details>
<summary>✅ v1.0 macOS Native Memory Support (Phases 1-7) — SHIPPED 2026-03-21</summary>

- [x] Phase 1: Platform Abstraction Interface — completed
- [x] Phase 2: Win32 Provider + Factory — completed
- [x] Phase 3: Darwin Memory Provider — completed
- [x] Phase 4: Cross-Platform Engine Refactoring — completed
- [x] Phase 5: Platform-Aware Tool Registration — completed
- [x] Phase 6: Testing & Verification — completed
- [x] Phase 7: Tech Debt Cleanup — completed

See [v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md) for full details.

</details>

<details open>
<summary>🚀 v2.0 Next-Gen Intelligent RE Agent (Phases 8-13) — IN PROGRESS</summary>

### Phase 8: Hybrid Semantic Routing ✅ (completed 2026-03-21)
**Goal:** Enhance tool discovery with Dense+Sparse dual-path retrieval and RRF reranking
**Requirements:** ROUTE-01, ROUTE-02, ROUTE-03, ROUTE-04, ROUTE-05, ROUTE-06, ROUTE-07
**Success Criteria:**
1. ✅ Tool search returns relevant results for natural language queries in both English and Chinese
2. ✅ Embedding-based search (dense) and BM25 (sparse) results are merged with RRF ranking algorithm
3. ✅ Embedding inference runs in WorkerThread and completes in <100ms without blocking the event loop

### Phase 9: State-Driven Auto-Boost & Intelligence ✅ (completed 2026-03-21)
**Goal:** Transform manual boost_profile into event-driven automatic context management
**Requirements:** BOOST-01, BOOST-02, BOOST-03, BOOST-04, BOOST-05, BOOST-06, BOOST-07
**Success Criteria:**
1. ✅ ActivationController auto-elevates session profiles when specific event patterns (breakpoints, memory scans) are detected
2. ✅ Platform-specific tools are automatically filtered based on runtime OS detection
3. ✅ Token budget is preserved by auto-pruning irrelevant tools from context when leaving a domain state

### Phase 10: Ephemeral Tool-as-Code Sandbox
**Goal:** Enable LLM to write and execute custom scripts in WASM-isolated sandbox
**Requirements:** EXEC-01, EXEC-02, EXEC-03, EXEC-04, EXEC-05, EXEC-06, EXEC-07
**Success Criteria:**
1. `execute_sandbox_script` successfully executes JS in a WASM-isolated QuickJS sandbox
2. Sandboxed scripts can call host MCP tools via the injected SDK (`mcp.call`)
3. Sandbox enforces strict memory limits and a 1000ms timeout for security

### Phase 11: Sub-Agent Macro Orchestration
**Goal:** Provide composite high-level tools that chain multiple primitive operations
**Requirements:** MACRO-01, MACRO-02, MACRO-03, MACRO-04, MACRO-05, MACRO-06
**Success Criteria:**
1. Composite tools like `deobfuscate_ast_flow` successfully chain source fetching, parsing, and AST transformations
2. Real-time progress feedback is streamed to the LLM during multi-stage macro execution
3. Failure in any macro step triggers an atomic bailout with partial results reported

### Phase 12: Time-Travel Trace & Debugging
**Goal:** Record execution traces and enable offline SQL-queryable analysis
**Requirements:** TRACE-01, TRACE-02, TRACE-03, TRACE-04, TRACE-05, TRACE-06, TRACE-07
**Success Criteria:**
1. CDP events and memory writes are recorded into a queryable SQLite database
2. Debugger state can be restored to any specific timestamp in a recorded trace
3. Memory heap snapshots can be diffed between two points in time to identify state changes

### Phase 13: Stealth & Anti-Detection Hardening
**Goal:** Integrate stealth primitives to bypass modern bot protection and WAFs
**Requirements:** STEALTH-01, STEALTH-02, STEALTH-03, STEALTH-04, STEALTH-05, STEALTH-06
**Success Criteria:**
1. Browser instances pass standard bot detection tests (navigator.webdriver, DevTools protocol markers)
2. Timing jitter on CDP commands mimics human/natural network latency
3. Integration with Camoufox/Patchright removes C++-level automation traces

</details>
