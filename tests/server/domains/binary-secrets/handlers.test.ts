import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

import { BinarySecretsHandlers } from '@server/domains/binary-secrets/handlers';
import { R } from '@server/domains/shared/ResponseBuilder';
import {
  FIXTURE_AES128_OFFSET,
  FIXTURE_HEX_OFFSET,
  writeFixture,
} from '@tests/fixtures/binary-secrets/build-keys-fixture';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'binary-secrets-handler-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

interface BinaryKeyExtractResponse {
  success: boolean;
  result?: {
    candidates: Array<{
      offset: number;
      length: number;
      format: string;
      entropy: number;
      value: string;
      context?: { before: string; after: string; beforeAscii: string; afterAscii: string };
    }>;
    scannedBytes: number;
    durationMs: number;
    truncated?: boolean;
  };
  error?: string;
  message?: string;
}

describe('BinarySecretsHandlers.handleBinaryKeyExtract', () => {
  it('returns candidates wrapped in a success envelope', async () => {
    const p = join(workDir, 'fixture.bin');
    await writeFixture(p);
    const handlers = new BinarySecretsHandlers();
    const response = await handlers.handleBinaryKeyExtract({
      filePath: p,
      keyLengths: [16],
      formats: ['raw'],
      minEntropy: 3,
    });
    const body = R.parse<BinaryKeyExtractResponse>(response);
    expect(body.success).toBe(true);
    expect(body.result).toBeDefined();
    expect(
      body.result!.candidates.some(
        (c) => c.offset === FIXTURE_AES128_OFFSET && c.format === 'raw' && c.length === 16,
      ),
    ).toBe(true);
  });

  it('detects a hex candidate from the fixture', async () => {
    const p = join(workDir, 'fixture.bin');
    await writeFixture(p);
    const handlers = new BinarySecretsHandlers();
    const response = await handlers.handleBinaryKeyExtract({
      filePath: p,
      keyLengths: [32],
      formats: ['hex'],
    });
    const body = R.parse<BinaryKeyExtractResponse>(response);
    expect(body.success).toBe(true);
    expect(
      body.result!.candidates.some((c) => c.format === 'hex' && c.offset === FIXTURE_HEX_OFFSET),
    ).toBe(true);
  });

  it('emits context windows by default and omits them when requested', async () => {
    const p = join(workDir, 'fixture.bin');
    await writeFixture(p);
    const handlers = new BinarySecretsHandlers();
    const withCtx = await handlers.handleBinaryKeyExtract({
      filePath: p,
      keyLengths: [16],
      formats: ['raw'],
      minEntropy: 3,
    });
    const withoutCtx = await handlers.handleBinaryKeyExtract({
      filePath: p,
      keyLengths: [16],
      formats: ['raw'],
      minEntropy: 3,
      includeContext: false,
    });
    const a = R.parse<BinaryKeyExtractResponse>(withCtx);
    const b = R.parse<BinaryKeyExtractResponse>(withoutCtx);
    expect(a.result!.candidates[0]!.context).toBeDefined();
    expect(b.result!.candidates[0]!.context).toBeUndefined();
  });

  it('returns success:false with a clear error when filePath is missing', async () => {
    const handlers = new BinarySecretsHandlers();
    const response = await handlers.handleBinaryKeyExtract({});
    const body = R.parse<BinaryKeyExtractResponse>(response);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/filePath/i);
  });

  it('returns success:false for a missing file', async () => {
    const handlers = new BinarySecretsHandlers();
    const missing = join(workDir, 'nope.bin');
    const response = await handlers.handleBinaryKeyExtract({ filePath: missing });
    const body = R.parse<BinaryKeyExtractResponse>(response);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/not found/i);
  });

  it('rejects keyLengths containing a non-integer', async () => {
    const p = join(workDir, 'empty.bin');
    await writeFile(p, Buffer.alloc(0));
    const handlers = new BinarySecretsHandlers();
    const response = await handlers.handleBinaryKeyExtract({
      filePath: p,
      keyLengths: [16, 'oops'],
    });
    const body = R.parse<BinaryKeyExtractResponse>(response);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/keyLengths/);
  });

  it('rejects unknown formats entry', async () => {
    const p = join(workDir, 'empty.bin');
    await writeFile(p, Buffer.alloc(0));
    const handlers = new BinarySecretsHandlers();
    const response = await handlers.handleBinaryKeyExtract({
      filePath: p,
      formats: ['bogus'],
    });
    const body = R.parse<BinaryKeyExtractResponse>(response);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/formats/);
  });

  it('rejects out-of-range minEntropy', async () => {
    const p = join(workDir, 'empty.bin');
    await writeFile(p, Buffer.alloc(0));
    const handlers = new BinarySecretsHandlers();
    const response = await handlers.handleBinaryKeyExtract({
      filePath: p,
      minEntropy: 9,
    });
    const body = R.parse<BinaryKeyExtractResponse>(response);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/minEntropy/);
  });

  it('reports scannedBytes equal to file size on a full scan', async () => {
    const buf = Buffer.alloc(1024);
    for (let i = 0; i < buf.length; i++) buf[i] = (i * 13 + 7) & 0xff;
    const p = join(workDir, 'tiny.bin');
    await writeFile(p, buf);
    const handlers = new BinarySecretsHandlers();
    const response = await handlers.handleBinaryKeyExtract({
      filePath: p,
      keyLengths: [16],
      formats: ['raw'],
    });
    const body = R.parse<BinaryKeyExtractResponse>(response);
    expect(body.success).toBe(true);
    expect(body.result!.scannedBytes).toBe(1024);
  });
});

describe('BinarySecretsHandlers — manifest registration', () => {
  it('exposes exactly one tool registration', async () => {
    const manifestModule = await import('@server/domains/binary-secrets/manifest');
    const manifest = manifestModule.default;
    expect(manifest.domain).toBe('binary-secrets');
    expect(manifest.depKey).toBe('binarySecretsHandlers');
    expect(manifest.profiles).toContain('full');
    expect(manifest.registrations).toHaveLength(1);
    expect(manifest.registrations[0]!.tool.name).toBe('binary_key_extract');
  });

  it('declares a description below the 110-char tool list cap', async () => {
    const { binarySecretsTools } = await import('@server/domains/binary-secrets/definitions');
    const tool = binarySecretsTools.find((t) => t.name === 'binary_key_extract');
    expect(tool).toBeDefined();
    expect((tool!.description ?? '').length).toBeLessThan(110);
  });
});
