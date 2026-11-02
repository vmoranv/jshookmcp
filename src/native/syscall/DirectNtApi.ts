import { requireKoffi, type KoffiLibraryHandle, type KoffiCallable } from '../koffi-loader';

let _ntdll: KoffiLibraryHandle | null = null;
function ntdll(): KoffiLibraryHandle {
  if (!_ntdll) _ntdll = requireKoffi().load('ntdll.dll');
  return _ntdll;
}

export function ntSuccess(status: number): boolean {
  return status >= 0;
}

/** Format an NTSTATUS code as a readable hex string (0xXXXXXXXX). */
function ntStatusToString(ntStatus: number): string {
  return `NTSTATUS 0x${(ntStatus >>> 0).toString(16).padStart(8, '0')}`;
}

// ── Process ──

let _NtOpenProcess: KoffiCallable | null = null;
function getNtOpenProcess() {
  if (!_NtOpenProcess) {
    _NtOpenProcess = ntdll().func(
      'int32 NtOpenProcess(_Out_ void **, uint32, _In_ void *, _In_ void *)',
    );
  }
  return _NtOpenProcess;
}

/**
 * Build an OBJECT_ATTRIBUTES structure (x64) in a Buffer.
 *
 * Layout: Length(0) RootDirectory(8) ObjectName(16) Attributes(24)
 * SecurityDescriptor(32) SecurityQualityOfService(40).
 *
 * NOTE: Attributes must be written at offset 24. Writing it at 16 (the
 * ObjectName pointer slot) hands the kernel a garbage 0x2 pointer instead of a
 * real UNICODE_STRING — harmless only while callers always pass attr = 0.
 */
export function buildObjectAttributes(attr: number, length = 48): Buffer {
  const oa = Buffer.alloc(length);
  oa.writeUInt32LE(length, 0);
  oa.writeUInt32LE(attr, 24);
  return oa;
}

export function ntOpenProcess(pid: number, desiredAccess: number, inheritHandle = false): bigint {
  const cid = Buffer.alloc(16);
  cid.writeBigUInt64LE(BigInt(pid), 0);
  const attr = inheritHandle ? 0x00000002 : 0x00000000;
  const oa = buildObjectAttributes(attr);
  const handleBuf = Buffer.alloc(8);
  const status = getNtOpenProcess()(
    requireKoffi().address(handleBuf),
    desiredAccess,
    requireKoffi().address(oa),
    requireKoffi().address(cid),
  ) as number;
  if (!ntSuccess(status)) {
    throw new Error(`NtOpenProcess failed for PID ${pid}: ${ntStatusToString(status)}`);
  }
  return handleBuf.readBigUInt64LE(0);
}

// ── Memory ──

let _NtReadVirtualMemory: KoffiCallable | null = null;
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
    requireKoffi().address(buf),
    BigInt(size),
    requireKoffi().address(bytesRead),
  ) as number;
  if (!ntSuccess(status)) {
    throw new Error(`NtReadVirtualMemory failed: ${ntStatusToString(status)}`);
  }
  return buf.subarray(0, Number(bytesRead.readBigUInt64LE(0)));
}

let _NtWriteVirtualMemory: KoffiCallable | null = null;
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
    requireKoffi().address(data),
    BigInt(data.length),
    requireKoffi().address(bytesWritten),
  ) as number;
  if (!ntSuccess(status)) {
    throw new Error(`NtWriteVirtualMemory failed: ${ntStatusToString(status)}`);
  }
  return Number(bytesWritten.readBigUInt64LE(0));
}

let _NtAllocateVirtualMemory: KoffiCallable | null = null;
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
    requireKoffi().address(addrBuf),
    0,
    requireKoffi().address(sizeBuf),
    allocType,
    protect,
  ) as number;
  if (!ntSuccess(status)) {
    throw new Error(`NtAllocateVirtualMemory failed: ${ntStatusToString(status)}`);
  }
  return addrBuf.readBigUInt64LE(0);
}

let _NtProtectVirtualMemory: KoffiCallable | null = null;
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
    requireKoffi().address(addrBuf),
    requireKoffi().address(sizeBuf),
    newProtect,
    requireKoffi().address(old),
  ) as number;
  if (!ntSuccess(status)) {
    throw new Error(`NtProtectVirtualMemory failed: ${ntStatusToString(status)}`);
  }
  return { oldProtect: old.readUInt32LE(0) };
}

let _NtFreeVirtualMemory: KoffiCallable | null = null;
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
    requireKoffi().address(addrBuf),
    requireKoffi().address(sizeBuf),
    freeType,
  ) as number;
  if (!ntSuccess(status)) {
    throw new Error(`NtFreeVirtualMemory failed: ${ntStatusToString(status)}`);
  }
}

// ── Suspend / Resume ──

let _NtSuspendProcess: KoffiCallable | null = null;
function getNtSP() {
  if (!_NtSuspendProcess) {
    _NtSuspendProcess = ntdll().func('int32 NtSuspendProcess(void *)');
  }
  return _NtSuspendProcess;
}

export function ntSuspendProcess(hProcess: bigint): void {
  const status = getNtSP()(hProcess as unknown as bigint) as number;
  if (!ntSuccess(status)) {
    throw new Error(`NtSuspendProcess failed: ${ntStatusToString(status)}`);
  }
}

let _NtResumeProcess: KoffiCallable | null = null;
function getNtRP() {
  if (!_NtResumeProcess) {
    _NtResumeProcess = ntdll().func('int32 NtResumeProcess(void *)');
  }
  return _NtResumeProcess;
}

export function ntResumeProcess(hProcess: bigint): void {
  const status = getNtRP()(hProcess as unknown as bigint) as number;
  if (!ntSuccess(status)) {
    throw new Error(`NtResumeProcess failed: ${ntStatusToString(status)}`);
  }
}
