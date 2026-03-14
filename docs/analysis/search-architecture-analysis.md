# Search Architecture Analysis

**Analysis Date**: 2026-03-14
**Project**: jshookmcp
**Scope**: Tool search engine usability and architecture

---

## 📊 Executive Summary

**Core Problem**: LLM models struggle to use the search system effectively. The multi-step protocol (search → activate → call) creates friction and confusion.

**Root Cause**: Protocol complexity + schema visibility issues + aggressive dynamic boost

**Recommended Solution**: **Tool Router Layer** (Option A) - Compress "search → activate → call" into 1-2 tool calls

---

## 🔍 Problem Decomposition

### Current System Components

| Component | Module | Responsibility |
|-----------|--------|---------------|
| Tool discovery & ranking | `src/server/ToolSearch.ts` | Map query → candidate tools (short desc, score, domain, isActive) |
| Search/activation meta-tools | `src/server/MCPServer.search.ts` | search_tools/activate_tools/activate_domain handlers |
| Dynamic tier boost | `src/server/MCPServer.search.dynamicBoost.ts` | Infer target tier from search results, silently boost profile |
| Tier/domain registry | `src/server/ToolCatalog.ts` + `src/server/registry/*` | tool→domain, domain→profile tier mappings |
| Client/tool-list update boundary | MCP SDK listChanged capability | Can model see new tool schemas after activation in same turn? |

### Happy Path Flow

```
Step 1: LLM calls search_tools(query, top_k?)
        → Returns candidate results + hints; may trigger silent dynamic boost

Step 2: Server (optional) dynamic boost
        → Infers tier from results, boosts profile
        → sendToolListChanged; results' isActive may be backfilled

Step 3: LLM calls activate_tools(names=[toolName]) or activate_domain(domain)
        → Registers tools + installs handlers + sendToolListChanged

Step 4: LLM calls business tool (e.g., page_navigate)
        → Returns business result
```

### Common Failure Paths

❌ **LLM directly calls unregistered tool** → Tool not found / wrong params → No fallback to search_tools/activate_tools
❌ **LLM calls activate_tools with wrong params** (names as string, not array) → Error → No self-correction
❌ **search_tools returns candidates but schema invisible** → LLM can't construct args or can't see new schema in same turn → Failure

---

## 🎯 Failure Points Analysis

### F1: Default Search-Tier Tools Too Limited

**Category**: Protocol/Usability
**Impact**: HIGH
**Likelihood**: HIGH

**Symptom**: Under default search-tier, LLM wants to call business tools directly but they're not in the list.

**Root Cause**: Default profile=search, initial registered tools set is extremely small. Requires discovery/activation/boost_profile chain.

**Evidence**: `src/server/MCPServer.registration.ts:10`

**Note**: This is a mismatch between "product default posture" and "model capability assumption" - the model must learn a discovery/activation protocol.

---

### F2: Schema Not Visible Before Activation

**Category**: Schema Visibility/Client Boundary
**Impact**: HIGH
**Likelihood**: MEDIUM-HIGH

**Symptom**: Even if search_tools finds the right tool, the model may not know how to construct params or hesitate to call because it can't see the input schema.

**Root Cause**: search_tools returns shortDescription, but not input schema. After activation, relies on tool list changed mechanism to refresh schema (client may not apply in same inference turn).

**Evidence**: `src/server/MCPServer.search.ts:162`, `src/server/MCPServer.search.ts:230`

---

### F3: activate_tools Parameter Friction

**Category**: Parameter Contract Friction
**Impact**: MEDIUM
**Likelihood**: MEDIUM

**Symptom**: activate_tools common error: names passed as string instead of array.

**Root Cause**: validateToolNameArray strictly validates names must be array; LLM easily generates single value.

**Evidence**: `src/server/MCPServer.search.ts:145`

---

### F4: Input Robustness Issues

**Category**: Input Robustness
**Impact**: MEDIUM
**Likelihood**: MEDIUM

**Symptom**: search_tools throws exception if query is missing/wrong type (caught by outer try/catch), model may not self-correct.

**Root Cause**: handleSearchTools does type assertion on args.query instead of runtime guard.

**Evidence**: `src/server/MCPServer.search.ts:162`

---

### F5: Dynamic Boost Over-Aggressive

**Category**: Dynamic Boost Side Effects
**Impact**: MEDIUM-HIGH
**Likelihood**: MEDIUM

**Symptom**: One search and it boosts to workflow/full, tool list bloats, model finds it harder to choose tools.

**Root Cause**: Tier decision takes max minimal tier from candidates; candidate set contains minCandidates=3 + relative threshold 0.6, easily includes "edge match" high-tier tools.

**Evidence**: `src/server/MCPServer.search.dynamicBoost.ts:62`, `src/server/MCPServer.search.ts:162`

---

### F6: Dynamic Boost Effect Delay

**Category**: Dynamic Boost Effect Loss
**Impact**: MEDIUM
**Likelihood**: HIGH

**Symptom**: Boost succeeds but current result ranking doesn't reflect new tier's domain bias.

**Root Cause**: Dynamic boost executes after engine.search, only backfills isActive, doesn't re-run search.

**Evidence**: `src/server/MCPServer.search.ts:162`, `src/server/MCPServer.search.ts:89`

---

### F7: Retrieval Algorithm Complexity

**Category**: Retrieval Quality/Maintainability
**Impact**: MEDIUM
**Likelihood**: MEDIUM

**Symptom**: Ranking "seems smart but unstable" - multiple boosts stacked, difficult to tune, hard to explain.

**Root Cause**: BM25 + prefix match + TF-IDF cosine + coverage boost + category/domain multipliers + intent bonus + affinity expansion + hub expansion all exist simultaneously.

**Evidence**: `src/server/ToolSearch.ts:460`, `src/server/ToolSearch.ts:111`

---

### F8: Multilingual/Token Coverage Gaps

**Category**: Multilingual/Token Coverage
**Impact**: MEDIUM
**Likelihood**: MEDIUM-HIGH

**Symptom**: Chinese natural language requests may still fail to match correct tools.

**Root Cause**: Chinese→English token injection relies on limited aliases/regex; outside coverage range degrades to single-character token noise matching.

**Evidence**: `src/server/ToolSearch.ts:160`, `src/server/ToolSearch.ts:111`, `src/server/ToolSearch.ts:192`

---

## 💡 Solution Options

### Option A: Tool Router Layer (Recommended)

**Summary**: Add/strengthen a high-level meta-tool: accepts natural language goal, outputs (or directly executes) recommended tool/workflow activation + call steps. Compress "discover + activate + execute" into 1-2 tool calls.

**Pros**:
✅ Significantly reduces model learning cost - no need to master activate/boost protocol details
✅ Can solidify "workflow-first" strategy as routing rules (prioritize run_extension_workflow/web_api_capture_session when strong intent detected)
✅ Can embed safety/performance guardrails (limit auto-enabled domains, limit full-tier auto-upgrade conditions)
✅ Can return executable nextActions (structured) + minimal example args, improving closure rate

**Cons**:
❌ Requires adding routing logic/maintaining rules, a product-level capability not pure retrieval
❌ If choosing "direct execution", requires stricter permission & audit (avoid mis-triggering high-risk tools)

**Trade-offs**:
- **Maintainability**: MEDIUM (rules need iteration, but more controllable than multiple scoring stacks)
- **Model Usability**: HIGH
- **Implementation Effort**: MEDIUM (requires protocol design & client compatibility verification)

---

### Option B: Simplify Retrieval Algorithm + Evaluation Harness

**Summary**: Converge ToolSearchEngine to "field-weighted BM25 + few configurable intent boosts", remove propagation & secondary similarity; establish offline query→expected tool evaluation set & regression tests.

**Pros**:
✅ More explainable, stable ranking, tunable
✅ Reduces technical debt: ToolSearch.ts complexity drops, faster iteration
✅ Paired with offline baseline avoids "feels smarter/dumber" subjective loop

**Cons**:
❌ Doesn't directly solve "activation/Schema visibility/client refresh" protocol friction
❌ Short-term may see recall drop (need to catch up via intent/vocabulary)

**Trade-offs**:
- **Maintainability**: HIGH
- **Model Usability**: MEDIUM (still requires model to follow protocol)
- **Implementation Effort**: MEDIUM-HIGH (needs data & evaluation pipeline)

---

### Option C: Schema-First Discovery + Direct Invocation Proxy

**Summary**: Provide stable describe_tool / invoke_tool (or call_tool) meta-tools: model uses name to get schema/examples, uses proxy to execute target tool, reducing dependency on tool list changed.

**Pros**:
✅ Bypasses "is schema visible immediately after activation" client uncertainty
✅ Model can complete: search → describe → invoke in same turn
✅ Can do unified param validation & error correction at invoke layer (friendlier error messages)

**Cons**:
❌ Weakens MCP's explicit tool whitelist mechanism (needs extra permission control)
❌ Proxy layer becomes new complex core, must guarantee behavior consistency with original tool

**Trade-offs**:
- **Maintainability**: MEDIUM
- **Model Usability**: HIGH
- **Implementation Effort**: MEDIUM

---

## 📋 Recommendation

**Preferred Option**: **A** (Tool Router Layer)

**Rationale**:
1. User feedback points to "model can't use", root cause more like protocol/usability than pure ranking - must simplify multi-step discovery/activation
2. A can centralize workflow-first & dynamic upgrade logic in one place, provide structured nextActions to model, significantly reducing misuse probability
3. A can combine with B: router layer solves usability first, then retrieval layer gradually simplifies/optimizes via evaluation set

---

## 🎬 Action Items

### Quick Wins

1. **Establish "Failure Point Logging/Metrics" Minimal Loop**
   - Record search_tools query, topK results, isActive, whether boost triggered, subsequently called tool name & error type
   - Form replayable sample set

2. **Minimize activate_tools Usage Friction**
   - Provide "array form" examples in LLM-facing output
   - In error returns, give copyable correct call template

3. **Dynamic Boost Trigger Strategy Review**
   - Evaluate if max-tier decision is excessive
   - Consider changing to top1-tier or majority-tier
   - Evaluate if re-running search after boost is needed

### Strategic Changes

1. **Design & Implement Tool Router (Option A)**
   - Define input (task description/context) → output (recommended tools + activation/call steps + param examples)
   - Prioritize high-frequency tasks (packet capture/workflow/registration/script library/Bundle search)

2. **Establish Offline Evaluation Set (Option B Prerequisite)**
   - Sample query→expected tools/domains from real logs
   - Add to regression tests, avoid search quality "perceived regression"

3. **Introduce Schema-First Capability (Option C Subset)**
   - At minimum provide describe_tool (name→inputSchema/brief example), reduce param construction failure

### Risk Mitigation

- Set hard guardrails for auto-upgrading to full-tier (e.g., must have top1 clearly belong to full and score significantly ahead, or need secondary confirmation)
- Audit & rate-limit "auto-activate/auto-execute": avoid mis-triggering high-risk domains (hooks/native/memory)
- Introduce configurable synonym/label system for multilingual queries (don't infinitely stack regex), drive expansion via evaluation set

---

## 📐 Success Metrics

### Primary Metrics

- **Average tool calls from user intent to first successful tool call** (fewer is better)
- **search_tools call closure success rate** (complete goal within N tool calls)

### Secondary Metrics

- **Dynamic boost trigger rate / proportion upgraded to full** (too high usually means excessive)
- **search_tools top1 subsequent adoption rate** (proportion actually called)
- **Activation failure rate** (activate_tools param errors, notFound, etc.)

---

## 📚 References

| File | Note |
|------|------|
| `src/server/MCPServer.registration.ts:10` | Default profile=search, initial tool set very small |
| `src/server/MCPServer.search.ts:162` | search_tools call flow + silent dynamic boost (no re-search) |
| `src/server/MCPServer.search.ts:230` | activate_tools registers tools + sendToolListChanged |
| `src/server/MCPServer.search.ts:145` | validateToolNameArray: names must be array |
| `src/server/MCPServer.search.dynamicBoost.ts:62` | analyzeSearchResultTiers: threshold 0.6 + minCandidates=3 + max-tier decision |
| `src/server/ToolSearch.ts:460` | ToolSearchEngine.search: BM25→TFIDF→multiple boosts→affinity/hub→cache |
| `src/server/ToolSearch.ts:160` | CJK_QUERY_ALIASES (Chinese→English token injection) |
| `src/server/ToolSearch.ts:192` | DEFAULT_INTENT_TOOL_BOOST_RULES (intent→tool bonus) |