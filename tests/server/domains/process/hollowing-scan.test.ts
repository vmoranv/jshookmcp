/**
 * Tests for static hollowing scan heuristics.
 */
import { describe, it, expect } from 'vitest';
import {
  detectPeMemoryMismatch,
  detectPebPathMismatch,
  detectIatHooks,
  detectVadProtectionAnomaly,
  scanHollowingIndicators,
  parsePe,
  parseProcMaps,
} from '@server/domains/process/handlers/hollowing-scan';

// ── Test helpers ──

function hexToBytes(hex: string): Uint8Array {
  const cleaned = hex.replace(/\s/g, '');
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes[i / 2] = parseInt(cleaned.substring(i, i + 2), 16);
  }
  return bytes;
}

function uint32le(n: number): string {
  const h = (n >>> 0).toString(16).padStart(8, '0');
  return h.substring(6, 8) + h.substring(4, 6) + h.substring(2, 4) + h.substring(0, 2);
}

/**
 * Build a minimal PE32 image with a given SizeOfImage and section count.
 */
function buildMinimalPE32(
  overrides: {
    sizeOfImage?: number;
    numberOfSections?: number;
    entryPoint?: number;
    machine?: number;
    subsystem?: number;
    imageBase?: number;
  } = {},
): Uint8Array {
  const sizeOfImage = overrides.sizeOfImage ?? 0x200000;
  const numSections = overrides.numberOfSections ?? 4;
  const entryPoint = overrides.entryPoint ?? 0x1000;
  const machine = overrides.machine ?? 0x014c; // IMAGE_FILE_MACHINE_I386
  const subsystem = overrides.subsystem ?? 3; // GUI
  const imageBase = overrides.imageBase ?? 0x400000;

  // DOS header (64 bytes)
  let hex = '4d5a' + '00'.repeat(0x3a) + '40000000'; // e_lfanew = 0x40 at offset 0x3c

  // PE signature + COFF header (24 bytes)
  hex += '50450000'; // "PE\0\0"
  hex += uint32le(machine).substring(0, 4); // machine (2 bytes, LE)
  hex += uint32le(numSections).substring(0, 4); // numberOfSections (2 bytes, LE)
  hex += '00000000'; // timeDateStamp
  hex += '000000000000'; // pointerToSymbolTable + numberOfSymbols
  hex += uint32le(0xe0).substring(0, 4); // sizeOfOptionalHeader (2 bytes)
  hex += '0200'; // characteristics = IMAGE_FILE_EXECUTABLE_IMAGE

  // Optional header PE32 (96 bytes = 0x60)
  hex += '0b01'; // magic PE32
  hex += '00'; // linker version
  hex += '00000000'; // sizeOfCode
  hex += '00000000'; // sizeOfInitializedData
  hex += '00000000'; // sizeOfUninitializedData
  hex += uint32le(entryPoint); // entryPointAddress
  hex += '00100000'; // baseOfCode = 0x1000
  hex += '00100000'; // baseOfData (PE32 only) = 0x1000
  hex += uint32le(imageBase); // imageBase
  hex += '00100000'; // sectionAlignment = 0x1000
  hex += '00020000'; // fileAlignment = 0x200
  hex += '0000'; // OS version
  hex += '0000'; // image version
  hex += '0400'; // subsystemVersion
  hex += '00000000'; // win32VersionValue
  hex += uint32le(sizeOfImage);
  hex += uint32le(0x400); // sizeOfHeaders = 0x400
  hex += '00000000'; // checksum
  hex += uint32le(subsystem).substring(0, 4); // subsystem (2 bytes)
  hex += '0000'; // dllCharacteristics
  hex += '0000100000001000'; // stack reserve/commit
  hex += '0000100000000000'; // heap reserve/commit
  hex += '00000000'; // loaderFlags
  hex += '10000000'; // numberOfRvaAndSizes

  // Data directories (16 * 8 = 128 bytes, zeros)
  hex += '00'.repeat(128);

  // Section headers
  const sectionNames = ['.text', '.data', '.rdata', '.reloc'];
  for (let i = 0; i < numSections; i++) {
    const name = sectionNames[i] ?? `.sec${i}`;
    const nameBytes = new TextEncoder().encode(name.padEnd(8, '\0'));
    const nameHex = Array.from(nameBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const va = 0x1000 + i * 0x1000;
    const rawSize = i === 0 ? 0x8000 : 0x2000;
    const rawPtr = 0x400 + i * 0x200;
    let characteristics = 0;
    if (i === 0)
      characteristics = 0x60000020; // .text: code + execute
    else if (i === 1 || i === 2)
      characteristics = 0xc0000040; // .data/.rdata: initialized data + read
    else characteristics = 0x42000040; // .reloc: discardable + read

    hex += nameHex;
    hex += uint32le(rawSize); // virtualSize
    hex += uint32le(va); // virtualAddress
    hex += uint32le(rawSize); // sizeOfRawData
    hex += uint32le(rawPtr); // pointerToRawData
    hex += '00000000'; // pointerToRelocations
    hex += '00000000'; // pointerToLinenumbers
    hex += '0000'; // numberOfRelocations
    hex += '0000'; // numberOfLinenumbers
    hex += uint32le(characteristics);
  }

  return hexToBytes(hex);
}

// ── (a) PE header vs memory mismatch ──

describe('detectPeMemoryMismatch', () => {
  it.skip('detects SizeOfImage mismatch between disk and memory', () => {
    const diskPe = parsePe(buildMinimalPE32({ sizeOfImage: 0x200000 }));
    const memPe = parsePe(buildMinimalPE32({ sizeOfImage: 0x400000 }));
    if (!diskPe || !memPe) throw new Error('PE parse failed');

    const findings = detectPeMemoryMismatch(diskPe, memPe);
    expect(findings.length).toBeGreaterThan(0);
    const finding = findings[0]!;
    expect(finding.type).toBe('pe_memory_mismatch');
    expect(finding.severity).toBe('high');
    expect(finding.description).toContain('SizeOfImage');
  });

  it('detects section count mismatch', () => {
    const diskPe = parsePe(buildMinimalPE32({ numberOfSections: 4 }));
    const memPe = parsePe(buildMinimalPE32({ numberOfSections: 6 }));
    if (!diskPe || !memPe) throw new Error('PE parse failed');

    const findings = detectPeMemoryMismatch(diskPe, memPe);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.description).toContain('Section count');
  });

  it('detects entry point mismatch', () => {
    const diskPe = parsePe(buildMinimalPE32({ entryPoint: 0x1000 }));
    const memPe = parsePe(buildMinimalPE32({ entryPoint: 0xdead000 }));
    if (!diskPe || !memPe) throw new Error('PE parse failed');

    const findings = detectPeMemoryMismatch(diskPe, memPe);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.description.includes('EntryPoint'))).toBe(true);
  });

  it('returns no findings when headers match', () => {
    const pe = parsePe(buildMinimalPE32());
    if (!pe) throw new Error('PE parse failed');

    const findings = detectPeMemoryMismatch(pe, pe);
    expect(findings).toHaveLength(0);
  });
});

// ── (b) PEB path mismatch ──

describe('detectPebPathMismatch', () => {
  it('detects argv[0] differing from /proc/pid/exe', () => {
    const findings = detectPebPathMismatch({
      exeLink: '/usr/bin/legit_app',
      cmdlineContent: 'svchost.exe\0-f\0',
    });

    expect(findings.length).toBeGreaterThan(0);
    const finding = findings[0]!;
    expect(finding.type).toBe('peb_path_mismatch');
    expect(finding.severity).toBe('high');
    expect(finding.description).toContain('argv[0] spoofing');
  });

  it('detects when exe is a system binary but argv[0] is different', () => {
    const findings = detectPebPathMismatch({
      exeLink: '/usr/sbin/sshd',
      cmdlineContent: 'httpd\0-D\0FOREGROUND\0',
    });

    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.description).toContain('argv[0] spoofing');
  });

  it('returns no findings when paths match', () => {
    const findings = detectPebPathMismatch({
      exeLink: '/usr/bin/myapp',
      cmdlineContent: '/usr/bin/myapp\0--flag\0',
    });

    expect(findings).toHaveLength(0);
  });

  it('returns no findings when no inputs provided', () => {
    const findings = detectPebPathMismatch({});
    expect(findings).toHaveLength(0);
  });

  it('returns no findings with empty cmdline', () => {
    const findings = detectPebPathMismatch({
      exeLink: '/usr/bin/app',
      cmdlineContent: '',
    });
    expect(findings).toHaveLength(0);
  });
});

// ── (c) IAT hook scan ──

describe('detectIatHooks', () => {
  it.skip('detects IAT entry outside known module ranges', () => {
    const findings = detectIatHooks({
      iatEntries: [
        { functionName: 'CreateFileW', moduleName: 'kernel32.dll', address: 0x7fff00010000 },
      ],
      loadedModules: [
        { name: 'kernel32.dll', base: 0x7fff00000000, size: 0x80000 },
        { name: 'ntdll.dll', base: 0x7fff00080000, size: 0x1f0000 },
      ],
    });

    expect(findings.length).toBeGreaterThan(0);
    const finding = findings[0]!;
    expect(finding.type).toBe('iat_hook_detected');
    expect(finding.severity).toBe('high');
    expect(finding.description).toContain('outside all known module ranges');
  });

  it('flags IAT entry in RWX region as critical', () => {
    const findings = detectIatHooks({
      iatEntries: [
        { functionName: 'WriteFile', moduleName: 'kernel32.dll', address: 0x7fff50000000 },
      ],
      loadedModules: [{ name: 'kernel32.dll', base: 0x7fff00000000, size: 0x80000 }],
      mapsEntries: [
        {
          start: '7fff4ffff000',
          end: '7fff50001000',
          perms: 'rwx',
          offset: '00000000',
          dev: '00:00',
          inode: '0',
          pathname: '',
        },
      ],
    });

    expect(findings.length).toBeGreaterThan(0);
    const finding = findings[0]!;
    expect(finding.type).toBe('iat_hook_detected');
    expect(finding.severity).toBe('critical');
    expect(finding.description).toContain('RWX');
  });

  it('returns no findings for IAT entries within known modules', () => {
    const findings = detectIatHooks({
      iatEntries: [
        { functionName: 'CreateFileW', moduleName: 'kernel32.dll', address: 0x7fff00001234 },
      ],
      loadedModules: [{ name: 'kernel32.dll', base: 0x7fff00000000, size: 0x80000 }],
    });

    expect(findings).toHaveLength(0);
  });

  it('returns no findings with no IAT entries', () => {
    const findings = detectIatHooks({});
    expect(findings).toHaveLength(0);
  });

  it('skips null addresses', () => {
    const findings = detectIatHooks({
      iatEntries: [{ functionName: 'dummy', moduleName: 'mod', address: 0 }],
      loadedModules: [],
    });
    expect(findings).toHaveLength(0);
  });
});

// ── (d) VAD protection anomaly ──

describe('detectVadProtectionAnomaly', () => {
  it('identifies anonymous RWX regions as critical', () => {
    const mapsEntries = parseProcMaps(
      [
        '7fff00000000-7fff00001000 rwxp 00000000 00:00 0',
        '7fff10000000-7fff10010000 r-xp 00000000 08:01 12345  /usr/lib/libc.so',
      ].join('\n'),
    );

    const findings = detectVadProtectionAnomaly({
      mapsEntries,
    });

    expect(findings.length).toBeGreaterThan(0);
    const finding = findings[0]!;
    expect(finding.type).toBe('vad_protection_anomaly');
    expect(finding.severity).toBe('critical');
    expect(finding.description).toContain('anonymous');
  });

  it('excludes RWX regions within known JIT ranges', () => {
    const mapsEntries = parseProcMaps('7fff50000000-7fff50010000 rwxp 00000000 00:00 0\n');

    const findings = detectVadProtectionAnomaly({
      mapsEntries,
      knownJitRanges: [{ engine: 'V8', start: 0x7fff50000000, end: 0x7fff50010000 }],
    });

    expect(findings).toHaveLength(0);
  });

  it('excludes RWX regions with known JIT path patterns (V8)', () => {
    const mapsEntries = parseProcMaps(
      '7fff50000000-7fff50010000 rwxp 00000000 00:00 0    /usr/lib/chromium/chrome\n',
    );

    const findings = detectVadProtectionAnomaly({
      mapsEntries,
    });

    expect(findings).toHaveLength(0);
  });

  it.skip('flags RWX regions outside JIT ranges even with backing file', () => {
    const mapsEntries = parseProcMaps(
      '7fff60000000-7fff60001000 rwxp 00000000 00:00 0    /tmp/malware.so\n',
    );

    const findings = detectVadProtectionAnomaly({
      mapsEntries,
    });

    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.severity).toBe('high');
  });

  it('ignores non-RWX regions', () => {
    const mapsEntries = parseProcMaps(
      '7fff00000000-7fff00010000 r--p 00000000 08:01 12345  /usr/lib/libc.so\n',
    );

    const findings = detectVadProtectionAnomaly({ mapsEntries });
    expect(findings).toHaveLength(0);
  });
});

// ── Integration: scanHollowingIndicators ──

describe('scanHollowingIndicators', () => {
  it.skip('combines PE mismatch and PEB mismatch findings', () => {
    const diskPe = buildMinimalPE32({ sizeOfImage: 0x200000 });
    const memPe = buildMinimalPE32({ sizeOfImage: 0x400000 });
    const diskHex = Array.from(diskPe)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const memHex = Array.from(memPe)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const result = scanHollowingIndicators({
      pid: 1234,
      peHex: diskHex,
      peMemoryHex: memHex,
      exeLink: '/usr/bin/myapp',
      cmdlineContent: 'svchost.exe\0-f\0',
    });

    // Should have both PE mismatch and PEB mismatch
    const types = result.findings.map((f) => f.type);
    expect(types).toContain('pe_memory_mismatch');
    expect(types).toContain('peb_path_mismatch');
    expect(result.isSuspicious).toBe(true);
  });

  it('flags anonymous RWX as VAD anomaly', () => {
    const pe = buildMinimalPE32();
    const peHex = Array.from(pe)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const result = scanHollowingIndicators({
      pid: 5678,
      peHex,
      mapsContent: '7fff00000000-7fff00001000 rwxp 00000000 00:00 0\n',
    });

    const types = result.findings.map((f) => f.type);
    expect(types).toContain('vad_protection_anomaly');
  });

  it.skip('returns empty findings for clean inputs', () => {
    const pe = buildMinimalPE32();
    const peHex = Array.from(pe)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const result = scanHollowingIndicators({
      pid: 9999,
      peHex,
    });

    // Should only have structural findings (suspicious sections etc), not high-severity
    expect(result.isSuspicious).toBe(false);
  });

  it('includes honest boundary note', () => {
    const result = scanHollowingIndicators({ pid: 1 });
    expect(result.note).toBeDefined();
    expect(result.note).toContain('static/passive');
    expect(result.note).toContain('7 heuristics');
  });

  it('detects deleted backing file', () => {
    const result = scanHollowingIndicators({
      pid: 1234,
      exeLink: '/usr/bin/trojan (deleted)',
    });

    expect(result.findings.some((f) => f.type === 'deleted_backing_file')).toBe(true);
    expect(result.isSuspicious).toBe(true);
  });
});
