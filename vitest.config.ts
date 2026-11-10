import { cpus } from 'node:os';
import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Project root (directory containing package.json)
const root = resolve(dirname(fileURLToPath(import.meta.url)));

const detectedCpuCount = Math.max(1, cpus().length);
const requestedMaxWorkers = Number.parseInt(process.env.VITEST_MAX_WORKERS ?? '', 10);
const configuredMaxWorkers =
  Number.isFinite(requestedMaxWorkers) && requestedMaxWorkers > 0
    ? Math.min(requestedMaxWorkers, detectedCpuCount)
    : undefined;

// Coverage reporter configuration based on environment
const coverageReporter =
  process.env.COVERAGE_FULL === 'true'
    ? ['text', 'json', 'html', 'text-summary']
    : ['text-summary'];

// Coverage exclusion patterns (shared across all projects)
const coverageExclude = [
  'src/**/*.d.ts',
  'src/**/types.ts',
  'src/types/**',
  'src/*/**/index.ts',
  'src/**/manifest.ts',
  'src/**/*.types.ts',
  // NOT excluded, and here is the measurement that says so.
  //
  // The ten `<domain>/handlers/**` globs (plus `<domain>/handlers.ts` and
  // `session/handlers.ts`) used to sit here behind the comment "Pure re-export
  // handler files (zero logic, just re-export from impl)". That comment was
  // false for all but 10 of the 125 files it matched: 110 files / ~33.7k raw
  // lines are REAL_LOGIC — branch/loop/parse code such as the AST rewriters
  // (`transform/handlers/ast-ops.ts`), the PE hollowing scanner
  // (`process/handlers/hollowing-scan.ts`), the VLQ source-map codecs
  // (`sourcemap/handlers/sourcemap-parsing.ts`), the live CDP stream monitors
  // (`streaming/handlers/{ws,sse,webrtc,fetch-stream}-handlers.ts`) and an SSRF
  // authorization policy (`workflow/handlers/network-policy.ts`). Five more are
  // dependency-wiring facades. Only the `<domain>/handlers.ts` barrels are
  // genuinely pure re-exports, and those contribute ZERO executable lines, so
  // excluding them was always a no-op.
  //
  // Removing the entries RAISED every metric, because the hidden files turned
  // out to be covered better than the repo average (measured on the full suite,
  // Windows local; 123 of the newly-included files are V8-instrumented for
  // 10,655 lines and sit at 85.54% line coverage):
  //   lines      81.22 -> 81.72   (threshold 80.0)
  //   statements 79.78 -> 80.23   (threshold 78.6)
  //   functions  81.31 -> 82.02   (threshold 80.9)
  //   branches   70.81 -> 71.19   (threshold 69.8)
  // The thresholds are deliberately left where they are: they now pass with a
  // LARGER buffer than before, and tightening them needs the CI (Linux) numbers,
  // not just the local ones.
  //
  // Do not re-add a glob here without measuring. "It looks like a re-export"
  // is not evidence; `grep -c '^export .* from '` over the whole file is.

  // Pure re-export/type-only barrel files
  'src/server/domains/shared/registry.ts',
  'src/server/registry/contracts.ts',
  'src/server/plugins/pluginContract.ts',
  // Definition-only files (0% coverage, contain only Tool[] arrays)
  'src/server/domains/*/definitions.ts',
  // Requires real browser CDP connection — untestable in unit tests
  'src/modules/collector/playwright-cdp-fallback.ts',
  // v0.3.1 domains: handlers require real hardware / native FFI / CDP sessions
  'src/server/domains/adb-bridge/handlers.impl.ts',
  'src/server/domains/tls-inspector/handlers/handler-class.ts',
  'src/server/domains/tls-inspector/handlers/raw-socket-handlers.ts',
  'src/server/domains/mojo-ipc/handlers.impl.ts',
  'src/server/domains/protocol-analysis/handlers/handler-class.ts',
  'src/server/domains/syscall-hook/handlers.impl.ts',
  // NOTE: a "Pure re-export backward-compat shim files (1-10 lines, zero logic)"
  // block listing 9 graphql + 5 process files used to sit here. All 14 were
  // 100% `export ... from` with ZERO executable lines, so excluding them was a
  // no-op: V8 instruments nothing inside them and they never entered the
  // denominator either way. The entries are gone because a no-op exclusion is
  // indistinguishable from no exclusion, except that it occupies the position
  // where a real check would be. Verified file-by-file, not by glob.
  //
  // Hardware/native FFI dependent — cannot be unit tested
  'src/modules/debugger/DebuggerManager.impl.ts',
  'src/modules/debugger/DebuggerManager.ts',
  'src/modules/debugger/ScriptManager.ts',
  'src/modules/monitor/ConsoleMonitor.impl.ts',
  'src/modules/monitor/ConsoleMonitor.ts',
  'src/modules/monitor/NetworkMonitor.impl.ts',
  'src/modules/monitor/NetworkMonitor.ts',
  'src/modules/binary-instrument/UnidbgRunner.ts',
  'src/modules/binary-instrument/GhidraAnalyzer.ts',
  'src/modules/binary-instrument/HookGenerator.ts',
  'src/native/platform/linux/LinuxMemoryProvider.impl.ts',
  // Native/raw-socket platform probes requiring OS privileges or real network stack
  'src/native/IcmpProbe.ts',
  // Requires a live browser-side inspector websocket target
  'src/modules/v8-inspector/V8InspectorClient.ts',
  // Requires a live page/canvas runtime with extracted Skia scene data
  'src/modules/skia-capture/SkiaSceneExtractor.ts',
  // NOTE: 9 entries were removed from this misc block after a file-by-file audit
  // (not a glob):
  //   - 8 `<domain>/handlers.ts` barrels (adb-bridge, binary-instrument,
  //     tls-inspector, canvas, cross-domain, extension-registry, mojo-ipc,
  //     protocol-analysis) are 100% `export ... from` with ZERO executable
  //     lines, so the exclusion was a no-op.
  //   - `maintenance/handlers/extension-registry-utils.ts` was excluded as a
  //     "duplicate extracted utility module". It is not a duplicate: each of the
  //     five definitions it holds has exactly one definition site in the repo,
  //     and `handlers.extensions.ts` IMPORTS them from it. The logic is
  //     exercised, so the exclusion was hiding measured code.
  'src/server/domains/tls-inspector/handlers.impl.core.ts',
  'src/server/domains/canvas/dependencies.ts',
  'src/server/domains/cross-domain/handlers.impl.ts',
  'src/server/domains/protocol-analysis/handlers.impl.core.ts',
  // NOTE: this block ("Pure composition facades delegating to focused
  // sub-handlers; covered at the sub-handler layer") and the live-stream block
  // that used to follow it were removed after a file-by-file audit:
  //   - `syscall-hook/handlers.ts`, `v8-inspector/handlers.ts`,
  //     `wasm/handlers.ts`, `wasm/handlers.impl.ts` are 100% `export ... from`
  //     with ZERO executable lines, so those exclusions were no-ops.
  //   - `debugger/handlers.ts` (460 lines) and `memory/handlers.impl.ts` (572)
  //     are NOT facades: nested `switch (type)` / `switch (action)` dispatch at
  //     debugger L285-328, and `switch (action)` plus argument-validation throws
  //     and a try/catch at memory L163/197/246/461/473/476/512.
  //   - `streaming/handlers/{sse,ws}-handlers.ts` were excluded on the grounds
  //     that "the lower-level streaming impl tests already cover it". That lower
  //     layer exists and is not itself excluded, so the exclusion was not
  //     circular — but the justification is INVERTED: handlers.impl.streaming-{sse,ws}.ts
  //     are marked @deprecated ("Current runtime wiring uses handlers.impl.core.ts
  //     + handlers/sse-handlers.ts"), so the excluded files are the CURRENT
  //     implementation while the measured layer is the legacy one. They are also
  //     directly tested (tests/server/domains/streaming/streaming-sse-handlers.coverage.test.ts
  //     and .../ws-handlers.test.ts).
  'src/modules/process/memory/regions.ts',
  'src/modules/process/memory/regions.impl.ts',
  // NOT excluded on purpose: src/server/registry/generated-*.ts.
  //
  // Every entry above removes weight that drags the percentages DOWN — e.g.
  // `definitions.ts` is 0% covered because nothing loads those Tool[] arrays.
  // The three generated registry files are the opposite case: the registry
  // always loads them, so they are fully covered. Measured with
  // COVERAGE_FULL=true on the tests that load them:
  //   generated-domains.ts      39/39 statements, 36/36 functions (the
  //                             dynamic-import loader arrows all fire)
  //   generated-tool-catalog.ts  1/1 statement  (V8 counts the whole ~28k-line
  //                             array literal as ONE statement, so it is
  //                             already coverage-neutral despite its size)
  //   generated-tool-domains.ts  2/2 statements (pure data map, no branches)
  // Excluding them would remove 42 statements / 36 functions that are 100%
  // covered, i.e. shave ~0.04pp off functions coverage — the same order as the
  // runner-delta the thresholds below already leave no room for. "It says
  // AUTO-GENERATED" is not a reason to exclude a file that is green.
];

export default defineConfig({
  resolve: {
    alias: [
      // Explicit .ts extensions so require() can find modules without extension auto-append
      {
        find: '@server/domains/canvas/adapters/cocos-adapter',
        replacement: resolve(root, 'src/server/domains/canvas/adapters/cocos-adapter.ts'),
      },
      {
        find: '@server/domains/canvas/adapters/pixi-adapter',
        replacement: resolve(root, 'src/server/domains/canvas/adapters/pixi-adapter.ts'),
      },
      {
        find: '@server/domains/canvas/adapters/phaser-adapter',
        replacement: resolve(root, 'src/server/domains/canvas/adapters/phaser-adapter.ts'),
      },
      {
        find: '@server/domains/canvas/adapters',
        replacement: resolve(root, 'src/server/domains/canvas/adapters'),
      },
      { find: '@server', replacement: resolve(root, 'src/server') },
      { find: '@src', replacement: resolve(root, 'src') },
      { find: '@modules', replacement: resolve(root, 'src/modules') },
      { find: '@native', replacement: resolve(root, 'src/native') },
      { find: '@utils', replacement: resolve(root, 'src/utils') },
      { find: '@errors', replacement: resolve(root, 'src/errors') },
      { find: '@internal-types', replacement: resolve(root, 'src/types') },
      { find: '@extension-sdk', replacement: resolve(root, 'packages/extension-sdk/src') },
      {
        find: '@jshookmcp/extension-sdk',
        replacement: resolve(root, 'packages/extension-sdk/src'),
      },
      { find: '@tests', replacement: resolve(root, 'tests') },
    ],
    // Note: tsconfigPaths is intentionally omitted. The explicit resolve.alias
    // entries above handle all path aliases correctly. tsconfigPaths can mangle
    // aliases into incorrect relative paths when dynamic require() is used in
    // tests (e.g. the canvas multi-engine adapter tests), causing ENOENT errors.
    // Additionally, explicit .ts extensions are needed for require() resolution.
  },
  test: {
    // ── Shared defaults (inherited by projects via extends: true) ──
    environment: 'node',
    // vitest 5 defaults to sharing one Vite server across projects (breaking
    // change #10848). With three parallel forks projects, all module-transform
    // requests funnel through that single server and import throughput
    // degrades: full suite measured 153s shared vs ~128s with per-project
    // servers (server/native shards are individually FASTER on 5.x, so the
    // regression is purely this serialization). Opt out to keep the 4.x
    // parallel profile.
    sharedViteServer: false,
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    ...(configuredMaxWorkers ? { maxWorkers: configuredMaxWorkers } : {}),
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: coverageExclude,
      reporter: coverageReporter,
      thresholds: {
        // Coverage gate is calibrated to the current repo baseline so push hooks
        // catch regressions without blocking on long-standing uncovered surfaces.
        // Branch coverage varies slightly across V8/Node-version combinations in CI,
        // so keep a small buffer below the observed Linux baseline instead of
        // failing healthy pushes on 0.01-0.1% runner deltas. Node 22 vs 24 V8
        // engines can swing branches/statements by up to 0.1% on the same commit.
        //
        // History: Phase 1.2/2 SIMD/FP/Dart ~3500 lines lowered these once.
        // M1-M5 + E4/E5 + Route A'/B/C/D + the 2026-07-04 coverage campaign
        // (43 files / ~520 tests added, functions threshold already cleared at
        // 86.14%) raised coverage substantially but the remaining gap sits in
        // the hardest tail: deep handler chains (CDP/ctx mocks), the ARM64
        // CpuEngine interpreter, and full binary parsers (AxmlParser,
        // HeapSnapshotParser internals, MachOParser/ElfParser section+symbol
        // paths). Observed AT THAT TIME (pre-erasableSyntaxOnly, local/CI):
        // 84.6/84.3% lines, 85.6/85.46% functions, 83.2/82.8% statements,
        // 73.6/73.3% branches — SUPERSEDED, see the Session 60 entry below.
        // CI runs ~0.17%
        // lower on functions (artifacts/tmp missing → DetailedDataManager persist
        // paths uncovered via ENOENT, visible as WARNs in the CI log), not a code
        // regression. Session 45 added 9 domain handler-layer functions not yet
        // unit-covered; restoring functions toward 86 needs ctx/fs mocks for
        // those handlers. Thresholds set below observed for headroom while
        // catching regressions.
        // TODO (next coverage campaign): restore toward lines:84 / statements:83
        //   / branches:73 by covering the tail surface — prioritise:
        //     1. HeapSnapshotParser internals (line-format edges, diff deltas)
        //     2. CpuEngine ARM64 instruction execution (needs fixture vectors)
        //     3. (removed) analysis-handlers.ts was deleted — it was a dead
        //        duplicate of the live per-tool handler files in this domain
        //     4. The big CDP handler chains (network/v8/streaming — need ctx mocks)
        // Session 60 (2026-08-27): the erasableSyntaxOnly refactor added 185 files /
        // ~1112 net lines of pure-shape changes (enum -> const object, parameter
        // properties -> explicit field declarations) - no new logic branches to
        // cover. The denominator grew ~15% (83768 -> 96304 statements) and the
        // observed lines coverage dropped from 81.7% to 80.75% in CI, 80.18%
        // locally. CI history shows the threshold holds with ~1% buffer below
        // observed; runner delta is 0.01-0.1% across V8/Node combinations, so
        // 80.4 keeps a ~0.35 buffer to the new observed baseline (local) and
        // ~0.35 below CI observed (80.75), matching the policy of staying below
        // the lower of the two observed numbers.
        lines: 80.0,
        // functions CI baseline drifts ~84.97-85.5% across Node 22/24 V8 builds
        // (artifacts/tmp ENOENT + handler-tail surface). 85.0 had NO buffer — unlike
        // lines/branches/statements (~1.3% below baseline) — so a 0.03% runner delta
        // tripped it on a docs-only commit (c3e3b367: 84.97% < 85%, test suite 1071
        // green). 84.0 restores a ~1% buffer matching the other thresholds and the
        // config's stated "buffer below Linux baseline" policy. Restoring toward 86
        // remains tracked by the coverage-campaign TODO above.
        // 81.3 -> 81.1: local Windows observed 81.2% (CI observed >= 81.3) —
        // a 0.1 threshold left no runner-delta buffer in either direction.
        // Post-v2-migration CI (linux-full) observed: lines 80.13 / functions
        // 81.03 / statements 78.74 / branches 69.98 — thresholds move below the
        // lower of the two observed numbers per the policy above.
        // 2026-09-24: the coverage `exclude` list was cut 95 -> 38 entries (the
        // removed globs covered real logic, not re-export shims — see the notes
        // on `coverageExclude` above) and 3 zero-caller files were deleted. Both
        // changes RAISED every metric, so the numbers below are unchanged.
        // Current local (Windows) observed, full suite: lines 81.49 /
        // statements 79.98 / functions 81.76 / branches 70.91 — i.e. +1.49 /
        // +1.38 / +0.86 / +1.11 above the thresholds. The tightest margin is
        // still functions; CI (Linux) re-measurement has NOT landed yet, so do
        // not tighten these until it does.
        functions: 80.9,
        branches: 69.8,
        statements: 78.6,
      },
    },

    // ── Projects for optimized parallel execution ──
    // Run all:     vitest run
    // Run single:  vitest run --project pure
    projects: [
      {
        extends: true,
        test: {
          name: 'pure',
          pool: 'forks', // Use forks because pure tests might load better-sqlite3 via cache utils
          // NOTE: isolate:false was tried in 928de3e7 and reverted — sharing
          // the module graph across files makes shared-fork state leak into
          // vi.mock('node:*')-heavy suites (sanitizeForCache / artifacts /
          // DetailedDataManager / safeOutput / bridges.shared rotate failures
          // per run; single-file runs are green). CI linux-full reproduces it
          // on both Node 22 and 24. Keep per-file isolation here; the ~80
          // cold imports are the price of determinism.
          include: [
            'tests/utils/**/*.test.ts',
            'tests/errors/**/*.test.ts',
            'tests/contracts/**/*.test.ts',
            'tests/cli/**/*.test.ts',
            'tests/config/**/*.test.ts',
            'tests/packages/**/*.test.ts',
            'tests/scripts/**/*.test.ts',
            'tests/constants*.test.ts',
          ],
          exclude: ['tests/e2e/**'],
          setupFiles: ['tests/setup.light.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'server',
          pool: 'forks', // Use forks for better-sqlite3 compatibility
          include: [
            'tests/server/**/*.test.ts',
            'tests/modules/**/*.test.ts',
            'tests/index.test.ts',
            'tests/simple-stub-test.test.ts',
          ],
          exclude: ['tests/e2e/**', 'tests/modules/process/**/*.test.ts'],
          setupFiles: ['tests/setup.registry.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'native',
          pool: 'forks', // FFI (koffi) is NOT thread-safe — must use process isolation
          include: ['tests/native/**/*.test.ts', 'tests/modules/process/**/*.test.ts'],
          exclude: ['tests/e2e/**'],
          setupFiles: ['tests/setup.registry.ts'],
        },
      },
    ],
  },
});
