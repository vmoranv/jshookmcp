import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => {
  const libSystem = {
    unload: vi.fn(),
    func: vi.fn(() => vi.fn(() => 123)),
  };

  const load = vi.fn(() => libSystem);

  return { libSystem, load };
});

vi.mock('koffi', () => ({
  default: {
    load: state.load,
  },
}));

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('DarwinAPI', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'darwin' });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('formats kern return codes with a stable unknown fallback', async () => {
    const { kernReturnName } = await import('@src/native/platform/darwin/DarwinAPI.js');

    expect(kernReturnName(0)).toBe('KERN_SUCCESS');
    expect(kernReturnName(1234)).toBe('KERN_UNKNOWN(1234)');
  });

  it('reflects the current platform in isDarwin', async () => {
    const { isDarwin } = await import('@src/native/platform/darwin/DarwinAPI.js');

    expect(isDarwin()).toBe(true);
    Object.defineProperty(process, 'platform', { value: 'linux' });
    expect(isDarwin()).toBe(false);
  });

  it('caches successful koffi availability checks', async () => {
    const { isKoffiAvailableOnDarwin } = await import('@src/native/platform/darwin/DarwinAPI.js');

    expect(isKoffiAvailableOnDarwin()).toBe(true);
    state.load.mockImplementation(() => {
      throw new Error('should not reload after cache');
    });
    expect(isKoffiAvailableOnDarwin()).toBe(true);
    expect(state.load).toHaveBeenCalledTimes(1);
    expect(state.libSystem.unload).toHaveBeenCalledTimes(1);
  });

  it('caches failed koffi availability checks', async () => {
    state.load.mockImplementation(() => {
      throw new Error('missing libSystem');
    });
    const { isKoffiAvailableOnDarwin } = await import('@src/native/platform/darwin/DarwinAPI.js');

    expect(isKoffiAvailableOnDarwin()).toBe(false);
    expect(isKoffiAvailableOnDarwin()).toBe(false);
    expect(state.load).toHaveBeenCalledTimes(1);
  });

  it('unloads the cached libSystem handle', async () => {
    const api = await import('@src/native/platform/darwin/DarwinAPI.js');

    api.machTaskSelf();
    api.unloadLibraries();

    expect(state.libSystem.unload).toHaveBeenCalledTimes(1);
  });

  it('exposes the low-level Mach and dyld wrappers', async () => {
    state.libSystem.func.mockImplementation((signature: string) => {
      switch (signature) {
        case 'uint32 mach_task_self_()':
          return vi.fn(() => 42);
        case 'int32 task_for_pid(uint32, int32, _Out_ uint32 *)':
          return vi.fn((_self: number, _pid: number, taskBuf: Buffer) => {
            taskBuf.writeUInt32LE(1234, 0);
            return 0;
          });
        case 'int32 mach_port_deallocate(uint32, uint32)':
          return vi.fn(() => 0);
        case 'int32 mach_vm_read_overwrite(uint32, uint64, uint64, _Out_ uint8_t[len], uint64 len, _Out_ uint64 *)':
          return vi.fn(
            (
              _task: number,
              _address: bigint,
              size: bigint,
              data: Buffer,
              _len: bigint,
              outsize: Buffer,
            ) => {
              data.fill(0x7f);
              outsize.writeBigUInt64LE(size);
              return 0;
            },
          );
        case 'int32 mach_vm_write(uint32, uint64, uint8_t *, uint32)':
          return vi.fn(() => 0);
        case 'int32 mach_vm_region(uint32, _Inout_ uint64 *, _Out_ uint64 *, int32, _Out_ uint8_t[36], _Inout_ uint32 *, _Out_ uint32 *)':
          return vi.fn((...args: unknown[]) => {
            const addressBuf = args[1] as Buffer;
            const sizeBuf = args[2] as Buffer;
            const infoBuf = args[4] as Buffer;
            addressBuf.writeBigUInt64LE(0x3000n, 0);
            sizeBuf.writeBigUInt64LE(0x4000n, 0);
            infoBuf.writeUInt32LE(1 | 2, 0);
            infoBuf.writeUInt32LE(1 | 2 | 4, 4);
            infoBuf.writeUInt32LE(0, 8);
            infoBuf.writeUInt32LE(0, 12);
            infoBuf.writeUInt32LE(0, 16);
            infoBuf.writeBigUInt64LE(0x10n, 20);
            infoBuf.writeUInt32LE(0, 28);
            infoBuf.writeUInt32LE(0, 32);
            return 0;
          });
        case 'int32 mach_vm_protect(uint32, uint64, uint64, int32, int32)':
          return vi.fn(() => 0);
        case 'int32 mach_vm_allocate(uint32, _Inout_ uint64 *, uint64, int32)':
          return vi.fn((_task: number, addressBuf: Buffer) => {
            addressBuf.writeBigUInt64LE(0x5000n, 0);
            return 0;
          });
        case 'int32 mach_vm_deallocate(uint32, uint64, uint64)':
          return vi.fn(() => 0);
        case 'int32 task_suspend(uint32)':
          return vi.fn(() => 0);
        case 'int32 task_resume(uint32)':
          return vi.fn(() => 0);
        case 'uint32 _dyld_image_count()':
          return vi.fn(() => 2);
        case 'const char * _dyld_get_image_name(uint32)':
          return vi.fn(() => '/usr/lib/libSystem.B.dylib');
        case 'int64 _dyld_get_image_vmaddr_slide(uint32)':
          return vi.fn(() => 4096);
        case 'void * _dyld_get_image_header(uint32)':
          return vi.fn(() => 0x100000);
        default:
          throw new Error(`Unexpected signature: ${signature}`);
      }
    });

    const api = await import('@src/native/platform/darwin/DarwinAPI.js');

    expect(api.machTaskSelf()).toBe(42);
    expect(api.taskForPid(99, 7)).toEqual({ kr: 0, task: 1234 });
    expect(api.machPortDeallocate(99, 7)).toBe(0);

    const read = api.machVmReadOverwrite(99, 0x1000n, 4);
    expect(read.kr).toBe(0);
    expect(read.outsize).toBe(4n);
    expect(read.data.subarray(0, 4)).toEqual(Buffer.from([0x7f, 0x7f, 0x7f, 0x7f]));

    expect(api.machVmWrite(99, 0x2000n, Buffer.from([1, 2, 3]))).toBe(0);

    const region = api.machVmRegion(99, 0x3000n);
    expect(region.kr).toBe(0);
    expect(region.address).toBe(0x3000n);
    expect(region.size).toBe(0x4000n);
    expect(region.info.protection).toBe(3);
    expect(region.info.max_protection).toBe(7);

    expect(api.machVmProtect(99, 0x4000n, 0x1000n, true, 7)).toBe(0);
    expect(api.machVmAllocate(99, 0x1000n, api.VM_FLAGS.ANYWHERE)).toEqual({
      kr: 0,
      address: 0x5000n,
    });
    expect(api.machVmDeallocate(99, 0x5000n, 0x1000n)).toBe(0);
    expect(api.taskSuspend(99)).toBe(0);
    expect(api.taskResume(99)).toBe(0);
    expect(api.dyldImageCount()).toBe(2);
    expect(api.dyldGetImageName(0)).toBe('/usr/lib/libSystem.B.dylib');
    expect(api.dyldGetImageVmaddrSlide(1)).toBe(4096n);
    expect(api.dyldGetImageHeader(1)).toBe(0x100000n);

    api.unloadLibraries();
    expect(state.libSystem.unload).toHaveBeenCalled();
  });
});
