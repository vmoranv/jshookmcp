/**
 * EPT Hypervisor type definitions — Phase 1 (comprehensive user-mode pre-configuration).
 *
 * Describes VT-x capability detection, physical memory allocation tracking,
 * VMCS field configuration, EPT page table structures, MSR bitmap layout,
 * and the comprehensive capability report consumed by the kernel component.
 *
 * ## Boundary
 * All detection and data-structure preparation is done from user mode via
 * CPUID + MSR reads (through BYOVD).  Actual VMX instruction execution
 * (VMXON, VMWRITE, VMLAUNCH, VMRESUME) requires a kernel-mode component.
 *
 * Fields marked `_needsKernel` MUST be resolved by the kernel component
 * before writing to VMCS.  All other fields are computed deterministically
 * from MSR capabilities.
 *
 * @module byovd/Hypervisor.types
 */

// ── CPUID ──

/** Result of CPUID.1 feature bits relevant to VT-x. */
export interface Cpuid1Features {
  /** CPUID.1:ECX[5] — VMX (Virtual Machine Extensions) supported. */
  vmxSupported: boolean;
  /** CPUID.1:ECX[6] — Debug Store (DTS). */
  dts: boolean;
  /** CPUID.1:ECX[19] — SSE4.1. */
  sse41: boolean;
  /** CPUID.1:ECX[20] — SSE4.2. */
  sse42: boolean;
  /** CPUID.1:ECX[28] — AVX. */
  avx: boolean;
  /** CPUID.1:ECX[31] — Hypervisor present. */
  hypervisorPresent: boolean;
  /** CPUID.1:EDX[25] — SSE. */
  sse: boolean;
  /** CPUID.1:EDX[26] — SSE2. */
  sse2: boolean;
}

/** Extended feature bits from CPUID.7.0. */
export interface Cpuid7Features {
  /** EBX[7] — SMEP (Supervisor Mode Execution Protection). */
  smep: boolean;
  /** EBX[20] — SMAP (Supervisor Mode Access Prevention). */
  smap: boolean;
  /** EBX[5] — VMX is still reported via CPUID.1, but extended features here. */
  avx2: boolean;
  /** EBX[16] — AVX-512F. */
  avx512f: boolean;
}

/** Raw CPUID leaf values returned by CPUID instruction. */
export interface CpuidLeaf {
  eax: number;
  ebx: number;
  ecx: number;
  edx: number;
}

// ── Physical Memory Allocation ──

/**
 * Tracks a physically-contiguous page allocation.
 *
 * `physicalAddress` is null when the VA→PA translation requires the kernel
 * component (MmGetPhysicalAddress).  The VA is always known and the
 * buffer is pre-configured at that address.
 */
export interface PhysicalAllocation {
  /** Virtual address (user-mode pointer). */
  virtualAddress: bigint;
  /** Physical address — null pending kernel resolution. */
  physicalAddress: bigint | null;
  /** Allocation size in bytes (page-aligned). */
  size: number;
  /** Human-readable purpose tag (e.g. "VMXON-CPU0", "MSR-BITMAP"). */
  purpose: string;
}

/** Per-logical-processor VMX setup bundle. */
export interface PerProcessorSetup {
  /** Zero-based logical processor index. */
  processorIndex: number;
  /** VMXON region for this processor. */
  vmxonRegion: PhysicalAllocation;
  /** VMCS region for this processor. */
  vmcsRegion: PhysicalAllocation;
}

// ── MSR Capability Types ──

/** A VMX capability MSR pair: allowed 0-settings (high 32) + allowed 1-settings (low 32). */
export interface MsrCapabilityPair {
  /** Raw 64-bit MSR value. */
  raw: bigint;
  /** Bits that CAN be 0 (high 32 bits of MSR). */
  allowed0Settings: number;
  /** Bits that CAN be 1 (low 32 bits of MSR). */
  allowed1Settings: number;
}

/** All VT-x capability MSR values read via BYOVD. */
export interface VmxCapabilityMsrs {
  /** IA32_VMX_BASIC (0x480). */
  basic: bigint;
  /** IA32_VMX_PINBASED_CTLS (0x481) or TRUE (0x48D). */
  pinBasedCtls: MsrCapabilityPair;
  /** IA32_VMX_PROCBASED_CTLS (0x482) or TRUE (0x48E). */
  procBasedCtls: MsrCapabilityPair;
  /** IA32_VMX_PROCBASED_CTLS2 (0x48B) or TRUE (0x491). */
  secondaryProcBasedCtls: MsrCapabilityPair;
  /** IA32_VMX_EXIT_CTLS (0x483) or TRUE (0x48F). */
  exitCtls: MsrCapabilityPair;
  /** IA32_VMX_ENTRY_CTLS (0x484) or TRUE (0x490). */
  entryCtls: MsrCapabilityPair;
  /** IA32_VMX_CR0_FIXED0 (0x486). */
  cr0Fixed0: bigint;
  /** IA32_VMX_CR0_FIXED1 (0x487). */
  cr0Fixed1: bigint;
  /** IA32_VMX_CR4_FIXED0 (0x488). */
  cr4Fixed0: bigint;
  /** IA32_VMX_CR4_FIXED1 (0x489). */
  cr4Fixed1: bigint;
  /** IA32_VMX_VMCS_ENUM (0x48A). */
  vmcsEnum: bigint;
  /** IA32_VMX_EPT_VPID_CAP (0x48C). */
  eptVpidCap: bigint;
  /** IA32_VMX_MISC (0x485). */
  misc: bigint;
}

/** Computed control field values adjusted against MSR capabilities. */
export interface AdjustedControls {
  pinBased: number;
  procBased: number;
  secondaryProcBased: number;
  exit: number;
  entry: number;
  cr0Fixed: { allowed0: bigint; allowed1: bigint };
  cr4Fixed: { allowed0: bigint; allowed1: bigint };
  /** Parsed EPT/VPID capability flags. */
  eptVpid: EptVpidCapabilities;
}

// ── EPT Tables ──

/** EPT page table configuration — identity maps guest-physical to host-physical. */
export interface EptTableConfig {
  /** PML4 table allocation. */
  pml4: PhysicalAllocation;
  /** PDPT table allocation. */
  pdpt: PhysicalAllocation;
  /** Page Directory allocation (2MB large pages). */
  pd: PhysicalAllocation;
  /** EPTP value (IA32_VMX_EPT_VPID_CAP format). */
  eptPointer: bigint;
  /** Page-walk length (3 = 4-level: PML4→PDPT→PD→PT, 4 = 5-level). */
  pageWalkLength: number;
  /** EPT memory type (0 = UC, 6 = WB). */
  memoryType: number;
  /** Whether identity mapping is configured. */
  identityMapped: boolean;
}

// ── MSR Bitmap ──

/** MSR bitmap configuration. */
export interface MsrBitmapConfig {
  /** The 4KB bitmap page allocation. */
  bitmap: PhysicalAllocation;
  /** True if all bits are 0 (passthrough). False if any interception bits are set. */
  passthroughAll: boolean;
  /** MSR indices intercepted on read (bit set = VM exit on RDMSR). */
  interceptedReads: number[];
  /** MSR indices intercepted on write (bit set = VM exit on WRMSR). */
  interceptedWrites: number[];
}

// ── VMCS Field Configuration ──

/**
 * All VMCS fields pre-computed from user mode.
 *
 * Fields suffixed `_needsKernel` require the kernel component to read
 * the current CPU state (CR0, CR3, CR4, segment registers, GDTR, IDTR, TR)
 * because those instructions are privileged and unavailable from ring-3.
 *
 * All other fields are deterministic from MSR capabilities or reasonable
 * defaults and can be written to VMCS without further resolution.
 */
export interface VmcsFieldConfig {
  // ── 16-bit control fields ──
  vpid: number;

  // ── 16-bit guest-state fields ──
  /** Guest ES selector — needs kernel (cannot read segment regs from user mode). */
  guestESSelector_needsKernel: number | null;
  /** Guest CS selector — needs kernel. */
  guestCSSelector_needsKernel: number | null;
  /** Guest SS selector — needs kernel. */
  guestSSSelector_needsKernel: number | null;
  /** Guest DS selector — needs kernel. */
  guestDSSelector_needsKernel: number | null;
  /** Guest FS selector — needs kernel. */
  guestFSSelector_needsKernel: number | null;
  /** Guest GS selector — needs kernel. */
  guestGSSelector_needsKernel: number | null;
  /** Guest LDTR selector — needs kernel. */
  guestLDTRSelector_needsKernel: number | null;
  /** Guest TR selector — needs kernel (STR instruction). */
  guestTRSelector_needsKernel: number | null;

  // ── 16-bit host-state fields ──
  hostESSelector: number;
  hostCSSelector: number;
  hostSSSelector: number;
  hostDSSelector: number;
  hostFSSelector: number;
  hostGSSelector: number;
  /** Host TR selector — needs kernel. */
  hostTRSelector_needsKernel: number | null;

  // ── 64-bit control fields ──
  /** Physical address of MSR bitmap (0 to disable). */
  msrBitmapAddress: bigint;
  /** EPT pointer (EPTP). */
  eptPointer: bigint;
  /** TSC offset (default 0). */
  tscOffset: bigint;

  // ── 64-bit guest-state fields ──
  guestDebugCtl: bigint;
  guestPAT: bigint;
  guestEFER: bigint;

  // ── 64-bit host-state fields ──
  hostPAT: bigint;
  hostEFER: bigint;

  // ── 32-bit control fields ──
  pinBasedCtls: number;
  procBasedCtls: number;
  exceptionBitmap: number;
  vmExitCtls: number;
  vmEntryCtls: number;
  secondaryProcBasedCtls: number;

  // ── 32-bit guest-state fields ──
  /** Guest ES/CS/SS/DS/FS/GS limits — needs kernel (segment descriptors). */
  guestESLimit_needsKernel: number | null;
  guestCSLimit_needsKernel: number | null;
  guestSSLimit_needsKernel: number | null;
  guestDSLimit_needsKernel: number | null;
  guestFSLimit_needsKernel: number | null;
  guestGSLimit_needsKernel: number | null;

  /** Guest LDTR/TR limits — needs kernel. */
  guestLDTRLimit_needsKernel: number | null;
  guestTRLimit_needsKernel: number | null;

  /** Guest GDTR/IDTR limits — needs kernel. */
  guestGDTRLimit_needsKernel: number | null;
  guestIDTRLimit_needsKernel: number | null;

  /** Guest segment access rights — needs kernel. */
  guestESAccess_needsKernel: number | null;
  guestCSAccess_needsKernel: number | null;
  guestSSAccess_needsKernel: number | null;
  guestDSAccess_needsKernel: number | null;
  guestFSAccess_needsKernel: number | null;
  guestGSAccess_needsKernel: number | null;
  guestLDTRAccess_needsKernel: number | null;
  guestTRAccess_needsKernel: number | null;

  /** Guest SYSENTER_CS — readable from MSR 0x174. */
  guestSysenterCS: number;

  // ── 32-bit host-state fields ──
  hostSysenterCS: number;

  // ── Natural-width control fields ──
  cr0GuestHostMask: bigint;
  cr4GuestHostMask: bigint;
  cr0ReadShadow: bigint;
  cr4ReadShadow: bigint;

  // ── Natural-width guest-state fields ──
  /** Guest CR0 — needs kernel (MOV CR0 privileged). */
  guestCR0_needsKernel: bigint | null;
  /** Guest CR3 — needs kernel (MOV CR3 privileged). */
  guestCR3_needsKernel: bigint | null;
  /** Guest CR4 — needs kernel (MOV CR4 privileged). */
  guestCR4_needsKernel: bigint | null;
  guestDR7: bigint;
  /** Guest RSP — provided by kernel component at VMLAUNCH time. */
  guestRSP_needsKernel: bigint | null;
  /** Guest RIP — provided by kernel component (current instruction pointer). */
  guestRIP_needsKernel: bigint | null;
  guestRFLAGS: bigint;

  /** Guest segment bases — needs kernel. */
  guestESBase_needsKernel: bigint | null;
  guestCSBase_needsKernel: bigint | null;
  guestSSBase_needsKernel: bigint | null;
  guestDSBase_needsKernel: bigint | null;
  /** Guest FS_BASE — readable from MSR 0xC0000100. */
  guestFSBase: bigint;
  /** Guest GS_BASE — readable from MSR 0xC0000101 (kernel) / swapgs. */
  guestGSBase: bigint;
  guestLDTRBase_needsKernel: bigint | null;
  guestTRBase_needsKernel: bigint | null;
  guestGDTRBase_needsKernel: bigint | null;
  guestIDTRBase_needsKernel: bigint | null;

  /** Guest SYSENTER_ESP/EIP — readable from MSRs 0x175/0x176. */
  guestSysenterESP: bigint;
  guestSysenterEIP: bigint;

  // ── Natural-width host-state fields ──
  /** Host CR0 — needs kernel. */
  hostCR0_needsKernel: bigint | null;
  /** Host CR3 — needs kernel. */
  hostCR3_needsKernel: bigint | null;
  /** Host CR4 — needs kernel. */
  hostCR4_needsKernel: bigint | null;
  /** Host RSP — provided by kernel component (host stack). */
  hostRSP_needsKernel: bigint | null;
  /** Host RIP — provided by kernel component (VM-exit handler entry point). */
  hostRIP_needsKernel: bigint | null;
  /** Host FS_BASE — readable from MSR 0xC0000100. */
  hostFSBase: bigint;
  /** Host GS_BASE — readable from MSR 0xC0000101. */
  hostGSBase: bigint;
  hostTRBase_needsKernel: bigint | null;
  hostGDTRBase_needsKernel: bigint | null;
  hostIDTRBase_needsKernel: bigint | null;
  hostSysenterESP: bigint;
  hostSysenterEIP: bigint;
}

// ── Parsed Capability Types ──

/** Parsed IA32_VMX_BASIC MSR fields. */
export interface VmxBasicInfo {
  revisionId: number;
  vmcsRegionSize: number;
  memoryType: number;
  trueControls: boolean;
  vmcsShadowing: boolean;
}

/** Parsed EPT/VPID capabilities from IA32_VMX_EPT_VPID_CAP. */
export interface EptVpidCapabilities {
  executeOnly: boolean;
  largePage2MB: boolean;
  largePage1GB: boolean;
  accessedDirty: boolean;
  eptVe: boolean;
  modeBasedExecute: boolean;
  invvpidIndividualAddress: boolean;
  invvpidSingleContext: boolean;
  invvpidAllContexts: boolean;
}

// ── Conflicts ──

/** Hypervisor conflict scan result. */
export interface HypervisorConflicts {
  /** Hyper-V role active (CPUID.1:ECX[31] or Hyper-V leaf present). */
  hyperv: boolean;
  /** WSL2 detected (wsl --status reports version 2). */
  wsl2: boolean;
  /** Virtualization-Based Security (lsass.exe mitigation). */
  vbs: boolean;
  /** Hypervisor-Enforced Code Integrity (HVCI / Memory Integrity). */
  hvci: boolean;
  /** Any VBS feature active. */
  virtualizationBasedSecurity: boolean;
}

// ── Comprehensive Capability Report ──

/**
 * Complete pre-flight report — everything the kernel component needs to
 * set up VMCS, EPT, and MSR bitmap without further computation.
 *
 * Generated by `Hypervisor.getCapabilityReport()` after
 * `detectCapabilities()` + `prepareForKernel()`.
 */
export interface HypervisorCapabilityReport {
  /** CPUID leaves and parsed features. */
  cpuid: {
    leaf1: CpuidLeaf | null;
    leaf7_0: CpuidLeaf | null;
    leaf80000001: CpuidLeaf | null;
    leaf80000008: CpuidLeaf | null;
    /** Leaf 6 — Thermal and power management features. */
    leaf6: CpuidLeaf | null;
    features: Cpuid1Features;
    features7: Cpuid7Features | null;
    vendor: string;
    brand: string;
    maxBasicLeaf: number;
    maxExtendedLeaf: number;
  };

  /** IA32_FEATURE_CONTROL MSR analysis — gatekeeper for VMXON. */
  featureControl: {
    raw: bigint | null;
    locked: boolean;
    vmxonOutsideSmx: boolean;
    vmxonInSmx: boolean;
    verdict: 'ok' | 'locked_missing_vmxon' | 'not_locked' | 'unreadable';
    detail: string;
  };

  /** All VT-x MSR values read via BYOVD (null if driver unavailable). */
  msrs: VmxCapabilityMsrs | null;

  /** Control fields adjusted against MSR capabilities. */
  adjustedControls: AdjustedControls;

  /** Conflict scan results. */
  conflicts: HypervisorConflicts;

  /** Physical memory allocations (VMXON regions per CPU, EPT, MSR bitmap). */
  allocations: {
    vmxonRegions: PerProcessorSetup[];
    eptTables: EptTableConfig | null;
    msrBitmap: MsrBitmapConfig | null;
  };

  /** Pre-computed VMCS field values. */
  vmcsFields: VmcsFieldConfig;

  /** Parsed VMX basic info. */
  vmxBasic: VmxBasicInfo | null;

  /** Highest VMCS field index supported (from IA32_VMX_VMCS_ENUM). */
  vmcsMaxIndex: number;

  /** True if all pre-flight checks pass and kernel component can proceed. */
  readyForKernelComponent: boolean;

  /** Human-readable summary of what the kernel component must resolve. */
  kernelComponentChecklist: string[];

  /**
   * Enumeration of all VMCS fields that must be written by the kernel component,
   * each with its encoding, name, description, and pre-computed value.
   */
  vmcsFieldManifest: VmcsFieldManifestEntry[];

  /** Count of _needsKernel fields that require kernel-mode resolution. */
  kernelResolvedFieldCount: number;
}

/**
 * One entry in the VMCS field manifest — maps an Intel VMCS encoding
 * to the pre-computed value and indicates whether the kernel must resolve it.
 */
export interface VmcsFieldManifestEntry {
  /** 32-bit VMCS field encoding (VMWRITE operand). */
  encoding: number;
  /** Human-readable field name. */
  name: string;
  /** What this field controls. */
  description: string;
  /** Pre-computed value (null if _needsKernel). */
  value: number | bigint | null;
  /** Width: 0=16-bit, 1=64-bit, 2=32-bit, 3=natural-width. */
  width: number;
  /** Type: 0=control, 2=guest-state, 3=host-state. */
  fieldType: number;
  /** True if this field must be resolved by the kernel component. */
  needsKernel: boolean;
}

// ── VMX Legacy Types (preserved for backward compatibility) ──

/** Comprehensive VT-x capability report (simplified — use HypervisorCapabilityReport for full). */
export interface VmxCapabilities {
  cpuid1: Cpuid1Features;
  vendor: string;
  brand: string;
  vtxSupported: boolean;
  eptSupported: boolean;
  vpidSupported: boolean;
  unrestrictedGuest: boolean;
  vmxBasic: VmxBasicInfo | null;
  eptVpid: EptVpidCapabilities | null;
  hypervActive: boolean;
  wsl2Active: boolean;
  cr4VmxeSet: boolean;
  byovdActive: boolean;
  compatibility: 'ready' | 'no_vtx' | 'hyperv_conflict' | 'no_byovd' | 'no_admin' | 'not_windows';
}

/** Hypervisor runtime status. */
export interface HypervisorStatus {
  loaded: boolean;
  vmxRootActive: boolean;
  eptEnabled: boolean;
  vpidEnabled: boolean;
  logicalProcessorCount: number;
  phase: 1 | 2 | 3 | 4;
  kernelComponentLoaded: boolean;
}

/** Phase 1 VMCS configuration summary. */
export interface VmcsConfig {
  pinBasedControls: number;
  primaryProcBasedControls: number;
  secondaryProcBasedControls: number;
  vmExitControls: number;
  vmEntryControls: number;
  exceptionBitmap: number;
  vpid: number;
  msrBitmapAddress: bigint;
  eptPointer: bigint;
}

// ── Legacy MSR Values Type ──
