/**
 * DarwinMemoryProvider — unit tests.
 *
 * Mocks DarwinAPI to test the adapter logic:
 * task port management, Mach protection mapping, region/module enumeration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  isDarwin: vi.fn(() => true),
  isKoffiAvailableOnDarwin: vi.fn(() => true),
  machTaskSelf: vi.fn(() => 100),
  taskForPid: vi.fn((_self: number, _pid: number) => ({ kr: 0, task: 200 })),
  machPortDeallocate: vi.fn(),
  machVmReadOverwrite: vi.fn(),
  machVmWrite: vi.fn(() => 0), // KERN_SUCCESS
  machVmRegion: vi.fn(),
  machVmProtect: vi.fn(() => 0), // KERN_SUCCESS
  machVmAllocate: vi.fn(() => ({ kr: 0, address: 0x50000n })),
  machVmDeallocate: vi.fn(() => 0), // KERN_SUCCESS
  dyldImageCount: vi.fn(() => 2),
  dyldGetImageName: vi.fn((idx: number) =>
    idx === 0 ? '/usr/lib/libSystem.B.dylib' : '/usr/lib/libc++.1.dylib',
  ),
  dyldGetImageHeader: vi.fn((idx: number) => (idx === 0 ? 0x100000n : 0x200000n)),
  kernReturnName: vi.fn((kr: number) => `KERN_${kr}`),
  KERN: { SUCCESS: 0, FAILURE: 5, INVALID_ARGUMENT: 4, INVALID_ADDRESS: 1 },
  VM_PROT: { NONE: 0, READ: 1, WRITE: 2, EXECUTE: 4, ALL: 7 },
  VM_FLAGS: { ANYWHERE: 1 },
  SM: {
    PRIVATE: 1,
    PRIVATE_ALIASED: 4,
    COW: 2,
    SHARED: 3,
    TRUESHARED: 5,
    SHARED_ALIASED: 6,
    EMPTY: 0,
  },
}));

vi.mock('@src/native/platform/darwin/DarwinAPI.js', () => state);

import { DarwinMemoryProvider } from '@src/native/platform/darwin/DarwinMemoryProvider.js';
import { MemoryProtection } from '@src/native/platform/types.js';

describe('DarwinMemoryProvider', () => {
  let provider: DarwinMemoryProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new DarwinMemoryProvider();
    state.taskForPid.mockReturnValue({ kr: 0, task: 200 });
    state.machTaskSelf.mockReturnValue(100);
  });

  it('has platform set to "darwin"', () => {
    expect(provider.platform).toBe('darwin');
  });

  describe('checkAvailability', () => {
    it('returns available when Darwin + koffi + task_for_pid succeeds', async () => {
      const result = await provider.checkAvailability();
      expect(result.available).toBe(true);
      expect(result.platform).toBe('darwin');
    });

    it('returns unavailable when not Darwin', async () => {
      state.isDarwin.mockReturnValue(false);
      const result = await provider.checkAvailability();
      expect(result.available).toBe(false);
      expect(result.reason).toContain('Not running on macOS');
    });

    it('returns unavailable when koffi missing', async () => {
      state.isKoffiAvailableOnDarwin.mockReturnValue(false);
      const result = await provider.checkAvailability();
      expect(result.available).toBe(false);
      expect(result.reason).toContain('koffi');
    });

    it('returns unavailable when task_for_pid fails', async () => {
      state.taskForPid.mockReturnValue({ kr: 5, task: 0 }); // KERN_FAILURE
      const result = await provider.checkAvailability();
      expect(result.available).toBe(false);
      expect(result.reason).toContain('task_for_pid failed');
    });

    it('returns unavailable when task_for_pid throws', async () => {
      state.taskForPid.mockImplementation(() => {
        throw new Error('no entitlement');
      });
      const result = await provider.checkAvailability();
      expect(result.available).toBe(false);
      expect(result.reason).toContain('no entitlement');
    });

    it('returns SIP-specific message when crash signal detected', async () => {
      state.taskForPid.mockImplementation(() => {
        throw new Error('bus error');
      });
      const result = await provider.checkAvailability();
      expect(result.available).toBe(false);
      expect(result.reason).toContain('SIP');
      expect(result.reason).toContain('ARM64');
    });
  });

  describe('openProcess / closeProcess', () => {
    it('opens process with taskForPid and returns ProcessHandle', () => {
      const handle = provider.openProcess(42, false);
      expect(handle.pid).toBe(42);
      expect(handle.writeAccess).toBe(false);
      expect(state.taskForPid).toHaveBeenCalledWith(100, 42);
    });

    it('throws descriptive error on KERN_FAILURE', () => {
      state.taskForPid.mockReturnValue({ kr: 5, task: 0 });
      expect(() => provider.openProcess(42, false)).toThrow('sudo');
    });

    it('throws descriptive error on KERN_INVALID_ARGUMENT', () => {
      state.taskForPid.mockReturnValue({ kr: 4, task: 0 });
      expect(() => provider.openProcess(999, false)).toThrow('Invalid PID');
    });

    it('closes process by deallocating Mach port', () => {
      const handle = provider.openProcess(42, false);
      provider.closeProcess(handle);
      expect(state.machPortDeallocate).toHaveBeenCalledWith(100, 200);
    });
  });

  describe('readMemory', () => {
    it('reads memory and returns MemoryReadResult', () => {
      const handle = provider.openProcess(1, false);
      const buf = Buffer.from([0xaa, 0xbb, 0xcc]);
      state.machVmReadOverwrite.mockReturnValue({ kr: 0, data: buf, outsize: 3n });

      const result = provider.readMemory(handle, 0x1000n, 3);
      expect(result.data).toEqual(buf);
      expect(result.bytesRead).toBe(3);
    });

    it('throws on non-SUCCESS kern_return', () => {
      const handle = provider.openProcess(1, false);
      state.machVmReadOverwrite.mockReturnValue({ kr: 1, data: Buffer.alloc(0), outsize: 0n });

      expect(() => provider.readMemory(handle, 0x1000n, 4)).toThrow(
        'mach_vm_read_overwrite failed',
      );
    });
  });

  describe('writeMemory', () => {
    it('writes memory and returns bytesWritten', () => {
      const handle = provider.openProcess(1, true);
      state.machVmWrite.mockReturnValue(0);

      const data = Buffer.from([1, 2, 3, 4]);
      const result = provider.writeMemory(handle, 0x2000n, data);
      expect(result.bytesWritten).toBe(4);
      expect(state.machVmWrite).toHaveBeenCalledWith(200, 0x2000n, data);
    });

    it('throws on non-SUCCESS kern_return', () => {
      const handle = provider.openProcess(1, true);
      state.machVmWrite.mockReturnValue(1);

      expect(() => provider.writeMemory(handle, 0x2000n, Buffer.alloc(4))).toThrow(
        'mach_vm_write failed',
      );
    });
  });

  describe('queryRegion', () => {
    it('maps Mach region info to MemoryRegionInfo', () => {
      const handle = provider.openProcess(1, false);
      state.machVmRegion.mockReturnValue({
        kr: 0,
        address: 0x10000n,
        size: 4096n,
        info: { protection: 3, behavior: 1 }, // READ|WRITE, SM_PRIVATE
      });

      const region = provider.queryRegion(handle, 0x10000n);
      expect(region).not.toBeNull();
      expect(region!.baseAddress).toBe(0x10000n);
      expect(region!.size).toBe(4096);
      expect(region!.state).toBe('committed'); // macOS always committed for returned regions
      expect(region!.type).toBe('private');
      expect(region!.isReadable).toBe(true);
      expect(region!.isWritable).toBe(true);
      expect(region!.isExecutable).toBe(false);
    });

    it('returns null when kern_return is not SUCCESS', () => {
      const handle = provider.openProcess(1, false);
      state.machVmRegion.mockReturnValue({
        kr: 1,
        address: 0n,
        size: 0n,
        info: { protection: 0, behavior: 0 },
      });

      expect(provider.queryRegion(handle, 0xffffffffn)).toBeNull();
    });

    it('maps READ+EXECUTE protection correctly', () => {
      const handle = provider.openProcess(1, false);
      state.machVmRegion.mockReturnValue({
        kr: 0,
        address: 0x10000n,
        size: 4096n,
        info: { protection: 5, behavior: 3 }, // READ|EXECUTE, SM_SHARED
      });

      const region = provider.queryRegion(handle, 0x10000n);
      expect(region!.isReadable).toBe(true);
      expect(region!.isExecutable).toBe(true);
      expect(region!.isWritable).toBe(false);
      expect(region!.type).toBe('mapped'); // SM_SHARED
    });

    it('maps SM_COW to private', () => {
      const handle = provider.openProcess(1, false);
      state.machVmRegion.mockReturnValue({
        kr: 0,
        address: 0n,
        size: 4096n,
        info: { protection: 1, behavior: 2 }, // READ, SM_COW
      });

      expect(provider.queryRegion(handle, 0n)!.type).toBe('private');
    });

    it('maps SM_EMPTY to unknown', () => {
      const handle = provider.openProcess(1, false);
      state.machVmRegion.mockReturnValue({
        kr: 0,
        address: 0n,
        size: 4096n,
        info: { protection: 0, behavior: 0 }, // NONE, SM_EMPTY
      });

      expect(provider.queryRegion(handle, 0n)!.type).toBe('unknown');
    });
  });

  describe('changeProtection', () => {
    it('changes protection and returns old protection', () => {
      const handle = provider.openProcess(1, true);
      state.machVmRegion.mockReturnValue({
        kr: 0,
        address: 0n,
        size: 4096n,
        info: { protection: 1, behavior: 0 }, // READ
      });

      const result = provider.changeProtection(handle, 0x1000n, 4096, MemoryProtection.ReadWrite);
      expect(result.oldProtection).toBe(MemoryProtection.Read);
      expect(state.machVmProtect).toHaveBeenCalled();
    });

    it('adjusts max protection for W^X when write+execute requested', () => {
      const handle = provider.openProcess(1, true);
      state.machVmRegion.mockReturnValue({
        kr: 0,
        address: 0n,
        size: 4096n,
        info: { protection: 1, behavior: 0 },
      });

      provider.changeProtection(handle, 0x1000n, 4096, MemoryProtection.ReadWriteExecute);

      // Should call machVmProtect twice: once for max_protection, once for current
      expect(state.machVmProtect).toHaveBeenCalledTimes(2);
      // First call: set_maximum=true, VM_PROT_ALL
      expect(state.machVmProtect).toHaveBeenNthCalledWith(1, 200, 0x1000n, 4096n, true, 7);
    });

    it('throws when machVmProtect fails', () => {
      const handle = provider.openProcess(1, true);
      state.machVmRegion.mockReturnValue({
        kr: 0,
        address: 0n,
        size: 4096n,
        info: { protection: 1, behavior: 0 },
      });
      state.machVmProtect.mockReturnValue(5); // KERN_FAILURE

      expect(() =>
        provider.changeProtection(handle, 0x1000n, 4096, MemoryProtection.ReadWrite),
      ).toThrow('mach_vm_protect failed');
    });
  });

  describe('allocateMemory', () => {
    it('allocates memory and returns address', () => {
      const handle = provider.openProcess(1, true);
      const result = provider.allocateMemory(handle, 4096, MemoryProtection.ReadWrite);
      expect(result.address).toBe(0x50000n);
      expect(state.machVmAllocate).toHaveBeenCalledWith(200, 4096n, 1);
    });

    it('adjusts protection if not default RW', () => {
      const handle = provider.openProcess(1, true);
      provider.allocateMemory(handle, 4096, MemoryProtection.Read);
      // Should call machVmProtect to change from default RW to R
      expect(state.machVmProtect).toHaveBeenCalled();
    });

    it('throws on allocation failure', () => {
      const handle = provider.openProcess(1, true);
      state.machVmAllocate.mockReturnValue({ kr: 5, address: 0n });

      expect(() => provider.allocateMemory(handle, 4096, MemoryProtection.ReadWrite)).toThrow(
        'mach_vm_allocate failed',
      );
    });

    it('deallocates on protection change failure', () => {
      const handle = provider.openProcess(1, true);
      state.machVmProtect.mockReturnValue(5); // KERN_FAILURE

      expect(() => provider.allocateMemory(handle, 4096, MemoryProtection.Read)).toThrow(
        'mach_vm_protect after allocate failed',
      );
      expect(state.machVmDeallocate).toHaveBeenCalledWith(200, 0x50000n, 4096n);
    });
  });

  describe('freeMemory', () => {
    it('deallocates memory successfully', () => {
      const handle = provider.openProcess(1, true);
      provider.freeMemory(handle, 0x50000n, 4096);
      expect(state.machVmDeallocate).toHaveBeenCalledWith(200, 0x50000n, 4096n);
    });

    it('throws on deallocation failure', () => {
      const handle = provider.openProcess(1, true);
      state.machVmDeallocate.mockReturnValue(1);

      expect(() => provider.freeMemory(handle, 0x50000n, 4096)).toThrow(
        'mach_vm_deallocate failed',
      );
    });
  });

  describe('enumerateModules', () => {
    it('uses dyld APIs for self process', () => {
      const handle = provider.openProcess(process.pid, false);
      const modules = provider.enumerateModules(handle);

      expect(modules).toHaveLength(2);
      expect(modules[0]!.name).toBe('libSystem.B.dylib');
      expect(modules[0]!.baseAddress).toBe(0x100000n);
      expect(modules[1]!.name).toBe('libc++.1.dylib');
      expect(state.dyldImageCount).toHaveBeenCalled();
    });

    it('scans remote process for Mach-O magic', () => {
      const handle = provider.openProcess(999, false); // not self

      // One region with Mach-O header, one without
      let callCount = 0;
      state.machVmRegion.mockImplementation((_task: number, _addr: bigint) => {
        callCount++;
        if (callCount === 1) {
          return {
            kr: 0,
            address: 0x10000n,
            size: 8192n,
            info: { protection: 5, behavior: 1 }, // R|X
          };
        }
        return { kr: 1, address: 0n, size: 0n, info: { protection: 0, behavior: 0 } };
      });

      // Return MH_MAGIC_64 header
      const header = Buffer.alloc(4);
      header.writeUInt32LE(0xfeedfacf, 0);
      state.machVmReadOverwrite.mockReturnValue({ kr: 0, data: header, outsize: 4n });

      const modules = provider.enumerateModules(handle);
      expect(modules).toHaveLength(1);
      expect(modules[0]!.baseAddress).toBe(0x10000n);
      expect(modules[0]!.size).toBe(8192);
    });
  });

  describe('handle validation', () => {
    it('throws for invalid handle on readMemory', () => {
      const fakeHandle = { pid: 99, writeAccess: false };
      state.machVmReadOverwrite.mockReturnValue({ kr: 0, data: Buffer.alloc(0), outsize: 0n });
      expect(() => provider.readMemory(fakeHandle, 0n, 1)).toThrow('Invalid ProcessHandle');
    });
  });
});
