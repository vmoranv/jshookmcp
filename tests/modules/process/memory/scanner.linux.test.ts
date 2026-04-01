import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  openSync: vi.fn(),
  readSync: vi.fn(),
  closeSync: vi.fn(),
  findPatternInBuffer: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('node:fs', () => ({
  readFileSync: state.readFileSync,
  openSync: state.openSync,
  readSync: state.readSync,
  closeSync: state.closeSync,
}));

vi.mock('@native/NativeMemoryManager.utils', () => ({
  findPatternInBuffer: state.findPatternInBuffer,
}));

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: state.debug,
    warn: state.warn,
    error: state.error,
    info: vi.fn(),
  },
}));

import { scanMemoryLinux } from '@modules/process/memory/scanner.linux';

describe('memory/scanner.linux', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.findPatternInBuffer.mockReturnValue([1]);
    state.readFileSync.mockReturnValue('1000-1004 r--p 00000000 00:00 0 /bin/cat\n');
    state.openSync.mockReturnValue(7);
    state.readSync.mockImplementation((_fd, buffer, _offset, length) => {
      Buffer.from([0x00, 0xaa, 0xbb, 0xcc]).copy(buffer, 0);
      return Math.min(length, 4);
    });
  });

  it('rejects invalid patterns before touching the filesystem', async () => {
    const result = await scanMemoryLinux(1, 'ZZ', 'hex');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid pattern');
    expect(state.readFileSync).not.toHaveBeenCalled();
  });

  it('reports maps access errors with the proc path', async () => {
    state.readFileSync.mockImplementationOnce(() => {
      throw new Error('permission denied');
    });

    const result = await scanMemoryLinux(1, 'AA BB', 'hex');

    expect(result.success).toBe(false);
    expect(state.readFileSync).toHaveBeenCalledWith('/proc/1/maps', 'utf-8');
    expect(result.error).toContain('permission denied');
  });
  it('maps ENOENT to a missing process error', async () => {
    state.readFileSync.mockImplementationOnce(() => {
      const error = new Error('no such file');
      (error as NodeJS.ErrnoException).code = 'ENOENT';
      throw error;
    });

    const result = await scanMemoryLinux(1, 'AA BB', 'hex');

    expect(result.success).toBe(false);
    expect(result.error).toContain('/proc/1/maps');
    expect(result.error).toContain('no longer exists');
  });

  it('reports mem open errors with the proc path', async () => {
    state.openSync.mockImplementationOnce(() => {
      const error = new Error('EACCES');
      (error as NodeJS.ErrnoException).code = 'EPERM';
      throw error;
    });

    const result = await scanMemoryLinux(1, 'AA BB', 'hex');

    expect(result.success).toBe(false);
    expect(result.error).toContain('/proc/1/mem');
  });
  it('maps EPERM to a privileged access error', async () => {
    state.openSync.mockImplementationOnce(() => {
      const error = new Error('EPERM');
      (error as NodeJS.ErrnoException).code = 'EPERM';
      throw error;
    });

    const result = await scanMemoryLinux(1, 'AA BB', 'hex');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Requires root privileges or ptrace access');
  });

  it('scans readable regions and returns discovered addresses', async () => {
    const result = await scanMemoryLinux(1, 'AA BB CC', 'hex');

    expect(result.success).toBe(true);
    expect(result.addresses).toEqual(['0x1001']);
    expect(result.stats?.patternLength).toBe(3);
    expect(result.stats?.resultsFound).toBe(1);
    expect(state.closeSync).toHaveBeenCalledWith(7);
  });

  it('stops after a short read and still returns discovered matches', async () => {
    state.readSync.mockImplementationOnce((_fd, buffer, _offset, length) => {
      Buffer.from([0x11, 0xaa]).copy(buffer, 0);
      return Math.min(length - 2, 2);
    });
    state.findPatternInBuffer.mockReturnValue([1]);

    const result = await scanMemoryLinux(1, 'AA BB', 'hex');

    expect(result.success).toBe(true);
    expect(result.addresses).toEqual(['0x1001']);
    expect(state.debug).toHaveBeenCalledWith(
      'Linux memory scan stopped after short read',
      expect.objectContaining({ pid: 1 }),
    );
  });

  it('skips unreadable chunks when readSync throws a permission error', async () => {
    state.readSync.mockImplementationOnce(() => {
      const error = new Error('EIO');
      (error as NodeJS.ErrnoException).code = 'EIO';
      throw error;
    });

    const result = await scanMemoryLinux(1, 'AA BB', 'hex');

    expect(result.success).toBe(true);
    expect(result.addresses).toEqual([]);
    expect(state.debug).toHaveBeenCalledWith(
      'Skipping unreadable Linux memory region chunk',
      expect.objectContaining({ pid: 1 }),
    );
  });
  it('skips zero-byte reads without invoking pattern matching', async () => {
    state.readSync.mockReturnValueOnce(0);

    const result = await scanMemoryLinux(1, 'AA BB', 'hex');

    expect(result.success).toBe(true);
    expect(result.addresses).toEqual([]);
    expect(state.findPatternInBuffer).not.toHaveBeenCalled();
  });

  it('carries matches across chunk boundaries and ignores invalid regions', async () => {
    const start = 0x1000n;
    const chunkSize = 16 * 1024 * 1024;
    const end = start + BigInt(chunkSize) + 1n;

    state.readFileSync.mockReturnValueOnce(
      [
        '2000-1000 r--p 00000000 00:00 0 /bin/skip-me',
        start.toString(16).padStart(8, '0') +
          '-' +
          end.toString(16).padStart(8, '0') +
          ' r--p 00000000 00:00 0 /bin/scan-me',
      ].join('\n'),
    );

    state.readSync
      .mockImplementationOnce((_fd, buffer, _offset, length) => {
        Buffer.from([0x00, 0x11, 0x22, 0x33]).copy(buffer, 0);
        return length;
      })
      .mockImplementationOnce((_fd, buffer, _offset, length) => {
        Buffer.from([0x44]).copy(buffer, 0);
        return length;
      });

    state.findPatternInBuffer
      .mockImplementationOnce(() => [chunkSize - 1])
      .mockImplementationOnce(() => [1]);

    const result = await scanMemoryLinux(1, 'AA BB CC DD', 'hex');

    expect(result.success).toBe(true);
    expect(result.addresses).toHaveLength(1);
    expect(state.findPatternInBuffer).toHaveBeenCalledTimes(2);
    expect(state.closeSync).toHaveBeenCalledWith(7);
  });
});
