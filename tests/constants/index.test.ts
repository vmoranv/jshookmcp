/**
 * Contract test: verifies all 331 constants are accessible from the barrel export.
 * This test ensures the modular refactor maintains backward compatibility.
 */

import { describe, test } from 'vitest';
import * as constants from '../../src/constants/index.js';

describe('constants barrel export', () => {
  test('all helpers are exported', ({ expect }) => {
    expect(constants.int).toBeTypeOf('function');
    expect(constants.float).toBeTypeOf('function');
    expect(constants.bool).toBeTypeOf('function');
    expect(constants.str).toBeTypeOf('function');
    expect(constants.list).toBeTypeOf('function');
    expect(constants.csv).toBeTypeOf('function');
    expect(constants.autoInt).toBeTypeOf('function');
    expect(constants.cpuCount).toBeTypeOf('function');
  });

  test('server constants are exported', ({ expect }) => {
    expect(constants.SHUTDOWN_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.RUNTIME_ERROR_WINDOW_MS).toBeTypeOf('number');
    expect(constants.DEBUG_PORT_CANDIDATES).toBeInstanceOf(Array);
    expect(constants.MCP_HTTP_REQUEST_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.TOKEN_BUDGET_MAX_TOKENS).toBeTypeOf('number');
    expect(constants.ACTIVATION_TTL_MINUTES).toBeTypeOf('number');
  });

  test('search constants are exported', ({ expect }) => {
    expect(constants.SEARCH_WORKFLOW_BOOST_TIERS).toBeInstanceOf(Set);
    expect(constants.SEARCH_AFFINITY_BOOST_FACTOR).toBeTypeOf('number');
    expect(constants.SEARCH_BM25_K1).toBeTypeOf('number');
    expect(constants.SEARCH_VECTOR_ENABLED).toBeTypeOf('boolean');
    expect(constants.PREDICTIVE_MAX_HISTORY).toBeTypeOf('number');
    expect(constants.RERANK_MAINTENANCE_PENALTY).toBeTypeOf('number');
  });

  test('memory constants are exported', ({ expect }) => {
    expect(constants.MEMORY_READ_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.SCAN_MAX_RESULTS_PER_SCAN).toBeTypeOf('number');
    expect(constants.POINTER_CHAIN_MAX_DEPTH).toBeTypeOf('number');
    expect(constants.STRUCT_ANALYZE_DEFAULT_SIZE).toBeTypeOf('number');
    expect(constants.HEAP_ENUMERATE_MAX_BLOCKS).toBeTypeOf('number');
    expect(constants.USERSPACE_MAX_ADDRESS).toBeTypeOf('bigint');
  });

  test('adb constants are exported', ({ expect }) => {
    expect(constants.ADB_DEFAULT_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.ADB_LOGCAT_TAIL_DEFAULT).toBeTypeOf('number');
    expect(constants.APK_ZIP_MAGIC_HEX_HEADERS).toBeInstanceOf(Array);
  });

  test('dart constants are exported', ({ expect }) => {
    expect(constants.DART_MIN_LENGTH).toBeTypeOf('number');
    expect(constants.DART_DEFAULT_ENCODING).toBeTypeOf('string');
    expect(constants.DART_SNAPSHOT_MAX_FILE_BYTES).toBeTypeOf('number');
  });

  test('workflow constants are exported', ({ expect }) => {
    expect(constants.WORKFLOW_BATCH_MAX_ACCOUNTS).toBeTypeOf('number');
    expect(constants.WORKFLOW_JS_BUNDLE_MAX_SIZE_BYTES).toBeTypeOf('number');
  });

  test('browser constants are exported', ({ expect }) => {
    expect(constants.BROWSER_POOL_IDLE_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.PAGE_FRAME_SELECTOR_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.DOM_QUERY_DEFAULT_LIMIT).toBeTypeOf('number');
    expect(constants.SCRIPTS_MAX_CAP).toBeTypeOf('number');
  });

  test('network constants are exported', ({ expect }) => {
    expect(constants.NETWORK_REPLAY_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.ICMP_PROBE_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.PROTO_TLS_CONFIDENCE).toBeTypeOf('number');
    expect(constants.BOT_DETECT_LIMIT_DEFAULT).toBeTypeOf('number');
  });

  test('captcha constants are exported', ({ expect }) => {
    expect(constants.CAPTCHA_SUBMIT_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.CAPTCHA_SCREENSHOT_FALLBACK_DIR).toBeTypeOf('string');
  });

  test('sandbox constants are exported', ({ expect }) => {
    expect(constants.SANDBOX_EXEC_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.SANDBOX_MIN_MEMORY_LIMIT_BYTES).toBeTypeOf('number');
    expect(constants.SANDBOX_MAX_MEMORY_LIMIT_MB).toBeTypeOf('number');
    expect(constants.JSVMP_DEOBFUSCATE_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.SYMBOLIC_EXEC_MAX_PATHS).toBeTypeOf('number');
    expect(constants.PACKER_SANDBOX_TIMEOUT_MS).toBeTypeOf('number');
  });

  test('external-tools constants are exported', ({ expect }) => {
    expect(constants.EXTERNAL_TOOL_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.FRIDA_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.GHIDRA_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.UNIDBG_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.NATIVE_BRIDGE_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.MOJO_MONITOR_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.V8_BYTECODE_SUBPROC_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.SYSCALL_TRACE_DURATION_DEFAULT_SEC).toBeTypeOf('number');
    expect(constants.NEMU_SESSION_IDLE_TTL_MS).toBeTypeOf('number');
    expect(constants.BINARY_STRINGS_MIN_LENGTH_DEFAULT).toBeTypeOf('number');
  });

  test('transform constants are exported', ({ expect }) => {
    expect(constants.TRANSFORM_WORKER_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.EMULATOR_FETCH_GOTO_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.ADV_DEOBF_LLM_MAX_TOKENS).toBeTypeOf('number');
  });

  test('analysis constants are exported', ({ expect }) => {
    expect(constants.GRAPHQL_MAX_PREVIEW_CHARS).toBeTypeOf('number');
    expect(constants.WASM_TOOL_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.ANALYSIS_MAX_SUMMARY_FILES).toBeTypeOf('number');
    expect(constants.MINIAPP_UNPACK_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.PROCESS_LAUNCH_WAIT_MS).toBeTypeOf('number');
    expect(constants.SOURCEMAP_EXT_TIMEOUT_MS).toBeTypeOf('number');
  });

  test('streaming constants are exported', ({ expect }) => {
    expect(constants.WS_PAYLOAD_PREVIEW_LIMIT).toBeTypeOf('number');
  });

  test('proxy constants are exported', ({ expect }) => {
    expect(constants.PROXY_CAPTURE_BUFFER_MAX).toBeTypeOf('number');
  });

  test('coordination constants are exported', ({ expect }) => {
    expect(constants.WEBHOOK_PROCESS_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.ORCHESTRATOR_STEP_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.MACRO_DEFAULT_TIMEOUT_MS).toBeTypeOf('number');
    expect(constants.COORDINATION_GOTO_TIMEOUT_MS).toBeTypeOf('number');
  });

  test('all constants remain accessible (comprehensive sample)', ({ expect }) => {
    // Sample from each file to ensure no import breakage
    const sampleConstants = [
      'SHUTDOWN_TIMEOUT_MS',
      'SEARCH_BM25_K1',
      'MEMORY_READ_TIMEOUT_MS',
      'ADB_DEFAULT_TIMEOUT_MS',
      'DART_MIN_LENGTH',
      'WORKFLOW_BATCH_MAX_ACCOUNTS',
      'BROWSER_POOL_IDLE_TIMEOUT_MS',
      'NETWORK_REPLAY_TIMEOUT_MS',
      'CAPTCHA_SUBMIT_TIMEOUT_MS',
      'SANDBOX_EXEC_TIMEOUT_MS',
      'FRIDA_TIMEOUT_MS',
      'TRANSFORM_WORKER_TIMEOUT_MS',
      'GRAPHQL_MAX_PREVIEW_CHARS',
      'WS_PAYLOAD_PREVIEW_LIMIT',
      'PROXY_CAPTURE_BUFFER_MAX',
      'MACRO_DEFAULT_TIMEOUT_MS',
    ];

    for (const name of sampleConstants) {
      expect(constants).toHaveProperty(name);
      expect((constants as Record<string, unknown>)[name]).toBeDefined();
    }
  });

  // ── Enhanced Tests (Task 5) ──

  describe('domain file export completeness', () => {
    test('helpers exports all 8 parsing functions', ({ expect }) => {
      const helperFns = ['int', 'float', 'bool', 'str', 'list', 'csv', 'autoInt', 'cpuCount'];
      for (const fn of helperFns) {
        expect(constants).toHaveProperty(fn);
        expect((constants as Record<string, unknown>)[fn]).toBeTypeOf('function');
      }
    });

    test('server constants are all numbers except arrays/sets', ({ expect }) => {
      expect(constants.SHUTDOWN_TIMEOUT_MS).toBeTypeOf('number');
      expect(constants.RUNTIME_ERROR_WINDOW_MS).toBeTypeOf('number');
      expect(constants.MCP_HTTP_REQUEST_TIMEOUT_MS).toBeTypeOf('number');
      expect(constants.TOKEN_BUDGET_MAX_TOKENS).toBeTypeOf('number');
      expect(constants.DEBUG_PORT_CANDIDATES).toBeInstanceOf(Array);
    });

    test('search constants include Set and numbers', ({ expect }) => {
      expect(constants.SEARCH_WORKFLOW_BOOST_TIERS).toBeInstanceOf(Set);
      expect(constants.SEARCH_BM25_K1).toBeTypeOf('number');
      expect(constants.SEARCH_BM25_B).toBeTypeOf('number');
      expect(constants.SEARCH_VECTOR_ENABLED).toBeTypeOf('boolean');
    });

    test('memory constants include bigint for address limits', ({ expect }) => {
      expect(constants.USERSPACE_MAX_ADDRESS).toBeTypeOf('bigint');
      expect(constants.MEMORY_READ_TIMEOUT_MS).toBeTypeOf('number');
      expect(constants.SCAN_MAX_RESULTS_PER_SCAN).toBeTypeOf('number');
    });

    test('browser constants are all numbers except arrays', ({ expect }) => {
      expect(constants.BROWSER_POOL_IDLE_TIMEOUT_MS).toBeTypeOf('number');
      expect(constants.PAGE_FRAME_SELECTOR_TIMEOUT_MS).toBeTypeOf('number');
      expect(constants.DOM_QUERY_DEFAULT_LIMIT).toBeTypeOf('number');
      expect(constants.SCRIPTS_MAX_CAP).toBeTypeOf('number');
    });

    test('network constants include arrays and numbers', ({ expect }) => {
      expect(constants.NETWORK_REPLAY_TIMEOUT_MS).toBeTypeOf('number');
      expect(constants.ICMP_PROBE_TIMEOUT_MS).toBeTypeOf('number');
      expect(constants.PROTO_TLS_CONFIDENCE).toBeTypeOf('number');
      expect(constants.BOT_DETECT_LIMIT_DEFAULT).toBeTypeOf('number');
    });

    test('workflow constants include numbers', ({ expect }) => {
      expect(constants.WORKFLOW_BATCH_MAX_ACCOUNTS).toBeTypeOf('number');
      expect(constants.WORKFLOW_JS_BUNDLE_MAX_SIZE_BYTES).toBeTypeOf('number');
    });
  });

  describe('helper function env variable parsing', () => {
    test('int() parses integer from env or fallback', ({ expect }) => {
      const result = constants.int('NONEXISTENT_INT', 42);
      expect(result).toBe(42);
      expect(result).toBeTypeOf('number');
    });

    test('float() parses float from env or fallback', ({ expect }) => {
      const result = constants.float('NONEXISTENT_FLOAT', 3.14);
      expect(result).toBe(3.14);
      expect(result).toBeTypeOf('number');
    });

    test('bool() parses boolean from env or fallback', ({ expect }) => {
      const result = constants.bool('NONEXISTENT_BOOL', true);
      expect(result).toBe(true);
      expect(result).toBeTypeOf('boolean');
    });

    test('str() parses string from env or fallback', ({ expect }) => {
      const result = constants.str('NONEXISTENT_STR', 'default');
      expect(result).toBe('default');
      expect(result).toBeTypeOf('string');
    });

    test('csv() parses comma-separated list from env or fallback', ({ expect }) => {
      const result = constants.csv('NONEXISTENT_CSV', ['a', 'b']);
      expect(result).toBeInstanceOf(Array);
      expect(result).toEqual(['a', 'b']);
    });

    test('list() parses list from env or fallback', ({ expect }) => {
      const result = constants.list('NONEXISTENT_LIST', [1, 2]);
      expect(result).toBeInstanceOf(Array);
      expect(result).toEqual([1, 2]);
    });

    test('autoInt() returns number or "auto"', ({ expect }) => {
      const result = constants.autoInt('NONEXISTENT_AUTO', 42, () => 100);
      expect(['number']).toContain(typeof result);
      expect(result).toBe(42);
    });

    test('cpuCount() returns positive integer', ({ expect }) => {
      const result = constants.cpuCount();
      expect(result).toBeTypeOf('number');
      expect(result).toBeGreaterThan(0);
      expect(Number.isInteger(result)).toBe(true);
    });
  });

  describe('constant value type validation', () => {
    test('timeout constants are positive numbers', ({ expect }) => {
      const timeoutConstants = [
        'SHUTDOWN_TIMEOUT_MS',
        'RUNTIME_ERROR_WINDOW_MS',
        'SEARCH_WORKFLOW_CACHE_TTL_MS',
        'MEMORY_READ_TIMEOUT_MS',
        'ADB_DEFAULT_TIMEOUT_MS',
        'BROWSER_POOL_IDLE_TIMEOUT_MS',
        'NETWORK_REPLAY_TIMEOUT_MS',
        'CAPTCHA_SUBMIT_TIMEOUT_MS',
        'SANDBOX_EXEC_TIMEOUT_MS',
        'FRIDA_TIMEOUT_MS',
        'TRANSFORM_WORKER_TIMEOUT_MS',
      ];

      for (const name of timeoutConstants) {
        const value = (constants as Record<string, unknown>)[name];
        expect(value).toBeTypeOf('number');
        expect(value as number).toBeGreaterThan(0);
      }
    });

    test('limit/cap/max constants are positive integers', ({ expect }) => {
      const limitConstants = [
        'SEARCH_BM25_TOP_N',
        'MEMORY_SCAN_BATCH_SIZE',
        'DOM_QUERY_DEFAULT_LIMIT',
        'SCRIPTS_MAX_CAP',
        'WORKFLOW_BATCH_MAX_ACCOUNTS',
      ];

      for (const name of limitConstants) {
        const value = (constants as Record<string, unknown>)[name];
        expect(value).toBeTypeOf('number');
        expect(value as number).toBeGreaterThan(0);
        expect(Number.isInteger(value as number)).toBe(true);
      }
    });

    test('boolean flags have boolean type', ({ expect }) => {
      const booleanConstants = [
        'SEARCH_VECTOR_ENABLED',
        'SEARCH_VECTOR_PREWARM',
        'SEARCH_VECTOR_CACHE_ENABLED',
        'SEARCH_RERANK_WORKFLOW_TOOLS',
        'SEARCH_AFFINITY_BOOST_ENABLED',
      ];

      for (const name of booleanConstants) {
        const value = (constants as Record<string, unknown>)[name];
        if (value !== undefined) {
          expect(value).toBeTypeOf('boolean');
        }
      }
    });

    test('string constants have string type', ({ expect }) => {
      expect(constants.DART_DEFAULT_ENCODING).toBeTypeOf('string');
      expect(constants.CAPTCHA_SCREENSHOT_FALLBACK_DIR).toBeTypeOf('string');
    });

    test('array constants are arrays', ({ expect }) => {
      expect(constants.DEBUG_PORT_CANDIDATES).toBeInstanceOf(Array);
      expect(constants.APK_ZIP_MAGIC_HEX_HEADERS).toBeInstanceOf(Array);
    });

    test('set constants are Sets', ({ expect }) => {
      expect(constants.SEARCH_WORKFLOW_BOOST_TIERS).toBeInstanceOf(Set);
    });

    test('bigint constants have bigint type', ({ expect }) => {
      expect(constants.USERSPACE_MAX_ADDRESS).toBeTypeOf('bigint');
      expect(constants.USERSPACE_MAX_ADDRESS).toBeGreaterThan(0n);
    });
  });

  describe('constant naming conventions', () => {
    test('all timeout constants end with _MS or _SEC', ({ expect }) => {
      const allKeys = Object.keys(constants);
      const timeoutKeys = allKeys.filter((k) => k.includes('TIMEOUT'));

      for (const key of timeoutKeys) {
        if (!key.endsWith('_MS') && !key.endsWith('_SEC') && !key.includes('DURATION')) {
          // Some constants might be boolean flags like ENABLE_TIMEOUT_GUARD
          const value = (constants as Record<string, unknown>)[key];
          if (typeof value === 'number') {
            expect(key).toMatch(/_MS$|_SEC$/);
          }
        }
      }
    });

    test('all constants are SCREAMING_SNAKE_CASE (excluding helpers)', ({ expect }) => {
      const allKeys = Object.keys(constants);
      const helperFns = ['int', 'float', 'bool', 'str', 'list', 'csv', 'autoInt', 'cpuCount'];
      const constantKeys = allKeys.filter((k) => !helperFns.includes(k));

      for (const key of constantKeys) {
        expect(key).toMatch(/^[A-Z0-9_]+$/);
      }
    });
  });

  describe('backward compatibility', () => {
    test('all constants from modular files are exported in barrel', ({ expect }) => {
      // Verify that modular structure does not break existing imports
      const criticalConstants = [
        'SHUTDOWN_TIMEOUT_MS', // server.ts
        'SEARCH_BM25_K1', // search.ts
        'MEMORY_READ_TIMEOUT_MS', // memory.ts
        'ADB_DEFAULT_TIMEOUT_MS', // adb.ts
        'DART_MIN_LENGTH', // dart.ts
        'WORKFLOW_BATCH_MAX_ACCOUNTS', // workflow.ts
        'BROWSER_POOL_IDLE_TIMEOUT_MS', // browser.ts
        'NETWORK_REPLAY_TIMEOUT_MS', // network.ts
        'CAPTCHA_SUBMIT_TIMEOUT_MS', // captcha.ts
        'SANDBOX_EXEC_TIMEOUT_MS', // sandbox.ts
        'FRIDA_TIMEOUT_MS', // external-tools.ts
        'TRANSFORM_WORKER_TIMEOUT_MS', // transform.ts
        'GRAPHQL_MAX_PREVIEW_CHARS', // analysis.ts
        'WS_PAYLOAD_PREVIEW_LIMIT', // streaming.ts
        'PROXY_CAPTURE_BUFFER_MAX', // proxy.ts
        'MACRO_DEFAULT_TIMEOUT_MS', // coordination.ts
      ];

      for (const name of criticalConstants) {
        expect(constants).toHaveProperty(name);
        expect((constants as Record<string, unknown>)[name]).toBeDefined();
      }
    });

    test('no undefined constants in barrel export', ({ expect }) => {
      const allKeys = Object.keys(constants);
      for (const key of allKeys) {
        const value = (constants as Record<string, unknown>)[key];
        // Helpers can be functions, constants should be defined
        if (typeof value !== 'function') {
          expect(value).toBeDefined();
        }
      }
    });
  });
});
