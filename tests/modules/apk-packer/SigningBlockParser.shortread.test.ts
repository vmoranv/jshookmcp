/**
 * Short-read regression tests for SigningBlockParser.
 *
 * `FileHandle.read()` may legally return fewer bytes than requested. Parsing
 * the zero-filled remainder as file data would produce silently wrong offsets,
 * so a short structural read must surface as `ToolError(VALIDATION)`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsState = vi.hoisted(() => ({
  stat: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  stat: fsState.stat,
  open: fsState.open,
}));

import { SigningBlockParser } from '@modules/apk-packer/SigningBlockParser';

describe('SigningBlockParser — short structural reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsState.stat.mockResolvedValue({ isFile: () => true, size: 4096 });
    fsState.close.mockResolvedValue(undefined);
    fsState.open.mockResolvedValue({
      read: vi.fn(async (buf: Buffer) => ({ bytesRead: Math.min(1, buf.length), buffer: buf })),
      close: fsState.close,
    });
  });

  it('rejects a short EOCD-window read with VALIDATION and closes the handle', async () => {
    const parser = new SigningBlockParser();
    await expect(parser.parse('synthetic.apk')).rejects.toMatchObject({
      name: 'ToolError',
      code: 'VALIDATION',
      message: expect.stringContaining('Short read'),
    });
    expect(fsState.close).toHaveBeenCalledTimes(1);
  });
});
