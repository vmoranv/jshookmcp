import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

interface ActivateDomainBody {
  success: boolean;
  domain?: string;
  activated?: number;
  totalDomainTools?: number;
}

interface CoverageReportBody {
  success: boolean;
  totalKnownTools?: number;
  uncalled?: string[];
  called?: Record<string, { count: number }>;
}

describe('Meta-tools runtime E2E', { timeout: 120_000 }, () => {
  const client = new MCPTestClient();

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.cleanup();
  });

  test('activate_domain(browser) exposes browser tool inventory and coverage_report returns runtime summary', async () => {
    if (
      !client.getToolMap().has('activate_domain') ||
      !client.getToolMap().has('coverage_report')
    ) {
      client.recordSynthetic(
        'meta-tools-runtime',
        'SKIP',
        'Missing activate_domain or coverage_report in current build',
      );
      return;
    }

    const activate = await client.call('activate_domain', { domain: 'browser' }, 30_000);
    expect(activate.result.status).not.toBe('FAIL');
    const activateBody = activate.parsed as ActivateDomainBody;
    expect(activateBody.success).toBe(true);
    expect(activateBody.domain).toBe('browser');
    expect(typeof activateBody.totalDomainTools).toBe('number');
    expect((activateBody.totalDomainTools ?? 0) > 0).toBe(true);

    const coverage = await client.call('coverage_report', {}, 30_000);
    expect(coverage.result.status).not.toBe('FAIL');
    const coverageBody = coverage.parsed as CoverageReportBody;
    expect(coverageBody.success).toBe(true);
    expect(typeof coverageBody.totalKnownTools).toBe('number');
    expect((coverageBody.totalKnownTools ?? 0) > 0).toBe(true);
    expect(Array.isArray(coverageBody.uncalled)).toBe(true);
    expect(coverageBody.called?.activate_domain?.count).toBeGreaterThanOrEqual(1);
  });
});

/**
 * P0 regression (v0.4.5): the `search` tier registers only 58 base tools
 * (meta-tools + browser/page runtime). Workflow/full-only domains such as
 * `network` are NOT in that base list and must be lazily registered via
 * `ensureDomainLoaded`. A cache-sync bug made `activate_tools` report every
 * such tool as notFound, so tools were discoverable but never callable.
 * The default `full`-profile client above cannot catch this — full loads all
 * domains at startup. This test drives the REAL stdio MCP pipeline under
 * `search` with a tool that genuinely requires lazy activation.
 */
describe('search-tier lazy activation pipeline (P0 regression)', { timeout: 120_000 }, () => {
  const client = new MCPTestClient({ envOverrides: { MCP_TOOL_PROFILE: 'search' } });

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.cleanup();
  });

  test('activate_tools activates a workflow/full tool and call_tool can invoke it', async () => {
    if (!client.getToolMap().has('activate_tools') || !client.getToolMap().has('call_tool')) {
      client.recordSynthetic(
        'search-tier-lazy-activation',
        'SKIP',
        'Missing activate_tools or call_tool in current build',
      );
      return;
    }

    // network_* tools live in the `network` domain (['workflow','full']), which
    // is NOT in the 58-tool `search` base list — they need ensureDomainLoaded.
    const activate = await client.call(
      'activate_tools',
      { names: ['network_get_status', 'network_get_stats'] },
      30_000,
    );
    expect(activate.result.status).not.toBe('FAIL');
    const body = activate.parsed as {
      success: boolean;
      activated?: string[];
      notFound?: string[];
    };
    expect(body.success).toBe(true);
    expect(body.notFound ?? []).toEqual([]);
    expect(body.activated).toContain('network_get_status');
    expect(body.activated).toContain('network_get_stats');

    // After activation the tool must be invocable through call_tool (the proxy
    // path that previously answered "exists but is not active").
    const status = await client.call('call_tool', { name: 'network_get_status', args: {} }, 30_000);
    expect(status.result.status).not.toBe('FAIL');
    const text = JSON.stringify(status.parsed);
    expect(text).not.toContain('not active');
    expect(text).not.toContain('notFound');
  });
});
