import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeBinaryFileAtomically, writeTextFileAtomically } from '@utils/safeOutput';

describe('safeOutput atomic writers', () => {
  it.each([
    [
      'text',
      (path: string, allowedRoot: string) =>
        writeTextFileAtomically(path, '{}', { allowedRoots: [allowedRoot] }),
    ],
    [
      'binary',
      (path: string, allowedRoot: string) =>
        writeBinaryFileAtomically(path, new Uint8Array([1, 2, 3]), {
          allowedRoots: [allowedRoot],
        }),
    ],
  ])(
    'rejects a %s write through a linked parent that escapes allowed roots',
    async (_name, write) => {
      const allowedRoot = await mkdtemp(join(tmpdir(), 'jshook-safe-root-'));
      const outsideRoot = await mkdtemp(join(tmpdir(), 'jshook-safe-outside-'));
      const linkedParent = join(allowedRoot, 'linked');

      try {
        await symlink(outsideRoot, linkedParent, process.platform === 'win32' ? 'junction' : 'dir');
        await expect(
          write(join(linkedParent, _name === 'text' ? 'trace.json' : 'trace.bin'), allowedRoot),
        ).rejects.toThrow('escapes the allowed roots');
      } finally {
        await rm(linkedParent, { force: true, recursive: true });
        await rm(allowedRoot, { force: true, recursive: true });
        await rm(outsideRoot, { force: true, recursive: true });
      }
    },
  );
});
