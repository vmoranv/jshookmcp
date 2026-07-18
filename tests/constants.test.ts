import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

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
  it('defaults vector search off for stdio and on for shared HTTP transport', async () => {
    expect(
      (await loadConstants({ MCP_TRANSPORT: undefined, SEARCH_VECTOR_ENABLED: undefined }))
        .SEARCH_VECTOR_ENABLED,
    ).toBe(false);
    expect(
      (await loadConstants({ MCP_TRANSPORT: 'http', SEARCH_VECTOR_ENABLED: undefined }))
        .SEARCH_VECTOR_ENABLED,
    ).toBe(true);
    expect(
      (await loadConstants({ MCP_TRANSPORT: 'stdio', SEARCH_VECTOR_ENABLED: 'true' }))
        .SEARCH_VECTOR_ENABLED,
    ).toBe(true);
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

  it('parses numeric lists and drops invalid entries without falling back', async () => {
    expect((await loadConstants({ DEBUG_PORT_CANDIDATES: '' })).DEBUG_PORT_CANDIDATES).toEqual([
      9222, 9229, 9333, 2039,
    ]);
    expect(
      (await loadConstants({ DEBUG_PORT_CANDIDATES: '9333,foo,9444' })).DEBUG_PORT_CANDIDATES,
    ).toEqual([9333, 9444]);
    expect(
      (await loadConstants({ DEBUG_PORT_CANDIDATES: 'foo,bar' })).DEBUG_PORT_CANDIDATES,
    ).toEqual([]);
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
});
