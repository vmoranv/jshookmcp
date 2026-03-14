# Implementation Plan

**Created**: 2026-03-14
**Based on**: Search Architecture + Node Compatibility Analysis

---

## 📊 Analysis Summary

### Search Architecture Issues

**8 Critical Failure Points Identified**:

- **F1 (HIGH)**: Default search-tier tools too limited
- **F2 (HIGH)**: Schema not visible before activation
- **F3 (MEDIUM)**: activate_tools parameter friction
- **F5 (MEDIUM-HIGH)**: Dynamic boost over-aggressive
- **F7 (MEDIUM)**: 7+ scoring mechanisms create complexity

**Recommended Solution**: Tool Router Layer (compress "search → activate → call" to 1-2 tool calls)

---

### Node Compatibility Issues

**Root Cause**: `isolated-vm` (V8 binding from webcrack) lacks prebuilt binaries for Node 22/24

**Node ABI Impact**:

- Node 20 (ABI=115): ✅ Has prebuild coverage
- Node 22 (ABI=127): ❌ Lacks prebuilds → node-gyp compilation fails
- Node 24 (ABI=137): ❌ Lacks prebuilds → node-gyp compilation fails

**Recommended Solution**: A+B+C Combination

- A: Upgrade webcrack/isolated-vm
- B: Make webcrack optional/plugin-based
- C: Improve Windows toolchain docs + doctor checks

---

## 🎯 Implementation Priorities

### P0 - Immediate (Critical User Experience)

#### 1. Tool Router Implementation

**Goal**: Compress multi-step search protocol into 1-2 tool calls

**Status**: ✅ Complete

**Tasks**:

- [x] Design Tool Router API (input: natural language goal → output: nextActions)
- [x] Implement routing logic with workflow-first heuristics
- [x] Add describe_tool capability for schema-first discovery
- [x] Integrate with existing search engine
- [x] Add safety guardrails for auto-activation
- [x] Add unit tests for Tool Router
- [x] Add integration tests with search_tools

**Files Created**:

- `src/server/ToolRouter.ts` (new) - Router implementation
- `src/server/MCPServer.search.ts` (modified) - Integrated route_tool and describe_tool handlers

**Success Metrics**:

- Reduce average tool calls from intent to first successful call
- Increase search_tools closure success rate

---

#### 2. Node Compatibility Fix

**Goal**: Enable installation on Node 22/24

**Status**: ✅ Complete (pnpm override + camoufox-js types added)

##### Phase 1: Investigation (Priority P0)

- [x] Check webcrack latest version and isolated-vm compatibility
- [x] Test isolated-vm prebuild availability for Node 22/24
- [x] Evaluate webcrack → make it optional dependency
- [x] Add camoufox-js type declarations

##### Phase 2: Implementation (Priority P1)

- [x] Upgrade webcrack if newer version available (N/A - already compatible)
- [x] Add pnpm overrides for isolated-vm if needed (isolated-vm@6.1.2)
- [x] Move webcrack to optionalDependencies (with feature gating)
- [x] Add doctor command to check native dependencies
- [x] Update documentation for Node version requirements

**Files Modified**:

- `package.json` (added isolated-vm override to 6.1.2)
- `pnpm-lock.yaml` (updated lockfile)

**Remaining Issues**:

- lefthook postinstall warning (non-blocking, can be ignored)

**Success Metrics**:

- Successful installation on Node 22/24 CI environments
- Reduced installation failure reports

---

### P1 - Near-term (Quality Improvements)

#### 3. Documentation Simplification

**Goal**: Remove redundancy, improve professionalism

**Status**: ✅ In Progress

**Tasks**:

- [ ] Audit all documentation files for redundancy
- [ ] Consolidate repeated references
- [ ] Simplify tool tables (use collapsible sections)
- [ ] Improve Chinese documentation quality
- [ ] Add troubleshooting guides

**Files to Modify**:

- `docs/**/*.md` (all documentation)
- `README.md`, `README.zh.md`

---

#### 4. Dynamic Boost Optimization

**Goal**: Reduce over-aggressive tier upgrades

**Tasks**:

- [ ] Change max-tier decision to top1-tier or majority-tier
- [ ] Add re-search after boost (optional, configurable)
- [ ] Add hard guardrails for full-tier auto-upgrade
- [ ] Expose boost behavior in search_tools response

**Files to Modify**:

- `src/server/MCPServer.search.dynamicBoost.ts`
- `src/server/MCPServer.search.ts`

---

### P2 - Medium-term (Architecture Modernization)

#### 5. File Size Refactoring

**Goal**: Split large files into nested structure

**Status**: ✅ Complete

**Target Files**:

- `src/server/ToolSearch.ts` (819 lines) → Split into:
  - `src/server/search/ToolSearchEngine.ts` (facade)
  - `src/server/search/BM25Scorer.ts` (154 lines)
  - `src/server/search/IntentBoost.ts` (137 lines)
  - `src/server/search/AffinityGraph.ts` (152 lines)
  - `src/server/search/ToolSearchEngineImpl.ts` (592 lines)
- `src/server/MCPServer.search.ts` (572 lines) → Kept as-is (already well-organized)
- Added `src/server/MCPServer.search.dynamicBoost.ts` (extracted boost logic)

**Success Metrics**:

- Reduced main ToolSearch file from 819 lines to 592 lines (search engine impl)
- Modular components < 200 lines each (except main impl)
- All TypeScript errors resolved
- Zero breaking changes to public API

---

#### 6. Search Algorithm Simplification

**Goal**: Reduce complexity, improve maintainability

**Tasks**:

- [ ] Evaluate each boost mechanism's contribution
- [ ] Remove redundant boosts (TF-IDF cosine? affinity expansion?)
- [ ] Create offline evaluation test set
- [ ] Add benchmark tests for search quality

**Files to Modify**:

- `src/server/ToolSearch.ts` (or split modules)
- `tests/server/ToolSearch.test.ts` (add evaluation tests)

---

## 📅 Execution Timeline

### Week 1 (Current)

- ✅ Complete analyses (Search Architecture + Node Compatibility)
- ✅ Implement Tool Router MVP (ToolRouter.ts + integration)
- ✅ Node 22/24 compatibility fix (isolated-vm 6.1.2 override)

### Week 2

- ✅ Complete Tool Router integration
- ✅ Deploy Node compatibility fixes
- ✅ Begin documentation cleanup
- ✅ Complete file refactoring (Phase 1-2)
- ✅ Fix all TypeScript compilation errors

### Week 3

- ✅ Complete: Documentation optimization
  - [x] Create troubleshooting guide (docs/guide/troubleshooting.md)
  - [x] Simplify tool tables using collapsible sections
  - [x] Audit and consolidate EN/ZH documentation
  - [x] Add common search issue solutions
- ✅ Optimize dynamic boost strategy (already using 'majority' approach)
- ✅ Complete file size refactoring (ToolSearch split into search/)

### Week 4+

- Complete search algorithm simplification
- Establish evaluation baseline
- Long-term maintenance improvements

---

## 🔧 Development Approach

### Multi-Agent Collaboration

- Use concurrent Codex workers for independent tasks
- Spawn specialized agents for research → implementation
- Parallel execution where possible

### Quality Gates

- Run `/verify-quality` after significant changes (>30 lines)
- Run `/verify-security` for security-related changes
- Run `/verify-change` for impact analysis

### Testing Strategy

- Add unit tests for new Tool Router
- Add CI tests for Node 20/22/24 installation
- Create evaluation test set for search quality

---

## 📝 Notes

### Key Constraints

- Don't use gemini CLI (not configured)
- Use concurrent codex for partitioned investigation
- Maintain backward compatibility
- Document all breaking changes

### Success Criteria

- Model can successfully discover and use tools in 1-2 calls
- Installation succeeds on Node 20/22/24
- Documentation is concise and professional
- Code is maintainable and well-structured

---

### Implementation Notes (2026-03-14)

**Completed Items**:

- ✅ Dynamic boost already uses 'majority' strategy (improved from 'max')
- ✅ Guardrails already implemented (DYNAMIC_BOOST_SKIP_SEARCH_TO_FULL, DYNAMIC_BOOST_MAX_JUMP)
- ✅ All 238 tools have descriptions (verified)
- ✅ Tool Router implementation complete (P0)
- ✅ Node 22/24 compatibility fixed (P0)
- ✅ File refactoring Phase 1-2 complete (P2)
- ✅ TypeScript errors all resolved (camoufox-js types, null checks)
- ✅ Troubleshooting guide created
- ✅ Documentation simplified

**Commit**: d4975e1 "feat: implement tool router and fix all TypeScript errors"

**Next Steps**:

- Consider P1 tasks (Search Algorithm Simplification)
- Monitor Tool Router usage metrics
- Collect feedback on documentation improvements
