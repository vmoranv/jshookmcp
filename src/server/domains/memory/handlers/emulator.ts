/**
 * Emulator memory detection (ArtMoney parity).
 *
 * Pure TS, read-only. Detects known console emulators by process name
 * and module fingerprint, and provides emulator-specific memory region
 * mapping for memory_region_enumerate "emulator" mode.
 */

// ── Known Emulator Database ──

interface EmulatorInfo {
  name: string;
  platform: string;
  /** Process name patterns (case-insensitive substring match) */
  processNames: string[];
  /** Module name patterns to confirm (case-insensitive substring) */
  modulePatterns: string[];
  /** Known memory regions for the emulated console */
  memoryRegions: EmulatorMemoryRegion[];
}

export interface EmulatorMemoryRegion {
  name: string;
  description: string;
  /** Start address relative to emulator process (0 = dynamic/resolved at runtime) */
  baseOffset: number;
  /** Typical size in bytes */
  typicalSize: number;
  /** How to resolve the actual address */
  resolutionHint: string;
}

const KNOWN_EMULATORS: EmulatorInfo[] = [
  {
    name: 'PCSX2',
    platform: 'PlayStation 2',
    processNames: ['pcsx2', 'pcsx2-qt', 'pcsx2x64'],
    modulePatterns: ['pcsx2', 'gsdx', 'spu2-x'],
    memoryRegions: [
      {
        name: 'EE_RAM',
        description: 'Emotion Engine main RAM (32 MB)',
        baseOffset: 0,
        typicalSize: 0x02000000,
        resolutionHint:
          'PCSX2 allocates EE RAM as a fixed virtual region. Search for pattern near 0x20000000.',
      },
      {
        name: 'IOP_RAM',
        description: 'I/O Processor RAM (2 MB)',
        baseOffset: 0,
        typicalSize: 0x00200000,
        resolutionHint: 'IOP RAM is typically allocated immediately after EE RAM.',
      },
      {
        name: 'VU0_MEM',
        description: 'Vector Unit 0 memory (4 KB data + 4 KB code)',
        baseOffset: 0,
        typicalSize: 0x00002000,
        resolutionHint: 'VU memory is small; find via pattern search for known data.',
      },
    ],
  },
  {
    name: 'Dolphin',
    platform: 'GameCube / Wii',
    processNames: ['dolphin', 'dolphin-emu', 'dolphinw'],
    modulePatterns: ['dolphin', 'core', 'video'],
    memoryRegions: [
      {
        name: 'MEM1',
        description: 'GameCube/Wii main memory (24 MB physical, 32 MB effective on Wii)',
        baseOffset: 0,
        typicalSize: 0x01800000,
        resolutionHint:
          'Dolphin maps MEM1 as a dedicated allocation. Search for the 0x80000000-0x81800000 virtual range.',
      },
      {
        name: 'MEM2',
        description: 'Wii-only extended memory (64 MB)',
        baseOffset: 0,
        typicalSize: 0x04000000,
        resolutionHint:
          'On Wii titles, MEM2 starts at 0x90000000 in emulated address space. Only present when Wii mode is active.',
      },
      {
        name: 'EFB',
        description: 'Embedded Framebuffer (~2 MB)',
        baseOffset: 0,
        typicalSize: 0x00200000,
        resolutionHint: 'Framebuffer region; typically writable-private.',
      },
    ],
  },
  {
    name: 'RPCS3',
    platform: 'PlayStation 3',
    processNames: ['rpcs3', 'rpcs3x64'],
    modulePatterns: ['rpcs3', 'cell', 'sys'],
    memoryRegions: [
      {
        name: 'Main_RAM',
        description: 'PS3 main memory (256 MB XDR)',
        baseOffset: 0,
        typicalSize: 0x10000000,
        resolutionHint:
          'RPCS3 allocates main RAM as a large contiguous block. Look for a ~256MB writable-private region.',
      },
      {
        name: 'VRAM',
        description: 'RSX video memory (256 MB GDDR3)',
        baseOffset: 0,
        typicalSize: 0x10000000,
        resolutionHint:
          'VRAM is a separate allocation, often after main RAM. Used for GPU textures/framebuffers.',
      },
    ],
  },
  {
    name: 'Yuzu',
    platform: 'Nintendo Switch',
    processNames: ['yuzu', 'yuzu-early-access', 'yuzucmd'],
    modulePatterns: ['yuzu', 'core', 'video_core'],
    memoryRegions: [
      {
        name: 'DRAM',
        description: 'Switch main memory (4 GB for retail, 6+ GB for dev kits)',
        baseOffset: 0,
        typicalSize: 0x100000000, // 4 GB
        resolutionHint:
          'Yuzu maps Switch DRAM as a huge allocation. Search for large writable-private regions.',
      },
    ],
  },
  {
    name: 'Cemu',
    platform: 'Wii U',
    processNames: ['cemu', 'cemu-emu'],
    modulePatterns: ['cemu', 'coreinit', 'gx2'],
    memoryRegions: [
      {
        name: 'MEM1',
        description: 'Wii U main application memory (2 GB)',
        baseOffset: 0,
        typicalSize: 0x80000000,
        resolutionHint:
          'Cemu reserves a large region for MEM1. Search for 0x10000000+ byte writable-private regions.',
      },
    ],
  },
  {
    name: 'ePSXe',
    platform: 'PlayStation 1',
    processNames: ['epsxe', 'epsxe-2.0.5', 'epsxecutor'],
    modulePatterns: ['epsxe', 'gpucore', 'spucore'],
    memoryRegions: [
      {
        name: 'Main_RAM',
        description: 'PS1 main memory (2 MB)',
        baseOffset: 0,
        typicalSize: 0x00200000,
        resolutionHint:
          'ePSXe allocates a 2 MB block for PS1 RAM. Usually at a fixed offset from the module base.',
      },
      {
        name: 'VRAM',
        description: 'PS1 video RAM (1 MB)',
        baseOffset: 0,
        typicalSize: 0x00100000,
        resolutionHint: 'VRAM is typically a separate 1 MB allocation.',
      },
    ],
  },
  {
    name: 'PPSSPP',
    platform: 'PlayStation Portable',
    processNames: ['ppsspp', 'ppssppwindows64', 'ppssppqt'],
    modulePatterns: ['ppsspp', 'gpu', 'core'],
    memoryRegions: [
      {
        name: 'Main_RAM',
        description: 'PSP main memory (32 MB for PSP-1000, 64 MB for PSP-2000+)',
        baseOffset: 0,
        typicalSize: 0x04000000,
        resolutionHint: 'PPSSPP allocates a 32-64 MB writable region for PSP RAM.',
      },
      {
        name: 'VRAM',
        description: 'PSP video RAM (2 MB embedded + up to 4 MB from main RAM)',
        baseOffset: 0,
        typicalSize: 0x00600000,
        resolutionHint: 'VRAM is typically a separate writable allocation near the GPU module.',
      },
    ],
  },
  {
    name: 'xemu',
    platform: 'Xbox (original)',
    processNames: ['xemu'],
    modulePatterns: ['xemu', 'nv2a'],
    memoryRegions: [
      {
        name: 'Main_RAM',
        description: 'Xbox main memory (64 MB unified DDR)',
        baseOffset: 0,
        typicalSize: 0x04000000,
        resolutionHint: 'xemu maps the 64 MB Xbox RAM as a contiguous writable region.',
      },
    ],
  },
];

// ── Detection API ──

export interface EmulatorDetectResult {
  isEmulator: boolean;
  emulatorName?: string;
  platform?: string;
  memoryRegions?: EmulatorMemoryRegion[];
  matchedBy?: string[];
  hint?: string;
}

/**
 * Detect if a process is a known console emulator.
 *
 * @param processName - The process executable name (e.g. "pcsx2.exe")
 * @param moduleNames - Optional list of loaded module names for fingerprint confirmation
 */
export function detectEmulator(processName: string, moduleNames?: string[]): EmulatorDetectResult {
  const lowerName = processName.toLowerCase();

  for (const emu of KNOWN_EMULATORS) {
    const nameMatch = emu.processNames.some((p) => lowerName.includes(p));
    if (!nameMatch) continue;

    // Confirm via module fingerprint if available
    const matchedBy: string[] = [`process name matches "${processName}"`];
    let moduleConfirmed = true;

    if (moduleNames && moduleNames.length > 0) {
      const lowerMods = moduleNames.map((m) => m.toLowerCase());
      const modMatches = emu.modulePatterns.filter((p) => lowerMods.some((m) => m.includes(p)));
      if (modMatches.length === 0) {
        // Process name matches but no module fingerprint — weak match
        moduleConfirmed = false;
      } else {
        matchedBy.push(`module fingerprint: ${modMatches.join(', ')}`);
      }
    }

    if (!moduleConfirmed && moduleNames && moduleNames.length > 0) {
      // Process name matches but modules don't — might be a renamed process
      // Still return positive but with lower confidence hint
      return {
        isEmulator: true,
        emulatorName: emu.name,
        platform: emu.platform,
        memoryRegions: emu.memoryRegions,
        matchedBy,
        hint:
          `Process name matches ${emu.name} but module fingerprint was not confirmed. ` +
          'This may be a renamed process. Verify manually.',
      };
    }

    return {
      isEmulator: true,
      emulatorName: emu.name,
      platform: emu.platform,
      memoryRegions: emu.memoryRegions,
      matchedBy,
      hint: moduleConfirmed
        ? `Confirmed ${emu.name} (${emu.platform}). ${emu.memoryRegions.length} known memory regions available for emulator-mode scanning.`
        : `Likely ${emu.name} (${emu.platform}) based on process name. Provide module list for confirmation.`,
    };
  }

  return {
    isEmulator: false,
    hint: 'The process does not match any known emulator. If this is an emulator, its process name may differ from the standard release name.',
  };
}

/**
 * Get memory region layout for a known emulator by name.
 */
export function getEmulatorMemoryLayout(emulatorName: string): EmulatorMemoryRegion[] | undefined {
  const emu = KNOWN_EMULATORS.find((e) => e.name.toLowerCase() === emulatorName.toLowerCase());
  return emu?.memoryRegions;
}

/**
 * List all known emulators.
 */
export function listKnownEmulators(): Array<{
  name: string;
  platform: string;
  processNames: string[];
}> {
  return KNOWN_EMULATORS.map((e) => ({
    name: e.name,
    platform: e.platform,
    processNames: e.processNames,
  }));
}

// ── Emulator Memory Region Descriptors ──

export interface EmulatorRegionDescriptor {
  regionName: string;
  description: string;
  /** Base address hint (hex string or empty for dynamic) */
  baseAddressHint: string;
  typicalSize: number;
  resolutionHint: string;
}
