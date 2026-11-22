import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleElectronScanUserdata } from '@server/domains/platform/handlers/electron-userdata-handler';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jshook-userdata-'));
  vi.stubEnv('JSHOOK_USERDATA_ROOTS', root);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

function payloadOf(response: Awaited<ReturnType<typeof handleElectronScanUserdata>>) {
  return JSON.parse((response.content[0] as { type: 'text'; text: string }).text) as Record<
    string,
    unknown
  >;
}

describe('electron_scan_userdata path containment', () => {
  it('reads JSON files inside an allowed root', async () => {
    await writeFile(join(root, 'prefs.json'), JSON.stringify({ theme: 'dark' }), 'utf8');

    const response = await handleElectronScanUserdata({ dirPath: root });
    expect(response.isError).toBeUndefined();

    const payload = payloadOf(response);
    expect(payload['files']).toEqual([
      { name: 'prefs.json', sizeBytes: expect.any(Number), content: { theme: 'dark' } },
    ]);
  });

  it('rejects a directory outside the allowed roots', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'jshook-outside-'));
    try {
      await writeFile(join(outside, 'secret.json'), JSON.stringify({ token: 'nope' }), 'utf8');

      const response = await handleElectronScanUserdata({ dirPath: outside });
      expect(response.isError).toBe(true);

      const payload = payloadOf(response);
      expect(payload['code']).toBe('VALIDATION');
      expect(String(payload['error'])).toContain('outside the allowed userdata roots');
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects a path that does not exist instead of leaking a filesystem error', async () => {
    const response = await handleElectronScanUserdata({ dirPath: join(root, 'missing') });
    expect(response.isError).toBe(true);
    expect(payloadOf(response)['code']).toBe('VALIDATION');
  });
});
