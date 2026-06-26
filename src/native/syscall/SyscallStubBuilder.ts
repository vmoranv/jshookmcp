import koffi from 'koffi';

let _k32: ReturnType<typeof koffi.load> | null = null;
function k32(): ReturnType<typeof koffi.load> {
  if (!_k32) _k32 = koffi.load('kernel32.dll');
  return _k32;
}

let _Va: ReturnType<ReturnType<typeof koffi.load>['func']> | null = null;
let _Vf: ReturnType<ReturnType<typeof koffi.load>['func']> | null = null;
let _Vp: ReturnType<ReturnType<typeof koffi.load>['func']> | null = null;
let _Gcp: ReturnType<ReturnType<typeof koffi.load>['func']> | null = null;
let _Wpm: ReturnType<ReturnType<typeof koffi.load>['func']> | null = null;

const MEM_COMMIT = 0x1000;
const MEM_RESERVE = 0x2000;
const MEM_RELEASE = 0x8000;
const PAGE_READWRITE = 0x04;
const PAGE_EXECUTE_READ = 0x20;
const STUB_PAGE = 64;
const STUB_SIZE = 24;

const _pages: bigint[] = [];

export interface SyscallStub {
  fn: () => number;
  addr: bigint;
}

export function buildSyscallStub(ssn: number, gadgetAddr: bigint): SyscallStub {
  if (!_Va) {
    _Va = k32().func('void * VirtualAlloc(void *, size_t, uint32, uint32)');
    _Vf = k32().func('int VirtualFree(void *, size_t, uint32)');
    _Vp = k32().func('int VirtualProtect(void *, size_t, uint32, _Out_ uint32 *)');
    _Gcp = k32().func('void * GetCurrentProcess()');
    _Wpm = k32().func(
      'int WriteProcessMemory(void *, void *, _In_ uint8_t *, size_t, _Out_ size_t *)',
    );
  }

  const page = _Va!(null, STUB_PAGE, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
  if (page === 0n || page === null || typeof page === 'undefined') {
    throw new Error('VirtualAlloc failed for stub page');
  }
  const base = page as unknown as bigint;
  _pages.push(base);

  const stub = Buffer.alloc(STUB_SIZE);
  stub[0] = 0x4c;
  stub[1] = 0x8b;
  stub[2] = 0xd1;
  stub[3] = 0xb8;
  stub.writeUInt32LE(ssn, 4);
  stub[8] = 0xff;
  stub[9] = 0x25;
  stub[10] = 0x02;
  stub[11] = 0x00;
  stub[12] = 0x00;
  stub[13] = 0x00;
  stub[14] = 0xeb;
  stub[15] = 0x00;
  stub.writeBigUInt64LE(gadgetAddr, 16);

  const self = _Gcp!() as unknown as bigint;
  const wrote = Buffer.alloc(8);
  _Wpm!(self, base, koffi.address(stub), STUB_SIZE, koffi.address(wrote));

  const old = Buffer.alloc(4);
  _Vp!(base, STUB_PAGE, PAGE_EXECUTE_READ, koffi.address(old));

  return { fn: koffi.decode(base, 'int32 (*)()') as () => number, addr: base };
}

export function freeAllStubs(): void {
  if (_Vf) for (const p of _pages) _Vf(p as unknown as bigint, 0, MEM_RELEASE);
  _pages.length = 0;
}
