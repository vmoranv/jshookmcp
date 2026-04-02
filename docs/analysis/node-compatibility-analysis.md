# Node.js Compatibility Analysis

**Analysis Date**: 2026-03-14
**Project**: jshookmcp
**Scope**: Node 22/24 installation failures vs Node 20 success

---

## 📊 Executive Summary

**Core Problem**: Same repository installs successfully on Node 20 but fails on Node 22/24.

**Root Cause**: `isolated-vm` (V8/Node-ABI binding from webcrack dependency) lacks prebuilt binaries for Node 22/24, triggering node-gyp compilation failures on Windows.

**Recommended Solution**: **A+B+C Combination**

- **A**: Upgrade webcrack/isolated-vm to Node 22/24-compatible versions
- **B**: Make webcrack optional/plugin-based to reduce installation fragility
- **C**: Improve Windows toolchain documentation + add doctor checks

**Confidence**: 78% (based on dependency tree & install script evidence; missing actual error logs from user)

---

## 🔍 Problem Analysis

### User-Reported Behavior

| Node Version | Installation Result |
| ------------ | ------------------- |
| Node 20      | ✅ Can install      |
| Node 22      | ❌ Cannot install   |
| Node 24      | ❌ Cannot install   |

### Observed in Current Workspace

- **Node Version**: v22.22.1
- **pnpm Version**: 10.28.2
- **Platform**: win32 x64
- **Node ABI**: 127
- **N-API Version**: 10

**Note**: Current workspace already has node_modules with generated .node artifacts in Node 22, meaning "Node 22 definitely cannot install" is not universally true. The issue is more likely related to:

- Prebuilt binary availability
- Network connectivity
- Local compilation toolchain

---

## 🎯 Root Cause Decomposition

### Most Likely Failure Class

**Native addon (binary/compilation) lacks prebuilt packages for new Node ABI/V8**, triggering node-gyp compilation failure, or failing in restricted network/missing compilation toolchain environments.

### Dependency Graph Analysis

```text
jshookmcp
├── webcrack ^2.15.1 (REQUIRED)
│   └── isolated-vm 5.0.4 (HIGH RISK - V8 binding)
│       └── install: prebuild-install || (node-gyp rebuild --release -j max && node-gyp clean)
│
├── camoufox-js ^0.9.1 (OPTIONAL)
│   └── better-sqlite3 ^12.2.0 (MEDIUM RISK - node-gyp)
│       └── install: prebuild-install || node-gyp rebuild --release
│
├── koffi ^2.15.1 (REQUIRED)
│   └── install: node src/cnoke/cnoke.js -p . -d src/koffi --prebuild
│   └── risk: LOW-MEDIUM (N-API based, more cross-version stable)
│
└── esbuild 0.27.3 (via overrides)
    └── install: node install.js (platform binary)
    └── risk: LOW
```

---

## 🔬 Technical Evaluation

### Native Modules & Install Mechanisms

| Package            | Version | Install Script                                                                | Native Style                                                 | Risk                    |
| ------------------ | ------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------- |
| **isolated-vm**    | 5.0.4   | `prebuild-install \|\| (node-gyp rebuild --release -j max && node-gyp clean)` | V8/Node-ABI binding (sensitive to Node major version)        | **HIGH**                |
| **better-sqlite3** | 12.6.2  | `prebuild-install \|\| node-gyp rebuild --release`                            | node-gyp compilation or prebuilt binary                      | MEDIUM (optional chain) |
| **koffi**          | 2.15.1  | `node src/cnoke/cnoke.js -p . -d src/koffi --prebuild`                        | N-API prebuilt (usually more cross-version stable)           | LOW-MEDIUM              |
| **esbuild**        | 0.27.3  | `node install.js` (selects platform binary)                                   | Platform binary (usually doesn't depend on Node ABI changes) | LOW                     |

### Node ABI Version Impact

| Node Version | ABI | Prebuild Coverage                                        | Risk Level |
| ------------ | --- | -------------------------------------------------------- | ---------- |
| Node 20.x    | 115 | ✅ Usually mature, better prebuild coverage              | LOW        |
| Node 22.x    | 127 | ⚠️ Requires corresponding prebuilds or local compilation | HIGH       |
| Node 24.x    | 137 | ⚠️ Requires corresponding prebuilds or local compilation | HIGH       |

**Why it matters**: Packages like `isolated-vm` and `better-sqlite3` that use V8/Node-ABI bindings are most sensitive to ABI changes. Without prebuilt binaries for the specific Node version, they fall back to node-gyp compilation.

### Key Hypotheses (Ranked)

**Rank 1**: `webcrack -> isolated-vm` lacks prebuilt packages for Node 22/24, falls back to node-gyp compilation; user environment lacks VS Build Tools/Python or isolated-vm source incompatible with new V8.

**Evidence**: isolated-vm install script explicitly tries prebuild-install first, then node-gyp rebuild. V8 binding packages are most sensitive to Node major versions.

**Rank 2**: `camoufox-js (optional) -> better-sqlite3` lacks prebuilt packages for Node 22/24, falls back to node-gyp compilation failure; if user performs "full install/enables optional dependencies", appears as "install failure".

**Evidence**: better-sqlite3 install script similarly uses prebuild-install || node-gyp rebuild. camoufox-js is root optionalDependency, commonly fails on Windows due to missing compilation toolchain.

**Rank 3**: Node version/minor version doesn't satisfy dev tools engines (e.g., eslint@10 requires ^22.13.0 or >=24), and user enabled engines strict checking (engine-strict) causing install abort.

**Evidence**: Dependency tree has stricter engines (eslint@10), but by default pnpm/npm usually only warn, not fail. Would need user machine config to confirm.

**Rank 4**: Prebuilt package download blocked by proxy/enterprise network/certificate, causing prebuild-install unable to fetch; Node 20 might succeed due to local cache or easier to hit prebuild/mirror for that version.

**Evidence**: Both isolated-vm/better-sqlite3 depend on downloading prebuilt packages; network issues would amplify differences.

---

## 🛠️ Solution Options

### Option A: Upgrade webcrack/isolated-vm

**What to do**:

1. Upgrade webcrack to version depending on newer isolated-vm, or directly override isolated-vm version
2. Add Node 20/22/24 + Windows install & basic verification in CI

**Pros**:
✅ Highest probability of solving "new Node version can't install" at root
✅ Most user-friendly (no local compilation toolchain needed)

**Cons**:
❌ Dependency upgrade may bring behavior changes (webcrack output/AST details/performance)
❌ isolated-vm is a high-churn native package, may repeat this issue with future Node major versions

**Trade-offs**:

- **Effort**: MEDIUM
- **Impact**: HIGH
- **Risk**: MEDIUM

---

### Option B: Make webcrack (and camoufox-js) Optional/Plugin-Based

**What to do**:

1. Move webcrack to optionalDependencies or change to on-demand dynamic loading (disable related features if missing and give prompt)
2. Keep camoufox-js optional, clarify in docs "full features require native dependencies available"

**Pros**:
✅ Significantly reduces install failure probability (even if isolated-vm/better-sqlite3 compilation fails, doesn't block base install)
✅ Isolates high-risk native capabilities as "enhanced features"

**Cons**:
❌ Feature experience will stratify: some users lack webcrack/camoufox features
❌ Requires more robust runtime error handling & feature gating

**Trade-offs**:

- **Effort**: MEDIUM
- **Impact**: MEDIUM-HIGH
- **Risk**: LOW-MEDIUM

---

### Option C: Accept Node 22/24 Requires Local Compilation

**What to do**:

1. Docs clarify: when prebuilt packages unavailable, need to install VS Build Tools + Python (with minimum versions/workloads)
2. Add `doctor` command: detect cl.exe, python, msbuild, prompt for missing items
3. Provide "compile from source" dedicated guide if needed

**Pros**:
✅ Lower implementation cost, can quickly relieve user blockage in short term
✅ More resilient to future Node major versions (at least has clear fallback path)

**Cons**:
❌ High user barrier (especially Windows)
❌ If isolated-vm source itself incompatible with new V8, local compilation still may fail

**Trade-offs**:

- **Effort**: LOW-MEDIUM
- **Impact**: MEDIUM
- **Risk**: MEDIUM

---

## 📋 Recommendation

**Preferred Approach**: **A + B combination** (A solves root cause, B reduces future installation risk recurrence); use C as fallback.

**Rationale**:

1. Current dependency graph's only "high-risk AND required" native package chain is webcrack -> isolated-vm; upgrading/replacing maximizes compatibility benefit
2. V8 binding packages like isolated-vm will repeatedly trigger install/compile issues with Node major versions; making its capability plugin-based significantly reduces overall install fragility
3. node-gyp failures are very common in Windows ecosystem; supplementing toolchain & doctor detection reduces ineffective troubleshooting time

**Compatibility Policy Suggestion**:

- **Runtime engines**: If Vite 8 remains in the toolchain, align the root package to `^20.19.0 || >=22.12.0` and document the minimum supported minor versions explicitly
- **Dev tooling engines**: Align with eslint@10: `^20.19.0 || ^22.13.0 || >=24` (at minimum document minimum minor version)

---

## 🎬 Action Items

### Priority P0: Lock Down True Failure Point

**Goal**: Identify which package/step fails

**Steps**:

1. Execute install on Node 22 and Node 24 separately, preserve full logs (suggest pasting first failed package name & error stack from logs)
2. Prioritize confirming if stuck at isolated-vm or better-sqlite3 install script (prebuild-install / node-gyp)

**Commands to Collect Evidence**:

```bash
node -v
node -p "process.platform + ' ' + process.arch"
node -p "process.versions.modules"
pnpm -v
pnpm why isolated-vm
pnpm why better-sqlite3
pnpm install --reporter=append-only
pnpm install --no-optional --reporter=append-only
```

**Interpretation Tips**:

- If `--no-optional` succeeds: Problem likely in camoufox-js/better-sqlite3 optional chain
- If `--no-optional` still fails: Problem more likely in webcrack/isolated-vm or koffi required chain

---

### Priority P1: Prepare Repeatable Windows Fallback Path

**Goal**: Prepare for "prebuild missing -> local compilation"

**Steps**:

1. Confirm Visual Studio Build Tools 2022 installed (Desktop development with C++), Windows SDK, Python 3.x
2. Ensure node-gyp available (usually driven indirectly by npm/pnpm)
3. Look for cl.exe/python/msbuild missing or V8 API compilation errors in failure logs

**Note**: If isolated-vm reports V8/header-related compilation errors, often need to upgrade isolated-vm version rather than just supplementing toolchain.

---

### Priority P2: Formulate Long-Term Compatibility Strategy

**Goal**: Reduce future Node major version repeated pitfalls

**Steps**:

1. Add Node 20/22/24 (at least Windows + Linux) install & basic self-check to CI
2. Evaluate sinking webcrack/isolated-vm capability to optional plugin (features downgrade when missing but don't block install)

---

## 📐 Node Version Constraints Analysis

| Package               | Constraint                                          | Impact                                                                                                  |
| --------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| root                  | `node >= 20.0.0`                                    | Runtime/install minimum threshold                                                                       |
| eslint@10.0.2         | `node ^20.19.0 \|\| ^22.13.0 \|\| >=24`             | Dev tool; if user enables engine-strict or Node minor version too low, may cause install/script failure |
| isolated-vm@5.0.4     | `node >= 18.0.0` (but actually affected by V8/ABI)  | Most sensitive during install: prebuild missing triggers node-gyp                                       |
| better-sqlite3@12.6.2 | `node 20.x \|\| 22.x \|\| 23.x \|\| 24.x \|\| 25.x` | Main native risk point in optional chain                                                                |
| camoufox-js@0.9.1     | `node >= 20`                                        | Optional dependency; only needed when using browser anti-detection capabilities                         |

---

## 🔄 API Changes: Node 20 vs 22 vs 24

### Install Impact Focus

| Area                                         | Node 20                                                 | Node 22                                                                                        | Node 24                                                                  | Why It Matters Here                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **C++ addon ABI / V8 version**               | ABI=115 (more mature, prebuild coverage usually better) | ABI=127 (needs corresponding prebuild or local compilation)                                    | ABI=137 (needs corresponding prebuild or local compilation, higher risk) | isolated-vm / better-sqlite3 are sensitive to ABI/V8 changes, main source of "install differences"                                 |
| **N-API (Node-API) stable interface**        | Supports N-API, suitable for cross-version binaries     | Supports higher N-API (this machine observed N-API=10)                                         | Expected to continue increasing                                          | koffi/rollup/impit etc. more likely based on N-API or published as platform packages, usually more cross-Node-major-version stable |
| **ESM/CJS resolution & conditional exports** | Modern ESM available                                    | Stricter/more complete ESM/conditional export boundaries (usually won't cause install failure) | Continued enhancement                                                    | This repo is type=module, but current issue is more like native compilation/prebuild download rather than ESM resolution           |

**Runtime Risk Note**: If install can pass, Node 22/24 at runtime is usually a superset of Node 20; main risk remains concentrated on native addon (especially isolated-vm) stability & compatibility under new V8.

---

## 📚 References

**Dependency Files Analyzed**:

- `package.json` (engines, dependencies, optionalDependencies, pnpm config)
- `node_modules\.pnpm\isolated-vm@5.0.4\node_modules\isolated-vm\package.json` (install scripts)
- `node_modules\.pnpm\better-sqlite3@12.6.2\node_modules\better-sqlite3\package.json` (install scripts)
- `node_modules\.pnpm\koffi@2.15.1\node_modules\koffi\package.json` (install scripts)
- `node_modules\.pnpm\esbuild@0.27.3\node_modules\esbuild\package.json` (install scripts)

**Key Findings**:

1. `isolated-vm` install script: `prebuild-install || (node-gyp rebuild --release -j max && node-gyp clean)`
2. `better-sqlite3` install script: `prebuild-install || node-gyp rebuild --release`
3. Both packages depend on prebuild-install first, then node-gyp as fallback
4. Node ABI version changes are the primary driver of prebuild availability differences
