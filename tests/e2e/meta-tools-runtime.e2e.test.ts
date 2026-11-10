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
