import koffi from 'koffi';

let _ntdll: ReturnType<typeof koffi.load> | null = null;
function ntdll(): ReturnType<typeof koffi.load> {
  if (!_ntdll) _ntdll = koffi.load('ntdll.dll');
  return _ntdll;
}

export function ntSuccess(status: number): boolean {
  return status >= 0;
}

// ── Process ──

let _NtOpenProcess: ReturnType<ReturnType<typeof koffi.load>['func']> | null = null;
function getNtOpenProcess() {
  if (!_NtOpenProcess) {
    _NtOpenProcess = ntdll().func(
      'int32 NtOpenProcess(_Out_ void **, uint32, _In_ void *, _In_ void *)',
    );
  }
  return _NtOpenProcess;
}

export function ntOpenProcess(pid: number, desiredAccess: number, inheritHandle = false): bigint {
  const cid = Buffer.alloc(16);
  cid.writeBigUInt64LE(BigInt(pid), 0);
  const attr = inheritHandle ? 0x00000002 : 0x00000000;
  const oa = Buffer.alloc(48);
  oa.writeUInt32LE(48, 0);
  oa.writeUInt32LE(attr, 16);
  const handleBuf = Buffer.alloc(8);
  const status = getNtOpenProcess()(
    koffi.address(handleBuf),
    desiredAccess,
    koffi.address(oa),
    koffi.address(cid),
  ) as number;
  if (!ntSuccess(status)) {
    throw new Error(
      `NtOpenProcess failed for PID ${pid}: NTSTATUS 0x${(status >>> 0).toString(16).padStart(8, '0')}`,
    );
  }
  return handleBuf.readBigUInt64LE(0);
}

// ── Memory ──

let _NtReadVirtualMemory: ReturnType<ReturnType<typeof koffi.load>['func']> | null = null;
function getNtRVM() {
  if (!_NtReadVirtualMemory) {
    _NtReadVirtualMemory = ntdll().func(
      'int32 NtReadVirtualMemory(void *, _In_ void *, _Out_ void *, ulonglong, _Out_ ulonglong *)',
    );
  }
  return _NtReadVirtualMemory;
}

export function ntReadVirtualMemory(hProcess: bigint, baseAddress: bigint, size: number): Buffer {
  const buf = Buffer.alloc(size);
  const bytesRead = Buffer.alloc(8);
  const status = getNtRVM()(
    hProcess,
    baseAddress as unknown as bigint,
    koffi.address(buf),
    BigInt(size),
    koffi.address(bytesRead),
  ) as number;
  if (!ntSuccess(status)) {
    throw new Error(
      `NtReadVirtualMemory failed: NTSTATUS 0x${(status >>> 0).toString(16).padStart(8, '0')}`,
    );
  }
  return buf.subarray(0, Number(bytesRead.readBigUInt64LE(0)));
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

export function ntWriteVirtualMemory(hProcess: bigint, baseAddress: bigint, data: Buffer): number {
  const bytesWritten = Buffer.alloc(8);
  const status = getNtWVM()(
    hProcess,
    baseAddress as unknown as bigint,
    koffi.address(data),
    BigInt(data.length),
    koffi.address(bytesWritten),
  ) as number;
  if (!ntSuccess(status)) {
    throw new Error(
      `NtWriteVirtualMemory failed: NTSTATUS 0x${(status >>> 0).toString(16).padStart(8, '0')}`,
    );
  }
  return Number(bytesWritten.readBigUInt64LE(0));
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

export function ntAllocateVirtualMemory(
  hProcess: bigint,
  size: number,
  allocType: number,
  protect: number,
): bigint {
  const addrBuf = Buffer.alloc(8);
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeBigUInt64LE(BigInt(size), 0);
  const status = getNtAVM()(
    hProcess,
    koffi.address(addrBuf),
    0,
    koffi.address(sizeBuf),
    allocType,
    protect,
  ) as number;
  if (!ntSuccess(status)) {
    throw new Error(
      `NtAllocateVirtualMemory failed: NTSTATUS 0x${(status >>> 0).toString(16).padStart(8, '0')}`,
    );
  }
  return addrBuf.readBigUInt64LE(0);
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

export function ntProtectVirtualMemory(
  hProcess: bigint,
  addr: bigint,
  size: number,
  newProtect: number,
): { oldProtect: number } {
  const addrBuf = Buffer.alloc(8);
  addrBuf.writeBigUInt64LE(addr, 0);
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeBigUInt64LE(BigInt(size), 0);
  const old = Buffer.alloc(4);
  const status = getNtPVM()(
    hProcess,
    koffi.address(addrBuf),
    koffi.address(sizeBuf),
    newProtect,
    koffi.address(old),
  ) as number;
  if (!ntSuccess(status)) {
    throw new Error(
      `NtProtectVirtualMemory failed: NTSTATUS 0x${(status >>> 0).toString(16).padStart(8, '0')}`,
    );
  }
  return { oldProtect: old.readUInt32LE(0) };
}

let _NtFreeVirtualMemory: ReturnType<ReturnType<typeof koffi.load>['func']> | null = null;
function getNtFVM() {
  if (!_NtFreeVirtualMemory) {
    _NtFreeVirtualMemory = ntdll().func(
      'int32 NtFreeVirtualMemory(void *, _Inout_ void **, _Inout_ ulonglong *, uint32)',
    );
  }
  return _NtFreeVirtualMemory;
}

export function ntFreeVirtualMemory(
  hProcess: bigint,
  addr: bigint,
  size: number,
  freeType: number,
): void {
  const addrBuf = Buffer.alloc(8);
  addrBuf.writeBigUInt64LE(addr, 0);
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeBigUInt64LE(BigInt(size), 0);
  const status = getNtFVM()(
    hProcess,
    koffi.address(addrBuf),
    koffi.address(sizeBuf),
    freeType,
  ) as number;
  if (!ntSuccess(status)) {
    throw new Error(
      `NtFreeVirtualMemory failed: NTSTATUS 0x${(status >>> 0).toString(16).padStart(8, '0')}`,
    );
  }
}

// ── Suspend / Resume ──

let _NtSuspendProcess: ReturnType<ReturnType<typeof koffi.load>['func']> | null = null;
function getNtSP() {
  if (!_NtSuspendProcess) {
    _NtSuspendProcess = ntdll().func('int32 NtSuspendProcess(void *)');
  }
  return _NtSuspendProcess;
}

export function ntSuspendProcess(hProcess: bigint): void {
  const status = getNtSP()(hProcess as unknown as bigint) as number;
  if (!ntSuccess(status)) {
    throw new Error(
      `NtSuspendProcess failed: NTSTATUS 0x${(status >>> 0).toString(16).padStart(8, '0')}`,
    );
  }
}

let _NtResumeProcess: ReturnType<ReturnType<typeof koffi.load>['func']> | null = null;
function getNtRP() {
  if (!_NtResumeProcess) {
    _NtResumeProcess = ntdll().func('int32 NtResumeProcess(void *)');
  }
  return _NtResumeProcess;
}

export function ntResumeProcess(hProcess: bigint): void {
  const status = getNtRP()(hProcess as unknown as bigint) as number;
  if (!ntSuccess(status)) {
    throw new Error(
      `NtResumeProcess failed: NTSTATUS 0x${(status >>> 0).toString(16).padStart(8, '0')}`,
    );
  }
}
