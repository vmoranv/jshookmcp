import koffi from 'koffi';

let _ntdll: ReturnType<typeof koffi.load> | null = null;
function ntdll(): ReturnType<typeof koffi.load> {
  if (!_ntdll) _ntdll = koffi.load('ntdll.dll');
  return _ntdll;
}

export function ntSuccess(s: number): boolean {
  return s >= 0;
}

// Lazy function resolvers

let _NtCreateThreadEx: ReturnType<ReturnType<typeof koffi.load>['func']> | null = null;
function getNtCTE() {
  if (!_NtCreateThreadEx) {
    _NtCreateThreadEx = ntdll().func(
      'int32 NtCreateThreadEx(_Out_ void **, uint32, _In_ void *, void *, _In_ void *, void *, uint32, uint32, ulonglong, ulonglong, _In_ void *)',
    );
  }
  return _NtCreateThreadEx;
}

let _NtAllocateVirtualMemory: ReturnType<ReturnType<typeof koffi.load>['func']> | null = null;
function getNtAVM() {
  if (!_NtAllocateVirtualMemory) {
    _NtAllocateVirtualMemory = ntdll().func(
      'int32 NtAllocateVirtualMemory(void *, _Inout_ void **, uint32, _Inout_ ulonglong *, uint32, uint32)',
    );
  }
  return _NtAllocateVirtualMemory;
}

let _NtWriteVirtualMemory: ReturnType<ReturnType<typeof koffi.load>['func']> | null = null;
function getNtWVM() {
  if (!_NtWriteVirtualMemory) {
    _NtWriteVirtualMemory = ntdll().func(
      'int32 NtWriteVirtualMemory(void *, _In_ void *, _In_ void *, ulonglong, _Out_ ulonglong *)',
    );
  }
  return _NtWriteVirtualMemory;
}

let _NtProtectVirtualMemory: ReturnType<ReturnType<typeof koffi.load>['func']> | null = null;
function getNtPVM() {
  if (!_NtProtectVirtualMemory) {
    _NtProtectVirtualMemory = ntdll().func(
      'int32 NtProtectVirtualMemory(void *, _Inout_ void **, _Inout_ ulonglong *, uint32, _Out_ uint32 *)',
    );
  }
  return _NtProtectVirtualMemory;
}

let _NtClose: ReturnType<ReturnType<typeof koffi.load>['func']> | null = null;
function getNtClose() {
  if (!_NtClose) _NtClose = ntdll().func('int32 NtClose(void *)');
  return _NtClose;
}

const MEM_COMMIT = 0x1000;
const MEM_RESERVE = 0x2000;

export function ntCreateThreadEx(
  hProcess: bigint,
  startAddr: bigint,
  param: bigint,
  flags = 0,
): { status: number; handle: bigint } {
  const handleBuf = Buffer.alloc(8);
  const status = getNtCTE()(
    koffi.address(handleBuf),
    0x1fffff,
    null,
    hProcess,
    startAddr as unknown as bigint,
    param as unknown as bigint,
    flags,
    0,
    0n,
    0n,
    null,
  ) as number;
  return { status, handle: status >= 0 ? handleBuf.readBigUInt64LE(0) : 0n };
}

export function ntAllocateVirtualMemory(
  hProcess: bigint,
  size: number,
  protect: number,
): { status: number; address: bigint } {
  let addr = 0n;
  const addrBuf = Buffer.alloc(8);
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeBigUInt64LE(BigInt(size), 0);
  const status = getNtAVM()(
    hProcess,
    koffi.address(addrBuf),
    0,
    koffi.address(sizeBuf),
    MEM_COMMIT | MEM_RESERVE,
    protect,
  ) as number;
  if (status >= 0) addr = addrBuf.readBigUInt64LE(0);
  return { status, address: addr };
}

export function ntWriteVirtualMemory(hProcess: bigint, targetAddr: bigint, data: Buffer): number {
  const wrote = Buffer.alloc(8);
  return getNtWVM()(
    hProcess,
    targetAddr as unknown as bigint,
    koffi.address(data),
    BigInt(data.length),
    koffi.address(wrote),
  ) as number;
}

export function ntProtectVirtualMemory(
  hProcess: bigint,
  addr: bigint,
  size: number,
  newProtect: number,
): { status: number; oldProtect: number } {
  const addrBuf = Buffer.alloc(8);
  addrBuf.writeBigUInt64LE(addr, 0);
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeBigUInt64LE(BigInt(size), 0);
  const oldBuf = Buffer.alloc(4);
  const status = getNtPVM()(
    hProcess,
    koffi.address(addrBuf),
    koffi.address(sizeBuf),
    newProtect,
    koffi.address(oldBuf),
  ) as number;
  return { status, oldProtect: oldBuf.readUInt32LE(0) };
}

export function ntClose(handle: bigint): number {
  return getNtClose()(handle as unknown as bigint) as number;
}

export function ntCreateThreadExSafe(
  hProcess: bigint,
  startAddr: bigint,
  param: bigint,
  flags = 0,
): { status: number; handle: bigint } {
  return ntCreateThreadEx(hProcess, startAddr, param, flags);
}
