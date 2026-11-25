import { afterAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { LargeDataOffloader } from '@server/ToolResponseOffloader';
import type { DetailedDataManager } from '@utils/DetailedDataManager';
import { getOffloadDir } from '@utils/sanitizeForCache';
import { getProjectRoot } from '@utils/outputPaths';

function textResponse(obj: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }],
  };
}

function createDetailManager(): DetailedDataManager {
  return {
    store: vi.fn(() => 'detail_123'),
    cache: new Map([['detail_123', { size: 1024 * 1024 }]]),
  } as unknown as DetailedDataManager;
}

describe('LargeDataOffloader — issue #62 structural detection', () => {
  const offloadDir = getOffloadDir();

  afterAll(() => {
    // Best-effort cleanup of any files written by these tests.
    rmSync(offloadDir, { recursive: true, force: true });
  });

  it('sanitizes a data: URI nested in a get_detailed_data wrapper instead of skipping it', async () => {
    const offloader = new LargeDataOffloader(createDetailManager());
    const dataUri = 'data:image/png;base64,' + 'A'.repeat(2 * 1024 * 1024);
    const response = textResponse({
      success: true,
      detailId: 'detail_abc',
      path: 'requests',
      data: [{ url: dataUri, method: 'GET', requestId: 'r1' }],
    });

    await offloader.offload('get_detailed_data', response);

    const text = (response.content[0] as { text: string }).text;
    // The wrapper is NOT skipped: the multi-MB blob is gone, replaced by a placeholder.
    expect(text).toContain('_offload');
    expect(text).not.toContain('A'.repeat(500));
    expect(text.length).toBeLessThan(5000);
    // Wrapper metadata survives.
    expect(text).toContain('detail_abc');
  });

  it('still skips a pure offload placeholder response (idempotent)', async () => {
    const offloader = new LargeDataOffloader(createDetailManager());
    // A response that is already an offload placeholder padded over the threshold.
    const placeholder = {
      _offload: { type: 'file', path: 'artifacts/offloaded/x.bin', size: '2.0MB' },
      padding: 'p'.repeat(600 * 1024),
    };
    const response = textResponse(placeholder);
    const before = (response.content[0] as { text: string }).text;

    await offloader.offload('some_tool', response);

    const after = (response.content[0] as { text: string }).text;
    // Unchanged — the pure placeholder branch is left alone.
    expect(after).toBe(before);
  });

  it('leaves small responses untouched', async () => {
    const offloader = new LargeDataOffloader(createDetailManager());
    const response = textResponse({ success: true, detailId: 'd1', data: { ok: true } });
    const before = (response.content[0] as { text: string }).text;

    await offloader.offload('get_detailed_data', response);

    expect((response.content[0] as { text: string }).text).toBe(before);
  });

  it('actually writes a top-level data URI to disk and references it from the placeholder', async () => {
    const offloader = new LargeDataOffloader(createDetailManager(), {
      detailThreshold: 0,
      fileThreshold: 0,
    });
    const payload = Buffer.from('PNG-DATA-HELLO-1234');
    const dataUri = `data:image/png;base64,${payload.toString('base64')}`;
    const response = { content: [{ type: 'text' as const, text: dataUri }] };

    await offloader.offload('some_tool', response);

    const placeholder = JSON.parse((response.content[0] as { text: string }).text);
    expect(placeholder._offload.type).toBe('file');
    expect(typeof placeholder._offload.path).toBe('string');
    expect(placeholder._offload.mimeType).toBe('image/png');

    const filePath = resolve(getProjectRoot(), placeholder._offload.path);
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath)).toEqual(payload);
  });

  it('stores large JSON payloads in the detail manager with a detailId reference', async () => {
    const ddm = createDetailManager();
    const offloader = new LargeDataOffloader(ddm);
    const bigObject = { data: 'x'.repeat(600 * 1024), ok: true };
    const response = textResponse(bigObject);

    await offloader.offload('some_tool', response);

    const placeholder = JSON.parse((response.content[0] as { text: string }).text);
    expect(placeholder._offload).toMatchObject({ type: 'detailId', detailId: 'detail_123' });
    expect(ddm.store).toHaveBeenCalledOnce();
  });

  it('writes large non-JSON strings to a .txt file referenced by the placeholder', async () => {
    const offloader = new LargeDataOffloader(createDetailManager(), {
      detailThreshold: 0,
      fileThreshold: 10,
    });
    const raw = 'LARGE-RAW-STRING-' + 'z'.repeat(50);
    const plain = { content: [{ type: 'text' as const, text: raw }] };

    await offloader.offload('some_tool', plain);

    const placeholder = JSON.parse((plain.content[0] as { text: string }).text);
    expect(placeholder._offload.type).toBe('file');
    expect(placeholder._offload.path).toMatch(/\.txt$/);
    const filePath = resolve(getProjectRoot(), placeholder._offload.path);
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf8')).toBe(raw);
  });

  it('leaves MCP-shaped resource entries untouched (no top-level text payload)', async () => {
    const ddm = createDetailManager();
    const offloader = new LargeDataOffloader(ddm);
    const resourceText = JSON.stringify({ big: 'y'.repeat(600 * 1024) });
    const response = {
      content: [
        {
          type: 'resource' as const,
          resource: {
            uri: 'jshook://capture',
            text: resourceText,
            mimeType: 'application/json',
          },
        },
      ],
    };

    await offloader.offload('some_tool', response);

    // Embedded resources carry their payload under `resource`, not `text`; the
    // offloader deliberately leaves them intact (see the class contract).
    expect(ddm.store).not.toHaveBeenCalled();
    expect(response.content[0]).toEqual({
      type: 'resource',
      resource: {
        uri: 'jshook://capture',
        text: resourceText,
        mimeType: 'application/json',
      },
    });
  });

  it('returns the response unchanged for error responses and excluded tools', async () => {
    const offloader = new LargeDataOffloader(createDetailManager(), {
      excludeTools: new Set(['excluded_tool']),
    });
    const errorResponse = {
      isError: true,
      content: [{ type: 'text' as const, text: 'x'.repeat(700 * 1024) }],
    };
    await offloader.offload('excluded_tool', errorResponse);
    expect((errorResponse.content[0] as { text: string }).text).toBe('x'.repeat(700 * 1024));

    const big = { content: [{ type: 'text' as const, text: 'y'.repeat(700 * 1024) }] };
    await offloader.offload('excluded_tool', big);
    expect((big.content[0] as { text: string }).text).toBe('y'.repeat(700 * 1024));
  });

  it('enforces the offload directory cap when writing large strings', async () => {
    const dir = resolve(getProjectRoot(), 'artifacts', `offloaded-offloader-quota-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const base = Date.now() - 60_000;
    for (let i = 0; i < 3; i++) {
      const p = join(dir, `seed-${i}.txt`);
      await writeFile(p, `seed-${i}`);
      const t = new Date(base + i * 10_000);
      await utimes(p, t, t);
    }

    const offloader = new LargeDataOffloader(createDetailManager(), {
      detailThreshold: 0,
      fileThreshold: 10,
      outputDir: dir,
      maxOffloadFiles: 2,
    });
    const raw = 'LARGE-' + 'z'.repeat(50);
    await offloader.offload('some_tool', { content: [{ type: 'text' as const, text: raw }] });

    const remaining = (await readdir(dir)).toSorted();
    expect(remaining).toHaveLength(2);
    expect(remaining.some((f) => f.startsWith('offload-'))).toBe(true);
    expect(remaining).not.toContain('seed-0.txt');
    await rm(dir, { recursive: true, force: true });
  });

  it('offloads multiple oversized entries concurrently instead of serializing them', async () => {
    const offloader = new LargeDataOffloader(createDetailManager(), {
      detailThreshold: 0,
      fileThreshold: 0,
    });

    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers: Array<(v: { path: string; size: string }) => void> = [];
    const writeSpy = vi
      .spyOn(
        offloader as unknown as {
          writeOffloadedFile: (
            raw: string,
            mime: string | undefined,
          ) => Promise<{
            path: string;
            size: string;
          }>;
        },
        'writeOffloadedFile',
      )
      .mockImplementation(() => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise<{ path: string; size: string }>((resolvePromise) => {
          resolvers.push((v) => {
            inFlight -= 1;
            resolvePromise(v);
          });
        });
      });

    const uri1 = 'data:image/png;base64,' + Buffer.from('AAA').toString('base64');
    const uri2 = 'data:image/gif;base64,' + Buffer.from('BBB').toString('base64');
    const response = {
      content: [
        { type: 'text' as const, text: uri1 },
        { type: 'text' as const, text: uri2 },
      ],
    };

    const promise = offloader.offload('some_tool', response);

    try {
      // Both entries' writes must start before either resolves (a serial loop
      // only starts the second after the first resolves → this times out).
      await vi.waitFor(() => expect(resolvers.length).toBe(2));
      expect(maxInFlight).toBe(2);
    } finally {
      for (const resolver of resolvers) {
        resolver({ path: 'artifacts/offloaded/x.bin', size: '1B' });
      }
      writeSpy.mockRestore();
    }

    await promise;
    expect(JSON.parse((response.content[0] as { text: string }).text)._offload.type).toBe('file');
    expect(JSON.parse((response.content[1] as { text: string }).text)._offload.type).toBe('file');
  });
});
