/**
 * Tests for ApkPackerHandlers.handleApkSigningBlockParse — the MCP-layer
 * wrapper around SigningBlockParser. Reuses the existing synthetic fixtures
 * built by build-signing-block-fixtures.ts so we do not need any real keystore
 * or `apksig` invocation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApkPackerHandlers } from '@server/domains/apk-packer/handlers';
import { R } from '@server/domains/shared/ResponseBuilder';
import {
  buildAll,
  type FixturePaths,
} from '@tests/fixtures/apk-packer/build-signing-block-fixtures';

let paths: FixturePaths;

beforeAll(async () => {
  paths = await buildAll();
});

afterAll(async () => {
  // Fixtures are reused across tests; leave for inspection.
});

interface HandlerReport {
  success: boolean;
  report: {
    apkPath: string;
    fileSize: number;
    signingBlock: { found: boolean; magic?: string; size?: number; offset?: number };
    schemes: Record<string, unknown>;
    unknownBlocks: Array<{ id: string; size: number }>;
    warnings: string[];
    anomalies: Array<{ kind: string; evidence: string }>;
  };
}

describe('handleApkSigningBlockParse — happy paths', () => {
  it('returns the same shape as direct SigningBlockParser for v2-only APK', async () => {
    const handlers = new ApkPackerHandlers();
    const response = await handlers.handleApkSigningBlockParse({ apkPath: paths.v2Only });
    const body = R.parse<HandlerReport>(response);
    expect(body.success).toBe(true);
    expect(body.report.signingBlock.found).toBe(true);
    expect(body.report.signingBlock.magic).toBe('APK Sig Block 42');
    expect(body.report.schemes['v2']).toBeDefined();
  });

  it('surfaces v3 + rotation marker for dual-signed APK', async () => {
    const handlers = new ApkPackerHandlers();
    const response = await handlers.handleApkSigningBlockParse({ apkPath: paths.v3Rotation });
    const body = R.parse<HandlerReport>(response);
    expect(body.success).toBe(true);
    expect(body.report.schemes['v2']).toBeDefined();
    expect(body.report.schemes['v3']).toBeDefined();
  });

  it('reports found=false for plain ZIP without throwing', async () => {
    const handlers = new ApkPackerHandlers();
    const response = await handlers.handleApkSigningBlockParse({ apkPath: paths.noSigblock });
    const body = R.parse<HandlerReport>(response);
    expect(body.success).toBe(true);
    expect(body.report.signingBlock.found).toBe(false);
  });

  it('forwards anomalies surfaced by the parser (eocd-not-found)', async () => {
    const handlers = new ApkPackerHandlers();
    const response = await handlers.handleApkSigningBlockParse({ apkPath: paths.corruptEocd });
    const body = R.parse<HandlerReport>(response);
    expect(body.success).toBe(true);
    const kinds = body.report.anomalies.map((a) => a.kind);
    expect(kinds).toContain('eocd-not-found');
  });
});

describe('handleApkSigningBlockParse — validation', () => {
  it('rejects missing apkPath with VALIDATION error', async () => {
    const handlers = new ApkPackerHandlers();
    const response = await handlers.handleApkSigningBlockParse({});
    const body = R.parse<{ success: boolean; error?: string; message?: string }>(response);
    expect(body.success).toBe(false);
    expect(body.error).toContain('apkPath');
  });

  it('rejects empty-string apkPath with VALIDATION error', async () => {
    const handlers = new ApkPackerHandlers();
    const response = await handlers.handleApkSigningBlockParse({ apkPath: '' });
    const body = R.parse<{ success: boolean; error?: string }>(response);
    expect(body.success).toBe(false);
    expect(body.error).toContain('apkPath');
  });

  it('returns NOT_FOUND when the path does not exist', async () => {
    const handlers = new ApkPackerHandlers();
    const response = await handlers.handleApkSigningBlockParse({
      apkPath: paths.noSigblock + '.does-not-exist',
    });
    const body = R.parse<{ success: boolean; error?: string }>(response);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/not found|APK not found/i);
  });
});
