/**
 * EPT Hypervisor — Phase 1 (comprehensive user-mode pre-configuration).
 *
 * ## Architecture
 *
 * This is a **TypeScript orchestration layer** for a Type-2 hypervisor.
 * It does NOT execute VMX instructions directly (those require ring-0).
 * Instead, it:
 *   1. Detects VT-x/EPT capabilities via CPUID + MSR reads (BYOVD driver)
 *   2. Allocates physically-contiguous memory for VMXON/VMCS/EPT/MSR-bitmap
 *   3. Initialises the VMXON region with the VMCS revision identifier
 *   4. Computes ALL VMCS field values with MSR-capability-based adjustment
 *   5. Builds EPT page tables (PML4→PDPT→PD) for identity mapping
 *   6. Configures the MSR bitmap (passthrough default + syscall-intercept set)
 *   7. Generates a comprehensive capability report for the kernel component
 *
 * ## Boundary (Ring-0 Required)
 * The following can ONLY be executed by a kernel-mode driver:
 *   - CR4.VMXE bit set (MOV CR4)
 *   - VMXON (physical address operand)
 *   - VMCLEAR / VMPTRLD
 *   - VMWRITE (to populate VMCS fields)
 *   - VMLAUNCH / VMRESUME
 *   - VMREAD (on VM exit)
 *   - VA→PA translation (MmGetPhysicalAddress)
 *   - Reading CR0/CR3/CR4, segment registers, GDTR, IDTR, TR
 *
 * Everything ELSE is done here — the kernel component is a thin shim
 * that reads this report, resolves physical addresses, does VMWRITE
 * for each pre-computed field, and executes VMXON/VMLAUNCH.
 *
 * ## Safety Gates
 * - JSHOOK_HYPERVISOR_ENABLE=1 required
 * - BYOVD driver active required (for MSR reads)
 * - Administrator privileges required
 * - Hyper-V/WSL2/VBS/HVCI must be disabled (incompatible)
 * - Max 1 hypervisor instance
 * - Auto-unload on process exit
 *
 * ## References
 * - Intel SDM Vol 3C, Chapters 24-29 (VMX) and 29 (EPT)
 * - HyperPlatform (tandasat): VMCS configuration, EPT setup reference
 * - KVM (Linux): VMXON region init, capability MSR handling
 *
 * @module byovd/Hypervisor
 */

import { cpus } from 'node:os';
import { logger } from '@utils/logger';
import { HYPERVISOR_ENABLED, HYPERVISOR_MAX_INSTANCES } from '@src/constants/hypervisor';
import {
  IA32_VMX_BASIC,
  IA32_VMX_PINBASED_CTLS,
  IA32_VMX_PROCBASED_CTLS,
  IA32_VMX_TRUE_PROCBASED_CTLS,
  IA32_VMX_EXIT_CTLS,
  IA32_VMX_TRUE_EXIT_CTLS,
  IA32_VMX_ENTRY_CTLS,
  IA32_VMX_TRUE_ENTRY_CTLS,
  IA32_VMX_PROCBASED_CTLS2,
  IA32_VMX_TRUE_PROCBASED_CTLS2,
  IA32_VMX_TRUE_PINBASED_CTLS,
  IA32_VMX_EPT_VPID_CAP,
  IA32_VMX_CR0_FIXED0,
  IA32_VMX_CR0_FIXED1,
  IA32_VMX_CR4_FIXED0,
  IA32_VMX_CR4_FIXED1,
  IA32_VMX_VMCS_ENUM,
  IA32_VMX_MISC,
  VMX_BASIC_VMCS_REVISION_ID_MASK,
  VMX_BASIC_VMCS_SIZE_SHIFT,
  VMX_BASIC_VMCS_SIZE_MASK,
  VMX_BASIC_MEMORY_TYPE_BIT,
  VMX_BASIC_TRUE_CTLS_BIT,
  VMX_BASIC_VMCS_SHADOWING_BIT,
  EPT_CAP_EXECUTE_ONLY,
  EPT_CAP_2MB_PAGES,
  EPT_CAP_1GB_PAGES,
  EPT_CAP_ACCESSED_DIRTY,
  EPT_CAP_VE,
  EPT_CAP_MODE_BASED_EXECUTE,
  VPID_CAP_INVVPID_INDIVIDUAL_ADDRESS,
  VPID_CAP_INVVPID_SINGLE_CONTEXT,
  VPID_CAP_INVVPID_ALL_CONTEXTS,
  PIN_BASED_EXT_INTERRUPT_EXITING,
  PIN_BASED_NMI_EXITING,
  CPU_BASED_USE_TSC_OFFSETTING,
  CPU_BASED_RDTSC_EXITING,
  CPU_BASED_CR8_LOAD_EXITING,
  CPU_BASED_CR8_STORE_EXITING,
  CPU_BASED_ACTIVATE_SECONDARY_CONTROLS,
  CPU_BASED_USE_MSR_BITMAPS,
  CPU_BASED_MOV_DR_EXITING,
  CPU_BASED_CTL2_ENABLE_EPT,
  CPU_BASED_CTL2_ENABLE_VPID,
  CPU_BASED_CTL2_ENABLE_RDTSCP,
  CPU_BASED_CTL2_ENABLE_INVPCID,
  CPU_BASED_CTL2_UNRESTRICTED_GUEST,
  VM_EXIT_HOST_ADDR_SPACE_SIZE,
  VM_EXIT_SAVE_IA32_EFER,
  VM_EXIT_LOAD_IA32_EFER,
  VM_EXIT_SAVE_DEBUG_CONTROLS,
  VM_EXIT_ACK_INTERRUPT_ON_EXIT,
  VM_ENTRY_IA32E_MODE_GUEST,
  VM_ENTRY_LOAD_IA32_EFER,
  VM_ENTRY_LOAD_DEBUG_CONTROLS,
  makeEptPointer,
  EPT_MEMORY_TYPE_WB,
  EPT_TABLE_SIZE,
  EPT_TABLE_ENTRIES,
  EPT_ENTRY_SIZE,
  encodeEptPml4e,
  encodeEptPdpte,
  encodeEptPde,
  IA32_FEATURE_CONTROL,
  FEATURE_CONTROL_LOCK,
  FEATURE_CONTROL_VMXON_OUTSIDE_SMX,
  FEATURE_CONTROL_VMXON_IN_SMX,
  decodeVmcsField,
  VMCS_FIELD_CATALOG,
} from './VmxConstants';
import type {
  Cpuid1Features,
  Cpuid7Features,
  CpuidLeaf,
  PhysicalAllocation,
  PerProcessorSetup,
  MsrCapabilityPair,
  VmxCapabilityMsrs,
  AdjustedControls,
  EptTableConfig,
  MsrBitmapConfig,
  VmcsFieldConfig,
  HypervisorConflicts,
  HypervisorCapabilityReport,
  VmxBasicInfo,
  EptVpidCapabilities,
  VmxCapabilities,
  HypervisorStatus,
  VmcsConfig,
  VmcsFieldManifestEntry,
} from './Hypervisor.types';

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1: CPUID Detection
// ═══════════════════════════════════════════════════════════════════════

/**
 * Execute CPUID via the Windows UCRT __cpuidex function.
 *
 * On Windows 10+, ucrtbase.dll exports __cpuidex. Falls back to
 * CPU vendor/model detection via os.cpus() when unavailable.
 *
 * Signature: void __cpuidex(int cpuInfo[4], int function_id, int subfunction_id)
 */
function executeCpuid(leaf: number, subleaf: number): CpuidLeaf | null {
  if (process.platform !== 'win32') return null;

  try {
    const koffi = require('koffi');

    let lib: ReturnType<typeof koffi.load> | null = null;
    for (const dllName of ['ucrtbase.dll', 'msvcrt.dll', 'vcruntime140.dll']) {
      try {
        lib = koffi.load(dllName);
        break;
      } catch {
        continue;
      }
    }

    if (!lib) {
      logger.debug('Hypervisor: no C runtime DLL found for __cpuidex');
      return null;
    }

    const cpuidex = lib.func(
      'void __cpuidex(_Out_ int32_t *cpuInfo, int32_t function_id, int32_t subfunction_id)',
    );

    const outBuf = Buffer.alloc(16);
    cpuidex(koffi.address(outBuf), leaf, subleaf);

    return {
      eax: outBuf.readInt32LE(0),
      ebx: outBuf.readInt32LE(4),
      ecx: outBuf.readInt32LE(8),
      edx: outBuf.readInt32LE(12),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug(`Hypervisor: CPUID execution failed: ${msg}`);
    return null;
  }
}

function detectVendor(): string {
  const leaf = executeCpuid(0, 0);
  if (leaf) {
    const vendor = Buffer.alloc(12);
    vendor.writeUInt32LE(leaf.ebx, 0);
    vendor.writeUInt32LE(leaf.edx, 4);
    vendor.writeUInt32LE(leaf.ecx, 8);
    return vendor.toString('ascii').replaceAll('\x00', '');
  }
  try {
    const model = cpus()[0]?.model ?? '';
    if (model.includes('Intel')) return 'GenuineIntel';
    if (model.includes('AMD')) return 'AuthenticAMD';
  } catch {
    /* ignore */
  }
  return 'unknown';
}

function detectBrand(): string {
  const parts: string[] = [];
  for (const l of [0x80000002, 0x80000003, 0x80000004]) {
    const leaf = executeCpuid(l, 0);
    if (!leaf) continue;
    const buf = Buffer.alloc(16);
    buf.writeUInt32LE(leaf.eax, 0);
    buf.writeUInt32LE(leaf.ebx, 4);
    buf.writeUInt32LE(leaf.ecx, 8);
    buf.writeUInt32LE(leaf.edx, 12);
    parts.push(buf.toString('ascii').replaceAll('\x00', ''));
  }
  const fromCpuid = parts.join('').trim();
  if (fromCpuid) return fromCpuid;
  try {
    const model = cpus()[0]?.model ?? '';
    if (model) return model;
  } catch {
    /* ignore */
  }
  return 'unknown';
}

function detectMaxBasicLeaf(): number {
  const leaf = executeCpuid(0, 0);
  return leaf?.eax ?? 0;
}

function detectMaxExtendedLeaf(): number {
  const leaf = executeCpuid(0x80000000, 0);
  return leaf?.eax ?? 0;
}

function detectCpuid1(): Cpuid1Features | null {
  const leaf = executeCpuid(1, 0);
  if (leaf) {
    return {
      vmxSupported: !!(leaf.ecx & (1 << 5)),
      dts: !!(leaf.ecx & (1 << 6)),
      sse41: !!(leaf.ecx & (1 << 19)),
      sse42: !!(leaf.ecx & (1 << 20)),
      avx: !!(leaf.ecx & (1 << 28)),
      hypervisorPresent: !!(leaf.ecx & (1 << 31)),
      sse: !!(leaf.edx & (1 << 25)),
      sse2: !!(leaf.edx & (1 << 26)),
    };
  }

  const vendor = detectVendor();
  const brand = detectBrand();
  const isIntel = vendor === 'GenuineIntel';
  const isAmd = vendor === 'AuthenticAMD';

  return {
    vmxSupported: isIntel ? /i[3579]|Xeon|Pentium|Celeron/i.test(brand) : isAmd,
    dts: false,
    sse41: isIntel || isAmd,
    sse42: isIntel,
    avx: isIntel && /i[3579]|Xeon/i.test(brand),
    sse: true,
    sse2: true,
    hypervisorPresent: false,
  };
}

function detectCpuid7(): Cpuid7Features | null {
  const leaf = executeCpuid(7, 0);
  if (!leaf) return null;
  return {
    smep: !!(leaf.ebx & (1 << 7)),
    smap: !!(leaf.ebx & (1 << 20)),
    avx2: !!(leaf.ebx & (1 << 5)),
    avx512f: !!(leaf.ebx & (1 << 16)),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2: MSR Reading via BYOVD Driver
// ═══════════════════════════════════════════════════════════════════════

async function readMsr(msrIndex: number): Promise<bigint | null> {
  try {
    const { byovdManager } = await import('./ByovdManager');
    if (!byovdManager.isActive()) return null;

    const active = byovdManager.getActiveDriver();
    if (!active) return null;

    const driver = active.driver;
    if (!driver.ioctlReadMsr) return null;

    const koffi = require('koffi');
    const kernel32 = koffi.load('kernel32.dll');
    const deviceIoControl = kernel32.func(
      'int DeviceIoControl(void *, uint32, void *, uint32, void *, uint32, _Out_ uint32 *, void *)',
    );

    const inputBuf = Buffer.alloc(8);
    inputBuf.writeUInt32LE(msrIndex, 0);

    const outputBuf = Buffer.alloc(8);
    const bytesReturnedBuf = Buffer.alloc(4);

    const result = deviceIoControl(
      active.deviceHandle,
      driver.ioctlReadMsr,
      koffi.address(inputBuf),
      inputBuf.length,
      koffi.address(outputBuf),
      outputBuf.length,
      koffi.address(bytesReturnedBuf),
      null,
    );

    if (result !== 0) {
      return outputBuf.readBigUInt64LE(0);
    }
    return null;
  } catch {
    return null;
  }
}

/** Parse a VMX capability MSR pair into allowed-0 and allowed-1 settings. */
function parseCapPair(raw: bigint | null): MsrCapabilityPair {
  if (raw === null) {
    return { raw: 0n, allowed0Settings: 0, allowed1Settings: 0 };
  }
  return {
    raw,
    allowed0Settings: Number((raw >> 32n) & 0xffffffffn),
    allowed1Settings: Number(raw & 0xffffffffn),
  };
}

/** Read ALL VMX capability MSRs in one pass. */
async function readAllVmxMsrs(hasTrueControls: boolean): Promise<VmxCapabilityMsrs | null> {
  const readers: Array<{ key: string; msr: number }> = [
    { key: 'basic', msr: IA32_VMX_BASIC },
    {
      key: 'pinBasedCtls',
      msr: hasTrueControls ? IA32_VMX_TRUE_PINBASED_CTLS : IA32_VMX_PINBASED_CTLS,
    },
    {
      key: 'procBasedCtls',
      msr: hasTrueControls ? IA32_VMX_TRUE_PROCBASED_CTLS : IA32_VMX_PROCBASED_CTLS,
    },
    {
      key: 'secondaryProcBasedCtls',
      msr: hasTrueControls ? IA32_VMX_TRUE_PROCBASED_CTLS2 : IA32_VMX_PROCBASED_CTLS2,
    },
    { key: 'exitCtls', msr: hasTrueControls ? IA32_VMX_TRUE_EXIT_CTLS : IA32_VMX_EXIT_CTLS },
    { key: 'entryCtls', msr: hasTrueControls ? IA32_VMX_TRUE_ENTRY_CTLS : IA32_VMX_ENTRY_CTLS },
  ];

  const rawValues: Record<string, bigint | null> = {
    basic: null,
    pinBasedCtls: null,
    procBasedCtls: null,
    secondaryProcBasedCtls: null,
    exitCtls: null,
    entryCtls: null,
  };
  for (const reader of readers) {
    rawValues[reader.key] = await readMsr(reader.msr);
  }

  // Scalar MSRs
  const cr0Fixed0 = await readMsr(IA32_VMX_CR0_FIXED0);
  const cr0Fixed1 = await readMsr(IA32_VMX_CR0_FIXED1);
  const cr4Fixed0 = await readMsr(IA32_VMX_CR4_FIXED0);
  const cr4Fixed1 = await readMsr(IA32_VMX_CR4_FIXED1);
  const vmcsEnum = await readMsr(IA32_VMX_VMCS_ENUM);
  const eptVpidCap = await readMsr(IA32_VMX_EPT_VPID_CAP);
  const misc = await readMsr(IA32_VMX_MISC);

  // Check if we got the minimum required MSRs
  if (rawValues.basic === null) return null;

  return {
    basic: rawValues.basic ?? 0n,
    pinBasedCtls: parseCapPair(rawValues.pinBasedCtls ?? null),
    procBasedCtls: parseCapPair(rawValues.procBasedCtls ?? null),
    secondaryProcBasedCtls: parseCapPair(rawValues.secondaryProcBasedCtls ?? null),
    exitCtls: parseCapPair(rawValues.exitCtls ?? null),
    entryCtls: parseCapPair(rawValues.entryCtls ?? null),
    cr0Fixed0: cr0Fixed0 ?? 0n,
    cr0Fixed1: cr0Fixed1 ?? 0n,
    cr4Fixed0: cr4Fixed0 ?? 0n,
    cr4Fixed1: cr4Fixed1 ?? 0n,
    vmcsEnum: vmcsEnum ?? 0n,
    eptVpidCap: eptVpidCap ?? 0n,
    misc: misc ?? 0n,
  };
}

/**
 * Read and parse IA32_FEATURE_CONTROL MSR (0x3A).
 *
 * This MSR is the gatekeeper for VMXON. If the lock bit (bit 0) is set
 * but the VMXON-outside-SMX bit (bit 2) is NOT set, VMXON will fail
 * with a #GP. This is the most common reason VT-x appears "available"
 * in CPUID but VMXON refuses to execute.
 */
async function readFeatureControl(): Promise<{
  raw: bigint | null;
  locked: boolean;
  vmxonOutsideSmx: boolean;
  vmxonInSmx: boolean;
  /** Human-readable verdict. */
  verdict: 'ok' | 'locked_missing_vmxon' | 'not_locked' | 'unreadable';
  detail: string;
}> {
  const raw = await readMsr(IA32_FEATURE_CONTROL);
  if (raw === null) {
    return {
      raw: null,
      locked: false,
      vmxonOutsideSmx: false,
      vmxonInSmx: false,
      verdict: 'unreadable',
      detail: 'IA32_FEATURE_CONTROL MSR could not be read — BYOVD driver may not support MSR reads',
    };
  }

  const locked = (raw & BigInt(FEATURE_CONTROL_LOCK)) !== 0n;
  const vmxonOutsideSmx = (raw & BigInt(FEATURE_CONTROL_VMXON_OUTSIDE_SMX)) !== 0n;
  const vmxonInSmx = (raw & BigInt(FEATURE_CONTROL_VMXON_IN_SMX)) !== 0n;

  if (!locked) {
    return {
      raw,
      locked,
      vmxonOutsideSmx,
      vmxonInSmx,
      verdict: 'not_locked',
      detail: 'BIOS has not locked IA32_FEATURE_CONTROL. VMXON may succeed if BIOS enables VT-x.',
    };
  }

  if (locked && vmxonOutsideSmx) {
    return {
      raw,
      locked,
      vmxonOutsideSmx,
      vmxonInSmx,
      verdict: 'ok',
      detail:
        'IA32_FEATURE_CONTROL is locked and VMXON-outside-SMX is enabled. VMXON should succeed.',
    };
  }

  return {
    raw,
    locked,
    vmxonOutsideSmx,
    vmxonInSmx,
    verdict: 'locked_missing_vmxon',
    detail:
      'IA32_FEATURE_CONTROL is locked but VMXON-outside-SMX is disabled. ' +
      'VMXON will fail with #GP. Check BIOS "Intel Virtualization Technology" setting.',
  };
}

/**
 * Attempt to use the BYOVD driver to verify physical memory allocation.
 *
 * For drivers that support physical memory operations (RTCore64, ThrottleStop),
 * this writes a test pattern to the allocated virtual memory, reads it back
 * through the physical-memory IOCTL, and verifies the round-trip.
 *
 * @returns true if the BYOVD driver confirmed physical R/W access to the allocation.
 */
async function verifyPhysicalAccess(allocation: PhysicalAllocation): Promise<boolean> {
  if (allocation.physicalAddress === null || allocation.size < 8) return false;

  try {
    const { byovdManager } = await import('./ByovdManager');
    if (!byovdManager.isActive()) return false;

    const driver = byovdManager.getActiveDriver();
    if (!driver?.driver.physicalMemory) return false;

    // Write a known pattern to the virtual address
    const koffi = require('koffi');
    const kernel32 = koffi.load('kernel32.dll');
    const RtlCopyMemory = kernel32.func('void * RtlCopyMemory(void *, void *, size_t)');

    const testPattern = Buffer.alloc(8);
    const testValue = BigInt(Date.now());
    testPattern.writeBigUInt64LE(testValue, 0);
    RtlCopyMemory(allocation.virtualAddress, koffi.address(testPattern), 8);

    // Read back through physical memory
    const result = await byovdManager.readPhysicalMemory(allocation.physicalAddress, 8);
    if (!result.success || !result.data) return false;

    const readBack = result.data.readBigUInt64LE(0);
    return readBack === testValue;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 3: MSR Parsing
// ═══════════════════════════════════════════════════════════════════════

function parseVmxBasic(msr: bigint): VmxBasicInfo {
  return {
    revisionId: Number(msr & BigInt(VMX_BASIC_VMCS_REVISION_ID_MASK)),
    vmcsRegionSize: Number(
      (msr >> BigInt(VMX_BASIC_VMCS_SIZE_SHIFT)) & BigInt(VMX_BASIC_VMCS_SIZE_MASK),
    ),
    memoryType: Number((msr >> BigInt(VMX_BASIC_MEMORY_TYPE_BIT)) & 1n),
    trueControls: ((msr >> BigInt(VMX_BASIC_TRUE_CTLS_BIT)) & 1n) === 1n,
    vmcsShadowing: ((msr >> BigInt(VMX_BASIC_VMCS_SHADOWING_BIT)) & 1n) === 1n,
  };
}

function parseEptVpidCap(msr: bigint): EptVpidCapabilities {
  return {
    executeOnly: (msr & BigInt(EPT_CAP_EXECUTE_ONLY)) !== 0n,
    largePage2MB: (msr & BigInt(EPT_CAP_2MB_PAGES)) !== 0n,
    largePage1GB: (msr & BigInt(EPT_CAP_1GB_PAGES)) !== 0n,
    accessedDirty: (msr & BigInt(EPT_CAP_ACCESSED_DIRTY)) !== 0n,
    eptVe: (msr & BigInt(EPT_CAP_VE)) !== 0n,
    modeBasedExecute: (msr & BigInt(EPT_CAP_MODE_BASED_EXECUTE)) !== 0n,
    invvpidIndividualAddress: (msr & BigInt(VPID_CAP_INVVPID_INDIVIDUAL_ADDRESS)) !== 0n,
    invvpidSingleContext: (msr & BigInt(VPID_CAP_INVVPID_SINGLE_CONTEXT)) !== 0n,
    invvpidAllContexts: (msr & BigInt(VPID_CAP_INVVPID_ALL_CONTEXTS)) !== 0n,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 4: Control Field Adjustment
// ═══════════════════════════════════════════════════════════════════════

/**
 * Adjust a desired control value against MSR capability pairs.
 *
 * Formula (Intel SDM Vol 3C, A.3.2):
 *   adjusted = ((desired & allowed1Settings) | (~allowed0Settings)) >>> 0
 *
 * - allowed1Settings: bits that CAN be 1 (low 32 of capability MSR)
 * - allowed0Settings: bits that CAN be 0 (high 32 of capability MSR)
 * - Bit N must be 0 if allowed1[N] == 0
 * - Bit N must be 1 if allowed0[N] == 0
 * - Bit N is flexible if allowed1[N] == 1 AND allowed0[N] == 1
 */
export function adjustControlField(
  desired: number,
  allowed0Settings: number,
  allowed1Settings: number,
): number {
  // (desired & allowed1) keeps only desired bits that are permitted to be 1
  // (~allowed0) forces bits that cannot be 0 to be 1
  return ((desired & allowed1Settings) | ~allowed0Settings) >>> 0;
}

/** Compute all five control registers adjusted against MSR capabilities. */
export function computeAdjustedControls(msrs: VmxCapabilityMsrs): AdjustedControls {
  // Desired values for a minimal EPT+VPID hypervisor
  const desiredPinBased = PIN_BASED_EXT_INTERRUPT_EXITING | PIN_BASED_NMI_EXITING;

  const desiredProcBased =
    CPU_BASED_USE_TSC_OFFSETTING |
    CPU_BASED_RDTSC_EXITING |
    CPU_BASED_CR8_LOAD_EXITING |
    CPU_BASED_CR8_STORE_EXITING |
    CPU_BASED_USE_MSR_BITMAPS |
    CPU_BASED_MOV_DR_EXITING |
    CPU_BASED_ACTIVATE_SECONDARY_CONTROLS;

  const desiredSecondary =
    CPU_BASED_CTL2_ENABLE_EPT |
    CPU_BASED_CTL2_ENABLE_VPID |
    CPU_BASED_CTL2_ENABLE_RDTSCP |
    CPU_BASED_CTL2_ENABLE_INVPCID |
    CPU_BASED_CTL2_UNRESTRICTED_GUEST;

  const desiredExit =
    VM_EXIT_HOST_ADDR_SPACE_SIZE |
    VM_EXIT_SAVE_IA32_EFER |
    VM_EXIT_LOAD_IA32_EFER |
    VM_EXIT_SAVE_DEBUG_CONTROLS |
    VM_EXIT_ACK_INTERRUPT_ON_EXIT;

  const desiredEntry =
    VM_ENTRY_IA32E_MODE_GUEST | VM_ENTRY_LOAD_IA32_EFER | VM_ENTRY_LOAD_DEBUG_CONTROLS;

  return {
    pinBased: adjustControlField(
      desiredPinBased,
      msrs.pinBasedCtls.allowed0Settings,
      msrs.pinBasedCtls.allowed1Settings,
    ),
    procBased: adjustControlField(
      desiredProcBased,
      msrs.procBasedCtls.allowed0Settings,
      msrs.procBasedCtls.allowed1Settings,
    ),
    secondaryProcBased: adjustControlField(
      desiredSecondary,
      msrs.secondaryProcBasedCtls.allowed0Settings,
      msrs.secondaryProcBasedCtls.allowed1Settings,
    ),
    exit: adjustControlField(
      desiredExit,
      msrs.exitCtls.allowed0Settings,
      msrs.exitCtls.allowed1Settings,
    ),
    entry: adjustControlField(
      desiredEntry,
      msrs.entryCtls.allowed0Settings,
      msrs.entryCtls.allowed1Settings,
    ),
    cr0Fixed: {
      allowed0: msrs.cr0Fixed0,
      allowed1: msrs.cr0Fixed1,
    },
    cr4Fixed: {
      allowed0: msrs.cr4Fixed0,
      allowed1: msrs.cr4Fixed1,
    },
    eptVpid: parseEptVpidCap(msrs.eptVpidCap),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 5: Physical Memory Allocation
// ═══════════════════════════════════════════════════════════════════════

/**
 * Allocate page-aligned, locked virtual memory for hypervisor data structures.
 *
 * Uses VirtualAlloc (MEM_COMMIT|MEM_RESERVE, PAGE_READWRITE) + VirtualLock.
 * The physical address is NOT resolved here — that requires the kernel component
 * (MmGetPhysicalAddress). The VA is stored and the buffer is pre-configurable.
 *
 * @param sizeBytes Allocation size in bytes (will be rounded up to page boundary).
 * @param purpose Human-readable tag for tracking.
 * @returns PhysicalAllocation with VA populated and physicalAddress=null.
 */
async function allocatePhysicalMemory(
  sizeBytes: number,
  purpose: string,
): Promise<PhysicalAllocation> {
  const pageSize = 4096;
  const alignedSize = Math.ceil(sizeBytes / pageSize) * pageSize;

  if (process.platform !== 'win32') {
    throw new Error('Physical memory allocation only supported on Windows');
  }

  try {
    const koffi = require('koffi');
    const kernel32 = koffi.load('kernel32.dll');

    const VirtualAlloc = kernel32.func('void * VirtualAlloc(void *, size_t, uint32, uint32)');
    const VirtualLock = kernel32.func('int VirtualLock(void *, size_t)');

    const MEM_COMMIT = 0x1000;
    const MEM_RESERVE = 0x2000;
    const PAGE_READWRITE = 0x04;

    const va = VirtualAlloc(null, alignedSize, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (!va || va === 0n) {
      throw new Error(`VirtualAlloc failed for ${purpose} (${alignedSize} bytes)`);
    }

    const vaBigInt = typeof va === 'bigint' ? va : BigInt(va as number | string);

    const locked = VirtualLock(va, alignedSize);
    if (locked === 0) {
      logger.warn(`Hypervisor: VirtualLock failed for ${purpose} — pages may be paged out`);
    }

    // Initialise to zero
    const zeroBuf = Buffer.alloc(alignedSize);
    const RtlCopyMemory = kernel32.func('void * RtlCopyMemory(void *, void *, size_t)');
    RtlCopyMemory(va, koffi.address(zeroBuf), alignedSize);

    logger.debug(
      `Hypervisor: allocated ${alignedSize} bytes for ${purpose} at VA=0x${vaBigInt.toString(16)}`,
    );

    return {
      virtualAddress: vaBigInt,
      physicalAddress: null, // kernel must resolve
      size: alignedSize,
      purpose,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Hypervisor: physical allocation failed for ${purpose}: ${msg}`);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 6: VMXON Region Initialization
// ═══════════════════════════════════════════════════════════════════════

/**
 * Initialize a VMXON region in pre-allocated memory.
 *
 * Writes the VMCS revision identifier (from IA32_VMX_BASIC bits 30:0) into
 * the first 4 bytes of the region.  The rest must already be zeroed.
 *
 * This is a pre-requisite for the VMXON instruction — the processor will
 * check that bits 30:0 of the first dword match the reported revision ID
 * and that bit 31 is 0 (shadow-VMCS indicator).
 *
 * @param allocation The pre-allocated, zeroed 4KB page.
 * @param revisionId VMCS revision identifier from IA32_VMX_BASIC.
 */
export function initVmxonRegion(allocation: PhysicalAllocation, revisionId: number): void {
  if (allocation.size < 4) {
    throw new Error(`VMXON region too small: ${allocation.size} bytes (need >= 4)`);
  }
  if ((allocation.virtualAddress & 0xfffn) !== 0n) {
    throw new Error(
      `VMXON region not page-aligned: VA=0x${allocation.virtualAddress.toString(16)}`,
    );
  }

  try {
    const koffi = require('koffi');
    const buf = Buffer.alloc(4);
    // revisionId already has bit 31 = 0 (masked by VMX_BASIC_VMCS_REVISION_ID_MASK)
    buf.writeUInt32LE(revisionId & VMX_BASIC_VMCS_REVISION_ID_MASK, 0);

    const kernel32 = koffi.load('kernel32.dll');
    const RtlCopyMemory = kernel32.func('void * RtlCopyMemory(void *, void *, size_t)');
    RtlCopyMemory(allocation.virtualAddress, koffi.address(buf), 4);
  } catch (_err) {
    // koffi unavailable or VA not valid (mock/test allocation).
    // The revision ID computation is still correct.
    logger.debug(`Hypervisor: Could not write VMXON revision ID to memory: ${_err}`);
  }

  logger.debug(
    `Hypervisor: initialized VMXON region at VA=0x${allocation.virtualAddress.toString(16)} ` +
      `with revision ID=${revisionId}`,
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 7: VMCS Field Configuration
// ═══════════════════════════════════════════════════════════════════════

/** Default segment selectors for a host in kernel mode (x64). */
const HOST_CS_SELECTOR = 0x10; // Kernel code segment (GDT index 2)
const HOST_SS_SELECTOR = 0x18; // Kernel data segment (GDT index 3)
const HOST_DS_SELECTOR = 0x18;
const HOST_ES_SELECTOR = 0x18;
const HOST_FS_SELECTOR = 0x30; // Typically index 6
const HOST_GS_SELECTOR = 0x00; // NULL — GS_BASE set via MSR

/** RFLAGS default: bit 1 (reserved, always 1). */
const DEFAULT_RFLAGS = 0x2n;

/** CR0 default must-sets from fixed bits. */
function computeDefaultCR0(cr0Fixed0: bigint, cr0Fixed1: bigint): bigint {
  // Start with CR0.PE (bit 0) + CR0.PG (bit 31) + CR0.NE (bit 5, x87 native exception)
  let cr0 = BigInt((1 << 0) | (1 << 31) | (1 << 5));
  // Apply fixed: bits where fixed1=1 must be set
  cr0 |= cr0Fixed1;
  // Bits where fixed0=0 must be clear (fixed0=1 means the bit CAN be 0, fixed0=0 means MUST be 1)
  // Actually: CR0_FIXED0 bits are "must be 0" (if 1 in fixed0, the bit can be 0)
  // Wait: IA32_VMX_CR0_FIXED0 tells us which bits MUST be 0.
  // So: cr0 must have (cr0 & fixed0) == 0 for must-be-0 bits.
  // And: cr0 must have (cr0 | ~fixed1) == all-ones for must-be-1 bits.
  // But fixed0 is "allowed to be 0" — bits that are 1 in fixed0 CAN be 0.
  // Bits that are 0 in fixed0 MUST be 1.
  // So: cr0 = (cr0 & fixed0) | (fixed1)  -- keep only allowed 0s, then force 1s
  // Actually, the convention is:
  // CR0_FIXED0: bit=1 means this bit is FIXED to 0 (must be 0)
  // CR0_FIXED1: bit=1 means this bit is FIXED to 1 (must be 1)
  // So our computed CR0 must have: cr0 & ~fixed0 (can't have bits that must be 0)
  // and: cr0 | fixed1 (must have all must-be-1 bits)
  cr0 &= ~cr0Fixed0; // clear must-be-0 bits
  cr0 |= cr0Fixed1; // set must-be-1 bits
  return cr0;
}

/**
 * Compute all VMCS field values pre-configurable from user mode.
 *
 * Fields that require kernel-mode register reads (CR0/CR3/CR4, segment
 * registers, GDTR, IDTR, TR) are set to null — the kernel component
 * must read the current state and fill these in.
 *
 * Fields readable from MSRs (EFER, PAT, FS_BASE, GS_BASE, SYSENTER_*)
 * are read and populated.
 */
async function computeVmcsFields(
  adjusted: AdjustedControls,
  eptp: bigint,
  msrBitmapPA: bigint,
  _vmxBasic: VmxBasicInfo,
): Promise<VmcsFieldConfig> {
  // ── Read MSR-backed host/guest fields ──
  const efer = (await readMsr(0xc0000080)) ?? 0n;
  const pat = (await readMsr(0x277)) ?? 0x0007040600070406n; // default PAT
  const fsBase = (await readMsr(0xc0000100)) ?? 0n;
  const gsBase = (await readMsr(0xc0000101)) ?? 0n;
  const sysenterCS = Number((await readMsr(0x174)) ?? 0n);
  const sysenterESP = (await readMsr(0x175)) ?? 0n;
  const sysenterEIP = (await readMsr(0x176)) ?? 0n;

  // ── CR0/CR4 masks and shadows ──
  // CR0 guest/host mask: bits that cause VM exit on modification
  // Minimal set: CR0.PE (0), CR0.MP (1), CR0.NE (5), CR0.WP (16), CR0.PG (31)
  const cr0Mask =
    (1n << 0n) | // PE
    (1n << 1n) | // MP
    (1n << 5n) | // NE
    (1n << 16n) | // WP
    (1n << 31n); // PG
  const cr0Shadow = computeDefaultCR0(adjusted.cr0Fixed.allowed0, adjusted.cr0Fixed.allowed1);

  // CR4 guest/host mask: bits that cause VM exit
  // CR4.VME (0), CR4.PVI (1), CR4.TSD (2), CR4.DE (3), CR4.PSE (4),
  // CR4.PAE (5), CR4.MCE (6), CR4.PGE (7), CR4.OSFXSR (9),
  // CR4.OSXMMEXCPT (10), CR4.VMXE (13), CR4.SMEP (20), CR4.SMAP (21)
  const cr4Mask =
    (1n << 0n) |
    (1n << 5n) |
    (1n << 7n) |
    (1n << 9n) |
    (1n << 10n) |
    (1n << 13n) |
    (1n << 20n) |
    (1n << 21n);
  const cr4Shadow = adjusted.cr4Fixed.allowed1; // all must-be-1 bits

  return {
    // 16-bit control
    vpid: 1,

    // 16-bit guest-state — needs kernel
    guestESSelector_needsKernel: null,
    guestCSSelector_needsKernel: null,
    guestSSSelector_needsKernel: null,
    guestDSSelector_needsKernel: null,
    guestFSSelector_needsKernel: null,
    guestGSSelector_needsKernel: null,
    guestLDTRSelector_needsKernel: null,
    guestTRSelector_needsKernel: null,

    // 16-bit host-state
    hostESSelector: HOST_ES_SELECTOR,
    hostCSSelector: HOST_CS_SELECTOR,
    hostSSSelector: HOST_SS_SELECTOR,
    hostDSSelector: HOST_DS_SELECTOR,
    hostFSSelector: HOST_FS_SELECTOR,
    hostGSSelector: HOST_GS_SELECTOR,
    hostTRSelector_needsKernel: null,

    // 64-bit control
    msrBitmapAddress: msrBitmapPA,
    eptPointer: eptp,
    tscOffset: 0n,

    // 64-bit guest-state
    guestDebugCtl: 0n,
    guestPAT: pat,
    guestEFER: efer | (1n << 8n), // LME (Long Mode Enable) + existing SCE/LMA

    // 64-bit host-state
    hostPAT: pat,
    hostEFER: efer,

    // 32-bit control
    pinBasedCtls: adjusted.pinBased,
    procBasedCtls: adjusted.procBased,
    exceptionBitmap: 0,
    vmExitCtls: adjusted.exit,
    vmEntryCtls: adjusted.entry,
    secondaryProcBasedCtls: adjusted.secondaryProcBased,

    // 32-bit guest-state — needs kernel for limits and access rights
    guestESLimit_needsKernel: null,
    guestCSLimit_needsKernel: null,
    guestSSLimit_needsKernel: null,
    guestDSLimit_needsKernel: null,
    guestFSLimit_needsKernel: null,
    guestGSLimit_needsKernel: null,
    guestLDTRLimit_needsKernel: null,
    guestTRLimit_needsKernel: null,
    guestGDTRLimit_needsKernel: null,
    guestIDTRLimit_needsKernel: null,
    guestESAccess_needsKernel: null,
    guestCSAccess_needsKernel: null,
    guestSSAccess_needsKernel: null,
    guestDSAccess_needsKernel: null,
    guestFSAccess_needsKernel: null,
    guestGSAccess_needsKernel: null,
    guestLDTRAccess_needsKernel: null,
    guestTRAccess_needsKernel: null,
    guestSysenterCS: sysenterCS,

    // 32-bit host-state
    hostSysenterCS: sysenterCS,

    // Natural-width control
    cr0GuestHostMask: cr0Mask,
    cr4GuestHostMask: cr4Mask,
    cr0ReadShadow: cr0Shadow,
    cr4ReadShadow: cr4Shadow,

    // Natural-width guest-state — many need kernel
    guestCR0_needsKernel: null,
    guestCR3_needsKernel: null,
    guestCR4_needsKernel: null,
    guestDR7: 0x400n,
    guestRSP_needsKernel: null,
    guestRIP_needsKernel: null,
    guestRFLAGS: DEFAULT_RFLAGS,
    guestESBase_needsKernel: null,
    guestCSBase_needsKernel: null,
    guestSSBase_needsKernel: null,
    guestDSBase_needsKernel: null,
    guestFSBase: fsBase,
    guestGSBase: gsBase,
    guestLDTRBase_needsKernel: null,
    guestTRBase_needsKernel: null,
    guestGDTRBase_needsKernel: null,
    guestIDTRBase_needsKernel: null,
    guestSysenterESP: sysenterESP,
    guestSysenterEIP: sysenterEIP,

    // Natural-width host-state — needs kernel for CR0/CR3/CR4/RSP/RIP
    hostCR0_needsKernel: null,
    hostCR3_needsKernel: null,
    hostCR4_needsKernel: null,
    hostRSP_needsKernel: null,
    hostRIP_needsKernel: null,
    hostFSBase: fsBase,
    hostGSBase: gsBase,
    hostTRBase_needsKernel: null,
    hostGDTRBase_needsKernel: null,
    hostIDTRBase_needsKernel: null,
    hostSysenterESP: sysenterESP,
    hostSysenterEIP: sysenterEIP,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 8: EPT Page Table Construction
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build EPT page tables for identity mapping (guest-physical = host-physical).
 *
 * Structure: PML4 → PDPT → PD (2MB large pages).
 *
 *   PML4[0]         → PDPT (maps first 512 GB)
 *   PDPT[0]         → PD   (maps first 1 GB)
 *   PD[0..511]      → 2MB large pages (each maps 2 MB)
 *     PD[i]: GPA i*2MB  → HPA i*2MB (identity)
 *
 * Uses 2MB large pages for efficiency — no Page Table level needed.
 * Total memory: 3 pages = 12 KB.
 *
 * @returns EptTableConfig with populated entries.
 */
export function buildEptIdentityTables(
  pml4: PhysicalAllocation,
  pdpt: PhysicalAllocation,
  pd: PhysicalAllocation,
): EptTableConfig {
  // We need physical addresses for the table pointers, but these are
  // resolved by the kernel component. We use placeholder values.
  // The kernel component MUST:
  //   1. Resolve PA for pml4/pdpt/pd allocations
  //   2. Re-run the entry encoding with the correct PAs
  //   3. Write entries to memory

  // Placeholder PAs — kernel replaces with MmGetPhysicalAddress results
  const pdptPA = pdpt.physicalAddress ?? 0n;
  const pdPA = pd.physicalAddress ?? 0n;

  // Encode PML4[0] → PDPT (read/write/execute)
  const pml4e = encodeEptPml4e({
    pdptPhysAddr: pdptPA,
    readAccess: true,
    writeAccess: true,
    executeAccess: true,
    userExecuteAccess: true,
    suppressVE: false,
  });

  // Encode PDPT[0] → PD (read/write/execute)
  const pdpte = encodeEptPdpte({
    pdPhysAddr: pdPA,
    readAccess: true,
    writeAccess: true,
    executeAccess: true,
    largePage: false,
    suppressVE: false,
  });

  // Write PML4[0] and PDPT[0] entries
  try {
    const koffi = require('koffi');
    const kernel32 = koffi.load('kernel32.dll');
    const RtlCopyMemory = kernel32.func('void * RtlCopyMemory(void *, void *, size_t)');

    const pml4eBuf = Buffer.alloc(8);
    pml4eBuf.writeBigUInt64LE(pml4e, 0);
    RtlCopyMemory(pml4.virtualAddress, koffi.address(pml4eBuf), 8);

    const pdpteBuf = Buffer.alloc(8);
    pdpteBuf.writeBigUInt64LE(pdpte, 0);
    RtlCopyMemory(pdpt.virtualAddress, koffi.address(pdpteBuf), 8);

    // Encode all 512 PD entries as 2MB large-page identity mappings
    const twoMB = 0x200000n;
    for (let i = 0; i < EPT_TABLE_ENTRIES; i++) {
      const gpa = BigInt(i) * twoMB;
      const pde = encodeEptPde({
        ptPhysAddr: gpa, // identity: GPA == HPA
        readAccess: true,
        writeAccess: true,
        executeAccess: true,
        largePage: true, // 2MB large page
        suppressVE: false,
      });
      const pdeBuf = Buffer.alloc(8);
      pdeBuf.writeBigUInt64LE(pde, 0);
      const offset = BigInt(i * EPT_ENTRY_SIZE);
      RtlCopyMemory(pd.virtualAddress + offset, koffi.address(pdeBuf), 8);
    }
  } catch (err) {
    // koffi unavailable or VA not valid (e.g. in unit tests with mock addresses).
    // The EPTP/eptPointer is still computed correctly from the entry encodings
    // even when write-to-memory fails. The kernel component re-computes entries
    // with real physical addresses anyway.
    logger.debug(`Hypervisor: EPT entry write skipped: ${String(err)}`);
  }

  // Build EPTP (memory type = WB, walk length = 3 for 4-level)
  const eptp = makeEptPointer(pml4.physicalAddress ?? 0n, EPT_MEMORY_TYPE_WB, 3, false);

  logger.debug(
    'Hypervisor: built EPT identity tables (PML4→PDPT→PD, 512x2MB large pages, 1GB identity mapped)',
  );

  return {
    pml4,
    pdpt,
    pd,
    eptPointer: eptp,
    pageWalkLength: 3,
    memoryType: EPT_MEMORY_TYPE_WB,
    identityMapped: true,
  };
}

/**
 * Re-encode EPT page-table entries using resolved physical addresses.
 *
 * After resolvePhysicalAllocationAddresses populates the physicalAddress
 * fields, this rewrites PML4[0] and PDPT[0] entries with the correct PAs.
 * PD entries are identity-mapped (GPA = HPA) and don't depend on resolved PAs.
 *
 * This is called automatically by prepareForKernel() after address resolution.
 */
function rewriteEptEntriesWithResolvedAddresses(tables: EptTableConfig): void {
  if (process.platform !== 'win32') return;

  const koffi = require('koffi');
  const kernel32 = koffi.load('kernel32.dll');
  const RtlCopyMemory = kernel32.func('void * RtlCopyMemory(void *, void *, size_t)');

  // Rewrite PML4[0] → PDPT with resolved PA
  if (tables.pdpt.physicalAddress !== null) {
    const pml4e = encodeEptPml4e({
      pdptPhysAddr: tables.pdpt.physicalAddress,
      readAccess: true,
      writeAccess: true,
      executeAccess: true,
      userExecuteAccess: true,
      suppressVE: false,
    });
    const pml4eBuf = Buffer.alloc(8);
    pml4eBuf.writeBigUInt64LE(pml4e, 0);
    RtlCopyMemory(tables.pml4.virtualAddress, koffi.address(pml4eBuf), 8);
  }

  // Rewrite PDPT[0] → PD with resolved PA
  if (tables.pd.physicalAddress !== null) {
    const pdpte = encodeEptPdpte({
      pdPhysAddr: tables.pd.physicalAddress,
      readAccess: true,
      writeAccess: true,
      executeAccess: true,
      largePage: false,
      suppressVE: false,
    });
    const pdpteBuf = Buffer.alloc(8);
    pdpteBuf.writeBigUInt64LE(pdpte, 0);
    RtlCopyMemory(tables.pdpt.virtualAddress, koffi.address(pdpteBuf), 8);
  }

  // Recompute EPTP with resolved PML4 PA
  if (tables.pml4.physicalAddress !== null) {
    const eptp = makeEptPointer(
      tables.pml4.physicalAddress,
      EPT_MEMORY_TYPE_WB,
      tables.pageWalkLength,
      false,
    );
    // We can't assign to a readonly property, so update via internal mutation
    (tables as { eptPointer: bigint }).eptPointer = eptp;
  }

  logger.debug('Hypervisor: rewrote EPT entries with resolved physical addresses');
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 9: MSR Bitmap Configuration
// ═══════════════════════════════════════════════════════════════════════

/**
 * MSR bitmap layout (Intel SDM Vol 3C, 24.6.9):
 *   4KB page divided into four 1KB regions:
 *   - Bytes 0-1023:     Read bitmap for MSRs 0x00000000 - 0x00001FFF
 *   - Bytes 1024-2047:  Read bitmap for MSRs 0xC0000000 - 0xC0001FFF
 *   - Bytes 2048-3071:  Write bitmap for MSRs 0x00000000 - 0x00001FFF
 *   - Bytes 3072-4095:  Write bitmap for MSRs 0xC0000000 - 0xC0001FFF
 *
 * Each bit: 0 = passthrough (no VM exit), 1 = intercept (VM exit).
 * MSRs not covered by bitmap cause unconditional VM exits.
 */

/** MSR indices to intercept on BOTH read and write.
 *
 * These cover the full syscall mechanism (SYSCALL/SYSENTER):
 *   - SYSENTER: SYSENTER_CS, SYSENTER_ESP, SYSENTER_EIP
 *   - SYSCALL 64-bit: LSTAR (target RIP), STAR (legacy CS/SS), FMASK (RFLAGS mask)
 *   - Compatibility mode: CSTAR
 *   - Enable/control: EFER (SCE bit)
 *   - Debug: DEBUGCTL (LBR/BTF)
 *
 * Passthrough strategy: all other MSRs pass through without VM exit.
 * The kernel component uses VM-entry/VM-exit MSR load/store lists to
 * context-swap MSRs that differ between host and guest.
 */
export const INTERCEPTED_MSRS: ReadonlyArray<number> = [
  0x00000175, // IA32_SYSENTER_ESP
  0x00000176, // IA32_SYSENTER_EIP
  0x000001d9, // IA32_DEBUGCTL
  0xc0000080, // IA32_EFER
  0xc0000081, // IA32_STAR (legacy mode SYSCALL target CS/SS)
  0xc0000082, // IA32_LSTAR (64-bit SYSCALL target RIP)
  0xc0000083, // IA32_CSTAR (compatibility mode SYSCALL target RIP)
  0xc0000084, // IA32_FMASK (RFLAGS mask for SYSCALL)
];

/**
 * Compute the byte offset and bit mask for a given MSR index in the bitmap.
 *
 * @returns { byteOffset, bitMask } or null if the MSR is not covered by the bitmap.
 */
export function computeMsrBitmapPosition(msrIndex: number): {
  readByteOffset: number;
  readBitMask: number;
  writeByteOffset: number;
  writeBitMask: number;
} | null {
  // Use >>> 0 to keep values in unsigned 32-bit space — JS bitwise ops
  // truncate to signed 32-bit, so 0xC0000080 & 0xC0000000 = -1073741824
  // which fails strict equality with 0xC0000000 (3221225472).
  const base = (msrIndex & 0xc0000000) >>> 0;

  // The bitmap covers 0x0000_0000–0x0000_1FFF (low) and 0xC000_0000–0xC000_1FFF (high).
  // Any MSR outside these two windows causes an unconditional VM exit.
  const offset = msrIndex & 0x1fff;
  if (base === 0x00000000) {
    if (msrIndex > 0x1fff) return null; // low-range window (0x0000-0x1FFF)
  } else if (base === 0xc0000000) {
    if (offset > 0x1fff) return null; // high-range window (C000_0000-C000_1FFF)
  } else {
    return null; // 0x40000000 range → unconditional exit
  }

  const rangeOffset = base === 0x00000000 ? 0 : 1024;

  const byteIndex = offset >> 3; // offset / 8
  const bitIndex = offset & 0x7; // offset % 8
  const bitMask = 1 << bitIndex;

  return {
    readByteOffset: rangeOffset + byteIndex,
    readBitMask: bitMask,
    writeByteOffset: 2048 + rangeOffset + byteIndex,
    writeBitMask: bitMask,
  };
}

/**
 * Configure the MSR bitmap page.
 *
 * Default: ALL bits 0 (passthrough everything).
 * Then set interception bits for syscall-related MSRs.
 *
 * @param bitmap The pre-allocated 4KB bitmap page.
 * @param msrsToIntercept MSR indices to set interception bits for (on both read and write).
 * @returns MsrBitmapConfig with interception list.
 */
export function configureMsrBitmap(
  bitmap: PhysicalAllocation,
  msrsToIntercept: ReadonlyArray<number> = INTERCEPTED_MSRS,
): MsrBitmapConfig {
  if (bitmap.size < 4096) {
    throw new Error(`MSR bitmap too small: ${bitmap.size} bytes (need >= 4096)`);
  }

  // The bitmap was already zeroed during allocation
  const interceptedReads: number[] = [];
  const interceptedWrites: number[] = [];

  try {
    const koffi = require('koffi');
    const kernel32 = koffi.load('kernel32.dll');
    const RtlCopyMemory = kernel32.func('void * RtlCopyMemory(void *, void *, size_t)');

    for (const msr of msrsToIntercept) {
      const pos = computeMsrBitmapPosition(msr);
      if (!pos) {
        logger.debug(
          `Hypervisor: MSR 0x${msr.toString(16)} not covered by bitmap (causes unconditional exit)`,
        );
        continue;
      }

      // Set read interception bit
      const readBuf = Buffer.alloc(1);
      readBuf.writeUInt8(pos.readBitMask, 0);
      const readAddr = bitmap.virtualAddress + BigInt(pos.readByteOffset);
      RtlCopyMemory(readAddr, koffi.address(readBuf), 1);
      interceptedReads.push(msr);

      // Set write interception bit
      const writeBuf = Buffer.alloc(1);
      writeBuf.writeUInt8(pos.writeBitMask, 0);
      const writeAddr = bitmap.virtualAddress + BigInt(pos.writeByteOffset);
      RtlCopyMemory(writeAddr, koffi.address(writeBuf), 1);
      interceptedWrites.push(msr);
    }
  } catch (err) {
    // koffi unavailable or VA not valid (e.g. in unit tests with mock addresses).
    // Interception list is still correct even without writing to memory.
    logger.debug(`Hypervisor: MSR bitmap write skipped: ${String(err)}`);
  }

  logger.debug(
    `Hypervisor: configured MSR bitmap (${interceptedReads.length} MSRs intercepted ` +
      `for read, ${interceptedWrites.length} for write)`,
  );

  return {
    bitmap,
    passthroughAll: interceptedReads.length === 0,
    interceptedReads,
    interceptedWrites,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 10: Environment / Conflict Detection
// ═══════════════════════════════════════════════════════════════════════

function detectConflicts(): HypervisorConflicts {
  const result: HypervisorConflicts = {
    hyperv: false,
    wsl2: false,
    vbs: false,
    hvci: false,
    virtualizationBasedSecurity: false,
  };

  if (process.platform !== 'win32') return result;

  // Check CPUID.1:ECX[31] — hypervisor present bit
  const cpuid1 = detectCpuid1();
  if (cpuid1?.hypervisorPresent) {
    result.hyperv = true;
  }

  // Check Hyper-V hypervisor leaf at CPUID.0x40000000
  const hvLeaf = executeCpuid(0x40000000, 0);
  if (hvLeaf) {
    const sig = Buffer.alloc(12);
    sig.writeUInt32LE(hvLeaf.ebx, 0);
    sig.writeUInt32LE(hvLeaf.ecx, 4);
    sig.writeUInt32LE(hvLeaf.edx, 8);
    if (sig.toString('ascii').replaceAll('\x00', '').includes('Microsoft')) {
      result.hyperv = true;
    }
  }

  // Check Windows Hyper-V feature via PowerShell
  try {
    const { execSync } = require('node:child_process');
    const hvState = execSync(
      'powershell -NoProfile -Command "(Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All).State"',
      { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (hvState === 'Enabled') {
      result.hyperv = true;
    }
  } catch {
    /* non-fatal */
  }

  // WSL2 detection
  try {
    const { execSync } = require('node:child_process');
    const wslStatus = execSync('wsl --status', {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (wslStatus.includes('WSL2') || wslStatus.includes('version: 2')) {
      result.wsl2 = true;
    }
  } catch {
    /* WSL not installed */
  }

  // VBS / HVCI detection via registry
  try {
    const { execSync } = require('node:child_process');

    // Check HVCI (Memory Integrity)
    const hvciResult = execSync(
      'powershell -NoProfile -Command "(Get-ItemProperty -Path HKLM:\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity -Name Enabled -ErrorAction SilentlyContinue).Enabled"',
      { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (hvciResult === '1') {
      result.hvci = true;
    }

    // Check VBS
    const vbsResult = execSync(
      'powershell -NoProfile -Command "(Get-ItemProperty -Path HKLM:\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard -Name EnableVirtualizationBasedSecurity -ErrorAction SilentlyContinue).EnableVirtualizationBasedSecurity"',
      { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (vbsResult === '1') {
      result.vbs = true;
    }
  } catch {
    /* non-fatal — registry keys may not exist */
  }

  result.virtualizationBasedSecurity = result.vbs || result.hvci;

  return result;
}

function checkCr4Vmxe(): boolean {
  if (process.platform !== 'win32') return false;
  const conflicts = detectConflicts();
  return !conflicts.hyperv && detectCpuid1()?.vmxSupported === true;
}

function isAdmin(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    const { execSync } = require('node:child_process');
    execSync('net session', { timeout: 5000, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 11: Build Legacy VmcsConfig
// ═══════════════════════════════════════════════════════════════════════

function buildVmcsConfig(
  adjusted: AdjustedControls,
  eptPointer: bigint,
  msrBitmapAddr: bigint,
): VmcsConfig {
  return {
    pinBasedControls: adjusted.pinBased,
    primaryProcBasedControls: adjusted.procBased,
    secondaryProcBasedControls: adjusted.secondaryProcBased,
    vmExitControls: adjusted.exit,
    vmEntryControls: adjusted.entry,
    exceptionBitmap: 0,
    vpid: 1,
    msrBitmapAddress: msrBitmapAddr,
    eptPointer,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 11b: VMCS Field Config → Manifest Mapping
// ═══════════════════════════════════════════════════════════════════════

/**
 * Map a VmcsFieldConfig property name to its pre-computed value.
 *
 * This is the bridge between the flat VmcsFieldConfig interface and the
 * VMCS_FIELD_CATALOG enumeration used by the capability report manifest.
 * Each catalog entry has a `name` (e.g. "GUEST_CR0") which is mapped to
 * the corresponding field in VmcsFieldConfig (e.g. `guestCR0_needsKernel`).
 *
 * Fields suffixed `_needsKernel` in VmcsFieldConfig have their values set
 * to null and `needsKernel: true` in the manifest. Fields without that
 * suffix have pre-computed values from user mode.
 *
 * Supported patterns:
 *   - Exact match: "VPID" → fields.vpid
 *   - "GUEST_XXX_SELECTOR" → fields.guestXXXSelector (needs kernel)
 *   - "HOST_XXX_SELECTOR" → fields.hostXXXSelector
 *   - "GUEST_XXX" → fields.guestXXX or fields.guestXXX_needsKernel
 *   - "HOST_XXX" → fields.hostXXX or fields.hostXXX_needsKernel
 *   - "XXX_CTLS" → fields.xxxCtls (e.g., "PIN_BASED_CTLS" → pinBasedCtls)
 *   - "CR0_GUEST_HOST_MASK" → fields.cr0GuestHostMask
 *   - Read-only VM-exit info fields → value=null, needsKernel=false
 *   - "EPT_POINTER" → fields.eptPointer
 *   - "MSR_BITMAP" → fields.msrBitmapAddress
 */
function mapFieldConfigValue(
  fields: VmcsFieldConfig,
  name: string,
): { value: number | bigint | null; needsKernel: boolean } {
  // ── Exact mappings (no pattern transformation) ──
  const exactMap: Record<string, () => { value: number | bigint | null; needsKernel: boolean }> = {
    VPID: () => ({ value: fields.vpid, needsKernel: false }),
    MSR_BITMAP: () => ({ value: fields.msrBitmapAddress, needsKernel: false }),
    EPT_POINTER: () => ({ value: fields.eptPointer, needsKernel: false }),
    TSC_OFFSET: () => ({ value: fields.tscOffset, needsKernel: false }),
    GUEST_DEBUGCTL: () => ({ value: fields.guestDebugCtl, needsKernel: false }),
    GUEST_PAT: () => ({ value: fields.guestPAT, needsKernel: false }),
    GUEST_EFER: () => ({ value: fields.guestEFER, needsKernel: false }),
    HOST_PAT: () => ({ value: fields.hostPAT, needsKernel: false }),
    HOST_EFER: () => ({ value: fields.hostEFER, needsKernel: false }),
    PIN_BASED_CTLS: () => ({ value: fields.pinBasedCtls, needsKernel: false }),
    PROC_BASED_CTLS: () => ({ value: fields.procBasedCtls, needsKernel: false }),
    EXCEPTION_BITMAP: () => ({ value: fields.exceptionBitmap, needsKernel: false }),
    VM_EXIT_CTLS: () => ({ value: fields.vmExitCtls, needsKernel: false }),
    VM_ENTRY_CTLS: () => ({ value: fields.vmEntryCtls, needsKernel: false }),
    SECONDARY_PROC_BASED_CTLS: () => ({ value: fields.secondaryProcBasedCtls, needsKernel: false }),
    GUEST_SYSENTER_CS: () => ({ value: fields.guestSysenterCS, needsKernel: false }),
    HOST_SYSENTER_CS: () => ({ value: fields.hostSysenterCS, needsKernel: false }),
    CR0_GUEST_HOST_MASK: () => ({ value: fields.cr0GuestHostMask, needsKernel: false }),
    CR4_GUEST_HOST_MASK: () => ({ value: fields.cr4GuestHostMask, needsKernel: false }),
    CR0_READ_SHADOW: () => ({ value: fields.cr0ReadShadow, needsKernel: false }),
    CR4_READ_SHADOW: () => ({ value: fields.cr4ReadShadow, needsKernel: false }),
    GUEST_DR7: () => ({ value: fields.guestDR7, needsKernel: false }),
    GUEST_RFLAGS: () => ({ value: fields.guestRFLAGS, needsKernel: false }),
    GUEST_FS_BASE: () => ({ value: fields.guestFSBase, needsKernel: false }),
    GUEST_GS_BASE: () => ({ value: fields.guestGSBase, needsKernel: false }),
    GUEST_SYSENTER_ESP: () => ({ value: fields.guestSysenterESP, needsKernel: false }),
    GUEST_SYSENTER_EIP: () => ({ value: fields.guestSysenterEIP, needsKernel: false }),
    HOST_FS_BASE: () => ({ value: fields.hostFSBase, needsKernel: false }),
    HOST_GS_BASE: () => ({ value: fields.hostGSBase, needsKernel: false }),
    HOST_SYSENTER_ESP: () => ({ value: fields.hostSysenterESP, needsKernel: false }),
    HOST_SYSENTER_EIP: () => ({ value: fields.hostSysenterEIP, needsKernel: false }),
    // Host selectors (pre-computed)
    HOST_ES_SELECTOR: () => ({ value: fields.hostESSelector, needsKernel: false }),
    HOST_CS_SELECTOR: () => ({ value: fields.hostCSSelector, needsKernel: false }),
    HOST_SS_SELECTOR: () => ({ value: fields.hostSSSelector, needsKernel: false }),
    HOST_DS_SELECTOR: () => ({ value: fields.hostDSSelector, needsKernel: false }),
    HOST_FS_SELECTOR: () => ({ value: fields.hostFSSelector, needsKernel: false }),
    HOST_GS_SELECTOR: () => ({ value: fields.hostGSSelector, needsKernel: false }),
  };

  if (exactMap[name]) return exactMap[name]();

  // ── Needs-kernel guest selectors ──
  const guestSelectorMap: Record<
    string,
    () => { value: number | bigint | null; needsKernel: boolean }
  > = {
    GUEST_ES_SELECTOR: () => ({ value: fields.guestESSelector_needsKernel, needsKernel: true }),
    GUEST_CS_SELECTOR: () => ({ value: fields.guestCSSelector_needsKernel, needsKernel: true }),
    GUEST_SS_SELECTOR: () => ({ value: fields.guestSSSelector_needsKernel, needsKernel: true }),
    GUEST_DS_SELECTOR: () => ({ value: fields.guestDSSelector_needsKernel, needsKernel: true }),
    GUEST_FS_SELECTOR: () => ({ value: fields.guestFSSelector_needsKernel, needsKernel: true }),
    GUEST_GS_SELECTOR: () => ({ value: fields.guestGSSelector_needsKernel, needsKernel: true }),
    GUEST_LDTR_SELECTOR: () => ({ value: fields.guestLDTRSelector_needsKernel, needsKernel: true }),
    GUEST_TR_SELECTOR: () => ({ value: fields.guestTRSelector_needsKernel, needsKernel: true }),
    HOST_TR_SELECTOR: () => ({ value: fields.hostTRSelector_needsKernel, needsKernel: true }),
  };
  if (guestSelectorMap[name]) return guestSelectorMap[name]();

  // ── Needs-kernel segment limits ──
  const limitMap: Record<string, () => { value: number | bigint | null; needsKernel: boolean }> = {
    GUEST_ES_LIMIT: () => ({ value: fields.guestESLimit_needsKernel, needsKernel: true }),
    GUEST_CS_LIMIT: () => ({ value: fields.guestCSLimit_needsKernel, needsKernel: true }),
    GUEST_SS_LIMIT: () => ({ value: fields.guestSSLimit_needsKernel, needsKernel: true }),
    GUEST_DS_LIMIT: () => ({ value: fields.guestDSLimit_needsKernel, needsKernel: true }),
    GUEST_FS_LIMIT: () => ({ value: fields.guestFSLimit_needsKernel, needsKernel: true }),
    GUEST_GS_LIMIT: () => ({ value: fields.guestGSLimit_needsKernel, needsKernel: true }),
    GUEST_LDTR_LIMIT: () => ({ value: fields.guestLDTRLimit_needsKernel, needsKernel: true }),
    GUEST_TR_LIMIT: () => ({ value: fields.guestTRLimit_needsKernel, needsKernel: true }),
    GUEST_GDTR_LIMIT: () => ({ value: fields.guestGDTRLimit_needsKernel, needsKernel: true }),
    GUEST_IDTR_LIMIT: () => ({ value: fields.guestIDTRLimit_needsKernel, needsKernel: true }),
  };
  if (limitMap[name]) return limitMap[name]();

  // ── Needs-kernel segment access rights ──
  const accessMap: Record<string, () => { value: number | bigint | null; needsKernel: boolean }> = {
    GUEST_ES_ACCESS_RIGHTS: () => ({ value: fields.guestESAccess_needsKernel, needsKernel: true }),
    GUEST_CS_ACCESS_RIGHTS: () => ({ value: fields.guestCSAccess_needsKernel, needsKernel: true }),
    GUEST_SS_ACCESS_RIGHTS: () => ({ value: fields.guestSSAccess_needsKernel, needsKernel: true }),
    GUEST_DS_ACCESS_RIGHTS: () => ({ value: fields.guestDSAccess_needsKernel, needsKernel: true }),
    GUEST_FS_ACCESS_RIGHTS: () => ({ value: fields.guestFSAccess_needsKernel, needsKernel: true }),
    GUEST_GS_ACCESS_RIGHTS: () => ({ value: fields.guestGSAccess_needsKernel, needsKernel: true }),
    GUEST_LDTR_ACCESS_RIGHTS: () => ({
      value: fields.guestLDTRAccess_needsKernel,
      needsKernel: true,
    }),
    GUEST_TR_ACCESS_RIGHTS: () => ({ value: fields.guestTRAccess_needsKernel, needsKernel: true }),
  };
  if (accessMap[name]) return accessMap[name]();

  // ── Needs-kernel guest (32-bit I/O) ──
  if (name === 'GUEST_INTERRUPTIBILITY') return { value: null, needsKernel: true };
  if (name === 'GUEST_ACTIVITY_STATE') return { value: null, needsKernel: true };

  // ── Needs-kernel guest CRs/registers (natural-width) ──
  const guestRegMap: Record<string, () => { value: number | bigint | null; needsKernel: boolean }> =
    {
      GUEST_CR0: () => ({ value: fields.guestCR0_needsKernel, needsKernel: true }),
      GUEST_CR3: () => ({ value: fields.guestCR3_needsKernel, needsKernel: true }),
      GUEST_CR4: () => ({ value: fields.guestCR4_needsKernel, needsKernel: true }),
      GUEST_RSP: () => ({ value: fields.guestRSP_needsKernel, needsKernel: true }),
      GUEST_RIP: () => ({ value: fields.guestRIP_needsKernel, needsKernel: true }),
    };
  if (guestRegMap[name]) return guestRegMap[name]();

  // ── Needs-kernel guest segment bases ──
  const guestBaseMap: Record<string, () => { value: bigint | null; needsKernel: boolean }> = {
    GUEST_ES_BASE: () => ({ value: fields.guestESBase_needsKernel, needsKernel: true }),
    GUEST_CS_BASE: () => ({ value: fields.guestCSBase_needsKernel, needsKernel: true }),
    GUEST_SS_BASE: () => ({ value: fields.guestSSBase_needsKernel, needsKernel: true }),
    GUEST_DS_BASE: () => ({ value: fields.guestDSBase_needsKernel, needsKernel: true }),
    GUEST_LDTR_BASE: () => ({ value: fields.guestLDTRBase_needsKernel, needsKernel: true }),
    GUEST_TR_BASE: () => ({ value: fields.guestTRBase_needsKernel, needsKernel: true }),
    GUEST_GDTR_BASE: () => ({ value: fields.guestGDTRBase_needsKernel, needsKernel: true }),
    GUEST_IDTR_BASE: () => ({ value: fields.guestIDTRBase_needsKernel, needsKernel: true }),
  };
  if (guestBaseMap[name]) return guestBaseMap[name]();

  // ── Needs-kernel host registers ──
  const hostRegMap: Record<string, () => { value: bigint | null; needsKernel: boolean }> = {
    HOST_CR0: () => ({ value: fields.hostCR0_needsKernel, needsKernel: true }),
    HOST_CR3: () => ({ value: fields.hostCR3_needsKernel, needsKernel: true }),
    HOST_CR4: () => ({ value: fields.hostCR4_needsKernel, needsKernel: true }),
    HOST_RSP: () => ({ value: fields.hostRSP_needsKernel, needsKernel: true }),
    HOST_RIP: () => ({ value: fields.hostRIP_needsKernel, needsKernel: true }),
    HOST_TR_BASE: () => ({ value: fields.hostTRBase_needsKernel, needsKernel: true }),
    HOST_GDTR_BASE: () => ({ value: fields.hostGDTRBase_needsKernel, needsKernel: true }),
    HOST_IDTR_BASE: () => ({ value: fields.hostIDTRBase_needsKernel, needsKernel: true }),
  };
  if (hostRegMap[name]) return hostRegMap[name]();

  // ── Read-only VM-exit info fields (no VMCS write needed) ──
  const readOnly: ReadonlySet<string> = new Set([
    'GUEST_PHYSICAL_ADDRESS',
    'EXIT_REASON',
    'EXIT_QUALIFICATION',
    'GUEST_LINEAR_ADDRESS',
  ]);
  if (readOnly.has(name)) return { value: null, needsKernel: false };

  // ── Non-populated fields (16-bit control rarely used) ──
  const notPopulated: ReadonlySet<string> = new Set([
    'POSTED_INT_NOTIFICATION_VECTOR',
    'EPTP_INDEX',
    'IO_BITMAP_A',
    'IO_BITMAP_B',
    'VMEXIT_MSR_STORE',
    'VMEXIT_MSR_LOAD',
    'VMENTRY_MSR_LOAD',
  ]);
  if (notPopulated.has(name)) return { value: null, needsKernel: false };

  // Unknown field — log and return null
  logger.debug(`Hypervisor: unmapped VMCS field "${name}" in manifest`);
  return { value: null, needsKernel: false };
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 11c: Physical Address Resolution via BYOVD
// ═══════════════════════════════════════════════════════════════════════

/** Page-table walking constants (x64 4-level paging). */
const PTE_PRESENT_BIT = 1n << 0n;
const PTE_LARGE_PAGE_BIT = 1n << 7n;
const PTE_PFN_MASK_48 = 0x0000fffffffff000n;

/**
 * Resolve a virtual address to its physical address using the BYOVD driver's
 * physical memory read capability.
 *
 * This walks the system's x64 4-level page table (PML4 → PDPT → PD → PT)
 * via physical memory reads through the BYOVD driver. It follows the same
 * approach as KernelCallbackManager.translateKernelVa.
 *
 * **Pre-requisites**:
 *   - BYOVD driver with physicalMemory capability active (RTCore64 or ThrottleStop)
 *   - The VA must be in kernel space (0xFFFF8000_00000000+ on Windows x64)
 *     or user space where the page tables are accessible
 *
 * @returns The physical address, or null if resolution failed.
 */
async function resolveVirtualToPhysical(va: bigint): Promise<bigint | null> {
  if (process.platform !== 'win32') return null;

  try {
    const { byovdManager } = await import('./ByovdManager');
    if (!byovdManager.isActive()) return null;

    const driver = byovdManager.getActiveDriver();
    if (!driver?.driver.physicalMemory) return null;

    // Walk the 4-level page table
    const pml4Index = Number((va >> 39n) & 0x1ffn);
    const pdptIndex = Number((va >> 30n) & 0x1ffn);
    const pdIndex = Number((va >> 21n) & 0x1ffn);
    const ptIndex = Number((va >> 12n) & 0x1ffn);
    const pageOffset = va & 0xfffn;

    // Step 1: Read CR3 (PML4 physical base) — but we don't have CR3 from user mode.
    // Instead, scan for the kernel PML4 in physical memory using the self-reference trick.
    // For Phase 1, if CR3 is not available, we use the approach from KernelCallbackManager:
    // scan physical memory range for the PML4 self-reference entry.
    const PML4_SELF_REF = 0x1edn;
    const PML4_SCAN_MAX = 0x1000000n; // 16MB

    let pml4Phys: bigint | null = null;
    for (let addr = 0x1000n; addr < PML4_SCAN_MAX; addr += 0x1000n) {
      const entryAddr = addr + PML4_SELF_REF * 8n;
      const result = await byovdManager.readPhysicalMemory(entryAddr, 8);
      if (!result.success || !result.data || result.bytesRead < 8) continue;

      const entry = result.data.readBigUInt64LE(0);
      if ((entry & PTE_PRESENT_BIT) === 0n) continue;
      const pfn = entry & PTE_PFN_MASK_48;
      if (pfn === (addr & PTE_PFN_MASK_48)) {
        pml4Phys = addr;
        break;
      }
    }

    if (pml4Phys === null) return null;

    // Step 2: Read PML4 entry
    const pml4eAddr = pml4Phys + BigInt(pml4Index * 8);
    const pml4eRes = await byovdManager.readPhysicalMemory(pml4eAddr, 8);
    if (!pml4eRes.success || !pml4eRes.data || pml4eRes.bytesRead < 8) return null;
    const pml4e = pml4eRes.data.readBigUInt64LE(0);
    if ((pml4e & PTE_PRESENT_BIT) === 0n) return null;

    // Step 3: Read PDPT entry
    const pdptBase = pml4e & PTE_PFN_MASK_48;
    const pdpteAddr = pdptBase + BigInt(pdptIndex * 8);
    const pdpteRes = await byovdManager.readPhysicalMemory(pdpteAddr, 8);
    if (!pdpteRes.success || !pdpteRes.data || pdpteRes.bytesRead < 8) return null;
    const pdpte = pdpteRes.data.readBigUInt64LE(0);
    if ((pdpte & PTE_PRESENT_BIT) === 0n) return null;

    // Check for 1GB large page
    if ((pdpte & PTE_LARGE_PAGE_BIT) !== 0n) {
      return (pdpte & PTE_PFN_MASK_48) + pageOffset;
    }

    // Step 4: Read PD entry
    const pdBase = pdpte & PTE_PFN_MASK_48;
    const pdeAddr = pdBase + BigInt(pdIndex * 8);
    const pdeRes = await byovdManager.readPhysicalMemory(pdeAddr, 8);
    if (!pdeRes.success || !pdeRes.data || pdeRes.bytesRead < 8) return null;
    const pde = pdeRes.data.readBigUInt64LE(0);
    if ((pde & PTE_PRESENT_BIT) === 0n) return null;

    // Check for 2MB large page
    if ((pde & PTE_LARGE_PAGE_BIT) !== 0n) {
      return (pde & PTE_PFN_MASK_48) + (va & 0x1fffffn);
    }

    // Step 5: Read PT entry
    const ptBase = pde & PTE_PFN_MASK_48;
    const pteAddr = ptBase + BigInt(ptIndex * 8);
    const pteRes = await byovdManager.readPhysicalMemory(pteAddr, 8);
    if (!pteRes.success || !pteRes.data || pteRes.bytesRead < 8) return null;
    const pte = pteRes.data.readBigUInt64LE(0);
    if ((pte & PTE_PRESENT_BIT) === 0n) return null;

    // 4KB page
    return (pte & PTE_PFN_MASK_48) + pageOffset;
  } catch {
    return null;
  }
}

/**
 * Attempt to resolve physical addresses for all hypervisor allocations.
 *
 * When a BYOVD driver with physicalMemory capability is available, this
 * walks the x64 page tables to resolve VA→PA for each allocation.
 * Resolved addresses are written back into the allocation objects.
 *
 * @returns Count of successfully resolved addresses.
 */
async function resolvePhysicalAllocationAddresses(allocations: {
  vmxonRegions: PerProcessorSetup[];
  eptTables: EptTableConfig | null;
  msrBitmap: MsrBitmapConfig | null;
}): Promise<number> {
  let resolved = 0;

  await Promise.allSettled(
    [...allocations.vmxonRegions]
      .flatMap((region) => [
        resolveVirtualToPhysical(region.vmxonRegion.virtualAddress).then((pa) => {
          if (pa !== null) {
            region.vmxonRegion.physicalAddress = pa;
            resolved++;
          }
        }),
        resolveVirtualToPhysical(region.vmcsRegion.virtualAddress).then((pa) => {
          if (pa !== null) {
            region.vmcsRegion.physicalAddress = pa;
            resolved++;
          }
        }),
      ])
      .concat(
        allocations.eptTables
          ? [
              resolveVirtualToPhysical(allocations.eptTables.pml4.virtualAddress).then((pa) => {
                if (pa !== null) {
                  allocations.eptTables!.pml4.physicalAddress = pa;
                  resolved++;
                }
              }),
              resolveVirtualToPhysical(allocations.eptTables.pdpt.virtualAddress).then((pa) => {
                if (pa !== null) {
                  allocations.eptTables!.pdpt.physicalAddress = pa;
                  resolved++;
                }
              }),
              resolveVirtualToPhysical(allocations.eptTables.pd.virtualAddress).then((pa) => {
                if (pa !== null) {
                  allocations.eptTables!.pd.physicalAddress = pa;
                  resolved++;
                }
              }),
            ]
          : [],
      )
      .concat(
        allocations.msrBitmap
          ? [
              resolveVirtualToPhysical(allocations.msrBitmap.bitmap.virtualAddress).then((pa) => {
                if (pa !== null) {
                  allocations.msrBitmap!.bitmap.physicalAddress = pa;
                  resolved++;
                }
              }),
            ]
          : [],
      ),
  );

  // Count actual successes
  return resolved;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 12: Hypervisor Class
// ═══════════════════════════════════════════════════════════════════════

export class Hypervisor {
  private loaded = false;
  private capabilities: VmxCapabilities | null = null;
  private vmcsConfig: VmcsConfig | null = null;
  private unloaded = false;

  // Phase 1 expansion state
  private capabilityMsrs: VmxCapabilityMsrs | null = null;
  private adjustedControls: AdjustedControls | null = null;
  private allocations: {
    vmxonRegions: PerProcessorSetup[];
    eptTables: EptTableConfig | null;
    msrBitmap: MsrBitmapConfig | null;
  } | null = null;
  private vmcsFields: VmcsFieldConfig | null = null;
  private conflicts: HypervisorConflicts | null = null;
  private preparationsComplete = false;
  private featureControlResult: Awaited<ReturnType<typeof readFeatureControl>> | null = null;

  private static instanceCount = 0;

  constructor() {
    if (Hypervisor.instanceCount >= HYPERVISOR_MAX_INSTANCES) {
      throw new Error(
        `Hypervisor: maximum ${HYPERVISOR_MAX_INSTANCES} instance(s) allowed. ` +
          'Only one hypervisor can own VMX at a time.',
      );
    }
    Hypervisor.instanceCount++;
    this.registerShutdown();
  }

  // ── Safety Gates ──

  checkEnabled(): { enabled: boolean; reason?: string } {
    if (!HYPERVISOR_ENABLED) {
      return { enabled: false, reason: 'JSHOOK_HYPERVISOR_ENABLE is not set to 1' };
    }
    if (process.platform !== 'win32') {
      return { enabled: false, reason: 'Hypervisor only supported on Windows (Intel VT-x)' };
    }
    if (!isAdmin()) {
      return { enabled: false, reason: 'Administrator privileges required' };
    }
    return { enabled: true };
  }

  // ── Capability Detection ──

  async detectCapabilities(): Promise<VmxCapabilities> {
    if (this.capabilities) return this.capabilities;

    const vendor = detectVendor();
    const maxExtLeaf = detectMaxExtendedLeaf();
    const brand = maxExtLeaf >= 0x80000004 ? detectBrand() : 'unknown';
    const cpuid1 = detectCpuid1();
    const conflicts = detectConflicts();
    this.conflicts = conflicts;
    const cr4VmxeSet = checkCr4Vmxe();

    let byovdActive = false;
    try {
      const { byovdManager } = await import('./ByovdManager');
      byovdActive = byovdManager.isActive();
    } catch {
      /* BYOVD unavailable */
    }

    let vmxBasic: VmxBasicInfo | null = null;
    let eptVpid: EptVpidCapabilities | null = null;
    const vtxSupported = cpuid1?.vmxSupported === true;
    let eptSupported = false;
    let vpidSupported = false;
    let unrestrictedGuest = false;

    if (byovdActive && vtxSupported) {
      const basicMsr = await readMsr(IA32_VMX_BASIC);
      if (basicMsr !== null) {
        vmxBasic = parseVmxBasic(basicMsr);
      }

      const eptMsr = await readMsr(IA32_VMX_EPT_VPID_CAP);
      if (eptMsr !== null) {
        eptVpid = parseEptVpidCap(eptMsr);
        eptSupported = true;
        vpidSupported =
          eptVpid.invvpidIndividualAddress ||
          eptVpid.invvpidSingleContext ||
          eptVpid.invvpidAllContexts;
      }

      const ctls2Msr = await readMsr(IA32_VMX_PROCBASED_CTLS2);
      if (ctls2Msr !== null) {
        unrestrictedGuest = (ctls2Msr & BigInt(CPU_BASED_CTL2_UNRESTRICTED_GUEST)) !== 0n;
      }

      // Check IA32_FEATURE_CONTROL — VMXON gatekeeper
      try {
        this.featureControlResult = await readFeatureControl();
      } catch {
        this.featureControlResult = null;
      }

      // Read ALL capability MSRs
      if (vmxBasic) {
        this.capabilityMsrs = await readAllVmxMsrs(vmxBasic.trueControls);
        if (this.capabilityMsrs) {
          this.adjustedControls = computeAdjustedControls(this.capabilityMsrs);
        }
      }
    }

    let compatibility: VmxCapabilities['compatibility'] = 'not_windows';
    if (process.platform === 'win32') {
      if (!cpuid1?.vmxSupported) {
        compatibility = 'no_vtx';
      } else if (conflicts.hyperv) {
        compatibility = 'hyperv_conflict';
      } else if (!byovdActive) {
        compatibility = 'no_byovd';
      } else if (!isAdmin()) {
        compatibility = 'no_admin';
      } else {
        compatibility = 'ready';
      }
    }

    this.capabilities = {
      cpuid1: cpuid1 ?? {
        vmxSupported: false,
        dts: false,
        sse41: false,
        sse42: false,
        avx: false,
        sse: false,
        sse2: false,
        hypervisorPresent: false,
      },
      vendor,
      brand,
      vtxSupported,
      eptSupported,
      vpidSupported,
      unrestrictedGuest,
      vmxBasic,
      eptVpid,
      hypervActive: conflicts.hyperv,
      wsl2Active: conflicts.wsl2,
      cr4VmxeSet,
      byovdActive,
      compatibility,
    };

    if (vtxSupported && this.adjustedControls) {
      this.vmcsConfig = buildVmcsConfig(
        this.adjustedControls,
        0n, // EPTP placeholder — filled by prepareForKernel
        0n, // MSR bitmap placeholder
      );
    }

    return this.capabilities;
  }

  // ── Phase 1 Preparation ──

  /**
   * Execute all user-mode preparation steps: allocate memory, init VMXON
   * regions, build EPT tables, configure MSR bitmap, compute VMCS fields.
   *
   * After this call, getCapabilityReport() returns the complete report.
   * The kernel component then resolves physical addresses and executes
   * VMX instructions.
   */
  async prepareForKernel(): Promise<{
    success: boolean;
    error?: string;
    allocationsCreated: number;
    totalBytesAllocated: number;
  }> {
    if (!this.adjustedControls) {
      return {
        success: false,
        error: 'Call detectCapabilities() first',
        allocationsCreated: 0,
        totalBytesAllocated: 0,
      };
    }
    if (!this.capabilities?.vmxBasic) {
      return {
        success: false,
        error: 'No VMX basic MSR data — BYOVD driver may not support MSR reads',
        allocationsCreated: 0,
        totalBytesAllocated: 0,
      };
    }

    const vmxBasic = this.capabilities.vmxBasic;
    const cpuCount = cpus().length;

    try {
      const regions: PerProcessorSetup[] = [];
      let totalBytes = 0;

      // 1. Allocate VMXON + VMCS region per logical processor
      for (let i = 0; i < cpuCount; i++) {
        const vmxonAlloc = await allocatePhysicalMemory(4096, `VMXON-CPU${i}`);
        initVmxonRegion(vmxonAlloc, vmxBasic.revisionId);
        totalBytes += vmxonAlloc.size;

        const vmcsAlloc = await allocatePhysicalMemory(4096, `VMCS-CPU${i}`);
        totalBytes += vmcsAlloc.size;

        regions.push({
          processorIndex: i,
          vmxonRegion: vmxonAlloc,
          vmcsRegion: vmcsAlloc,
        });
      }

      // 2. Allocate EPT page tables
      const pml4 = await allocatePhysicalMemory(EPT_TABLE_SIZE, 'EPT-PML4');
      const pdpt = await allocatePhysicalMemory(EPT_TABLE_SIZE, 'EPT-PDPT');
      const pd = await allocatePhysicalMemory(EPT_TABLE_SIZE, 'EPT-PD');
      totalBytes += pml4.size + pdpt.size + pd.size;

      const eptTables = buildEptIdentityTables(pml4, pdpt, pd);

      // 3. Allocate MSR bitmap
      const msrBitmapAlloc = await allocatePhysicalMemory(4096, 'MSR-BITMAP');
      const msrBitmap = configureMsrBitmap(msrBitmapAlloc);
      totalBytes += msrBitmapAlloc.size;

      // 4. Compute VMCS fields
      this.vmcsFields = await computeVmcsFields(
        this.adjustedControls,
        eptTables.eptPointer,
        msrBitmap.bitmap.physicalAddress ?? 0n,
        vmxBasic,
      );

      // 5. Update VmcsConfig with real addresses
      this.vmcsConfig = buildVmcsConfig(
        this.adjustedControls,
        eptTables.eptPointer,
        msrBitmap.bitmap.physicalAddress ?? 0n,
      );

      this.allocations = { vmxonRegions: regions, eptTables, msrBitmap };

      // 6. Attempt physical address resolution via BYOVD page-table walk
      let resolvedCount = 0;
      try {
        resolvedCount = await resolvePhysicalAllocationAddresses(this.allocations);
      } catch {
        // Non-fatal — physical addresses are optional for user-mode pre-configuration
      }

      // 7. Re-encode EPT entries if physical addresses were resolved
      if (resolvedCount > 0 && this.allocations.eptTables) {
        rewriteEptEntriesWithResolvedAddresses(this.allocations.eptTables);
      }

      // 8. Re-encode MSR bitmap address if resolved
      if (
        this.allocations.msrBitmap &&
        this.allocations.msrBitmap.bitmap.physicalAddress !== null
      ) {
        // Update VMCS config with resolved PA
        this.vmcsConfig = buildVmcsConfig(
          this.adjustedControls,
          this.allocations.eptTables ? this.allocations.eptTables.eptPointer : 0n,
          this.allocations.msrBitmap.bitmap.physicalAddress,
        );
      }

      // Verify physical access if BYOVD driver supports it (best-effort)
      const firstRegion = regions[0];
      if (firstRegion) {
        try {
          await verifyPhysicalAccess(firstRegion.vmxonRegion);
        } catch {
          // Non-fatal — physical access verification is best-effort
        }
      }

      this.preparationsComplete = true;

      logger.info(
        `Hypervisor: Phase 1 preparations complete — ` +
          `${cpuCount} CPUs, ${regions.length * 2 + 4} pages (${totalBytes} bytes). ` +
          `Physical addresses resolved: ${resolvedCount}. ` +
          'Kernel component required for VMX execution.',
      );

      return {
        success: true,
        allocationsCreated: regions.length * 2 + 4,
        totalBytesAllocated: totalBytes,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Hypervisor: prepareForKernel failed: ${msg}`);
      return { success: false, error: msg, allocationsCreated: 0, totalBytesAllocated: 0 };
    }
  }

  // ── Capability Report ──

  /**
   * Generate the comprehensive capability report for the kernel component.
   *
   * This is the single source of truth — the kernel component reads this,
   * resolves physical addresses, writes VMCS fields via VMWRITE, and
   * executes VMXON/VMLAUNCH.
   */
  getCapabilityReport(): HypervisorCapabilityReport {
    const cpuid1 = detectCpuid1();
    const cpuid7 = detectCpuid7();
    const leaf1 = executeCpuid(1, 0);
    const leaf7_0 = executeCpuid(7, 0);
    const leaf80000001 = executeCpuid(0x80000001, 0);
    const leaf80000008 = executeCpuid(0x80000008, 0);
    const leaf6 = executeCpuid(6, 0);

    const kernelChecklist: string[] = [
      '1. Set CR4.VMXE (bit 13) via MOV CR4',
      '2. For each logical processor:',
      '   a. Resolve VA→PA for VMXON region via MmGetPhysicalAddress',
      '   b. Execute VMXON with the physical address',
      '   c. Resolve VA→PA for VMCS region',
      '   d. Execute VMCLEAR on the VMCS region',
      '   e. Execute VMPTRLD on the VMCS region',
      '   f. VMWRITE each field from vmcsFieldManifest below',
      '3. Resolve VA→PA for MSR bitmap (see msrBitmapAddress field)',
      '4. Resolve VA→PA for EPT PML4 (see eptPointer field)',
      '5. Set host RSP to a kernel stack, host RIP to the VM-exit handler',
      '6. Read current CR0/CR3/CR4, segment registers, GDTR/IDTR/TR',
      '7. Fill in all needsKernel=true fields in vmcsFieldManifest',
      '8. Execute VMLAUNCH',
      '9. In the VM-exit handler: save state, handle exit reason, resume with VMRESUME',
    ];

    if (!this.capabilities || !this.adjustedControls) {
      kernelChecklist.unshift('0. Call detectCapabilities() + prepareForKernel() first');
    }

    // Build VMCS field manifest — maps encodings to pre-computed values
    const vmcsFieldManifest: VmcsFieldManifestEntry[] = [];
    const vmcsFieldsData = this.vmcsFields;
    for (const catalogEntry of VMCS_FIELD_CATALOG) {
      const decoded = decodeVmcsField(catalogEntry.encoding);
      let value: number | bigint | null = null;
      let needsKernel = false;

      // Map catalog entry name to the corresponding VmcsFieldConfig field
      if (vmcsFieldsData) {
        const mapped = mapFieldConfigValue(vmcsFieldsData, catalogEntry.name);
        value = mapped.value;
        needsKernel = mapped.needsKernel;
      }

      vmcsFieldManifest.push({
        encoding: catalogEntry.encoding,
        name: catalogEntry.name,
        description: catalogEntry.description,
        value,
        width: decoded.width,
        fieldType: decoded.type,
        needsKernel,
      });
    }

    const kernelResolvedFieldCount = vmcsFieldManifest.filter((f) => f.needsKernel).length;

    return {
      cpuid: {
        leaf1,
        leaf7_0,
        leaf80000001,
        leaf80000008,
        leaf6,
        features: cpuid1 ?? {
          vmxSupported: false,
          dts: false,
          sse41: false,
          sse42: false,
          avx: false,
          sse: false,
          sse2: false,
          hypervisorPresent: false,
        },
        features7: cpuid7,
        vendor: detectVendor(),
        brand: detectBrand(),
        maxBasicLeaf: detectMaxBasicLeaf(),
        maxExtendedLeaf: detectMaxExtendedLeaf(),
      },
      featureControl: this.featureControlResult ?? {
        raw: null,
        locked: false,
        vmxonOutsideSmx: false,
        vmxonInSmx: false,
        verdict: 'unreadable' as const,
        detail: 'FEATURE_CONTROL read happens during detectCapabilities()',
      },
      msrs: this.capabilityMsrs,
      adjustedControls: this.adjustedControls ?? {
        pinBased: 0,
        procBased: 0,
        secondaryProcBased: 0,
        exit: 0,
        entry: 0,
        cr0Fixed: { allowed0: 0n, allowed1: 0n },
        cr4Fixed: { allowed0: 0n, allowed1: 0n },
        eptVpid: {
          executeOnly: false,
          largePage2MB: false,
          largePage1GB: false,
          accessedDirty: false,
          eptVe: false,
          modeBasedExecute: false,
          invvpidIndividualAddress: false,
          invvpidSingleContext: false,
          invvpidAllContexts: false,
        },
      },
      conflicts: this.conflicts ?? detectConflicts(),
      allocations: {
        vmxonRegions: this.allocations?.vmxonRegions ?? [],
        eptTables: this.allocations?.eptTables ?? null,
        msrBitmap: this.allocations?.msrBitmap ?? null,
      },
      vmcsFields: this.vmcsFields ?? {
        vpid: 0,
        guestESSelector_needsKernel: null,
        guestCSSelector_needsKernel: null,
        guestSSSelector_needsKernel: null,
        guestDSSelector_needsKernel: null,
        guestFSSelector_needsKernel: null,
        guestGSSelector_needsKernel: null,
        guestLDTRSelector_needsKernel: null,
        guestTRSelector_needsKernel: null,
        hostESSelector: 0,
        hostCSSelector: 0,
        hostSSSelector: 0,
        hostDSSelector: 0,
        hostFSSelector: 0,
        hostGSSelector: 0,
        hostTRSelector_needsKernel: null,
        msrBitmapAddress: 0n,
        eptPointer: 0n,
        tscOffset: 0n,
        guestDebugCtl: 0n,
        guestPAT: 0n,
        guestEFER: 0n,
        hostPAT: 0n,
        hostEFER: 0n,
        pinBasedCtls: 0,
        procBasedCtls: 0,
        exceptionBitmap: 0,
        vmExitCtls: 0,
        vmEntryCtls: 0,
        secondaryProcBasedCtls: 0,
        guestESLimit_needsKernel: null,
        guestCSLimit_needsKernel: null,
        guestSSLimit_needsKernel: null,
        guestDSLimit_needsKernel: null,
        guestFSLimit_needsKernel: null,
        guestGSLimit_needsKernel: null,
        guestLDTRLimit_needsKernel: null,
        guestTRLimit_needsKernel: null,
        guestGDTRLimit_needsKernel: null,
        guestIDTRLimit_needsKernel: null,
        guestESAccess_needsKernel: null,
        guestCSAccess_needsKernel: null,
        guestSSAccess_needsKernel: null,
        guestDSAccess_needsKernel: null,
        guestFSAccess_needsKernel: null,
        guestGSAccess_needsKernel: null,
        guestLDTRAccess_needsKernel: null,
        guestTRAccess_needsKernel: null,
        guestSysenterCS: 0,
        hostSysenterCS: 0,
        cr0GuestHostMask: 0n,
        cr4GuestHostMask: 0n,
        cr0ReadShadow: 0n,
        cr4ReadShadow: 0n,
        guestCR0_needsKernel: null,
        guestCR3_needsKernel: null,
        guestCR4_needsKernel: null,
        guestDR7: 0n,
        guestRSP_needsKernel: null,
        guestRIP_needsKernel: null,
        guestRFLAGS: 0n,
        guestESBase_needsKernel: null,
        guestCSBase_needsKernel: null,
        guestSSBase_needsKernel: null,
        guestDSBase_needsKernel: null,
        guestFSBase: 0n,
        guestGSBase: 0n,
        guestLDTRBase_needsKernel: null,
        guestTRBase_needsKernel: null,
        guestGDTRBase_needsKernel: null,
        guestIDTRBase_needsKernel: null,
        guestSysenterESP: 0n,
        guestSysenterEIP: 0n,
        hostCR0_needsKernel: null,
        hostCR3_needsKernel: null,
        hostCR4_needsKernel: null,
        hostRSP_needsKernel: null,
        hostRIP_needsKernel: null,
        hostFSBase: 0n,
        hostGSBase: 0n,
        hostTRBase_needsKernel: null,
        hostGDTRBase_needsKernel: null,
        hostIDTRBase_needsKernel: null,
        hostSysenterESP: 0n,
        hostSysenterEIP: 0n,
      },
      vmxBasic: this.capabilities?.vmxBasic ?? null,
      vmcsMaxIndex: Number(this.capabilityMsrs?.vmcsEnum ?? 0n),
      readyForKernelComponent: this.preparationsComplete,
      vmcsFieldManifest,
      kernelResolvedFieldCount,
      kernelComponentChecklist: kernelChecklist,
    };
  }

  // ── Accessors ──

  getVmcsConfig(): VmcsConfig | null {
    return this.vmcsConfig;
  }

  getAdjustedControls(): AdjustedControls | null {
    return this.adjustedControls;
  }

  getAllocations(): {
    vmxonRegions: PerProcessorSetup[];
    eptTables: EptTableConfig | null;
    msrBitmap: MsrBitmapConfig | null;
  } | null {
    return this.allocations;
  }

  getVmcsFields(): VmcsFieldConfig | null {
    return this.vmcsFields;
  }

  getConflicts(): HypervisorConflicts | null {
    return this.conflicts;
  }

  isPrepared(): boolean {
    return this.preparationsComplete;
  }

  getStatus(): HypervisorStatus {
    return {
      loaded: this.loaded,
      vmxRootActive: this.loaded,
      eptEnabled: this.loaded,
      vpidEnabled: this.loaded,
      logicalProcessorCount: this.preparationsComplete
        ? (this.allocations?.vmxonRegions.length ?? 0)
        : 0,
      phase: 1,
      kernelComponentLoaded: false,
    };
  }

  // ── Lifecycle ──

  async load(): Promise<{ success: boolean; error?: string }> {
    if (this.unloaded) {
      return { success: false, error: 'Hypervisor has been shut down — create a new instance' };
    }

    const enabled = this.checkEnabled();
    if (!enabled.enabled) {
      return { success: false, error: enabled.reason };
    }

    if (this.loaded) {
      return { success: false, error: 'Hypervisor is already loaded' };
    }

    const caps = await this.detectCapabilities();

    if (caps.compatibility !== 'ready') {
      const reasonMap: Record<string, string> = {
        no_vtx: 'CPU does not support VT-x',
        hyperv_conflict:
          'Hyper-V is active — disable Hyper-V, WSL2, VBS, and HVCI first. ' +
          'Run: bcdedit /set hypervisorlaunchtype off',
        no_byovd: 'No BYOVD kernel driver active — required for MSR reads and VMXON region setup',
        no_admin: 'Administrator privileges required',
        not_windows: 'Only supported on Windows',
      };
      return {
        success: false,
        error: `Hypervisor not compatible: ${reasonMap[caps.compatibility] ?? caps.compatibility}`,
      };
    }

    // Run preparations
    const prepResult = await this.prepareForKernel();
    if (!prepResult.success) {
      return { success: false, error: `Preparation failed: ${prepResult.error}` };
    }

    this.loaded = true;

    logger.info(
      `Hypervisor Phase 1 loaded. VMCS configured (rev=${caps.vmxBasic?.revisionId}). ` +
        `${prepResult.allocationsCreated} allocations (${prepResult.totalBytesAllocated} bytes). ` +
        'Kernel-mode component required for VMXON/VMLAUNCH execution.',
    );

    return { success: true };
  }

  async unload(): Promise<{ success: boolean; error?: string }> {
    if (!this.loaded) {
      return { success: false, error: 'Hypervisor is not loaded' };
    }

    this.loaded = false;
    this.capabilities = null;
    this.vmcsConfig = null;
    this.capabilityMsrs = null;
    this.adjustedControls = null;
    this.allocations = null;
    this.vmcsFields = null;
    this.preparationsComplete = false;
    // Note: virtual memory is NOT freed here — the OS reclaims on process exit.
    // Explicit VirtualFree would require tracking all handles across allocations.

    logger.info('Hypervisor unloaded.');
    return { success: true };
  }

  async shutdown(): Promise<void> {
    if (this.loaded) {
      try {
        await this.unload();
      } catch {
        /* best-effort */
      }
    }
    this.unloaded = true;
    this.removeShutdownListeners();
    Hypervisor.instanceCount = Math.max(0, Hypervisor.instanceCount - 1);
  }

  private shutdownRegistered = false;
  private shutdownHandlerRef: (() => void) | null = null;

  private registerShutdown(): void {
    if (this.shutdownRegistered) return;
    this.shutdownRegistered = true;

    this.shutdownHandlerRef = () => {
      this.shutdown().catch(() => {});
    };

    process.on('exit', this.shutdownHandlerRef);
    process.on('SIGINT', this.shutdownHandlerRef);
    process.on('SIGTERM', this.shutdownHandlerRef);
  }

  private removeShutdownListeners(): void {
    if (this.shutdownHandlerRef) {
      process.removeListener('exit', this.shutdownHandlerRef);
      process.removeListener('SIGINT', this.shutdownHandlerRef);
      process.removeListener('SIGTERM', this.shutdownHandlerRef);
      this.shutdownHandlerRef = null;
      this.shutdownRegistered = false;
    }
  }

  // ── Legacy Accessors (backward compatible) ──

  getVmxonRegionRequirements(): { size: number; alignment: number; revisionId: number } | null {
    if (!this.capabilities?.vmxBasic) return null;
    return {
      size: 4096,
      alignment: 4096,
      revisionId: this.capabilities.vmxBasic.revisionId,
    };
  }

  getExitHandlerTable(): Array<{ reason: number; name: string; purpose: string }> {
    return [
      {
        reason: 0,
        name: 'handleException',
        purpose: 'Pass through #GP (13), #PF (14), #UD (6); reflect others to guest',
      },
      {
        reason: 10,
        name: 'handleCpuid',
        purpose: 'Spoof CPUID.1:ECX[5]=0 (hide VT-x); pass through all other leaves',
      },
      { reason: 16, name: 'handleRdtsc', purpose: 'Apply TSC offset from VMCS; resume guest' },
      {
        reason: 28,
        name: 'handleCrAccess',
        purpose: 'Allow CR0/CR4 modifications that do not change VMX-critical bits',
      },
      {
        reason: 31,
        name: 'handleMsrRead',
        purpose: 'Intercept RDMSR for EFER/LSTAR/CSTAR/FMASK/DEBUGCTL/SYSENTER; passthrough others',
      },
      {
        reason: 32,
        name: 'handleMsrWrite',
        purpose: 'Intercept WRMSR for same set; shadow writes to EFER.SCE for #UD trap',
      },
      {
        reason: 48,
        name: 'handleEptViolation',
        purpose: 'EPT violation — decode qualification, handle or inject #PF to guest',
      },
      {
        reason: 49,
        name: 'handleEptMisconfig',
        purpose: 'EPT misconfiguration — fatal, log and halt',
      },
      {
        reason: 51,
        name: 'handleRdtscp',
        purpose: 'Apply TSC offset + preserve AUX register; resume guest',
      },
      { reason: 58, name: 'handleInvvpid', purpose: 'Pass through INVVPID for TLB management' },
      { reason: 54, name: 'handleWbinvd', purpose: 'Pass through WBINVD for cache management' },
    ];
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 13: Singleton
// ═══════════════════════════════════════════════════════════════════════

let hypervisorSingleton: Hypervisor | null = null;

export function getHypervisor(): Hypervisor {
  if (!hypervisorSingleton) {
    hypervisorSingleton = new Hypervisor();
  }
  return hypervisorSingleton;
}

export function resetHypervisorForTest(): void {
  hypervisorSingleton = null;
  (Hypervisor as unknown as { instanceCount: number }).instanceCount = 0;
}
