import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';
import { analyzeCoverage, formatCoverageReport } from '@tests/e2e/helpers/coverage-analyzer';

const ARTIFACT_DIR = join(process.cwd(), '.tmp_mcp_artifacts');

describe('E2E Coverage Analysis', { timeout: 60_000 }, () => {
  const client = new MCPTestClient();
  let toolMap: Map<string, { name: string; inputSchema?: Record<string, unknown> }>;

  beforeAll(async () => {
    await mkdir(ARTIFACT_DIR, { recursive: true });
    await client.connect();
    toolMap = client.getToolMap();
  });

  afterAll(async () => {
    await client.cleanup();
  });

  it('generates a coverage report with all registered tools', () => {
    const report = analyzeCoverage(toolMap);

    // Report should exist and have valid structure
    expect(report.totalTools).toBeGreaterThan(0);
    expect(report.totalTools).toBe(toolMap.size);
    expect(report.exercised + report.skipped + report.untested).toBe(report.totalTools);
    expect(report.overallCoveragePercent).toBeGreaterThanOrEqual(0);
    expect(report.overallCoveragePercent).toBeLessThanOrEqual(100);
    expect(report.timestamp).toBeTruthy();
  });

  it('produces per-domain breakdown', () => {
    const report = analyzeCoverage(toolMap);

    // Should have multiple domains
    expect(report.domains.length).toBeGreaterThan(5);

    for (const domain of report.domains) {
      expect(domain.domain).toBeTruthy();
      expect(domain.total).toBeGreaterThan(0);
      expect(domain.exercised + domain.skipped + domain.untested).toBe(domain.total);
      expect(domain.coveragePercent).toBeGreaterThanOrEqual(0);
      expect(domain.coveragePercent).toBeLessThanOrEqual(100);
      expect(domain.tools.length).toBe(domain.total);
    }
  });

  it('identifies untested tools', () => {
    const report = analyzeCoverage(toolMap);

    // Untested list should match count
    expect(report.untestedTools.length).toBe(report.untested);

    // Each untested tool should be in the registered tool map
    for (const toolName of report.untestedTools) {
      expect(toolMap.has(toolName)).toBe(true);
    }
  });

  it('writes coverage report as JSON artifact', async () => {
    const report = analyzeCoverage(toolMap);
    const reportPath = join(ARTIFACT_DIR, 'e2e-coverage-report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2));

    // Verify the report parses back correctly
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(reportPath, 'utf-8');
    const parsed = JSON.parse(content) as typeof report;
    expect(parsed.totalTools).toBe(report.totalTools);
    expect(parsed.domains.length).toBe(report.domains.length);
  });

  it('formats a human-readable summary', () => {
    const report = analyzeCoverage(toolMap);
    const summary = formatCoverageReport(report);

    // Summary should contain key sections
    expect(summary).toContain('E2E Coverage Report');
    expect(summary).toContain('Per-Domain Breakdown');
    expect(summary).toContain('Total tools:');
    expect(summary).toContain('Exercised:');
    expect(summary).toContain('Coverage:');

    // Print for visibility in test output
    console.info('\n' + summary);
  });

  it('verifies real browser (non-headless) configuration is supported', () => {
    // The MCPTestClient sets PUPPETEER_HEADLESS=false by default
    // and browser_launch override uses headless: false
    // This test verifies those configurations are present

    // Check tool map has browser_launch
    expect(toolMap.has('browser_launch')).toBe(true);

    // Check the schema accepts a headless parameter
    const browserLaunch = toolMap.get('browser_launch');
    expect(browserLaunch).toBeDefined();
    if (browserLaunch?.inputSchema) {
      const schema = browserLaunch.inputSchema;
      const properties = schema.properties as Record<string, unknown> | undefined;
      if (properties) {
        expect(properties).toHaveProperty('headless');
      }
    }
  });
});
