import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

// Block `.env` loading so fallback assertions always observe the source
// defaults. Without this, a local (gitignored, search-tune generated) `.env`
// re-injects keys during the env-bootstrap that runs on every constants
// re-import, silently overriding the defaults under test. Mirrors the
// isolation pattern used by tests/utils/config.test.ts.
const { dotenvMock } = vi.hoisted(() => ({
  dotenvMock: {
    config: vi.fn(() => ({ error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) })),
  },
}));

vi.mock('dotenv', () => dotenvMock);

const ORIGINAL_ENV = { ...process.env };

async function loadConstants(overrides: Record<string, string | undefined> = {}) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return import('@src/constants');
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('constants env parsing', () => {
  it('defaults vector search on for every transport and honors explicit overrides', async () => {
    expect(
      (await loadConstants({ MCP_TRANSPORT: undefined, SEARCH_VECTOR_ENABLED: undefined }))
        .SEARCH_VECTOR_ENABLED,
    ).toBe(true);
    expect(
      (await loadConstants({ MCP_TRANSPORT: 'http', SEARCH_VECTOR_ENABLED: undefined }))
        .SEARCH_VECTOR_ENABLED,
    ).toBe(true);
    expect(
      (await loadConstants({ MCP_TRANSPORT: 'stdio', SEARCH_VECTOR_ENABLED: undefined }))
        .SEARCH_VECTOR_ENABLED,
    ).toBe(true);
    // The opt-out must still work on stdio — that is the documented escape
    // hatch now that the transport no longer decides the default.
    expect(
      (await loadConstants({ MCP_TRANSPORT: 'stdio', SEARCH_VECTOR_ENABLED: 'false' }))
        .SEARCH_VECTOR_ENABLED,
    ).toBe(false);
  });

  it('uses a short stdio worker idle timeout and a longer HTTP timeout by default', async () => {
    expect(
      (await loadConstants({ MCP_TRANSPORT: undefined, SEARCH_VECTOR_WORKER_IDLE_MS: undefined }))
        .SEARCH_VECTOR_WORKER_IDLE_MS,
    ).toBe(15_000);
    expect(
      (await loadConstants({ MCP_TRANSPORT: 'http', SEARCH_VECTOR_WORKER_IDLE_MS: undefined }))
        .SEARCH_VECTOR_WORKER_IDLE_MS,
    ).toBe(300_000);
  });

  it('parses integer env values with fallback semantics', async () => {
    expect((await loadConstants({ DEFAULT_DEBUG_PORT: undefined })).DEFAULT_DEBUG_PORT).toBe(9222);
    expect((await loadConstants({ DEFAULT_DEBUG_PORT: '' })).DEFAULT_DEBUG_PORT).toBe(9222);
    expect((await loadConstants({ DEFAULT_DEBUG_PORT: 'abc' })).DEFAULT_DEBUG_PORT).toBe(9222);
    expect((await loadConstants({ DEFAULT_DEBUG_PORT: '1337' })).DEFAULT_DEBUG_PORT).toBe(1337);
  });

  it('parses float env values with fallback semantics', async () => {
    expect(
      (await loadConstants({ SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER: undefined }))
        .SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER,
    ).toBe(2.4);
    expect(
      (await loadConstants({ SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER: '' }))
        .SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER,
    ).toBe(2.4);
    expect(
      (await loadConstants({ SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER: 'abc' }))
        .SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER,
    ).toBe(2.4);
    expect(
      (await loadConstants({ SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER: '2.25' }))
        .SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER,
    ).toBe(2.25);
    // Per-tool boost multipliers: fallback to defaults, parse valid floats.
    expect(
      (await loadConstants({ SEARCH_EXTENSION_TOOL_BOOST_MULTIPLIER: undefined }))
        .SEARCH_EXTENSION_TOOL_BOOST_MULTIPLIER,
    ).toBe(1.12);
    expect(
      (await loadConstants({ SEARCH_EXTENSION_TOOL_BOOST_MULTIPLIER: 'abc' }))
        .SEARCH_EXTENSION_TOOL_BOOST_MULTIPLIER,
    ).toBe(1.12);
    expect(
      (await loadConstants({ SEARCH_EXTENSION_TOOL_BOOST_MULTIPLIER: '1.6' }))
        .SEARCH_EXTENSION_TOOL_BOOST_MULTIPLIER,
    ).toBe(1.6);
    expect(
      (await loadConstants({ SEARCH_WORKFLOW_TOOL_BOOST_MULTIPLIER: undefined }))
        .SEARCH_WORKFLOW_TOOL_BOOST_MULTIPLIER,
    ).toBe(1.35);
    expect(
      (await loadConstants({ SEARCH_WORKFLOW_TOOL_BOOST_MULTIPLIER: '2.0' }))
        .SEARCH_WORKFLOW_TOOL_BOOST_MULTIPLIER,
    ).toBe(2.0);
    expect(
      (await loadConstants({ SEARCH_WORKFLOW_LIST_TOOL_BOOST_MULTIPLIER: undefined }))
        .SEARCH_WORKFLOW_LIST_TOOL_BOOST_MULTIPLIER,
    ).toBe(1.25);
    expect(
      (await loadConstants({ SEARCH_WORKFLOW_LIST_TOOL_BOOST_MULTIPLIER: '0.9' }))
        .SEARCH_WORKFLOW_LIST_TOOL_BOOST_MULTIPLIER,
    ).toBe(0.9);
  });

  it('parses string env values with fallback semantics', async () => {
    expect((await loadConstants({ GHIDRA_BRIDGE_URL: undefined })).GHIDRA_BRIDGE_ENDPOINT).toBe(
      'http://127.0.0.1:18080',
    );
    expect((await loadConstants({ GHIDRA_BRIDGE_URL: '' })).GHIDRA_BRIDGE_ENDPOINT).toBe(
      'http://127.0.0.1:18080',
    );
    expect(
      (await loadConstants({ GHIDRA_BRIDGE_URL: withPath(TEST_URLS.root, 'test') }))
        .GHIDRA_BRIDGE_ENDPOINT,
    ).toBe(withPath(TEST_URLS.root, 'test'));
  });

  it('parses numeric lists and falls back to defaults when every entry is invalid', async () => {
    expect((await loadConstants({ DEBUG_PORT_CANDIDATES: '' })).DEBUG_PORT_CANDIDATES).toEqual([
      9222, 9229, 9333, 2039,
    ]);
    expect(
      (await loadConstants({ DEBUG_PORT_CANDIDATES: '9333,foo,9444' })).DEBUG_PORT_CANDIDATES,
    ).toEqual([9333, 9444]);
    // readEnvIntegerList/list() falls back to the default list (not []) when
    // every comma-separated entry fails to parse — see the "Backward-compatible
    // alias" doc comment on list() in src/config/environment.ts: an all-invalid
    // config value preserves the effective default instead of silently
    // emptying a list that callers then treat as "no candidates".
    expect(
      (await loadConstants({ DEBUG_PORT_CANDIDATES: 'foo,bar' })).DEBUG_PORT_CANDIDATES,
    ).toEqual([9222, 9229, 9333, 2039]);
  });

  it('parses csv tiers with normalization and fallback semantics', async () => {
    expect(
      (await loadConstants({ SEARCH_WORKFLOW_BOOST_TIERS: undefined })).SEARCH_WORKFLOW_BOOST_TIERS,
    ).toEqual(new Set(['workflow', 'full']));
    expect(
      (await loadConstants({ SEARCH_WORKFLOW_BOOST_TIERS: ' Workflow , FULL ' }))
        .SEARCH_WORKFLOW_BOOST_TIERS,
    ).toEqual(new Set(['workflow', 'full']));
    expect(
      (await loadConstants({ SEARCH_WORKFLOW_BOOST_TIERS: ' , , ' })).SEARCH_WORKFLOW_BOOST_TIERS,
    ).toEqual(new Set(['workflow', 'full']));
  });

  it('prefers the primary captcha solver url and trims both env variants', async () => {
    expect(
      (
        await loadConstants({
          CAPTCHA_SOLVER_BASE_URL: ` ${withPath(TEST_URLS.root, 'captcha-a')} `,
          CAPTCHA_2CAPTCHA_BASE_URL: withPath(TEST_URLS.root, 'captcha-b'),
        })
      ).CAPTCHA_SOLVER_BASE_URL,
    ).toBe(withPath(TEST_URLS.root, 'captcha-a'));

    expect(
      (
        await loadConstants({
          CAPTCHA_SOLVER_BASE_URL: '   ',
          CAPTCHA_2CAPTCHA_BASE_URL: ` ${withPath(TEST_URLS.root, 'captcha-b')} `,
        })
      ).CAPTCHA_SOLVER_BASE_URL,
    ).toBe(withPath(TEST_URLS.root, 'captcha-b'));

    expect(
      (
        await loadConstants({
          CAPTCHA_SOLVER_BASE_URL: undefined,
          CAPTCHA_2CAPTCHA_BASE_URL: undefined,
        })
      ).CAPTCHA_SOLVER_BASE_URL,
    ).toBe('');
  });

  it('trims extension registry urls and collapses blank values', async () => {
    expect(
      (
        await loadConstants({
          EXTENSION_REGISTRY_BASE_URL:
            ' https://raw.githubusercontent.com/vmoranv/jshookmcpextension/master/registry ',
        })
      ).EXTENSION_REGISTRY_BASE_URL,
    ).toBe('https://raw.githubusercontent.com/vmoranv/jshookmcpextension/master/registry');
    expect(
      (await loadConstants({ EXTENSION_REGISTRY_BASE_URL: '   ' })).EXTENSION_REGISTRY_BASE_URL,
    ).toBe('');
  });

  it('uses float() helper for CACHE_LOW_HIT_RATE_THRESHOLD with proper fallback', async () => {
    expect(
      (await loadConstants({ CACHE_LOW_HIT_RATE_THRESHOLD: undefined }))
        .CACHE_LOW_HIT_RATE_THRESHOLD,
    ).toBe(0.3);
    expect(
      (await loadConstants({ CACHE_LOW_HIT_RATE_THRESHOLD: '0.75' })).CACHE_LOW_HIT_RATE_THRESHOLD,
    ).toBe(0.75);
    // With float() helper, invalid input returns fallback instead of NaN
    expect(
      (await loadConstants({ CACHE_LOW_HIT_RATE_THRESHOLD: 'abc' })).CACHE_LOW_HIT_RATE_THRESHOLD,
    ).toBe(0.3);
  });

  it('parses PageController operation/evaluate timeout envs with 30s fallback', async () => {
    expect(
      (
        await loadConstants({
          PAGE_OPERATION_TIMEOUT_MS: undefined,
          PAGE_EVALUATE_TIMEOUT_MS: undefined,
        })
      ).PAGE_OPERATION_TIMEOUT_MS,
    ).toBe(30_000);
    expect(
      (
        await loadConstants({
          PAGE_OPERATION_TIMEOUT_MS: undefined,
          PAGE_EVALUATE_TIMEOUT_MS: undefined,
        })
      ).PAGE_EVALUATE_TIMEOUT_MS,
    ).toBe(30_000);
    expect(
      (await loadConstants({ PAGE_OPERATION_TIMEOUT_MS: '15000', PAGE_EVALUATE_TIMEOUT_MS: 'abc' }))
        .PAGE_OPERATION_TIMEOUT_MS,
    ).toBe(15_000);
    // Invalid values fall back to the 30s default
    expect(
      (await loadConstants({ PAGE_OPERATION_TIMEOUT_MS: 'abc', PAGE_EVALUATE_TIMEOUT_MS: '45000' }))
        .PAGE_EVALUATE_TIMEOUT_MS,
    ).toBe(45_000);
  });

  it('parses ANALYSIS_EXPLOIT_LLM_MAX_TOKENS env with 3072 fallback', async () => {
    expect(
      (await loadConstants({ ANALYSIS_EXPLOIT_LLM_MAX_TOKENS: undefined }))
        .ANALYSIS_EXPLOIT_LLM_MAX_TOKENS,
    ).toBe(3_072);
    expect(
      (await loadConstants({ ANALYSIS_EXPLOIT_LLM_MAX_TOKENS: '4096' }))
        .ANALYSIS_EXPLOIT_LLM_MAX_TOKENS,
    ).toBe(4_096);
    // Invalid values fall back to the 3072 default
    expect(
      (await loadConstants({ ANALYSIS_EXPLOIT_LLM_MAX_TOKENS: 'abc' }))
        .ANALYSIS_EXPLOIT_LLM_MAX_TOKENS,
    ).toBe(3_072);
  });

  it('parses MEMORY_SCAN_REGION_GUARD_BYTES env with 1 GiB fallback', async () => {
    expect(
      (await loadConstants({ MEMORY_SCAN_REGION_GUARD_BYTES: undefined }))
        .MEMORY_SCAN_REGION_GUARD_BYTES,
    ).toBe(1024 * 1024 * 1024);
    expect(
      (await loadConstants({ MEMORY_SCAN_REGION_GUARD_BYTES: '536870912' }))
        .MEMORY_SCAN_REGION_GUARD_BYTES,
    ).toBe(536870912);
    // Invalid values fall back to the 1 GiB default
    expect(
      (await loadConstants({ MEMORY_SCAN_REGION_GUARD_BYTES: 'abc' }))
        .MEMORY_SCAN_REGION_GUARD_BYTES,
    ).toBe(1024 * 1024 * 1024);
  });
});
