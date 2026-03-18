import { afterEach, describe, expect, it, vi } from 'vitest';

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
  it('parses integer env values with fallback semantics', async () => {
    expect((await loadConstants({ DEFAULT_DEBUG_PORT: undefined })).DEFAULT_DEBUG_PORT).toBe(9222);
    expect((await loadConstants({ DEFAULT_DEBUG_PORT: '' })).DEFAULT_DEBUG_PORT).toBe(9222);
    expect((await loadConstants({ DEFAULT_DEBUG_PORT: 'abc' })).DEFAULT_DEBUG_PORT).toBe(9222);
    expect((await loadConstants({ DEFAULT_DEBUG_PORT: '1337' })).DEFAULT_DEBUG_PORT).toBe(1337);
  });

  it('parses float env values with fallback semantics', async () => {
    expect(
      (await loadConstants({ SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER: undefined }))
        .SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER
    ).toBe(1.5);
    expect(
      (await loadConstants({ SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER: '' }))
        .SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER
    ).toBe(1.5);
    expect(
      (await loadConstants({ SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER: 'abc' }))
        .SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER
    ).toBe(1.5);
    expect(
      (await loadConstants({ SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER: '2.25' }))
        .SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER
    ).toBe(2.25);
  });

  it('parses boolean env values for ENABLE_INJECTION_TOOLS', async () => {
    expect(
      (await loadConstants({ ENABLE_INJECTION_TOOLS: undefined })).ENABLE_INJECTION_TOOLS
    ).toBe(true);
    expect((await loadConstants({ ENABLE_INJECTION_TOOLS: '' })).ENABLE_INJECTION_TOOLS).toBe(true);
    expect((await loadConstants({ ENABLE_INJECTION_TOOLS: '1' })).ENABLE_INJECTION_TOOLS).toBe(
      true
    );
    expect((await loadConstants({ ENABLE_INJECTION_TOOLS: ' TRUE ' })).ENABLE_INJECTION_TOOLS).toBe(
      true
    );
    expect((await loadConstants({ ENABLE_INJECTION_TOOLS: '0' })).ENABLE_INJECTION_TOOLS).toBe(
      false
    );
    expect((await loadConstants({ ENABLE_INJECTION_TOOLS: 'false' })).ENABLE_INJECTION_TOOLS).toBe(
      false
    );
    expect((await loadConstants({ ENABLE_INJECTION_TOOLS: 'maybe' })).ENABLE_INJECTION_TOOLS).toBe(
      true
    );
  });

  it('parses string env values with fallback semantics', async () => {
    expect((await loadConstants({ GHIDRA_BRIDGE_URL: undefined })).GHIDRA_BRIDGE_ENDPOINT).toBe(
      'http://127.0.0.1:18080'
    );
    expect((await loadConstants({ GHIDRA_BRIDGE_URL: '' })).GHIDRA_BRIDGE_ENDPOINT).toBe(
      'http://127.0.0.1:18080'
    );
    expect(
      (await loadConstants({ GHIDRA_BRIDGE_URL: 'https://vmoranv.github.io/jshookmcp/test' }))
        .GHIDRA_BRIDGE_ENDPOINT
    ).toBe('https://vmoranv.github.io/jshookmcp/test');
  });

  it('parses numeric lists and drops invalid entries without falling back', async () => {
    expect((await loadConstants({ DEBUG_PORT_CANDIDATES: '' })).DEBUG_PORT_CANDIDATES).toEqual([
      9222, 9229, 9333, 2039,
    ]);
    expect(
      (await loadConstants({ DEBUG_PORT_CANDIDATES: '9333,foo,9444' })).DEBUG_PORT_CANDIDATES
    ).toEqual([9333, 9444]);
    expect(
      (await loadConstants({ DEBUG_PORT_CANDIDATES: 'foo,bar' })).DEBUG_PORT_CANDIDATES
    ).toEqual([]);
  });

  it('parses csv tiers with normalization and fallback semantics', async () => {
    expect(
      (await loadConstants({ SEARCH_WORKFLOW_BOOST_TIERS: undefined })).SEARCH_WORKFLOW_BOOST_TIERS
    ).toEqual(new Set(['workflow', 'full']));
    expect(
      (await loadConstants({ SEARCH_WORKFLOW_BOOST_TIERS: ' Workflow , FULL ' }))
        .SEARCH_WORKFLOW_BOOST_TIERS
    ).toEqual(new Set(['workflow', 'full']));
    expect(
      (await loadConstants({ SEARCH_WORKFLOW_BOOST_TIERS: ' , , ' })).SEARCH_WORKFLOW_BOOST_TIERS
    ).toEqual(new Set(['workflow', 'full']));
  });

  it('prefers the primary captcha solver url and trims both env variants', async () => {
    expect(
      (
        await loadConstants({
          CAPTCHA_SOLVER_BASE_URL: ' https://vmoranv.github.io/jshookmcp/captcha-a ',
          CAPTCHA_2CAPTCHA_BASE_URL: 'https://vmoranv.github.io/jshookmcp/captcha-b',
        })
      ).CAPTCHA_SOLVER_BASE_URL
    ).toBe('https://vmoranv.github.io/jshookmcp/captcha-a');

    expect(
      (
        await loadConstants({
          CAPTCHA_SOLVER_BASE_URL: '   ',
          CAPTCHA_2CAPTCHA_BASE_URL: ' https://vmoranv.github.io/jshookmcp/captcha-b ',
        })
      ).CAPTCHA_SOLVER_BASE_URL
    ).toBe('https://vmoranv.github.io/jshookmcp/captcha-b');

    expect(
      (
        await loadConstants({
          CAPTCHA_SOLVER_BASE_URL: undefined,
          CAPTCHA_2CAPTCHA_BASE_URL: undefined,
        })
      ).CAPTCHA_SOLVER_BASE_URL
    ).toBe('');
  });

  it('trims extension registry urls and collapses blank values', async () => {
    expect(
      (
        await loadConstants({
          EXTENSION_REGISTRY_BASE_URL: ' https://vmoranv.github.io/jshookmcp/registry ',
        })
      ).EXTENSION_REGISTRY_BASE_URL
    ).toBe('https://vmoranv.github.io/jshookmcp/registry');
    expect(
      (await loadConstants({ EXTENSION_REGISTRY_BASE_URL: '   ' })).EXTENSION_REGISTRY_BASE_URL
    ).toBe('');
  });

  it('preserves direct parseFloat behavior for CACHE_LOW_HIT_RATE_THRESHOLD', async () => {
    expect(
      (await loadConstants({ CACHE_LOW_HIT_RATE_THRESHOLD: undefined }))
        .CACHE_LOW_HIT_RATE_THRESHOLD
    ).toBe(0.3);
    expect(
      (await loadConstants({ CACHE_LOW_HIT_RATE_THRESHOLD: '0.75' })).CACHE_LOW_HIT_RATE_THRESHOLD
    ).toBe(0.75);
    expect(
      Number.isNaN(
        (await loadConstants({ CACHE_LOW_HIT_RATE_THRESHOLD: 'abc' })).CACHE_LOW_HIT_RATE_THRESHOLD
      )
    ).toBe(true);
  });
});
