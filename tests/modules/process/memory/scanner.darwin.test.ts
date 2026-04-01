import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  writeFile: vi.fn(),
  unlink: vi.fn(),
  execAsync: vi.fn(),
  findPatternInBuffer: vi.fn(),
  createPlatformProvider: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('node:fs', () => ({
  promises: {
    writeFile: state.writeFile,
    unlink: state.unlink,
  },
}));

vi.mock('@modules/process/memory/types', () => ({
  execAsync: state.execAsync,
}));

vi.mock('@native/NativeMemoryManager.utils', () => ({
  findPatternInBuffer: state.findPatternInBuffer,
}));

vi.mock('@native/platform/factory.js', () => ({
  createPlatformProvider: state.createPlatformProvider,
}));

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: state.debug,
    warn: state.warn,
    error: state.error,
    info: vi.fn(),
  },
}));

import { scanMemoryMac } from '@modules/process/memory/scanner.darwin';

describe('memory/scanner.darwin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.findPatternInBuffer.mockReturnValue([1]);
    state.writeFile.mockResolvedValue(undefined);
    state.unlink.mockResolvedValue(undefined);
  });

  it('rejects invalid patterns before scanning', async () => {
    const result = await scanMemoryMac(1, 'ZZ', 'hex');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid hex byte');
    expect(state.createPlatformProvider).not.toHaveBeenCalled();
  });

  it('uses the native Mach fast-path when the provider is available', async () => {
    const region = {
      baseAddress: 0x1000n,
      size: 3,
      isReadable: true,
      isWritable: false,
      isExecutable: false,
    };

    const provider = {
      checkAvailability: vi.fn().mockResolvedValue({ available: true }),
      openProcess: vi.fn().mockReturnValue({ pid: 1 }),
      queryRegion: vi
        .fn()
        .mockImplementationOnce(() => region)
        .mockImplementationOnce(() => null),
      readMemory: vi.fn().mockReturnValue({ data: Buffer.from([0x00, 0xaa, 0xbb]) }),
      closeProcess: vi.fn(),
    };

    state.createPlatformProvider.mockReturnValue(provider);

    const result = await scanMemoryMac(1, 'AA BB', 'hex');

    expect(result.success).toBe(true);
    expect(result.addresses).toEqual(['0x1001']);
    expect(result.stats?.resultsFound).toBe(1);
    expect(provider.closeProcess).toHaveBeenCalledWith({ pid: 1 });
  });

  it('falls back to lldb when the native provider is unavailable', async () => {
    const provider = {
      checkAvailability: vi.fn().mockResolvedValue({ available: false }),
      openProcess: vi.fn(),
      queryRegion: vi.fn(),
      readMemory: vi.fn(),
      closeProcess: vi.fn(),
    };

    state.createPlatformProvider.mockReturnValue(provider);
    state.execAsync.mockResolvedValue({
      stdout:
        'SCAN_RESULT:{"success":true,"addresses":["0x3000"],"stats":{"patternLength":2,"resultsFound":1}}\n',
      stderr: '',
    });

    const result = await scanMemoryMac(2, 'AA BB', 'hex');

    expect(result.success).toBe(true);
    expect(result.addresses).toEqual(['0x3000']);
    expect(state.writeFile).toHaveBeenCalledTimes(2);
    expect(state.execAsync).toHaveBeenCalledWith(
      expect.stringContaining('lldb --batch -p 2'),
      expect.objectContaining({ timeout: 120000 }),
    );
    expect(state.unlink).toHaveBeenCalledTimes(2);
  });

  it('skips native region reads that throw and still returns a result', async () => {
    const region = {
      baseAddress: 0x1000n,
      size: 3,
      isReadable: true,
      isWritable: false,
      isExecutable: false,
    };

    const provider = {
      checkAvailability: vi.fn().mockResolvedValue({ available: true }),
      openProcess: vi.fn().mockReturnValue({ pid: 1 }),
      queryRegion: vi
        .fn()
        .mockImplementationOnce(() => region)
        .mockImplementationOnce(() => null),
      readMemory: vi.fn().mockImplementation(() => {
        throw new Error('read failed');
      }),
      closeProcess: vi.fn(),
    };

    state.createPlatformProvider.mockReturnValue(provider);

    const result = await scanMemoryMac(1, 'AA BB', 'hex');

    expect(result.success).toBe(true);
    expect(result.addresses).toEqual([]);
    expect(provider.closeProcess).toHaveBeenCalledWith({ pid: 1 });
  });

  it('returns a scan error when lldb does not emit a SCAN_RESULT line', async () => {
    const provider = {
      checkAvailability: vi.fn().mockResolvedValue({ available: false }),
      openProcess: vi.fn(),
      queryRegion: vi.fn(),
      readMemory: vi.fn(),
      closeProcess: vi.fn(),
    };

    state.createPlatformProvider.mockReturnValue(provider);
    state.execAsync.mockResolvedValue({
      stdout: 'lldb started\nerror: something went wrong\n',
      stderr: '',
    });

    const result = await scanMemoryMac(2, 'AA BB', 'hex');

    expect(result.success).toBe(false);
    expect(result.error).toContain('lldb scan returned no result');
  });
});
