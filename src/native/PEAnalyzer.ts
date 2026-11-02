/**
 * PE Analyzer Engine.
 *
 * Parses PE headers from process memory using ReadProcessMemory.
 * Provides import/export table resolution, inline hook detection,
 * and section anomaly analysis.
 *
 * @module PEAnalyzer
 */

import { promises as fs } from 'node:fs';
import { logger } from '@utils/logger';
import { enumerateProcessModules, type ProcessModuleEntry } from './processModules';
import { openProcessForMemory, CloseHandle, ReadProcessMemory } from '@native/Win32API';
import { classifyHookPattern, decodeHookTarget } from './platform/HookPatternScanner';
import type {
  PEHeaders,
  PESection,
  ImportEntry,
  ImportFunction,
  ExportEntry,
  InlineHookDetection,
  IATHookDetection,
  SectionAnomaly,
  PEParsedBuffer,
} from './PEAnalyzer.types';
import { IMAGE_SCN, IMAGE_DIRECTORY_ENTRY } from './PEAnalyzer.types';
import {
  MZ_MAGIC,
  PE_SIGNATURE,
  DOS_HEADER_SIZE,
  E_LFANEW_OFFSET,
  IMAGE_NT_OPTIONAL_HDR64_MAGIC as PE32PLUS_MAGIC,
} from './PEConstants';

// ── Constants ──

const SECTION_HEADER_SIZE = 40;
const IMPORT_DESCRIPTOR_SIZE = 20;
const COMPARE_BYTES = 16; // Bytes to compare for inline hook detection
/** Safety caps on descriptor/thunk walks (malformed headers would loop forever). */
const MAX_IMPORT_DESCRIPTORS = 500;
const MAX_THUNK_ENTRIES = 2000;
const MAX_EXPORTED_FUNCTIONS = 2000;
/** Name buffer sizes for DLL/module names and hint/name import records. */
const MAX_DLL_NAME_BYTES = 256;
const MAX_HINT_NAME_BYTES = 258; // 2-byte hint + 256-byte name

// PE header layout offsets (IMAGE_NT_HEADERS size, PE/COFF spec).
const NT_HEADERS_SIZE = 264; // 4 signature + 20 file header + 240 PE32+ optional header
const FILE_HEADER_OFFSET = 4; // within NT headers
const OPTIONAL_HEADER_OFFSET = 24; // within NT headers
const PE32_NUMBER_OF_RVA_AND_SIZES_OFFSET = 116;
const PE32PLUS_NUMBER_OF_RVA_AND_SIZES_OFFSET = 132;
const PE32_DATA_DIRECTORIES_OFFSET = 120;
const PE32PLUS_DATA_DIRECTORIES_OFFSET = 136;
const MAX_DATA_DIRECTORIES = 16;

/** IMAGE_ORDINAL_FLAG: the high bit of a thunk value marks an import by ordinal. */
/** Parsed PE core headers (DOS/NT/optional-header summary). */
interface PeCoreHeaders {
  numSections: number;
  isPE32Plus: boolean;
  firstSectionOffset: number;
  dataDirectories: { rva: number; size: number }[];
}

function ordinalFlag(isPE32Plus: boolean): bigint {
  return isPE32Plus ? 0x8000000000000000n : 0x80000000n;
}

// ── PEAnalyzer Class ──

export class PEAnalyzer {
  /**
   * Parse PE headers from a module's base address in process memory.
   */
  async parseHeaders(pid: number, moduleBase: string): Promise<PEHeaders> {
    const base = BigInt(moduleBase);
    const hProcess = openProcessForMemory(pid);

    try {
      // Read DOS header
      const dosData = ReadProcessMemory(hProcess, base, DOS_HEADER_SIZE);
      const e_magic = dosData.readUInt16LE(0);
      if (e_magic !== MZ_MAGIC) {
        throw new Error(`Invalid DOS header: expected 0x5A4D, got 0x${e_magic.toString(16)}`);
      }
      const e_lfanew = dosData.readUInt32LE(E_LFANEW_OFFSET);

      // Read NT headers (4 + 20 + 240 for PE32+)
      const ntData = ReadProcessMemory(hProcess, base + BigInt(e_lfanew), NT_HEADERS_SIZE);
      const ntSignature = ntData.readUInt32LE(0);
      if (ntSignature !== PE_SIGNATURE) {
        throw new Error(`Invalid PE signature: expected 0x4550, got 0x${ntSignature.toString(16)}`);
      }

      // File header (offset 4, 20 bytes)
      const machine = ntData.readUInt16LE(FILE_HEADER_OFFSET);
      const numberOfSections = ntData.readUInt16LE(FILE_HEADER_OFFSET + 2);
      const timeDateStamp = ntData.readUInt32LE(FILE_HEADER_OFFSET + 4);
      const characteristics = ntData.readUInt16LE(FILE_HEADER_OFFSET + 18);

      // Optional header (offset 24)
      const magic = ntData.readUInt16LE(OPTIONAL_HEADER_OFFSET);
      const isPE32Plus = magic === PE32PLUS_MAGIC;

      let imageBase: bigint;
      let entryPoint: number;
      let sizeOfImage: number;
      let numberOfRvaAndSizes: number;

      if (isPE32Plus) {
        entryPoint = ntData.readUInt32LE(40);
        imageBase = ntData.readBigUInt64LE(48);
        sizeOfImage = ntData.readUInt32LE(80);
        numberOfRvaAndSizes = ntData.readUInt32LE(PE32PLUS_NUMBER_OF_RVA_AND_SIZES_OFFSET);
      } else {
        entryPoint = ntData.readUInt32LE(40);
        imageBase = BigInt(ntData.readUInt32LE(52));
        sizeOfImage = ntData.readUInt32LE(80);
        numberOfRvaAndSizes = ntData.readUInt32LE(PE32_NUMBER_OF_RVA_AND_SIZES_OFFSET);
      }

      return {
        dosHeader: { e_magic, e_lfanew },
        ntSignature,
        fileHeader: { machine, numberOfSections, timeDateStamp, characteristics },
        optionalHeader: {
          magic,
          imageBase: `0x${imageBase.toString(16)}`,
          entryPoint: `0x${entryPoint.toString(16)}`,
          sizeOfImage,
          numberOfRvaAndSizes,
        },
      };
    } finally {
      CloseHandle(hProcess);
    }
  }

  /**
   * List all PE sections with permissions.
   */
  async listSections(pid: number, moduleBase: string): Promise<PESection[]> {
    const base = BigInt(moduleBase);
    const hProcess = openProcessForMemory(pid);

    try {
      const headers = await this.readCoreHeaders(hProcess, base);
      const sections: PESection[] = [];

      for (let i = 0; i < headers.numSections; i++) {
        const off = headers.firstSectionOffset + i * SECTION_HEADER_SIZE;
        const secData = ReadProcessMemory(hProcess, base + BigInt(off), SECTION_HEADER_SIZE);

        // Name: 8 bytes, null-terminated
        const nameEnd = secData.indexOf(0);
        const name = secData
          .subarray(0, nameEnd > 0 && nameEnd <= 8 ? nameEnd : 8)
          .toString('ascii');

        const virtualSize = secData.readUInt32LE(8);
        const virtualAddress = secData.readUInt32LE(12);
        const rawSize = secData.readUInt32LE(16);
        const chars = secData.readUInt32LE(36);

        sections.push({
          name,
          virtualAddress: `0x${virtualAddress.toString(16)}`,
          virtualSize,
          rawSize,
          characteristics: chars,
          isExecutable: (chars & IMAGE_SCN.MEM_EXECUTE) !== 0,
          isWritable: (chars & IMAGE_SCN.MEM_WRITE) !== 0,
          isReadable: (chars & IMAGE_SCN.MEM_READ) !== 0,
        });
      }

      return sections;
    } finally {
      CloseHandle(hProcess);
    }
  }

  /**
   * Parse import table.
   */
  async parseImports(pid: number, moduleBase: string): Promise<ImportEntry[]> {
    const base = BigInt(moduleBase);
    const hProcess = openProcessForMemory(pid);

    try {
      const headers = await this.readCoreHeaders(hProcess, base);
      const importRva = headers.dataDirectories[IMAGE_DIRECTORY_ENTRY.IMPORT];
      if (!importRva || importRva.rva === 0) return [];

      const imports: ImportEntry[] = [];
      let descOffset = importRva.rva;

      // Walk IMAGE_IMPORT_DESCRIPTOR chain (20 bytes each, terminated by all-zeros)
      for (let i = 0; i < MAX_IMPORT_DESCRIPTORS; i++) {
        const desc = ReadProcessMemory(hProcess, base + BigInt(descOffset), IMPORT_DESCRIPTOR_SIZE);
        const nameRva = desc.readUInt32LE(12);
        if (nameRva === 0) break; // Terminator

        // Read DLL name
        const nameData = ReadProcessMemory(hProcess, base + BigInt(nameRva), MAX_DLL_NAME_BYTES);
        const nullIdx = nameData.indexOf(0);
        const dllName = nameData
          .subarray(0, nullIdx > 0 ? nullIdx : MAX_DLL_NAME_BYTES)
          .toString('ascii');

        // Read thunk array (simplified — just collect names)
        const originalFirstThunkRva = desc.readUInt32LE(0) || desc.readUInt32LE(16);
        const functions = this.readThunkArray(
          hProcess,
          base,
          originalFirstThunkRva,
          headers.isPE32Plus,
        );

        imports.push({ dllName, functions });
        descOffset += IMPORT_DESCRIPTOR_SIZE;
      }

      return imports;
    } finally {
      CloseHandle(hProcess);
    }
  }

  /**
   * Parse export table.
   */
  async parseExports(pid: number, moduleBase: string): Promise<ExportEntry[]> {
    const base = BigInt(moduleBase);
    const hProcess = openProcessForMemory(pid);

    try {
      return await this.parseExportsInternal(hProcess, base);
    } finally {
      CloseHandle(hProcess);
    }
  }

  /**
   * Export-table parser over an already-open process handle. Shared by the
   * public {@link parseExports} and {@link detectIATHooks} (which reuses its
   * own handle instead of opening a second one per module).
   */
  private async parseExportsInternal(hProcess: bigint, base: bigint): Promise<ExportEntry[]> {
    const headers = await this.readCoreHeaders(hProcess, base);
    const exportDir = headers.dataDirectories[IMAGE_DIRECTORY_ENTRY.EXPORT];
    if (!exportDir || exportDir.rva === 0) return [];

    // Read IMAGE_EXPORT_DIRECTORY (40 bytes)
    const expData = ReadProcessMemory(hProcess, base + BigInt(exportDir.rva), 40);
    // Cap before sizing the name/ordinal buffers — a corrupt header could
    // otherwise drive huge allocations from numberOfNames.
    const numberOfNames = Math.min(expData.readUInt32LE(24), MAX_EXPORTED_FUNCTIONS);
    const addressOfFunctionsRva = expData.readUInt32LE(28);
    const addressOfNamesRva = expData.readUInt32LE(32);
    const addressOfNameOrdinalsRva = expData.readUInt32LE(36);
    const ordinalBase = expData.readUInt32LE(16);

    const exports: ExportEntry[] = [];

    // Read name pointers array
    const namesBuf = ReadProcessMemory(
      hProcess,
      base + BigInt(addressOfNamesRva),
      numberOfNames * 4,
    );
    const ordsBuf = ReadProcessMemory(
      hProcess,
      base + BigInt(addressOfNameOrdinalsRva),
      numberOfNames * 2,
    );

    for (let i = 0; i < Math.min(numberOfNames, MAX_EXPORTED_FUNCTIONS); i++) {
      const nameRva = namesBuf.readUInt32LE(i * 4);
      const ordIndex = ordsBuf.readUInt16LE(i * 2);

      // Read function name
      const nameBuf = ReadProcessMemory(hProcess, base + BigInt(nameRva), MAX_DLL_NAME_BYTES);
      const nullIdx = nameBuf.indexOf(0);
      const name = nameBuf
        .subarray(0, nullIdx > 0 ? nullIdx : MAX_DLL_NAME_BYTES)
        .toString('ascii');

      // Read function RVA
      const funcRva = ReadProcessMemory(
        hProcess,
        base + BigInt(addressOfFunctionsRva + ordIndex * 4),
        4,
      ).readUInt32LE(0);

      // Check for forwarded export (RVA points inside export directory)
      let forwardedTo: string | null = null;
      if (funcRva >= exportDir.rva && funcRva < exportDir.rva + exportDir.size) {
        const fwdBuf = ReadProcessMemory(hProcess, base + BigInt(funcRva), 256);
        const fwdEnd = fwdBuf.indexOf(0);
        forwardedTo = fwdBuf.subarray(0, fwdEnd > 0 ? fwdEnd : 256).toString('ascii');
      }

      exports.push({
        name,
        ordinal: ordinalBase + ordIndex,
        rva: `0x${funcRva.toString(16)}`,
        forwardedTo,
      });
    }

    return exports;
  }

  /**
   * Detect inline hooks by comparing first bytes of exported functions (disk vs memory).
   */
  async detectInlineHooks(pid: number, moduleName?: string): Promise<InlineHookDetection[]> {
    const hProcess = openProcessForMemory(pid);
    const detections: InlineHookDetection[] = [];

    try {
      // Find module by name
      const modules = this.enumerateModulesInternal(hProcess);
      const targets = moduleName
        ? modules.filter((m) => m.name.toLowerCase().includes(moduleName.toLowerCase()))
        : modules;

      for (const mod of targets) {
        try {
          // Read disk file
          const diskData = await fs.readFile(mod.path);

          // Get exports for this module
          const exports = await this.parseExports(pid, mod.base);

          for (const exp of exports) {
            const funcRva = parseInt(exp.rva, 16);
            if (funcRva === 0 || exp.forwardedTo) continue;

            // Read memory bytes
            const memBytes = ReadProcessMemory(
              hProcess,
              BigInt(mod.base) + BigInt(funcRva),
              COMPARE_BYTES,
            );

            // Read disk bytes (need to convert RVA to file offset)
            const diskOffset = this.rvaToFileOffset(diskData, funcRva);
            if (diskOffset < 0 || diskOffset + COMPARE_BYTES > diskData.length) continue;
            const diskBytes = diskData.subarray(diskOffset, diskOffset + COMPARE_BYTES);

            // Compare
            if (!memBytes.equals(diskBytes)) {
              const hookType = this.classifyHook(memBytes);
              const jumpTarget = this.decodeJumpTarget(
                memBytes,
                BigInt(mod.base) + BigInt(funcRva),
              );

              detections.push({
                address: `0x${(BigInt(mod.base) + BigInt(funcRva)).toString(16)}`,
                moduleName: mod.name,
                functionName: exp.name,
                originalBytes: Array.from(diskBytes),
                currentBytes: Array.from(memBytes),
                hookType,
                jumpTarget,
              });
            }
          }
        } catch (e) {
          logger.debug(`Hook check skipped for ${mod.name}: ${e}`);
        }
      }
    } finally {
      CloseHandle(hProcess);
    }

    return detections;
  }

  /**
   * Detect IAT (Import Address Table) hooks.
   *
   * For each imported function, the resolved IAT entry address is compared
   * against the declared source module's address range. An entry pointing
   * outside its source module indicates the IAT was redirected — the hallmark
   * of an IAT hook (EasyHook/MinHook/Detours style), which leaves the function
   * body untouched and thus evades {@link detectInlineHooks}.
   *
   * Algorithm (pe-sieve 4.7 "iat" mode):
   *   1. Walk IMAGE_IMPORT_DESCRIPTOR chain.
   *   2. For each descriptor, read FirstThunk (the IAT) — its entries hold the
   *      loader-resolved function addresses in memory.
   *   3. Resolve the declared source DLL's loaded module range.
   *   4. Flag entries whose address falls outside that range.
   *
   * Forwarded exports legitimately point outside the source module; such cases
   * are still reported (with `actualModule` populated) so the operator can
   * triage, rather than silently dropped.
   */
  async detectIATHooks(pid: number, moduleName?: string): Promise<IATHookDetection[]> {
    const hProcess = openProcessForMemory(pid);
    const detections: IATHookDetection[] = [];
    // Per source module: set of exported names that are forwarded. Computed
    // lazily (one export-table parse per distinct source module).
    const srcForwardCache = new Map<string, Set<string>>();

    try {
      const modules = this.enumerateModulesInternal(hProcess);
      const targets = moduleName
        ? modules.filter((m) => m.name.toLowerCase().includes(moduleName!.toLowerCase()))
        : modules;

      for (const mod of targets) {
        try {
          const base = BigInt(mod.base);
          const headers = await this.readCoreHeaders(hProcess, base);
          const importDir = headers.dataDirectories[IMAGE_DIRECTORY_ENTRY.IMPORT];
          if (!importDir || importDir.rva === 0) continue;

          await this.walkImportDescriptors(
            hProcess,
            mod,
            base,
            headers,
            modules,
            srcForwardCache,
            detections,
          );
        } catch (e) {
          logger.debug(`IAT hook check skipped for ${mod.name}: ${e}`);
        }
      }
    } finally {
      CloseHandle(hProcess);
    }

    return detections;
  }

  /** Walk the module's IMAGE_IMPORT_DESCRIPTOR chain, delegating each
   * descriptor to walkImportThunks. */
  private async walkImportDescriptors(
    hProcess: bigint,
    mod: PeModuleEntry,
    base: bigint,
    headers: Awaited<ReturnType<PEAnalyzer['readCoreHeaders']>>,
    modules: PeModuleEntry[],
    srcForwardCache: Map<string, Set<string>>,
    detections: IATHookDetection[],
  ): Promise<void> {
    const importDir = headers.dataDirectories[IMAGE_DIRECTORY_ENTRY.IMPORT]!;
    const thunkSize = headers.isPE32Plus ? 8 : 4;
    let descOffset = importDir.rva;

    // Walk IMAGE_IMPORT_DESCRIPTOR chain (20 bytes each).
    for (let i = 0; i < MAX_IMPORT_DESCRIPTORS; i++) {
      const desc = ReadProcessMemory(hProcess, base + BigInt(descOffset), IMPORT_DESCRIPTOR_SIZE);
      const nameRva = desc.readUInt32LE(12);
      if (nameRva === 0) break; // Terminator

      const firstThunkRva = desc.readUInt32LE(16); // IAT (loader-filled)
      const originalFirstThunkRva = desc.readUInt32LE(0); // INT (hint/name)

      const dllName = readImportDllName(hProcess, base, nameRva);
      const sourceMod = resolveSourceModule(modules, dllName);
      const srcBase = sourceMod ? BigInt(sourceMod.base) : 0n;
      const srcEnd = sourceMod ? srcBase + BigInt(sourceMod.size) : 0n;

      // Forwarded exports legitimately resolve OUTSIDE the source module:
      // the loader follows the forward chain (e.g. kernel32 → api-ms-win-*
      // → KernelBase) and writes the FINAL address into the IAT. Reading the
      // source module's export table once lets us skip such entries — only
      // genuinely redirected IAT entries are hooks. Ordinal-only forwards
      // (no name in the export table) cannot be detected here.
      if (sourceMod && !srcForwardCache.has(sourceMod.name)) {
        srcForwardCache.set(
          sourceMod.name,
          await this.collectForwardedExportNames(hProcess, srcBase),
        );
      }

      this.walkIatThunks(hProcess, {
        mod,
        base,
        headers,
        modules,
        sourceMod,
        srcBase,
        srcEnd,
        dllName,
        firstThunkRva,
        originalFirstThunkRva,
        thunkSize,
        forwarded: sourceMod ? srcForwardCache.get(sourceMod.name) : undefined,
        detections,
      });

      descOffset += IMPORT_DESCRIPTOR_SIZE;
    }
  }

  /** Parse the source module's export table into the set of names (and
   * ordinal markers) that are forwarded elsewhere. */
  private async collectForwardedExportNames(
    hProcess: bigint,
    srcBase: bigint,
  ): Promise<Set<string>> {
    const srcExports = await this.parseExportsInternal(hProcess, srcBase);
    const forwarded = new Set<string>();
    for (const e of srcExports) {
      if (e.forwardedTo) {
        forwarded.add(e.name);
        forwarded.add(`Ordinal#${e.ordinal}`);
      }
    }
    return forwarded;
  }

  /** Walk one descriptor's IAT thunk array, collecting out-of-module targets. */
  private walkIatThunks(hProcess: bigint, ctx: IatWalkContext): void {
    const { base, headers, modules, sourceMod, srcBase, srcEnd, dllName, thunkSize } = ctx;
    const ordinal = ordinalFlag(headers.isPE32Plus);

    for (let j = 0; j < MAX_THUNK_ENTRIES; j++) {
      const iatAbs = base + BigInt(ctx.firstThunkRva + j * thunkSize);
      const thunkData = ReadProcessMemory(hProcess, iatAbs, thunkSize);
      const funcAddr = headers.isPE32Plus
        ? thunkData.readBigUInt64LE(0)
        : BigInt(thunkData.readUInt32LE(0));
      if (funcAddr === 0n) break; // End of IAT

      const funcName = readImportedFunctionName(hProcess, {
        base,
        headers,
        originalFirstThunkRva: ctx.originalFirstThunkRva,
        firstThunkRva: ctx.firstThunkRva,
        index: j,
        thunkSize,
        ordinal,
      });

      // Flag if the resolved address is outside the source module range.
      if (sourceMod && (funcAddr < srcBase || funcAddr >= srcEnd)) {
        // Skip forwarded exports — the loader wrote the final target,
        // so an outside-module address is expected, not a hook.
        if (ctx.forwarded?.has(funcName)) continue;

        ctx.detections.push({
          moduleName: ctx.mod.name,
          importDll: dllName,
          functionName: funcName,
          iatAddress: `0x${iatAbs.toString(16)}`,
          expectedModule: sourceMod.name,
          actualTarget: `0x${funcAddr.toString(16)}`,
          actualModule: findOwningModule(modules, funcAddr),
        });
      }
    }
  }

  /**
   * Analyze sections for anomalies (RWX, writable code, etc.).
   */
  async analyzeSections(pid: number, moduleBase: string): Promise<SectionAnomaly[]> {
    const sections = await this.listSections(pid, moduleBase);
    const anomalies: SectionAnomaly[] = [];

    for (const sec of sections) {
      // RWX section
      if (sec.isReadable && sec.isWritable && sec.isExecutable) {
        anomalies.push({
          sectionName: sec.name,
          anomalyType: 'rwx',
          severity: 'high',
          details: `Section ${sec.name} has Read+Write+Execute permissions — unusual and potentially malicious`,
        });
      }
      // Writable code section
      else if (sec.isWritable && sec.isExecutable) {
        anomalies.push({
          sectionName: sec.name,
          anomalyType: 'writable_code',
          severity: 'high',
          details: `Section ${sec.name} is writable and executable — code may be self-modifying or packed`,
        });
      }
      // Executable data section (unexpected)
      else if (
        sec.isExecutable &&
        !sec.name.startsWith('.text') &&
        !sec.name.startsWith('.code') &&
        (sec.characteristics & IMAGE_SCN.CNT_INITIALIZED_DATA) !== 0
      ) {
        anomalies.push({
          sectionName: sec.name,
          anomalyType: 'executable_data',
          severity: 'medium',
          details: `Data section ${sec.name} has execute permission`,
        });
      }
    }

    return anomalies;
  }

  // ── Private Helpers ──

  private async readCoreHeaders(hProcess: bigint, base: bigint): Promise<PeCoreHeaders> {
    const dosData = ReadProcessMemory(hProcess, base, DOS_HEADER_SIZE);
    const e_lfanew = dosData.readUInt32LE(E_LFANEW_OFFSET);
    if (e_lfanew < DOS_HEADER_SIZE) {
      throw new Error(`Invalid e_lfanew: 0x${e_lfanew.toString(16)}`);
    }

    const ntData = ReadProcessMemory(hProcess, base + BigInt(e_lfanew), NT_HEADERS_SIZE);
    // Validate the full "PE\0\0" signature before trusting numSections /
    // data-directory offsets parsed from a corrupt header.
    const ntSignature = ntData.readUInt32LE(0);
    if (ntSignature !== PE_SIGNATURE) {
      throw new Error(`Invalid PE signature: expected 0x4550, got 0x${ntSignature.toString(16)}`);
    }

    const numSections = ntData.readUInt16LE(FILE_HEADER_OFFSET + 2);
    const sizeOfOptionalHeader = ntData.readUInt16LE(FILE_HEADER_OFFSET + 16);
    const magic = ntData.readUInt16LE(OPTIONAL_HEADER_OFFSET);
    const isPE32Plus = magic === PE32PLUS_MAGIC;
    const numberOfRvaAndSizes = isPE32Plus
      ? ntData.readUInt32LE(PE32PLUS_NUMBER_OF_RVA_AND_SIZES_OFFSET)
      : ntData.readUInt32LE(PE32_NUMBER_OF_RVA_AND_SIZES_OFFSET);

    // Data directories start after fixed optional header fields
    const dataDirectoriesOffset = isPE32Plus
      ? PE32PLUS_DATA_DIRECTORIES_OFFSET
      : PE32_DATA_DIRECTORIES_OFFSET;
    const dataDirectories: { rva: number; size: number }[] = [];
    for (let i = 0; i < Math.min(numberOfRvaAndSizes, MAX_DATA_DIRECTORIES); i++) {
      const off = dataDirectoriesOffset + i * 8;
      if (off + 8 <= ntData.length) {
        dataDirectories.push({
          rva: ntData.readUInt32LE(off),
          size: ntData.readUInt32LE(off + 4),
        });
      }
    }

    const firstSectionOffset = e_lfanew + FILE_HEADER_OFFSET + 20 + sizeOfOptionalHeader;

    return { numSections, isPE32Plus, firstSectionOffset, dataDirectories };
  }

  /** Read the section table from process memory (name/virtual layout only). */
  private async readSectionsFromMemory(
    hProcess: bigint,
    base: bigint,
    headers: { numSections: number; firstSectionOffset: number },
  ): Promise<Array<{ name: string; virtualAddress: number; virtualSize: number }>> {
    const sections: Array<{ name: string; virtualAddress: number; virtualSize: number }> = [];
    for (let i = 0; i < headers.numSections; i++) {
      const sectionOffset = headers.firstSectionOffset + i * SECTION_HEADER_SIZE;
      const sectionData = ReadProcessMemory(
        hProcess,
        base + BigInt(sectionOffset),
        SECTION_HEADER_SIZE,
      );
      const nameBytes = sectionData.subarray(0, 8);
      const name = nameBytes.toString('utf8').split(String.fromCharCode(0))[0]!;
      const virtualSize = sectionData.readUInt32LE(8);
      const virtualAddress = sectionData.readUInt32LE(12);
      sections.push({ name, virtualAddress, virtualSize });
    }
    return sections;
  }

  private readThunkArray(
    hProcess: bigint,
    base: bigint,
    thunkRva: number,
    isPE32Plus: boolean,
  ): ImportFunction[] {
    const thunkSize = isPE32Plus ? 8 : 4;
    const functions: ImportFunction[] = [];
    const ordinal = ordinalFlag(isPE32Plus);

    for (let i = 0; i < MAX_THUNK_ENTRIES; i++) {
      const thunkData = ReadProcessMemory(
        hProcess,
        base + BigInt(thunkRva + i * thunkSize),
        thunkSize,
      );
      const thunkValue = isPE32Plus
        ? thunkData.readBigUInt64LE(0)
        : BigInt(thunkData.readUInt32LE(0));

      if (thunkValue === 0n) break; // End of array

      if ((thunkValue & ordinal) !== 0n) {
        // Import by ordinal
        functions.push({
          name: `Ordinal#${Number(thunkValue & 0xffffn)}`,
          ordinal: Number(thunkValue & 0xffffn),
          hint: 0,
          thunkRva: `0x${(thunkRva + i * thunkSize).toString(16)}`,
        });
      } else {
        // Import by name — read IMAGE_IMPORT_BY_NAME
        const hintNameRva = Number(thunkValue);
        const hintNameData = ReadProcessMemory(
          hProcess,
          base + BigInt(hintNameRva),
          MAX_HINT_NAME_BYTES,
        );
        const hint = hintNameData.readUInt16LE(0);
        const nullIdx = hintNameData.indexOf(0, 2);
        const name = hintNameData
          .subarray(2, nullIdx > 2 ? nullIdx : MAX_HINT_NAME_BYTES)
          .toString('ascii');

        functions.push({
          name,
          ordinal: 0,
          hint,
          thunkRva: `0x${(thunkRva + i * thunkSize).toString(16)}`,
        });
      }
    }

    return functions;
  }

  private enumerateModulesInternal(hProcess: bigint): ProcessModuleEntry[] {
    return enumerateProcessModules(hProcess);
  }

  /**
   * Convert an RVA to a file offset using the section table parsed by
   * {@link parsePEFromBuffer} — no duplicated section-header parsing. Returns
   * -1 when the buffer is not a valid PE or the RVA maps to no section.
   * Public so sibling native modules (e.g. AntiCheatDetector's disk-vs-memory
   * integrity scan) reuse the same mapping instead of re-parsing section
   * headers with raw offsets.
   */
  rvaToFileOffset(peData: Buffer, rva: number): number {
    let parsed: PEParsedBuffer;
    try {
      parsed = this.parsePEFromBuffer(peData);
    } catch {
      return -1; // Not a valid PE — nothing to map
    }

    for (const section of parsed.sections) {
      if (rva >= section.virtualAddress && rva < section.virtualAddress + section.virtualSize) {
        // An RVA can hit a section's virtual range while its raw data is
        // smaller (e.g. zero-filled .bss) — don't map past sizeOfRawData.
        const offset = section.pointerToRawData + (rva - section.virtualAddress);
        if (offset < section.pointerToRawData + section.sizeOfRawData) return offset;
      }
    }

    return -1; // Not found
  }

  /**
   * Classify a hook pattern from the first bytes of a function in memory.
   *
   * Recognises the 8 inline-hook patterns documented in pe-sieve's
   * PatchAnalyzer (plus INT3/padding non-hook modifications):
   *   - `jmp_rel32`   E9 disp32          — direct jump
   *   - `call_rel32`  E8 disp32          — direct call hook
   *   - `short_jmp`   EB disp8           — short jump hook
   *   - `jmp_abs64`   FF 25 ...          — indirect jump via [rip+disp32]
   *   - `mov_jmp`     B8-BF imm32 FF E0-EF — MOV reg,imm32; JMP reg
   *   - `mov_call`    B8-BF imm32 FF D0-DF — MOV reg,imm32; CALL reg
   *   - `push_ret`    68 imm32 C3        — PUSH imm32; RET
   *   - `int3_breakpoint` CC             — debug breakpoint
   *   - `padding`     any run of identical bytes (e.g. NOP sled 0x90)
   */
  private classifyHook(memBytes: Buffer): InlineHookDetection['hookType'] {
    // Delegate to the shared HookPatternScanner (extracted from this class).
    // Buffer is a Uint8Array subclass, so it is accepted directly.
    return classifyHookPattern(memBytes);
  }

  /**
   * Decode the jump/call target address for a classified hook.
   *
   * Delegates to the shared HookPatternScanner.decodeHookTarget (extracted
   * from this class). Returns `'0x0'` when the pattern has no extractable
   * target. Buffer is a Uint8Array subclass, accepted directly.
   */
  private decodeJumpTarget(memBytes: Buffer, funcAddr: bigint): string {
    return decodeHookTarget(memBytes, funcAddr);
  }

  /**
   * Parse PE headers and section table from a raw on-disk or in-memory buffer.
   * Public so memory-comparison/restoration handlers (e.g. process hollowing
   * detection) can resolve section file offsets without re-implementing the
   * parser or reaching into private state.
   */
  parsePEFromBuffer(buffer: Buffer): PEParsedBuffer {
    // Read DOS header
    const e_magic = buffer.readUInt16LE(0);
    if (e_magic !== MZ_MAGIC) {
      throw new Error(
        `Invalid DOS header in buffer: expected 0x5A4D, got 0x${e_magic.toString(16)}`,
      );
    }
    const e_lfanew = buffer.readUInt32LE(E_LFANEW_OFFSET);
    if (e_lfanew < DOS_HEADER_SIZE || e_lfanew + NT_HEADERS_SIZE > buffer.length) {
      throw new Error(`Invalid e_lfanew in buffer: 0x${e_lfanew.toString(16)}`);
    }

    // Read NT headers
    const ntSignature = buffer.readUInt32LE(e_lfanew);
    if (ntSignature !== PE_SIGNATURE) {
      throw new Error(
        `Invalid PE signature in buffer: expected 0x4550, got 0x${ntSignature.toString(16)}`,
      );
    }

    // File header (offset = e_lfanew + 4)
    const fileHeaderOffset = e_lfanew + FILE_HEADER_OFFSET;
    const machine = buffer.readUInt16LE(fileHeaderOffset);
    const numberOfSections = buffer.readUInt16LE(fileHeaderOffset + 2);
    const timeDateStamp = buffer.readUInt32LE(fileHeaderOffset + 4);

    // Optional header magic (offset = e_lfanew + 24)
    // Note: isPE32Plus determination available for future PE32+ specific handling
    // const magic = buffer.readUInt16LE(e_lfanew + OPTIONAL_HEADER_OFFSET);
    // const isPE32Plus = magic === PE32PLUS_MAGIC;

    // Section table offset = e_lfanew + 24 + sizeOfOptionalHeader
    const sizeOfOptionalHeader = buffer.readUInt16LE(fileHeaderOffset + 16);
    const sectionTableOffset = e_lfanew + OPTIONAL_HEADER_OFFSET + sizeOfOptionalHeader;

    // Parse sections
    const sections: Array<{
      name: string;
      virtualAddress: number;
      virtualSize: number;
      pointerToRawData: number;
      sizeOfRawData: number;
    }> = [];
    for (let i = 0; i < numberOfSections; i++) {
      const offset = sectionTableOffset + i * SECTION_HEADER_SIZE;
      const nameBytes = buffer.subarray(offset, offset + 8);
      const name = nameBytes.toString('utf8').split(String.fromCharCode(0))[0]!;
      const virtualSize = buffer.readUInt32LE(offset + 8);
      const virtualAddress = buffer.readUInt32LE(offset + 12);
      const sizeOfRawData = buffer.readUInt32LE(offset + 16);
      const pointerToRawData = buffer.readUInt32LE(offset + 20);

      sections.push({ name, virtualAddress, virtualSize, pointerToRawData, sizeOfRawData });
    }

    return { fileHeader: { machine, numberOfSections, timeDateStamp }, sections };
  }

  /**
   * Compare process memory PE sections with on-disk PE file.
   * Used for detecting process hollowing (original code replaced with malicious code).
   *
   * @param pid - Process ID
   * @param moduleBase - Module base address (hex string, e.g., "0x400000")
   * @param diskPath - Path to the on-disk PE file
   * @returns Comparison result with confidence score and list of differing sections
   */
  async compareMemoryWithDisk(
    pid: number,
    moduleBase: string,
    diskPath: string,
  ): Promise<{
    isMatch: boolean;
    confidence: number;
    differences: Array<{
      sectionName: string;
      offsetStart: number;
      offsetEnd: number;
      memoryHash: string;
      diskHash: string;
      bytesCompared: number;
    }>;
  }> {
    const base = BigInt(moduleBase.startsWith('0x') ? moduleBase : `0x${moduleBase}`);
    const hProcess = openProcessForMemory(pid);

    try {
      // 1. Parse memory PE (shared header + section parsing instead of a
      //    third copy of the DOS/NT header reads).
      const headers = await this.readCoreHeaders(hProcess, base);
      const memorySections = await this.readSectionsFromMemory(hProcess, base, headers);

      // 2. Read and parse disk PE file
      const diskBuffer = await fs.readFile(diskPath);
      const diskPE = this.parsePEFromBuffer(diskBuffer);

      // 3. Compare critical sections (.text, .data, .rdata)
      const criticalSections = ['.text', '.data', '.rdata'];
      const differences: Array<{
        sectionName: string;
        offsetStart: number;
        offsetEnd: number;
        memoryHash: string;
        diskHash: string;
        bytesCompared: number;
      }> = [];

      let totalBytesChecked = 0;
      let matchingBytes = 0;

      for (const memSection of memorySections) {
        if (!criticalSections.includes(memSection.name)) continue;

        // Find corresponding section in disk PE
        const diskSection = diskPE.sections.find((s) => s.name === memSection.name);
        if (!diskSection) {
          logger.warn(`Section ${memSection.name} not found in disk PE`);
          continue;
        }

        // Read memory section
        const memoryBytes = ReadProcessMemory(
          hProcess,
          base + BigInt(memSection.virtualAddress),
          Math.min(memSection.virtualSize, diskSection.sizeOfRawData),
        );

        // Read disk section
        const diskBytes = diskBuffer.subarray(
          diskSection.pointerToRawData,
          diskSection.pointerToRawData + Math.min(diskSection.sizeOfRawData, memoryBytes.length),
        );

        // Pad if sizes differ
        const compareSize = Math.min(memoryBytes.length, diskBytes.length);
        const memorySlice = memoryBytes.subarray(0, compareSize);
        const diskSlice = diskBytes.subarray(0, compareSize);

        totalBytesChecked += compareSize;

        // Compute hashes
        const { createHash } = await import('node:crypto');
        const memoryHash = createHash('sha256').update(memorySlice).digest('hex');
        const diskHash = createHash('sha256').update(diskSlice).digest('hex');

        if (memoryHash !== diskHash) {
          differences.push({
            sectionName: memSection.name,
            offsetStart: memSection.virtualAddress,
            offsetEnd: memSection.virtualAddress + compareSize,
            memoryHash,
            diskHash,
            bytesCompared: compareSize,
          });
        } else {
          matchingBytes += compareSize;
        }
      }

      // 4. Calculate confidence
      // confidence = (matching bytes / total bytes) * 100
      const confidence =
        totalBytesChecked > 0 ? Math.round((matchingBytes / totalBytesChecked) * 100) : 0;

      return {
        isMatch: differences.length === 0,
        confidence,
        differences,
      };
    } finally {
      CloseHandle(hProcess);
    }
  }
}

export const peAnalyzer = new PEAnalyzer();

/** One loaded module as returned by enumerateModulesInternal. */
type PeModuleEntry = { name: string; base: string; path: string; size: number };

/** Context for walking a single import descriptor's IAT. */
interface IatWalkContext {
  mod: PeModuleEntry;
  base: bigint;
  headers: PeCoreHeaders;
  modules: PeModuleEntry[];
  sourceMod: PeModuleEntry | undefined;
  srcBase: bigint;
  srcEnd: bigint;
  dllName: string;
  firstThunkRva: number;
  originalFirstThunkRva: number;
  thunkSize: number;
  forwarded: Set<string> | undefined;
  detections: IATHookDetection[];
}

/** Read the imported DLL's name from its RVA. */
function readImportDllName(hProcess: bigint, base: bigint, nameRva: number): string {
  const nameData = ReadProcessMemory(hProcess, base + BigInt(nameRva), MAX_DLL_NAME_BYTES);
  const nullIdx = nameData.indexOf(0);
  return nameData.subarray(0, nullIdx > 0 ? nullIdx : MAX_DLL_NAME_BYTES).toString('ascii');
}

/** Resolve the loaded module that a DLL name refers to (exact, then stem). */
function resolveSourceModule(modules: PeModuleEntry[], dllName: string): PeModuleEntry | undefined {
  const dllStem = dllName.toLowerCase().replace(/\.dll$/i, '');
  return (
    modules.find((m) => m.name.toLowerCase() === dllName.toLowerCase()) ??
    modules.find((m) => m.name.toLowerCase().replace(/\.dll$/i, '') === dllStem)
  );
}

/** Find which loaded module owns an address, or null when unowned. */
function findOwningModule(modules: PeModuleEntry[], funcAddr: bigint): string | null {
  for (const m of modules) {
    const mb = BigInt(m.base);
    if (funcAddr >= mb && funcAddr < mb + BigInt(m.size)) {
      return m.name;
    }
  }
  return null;
}

/** Resolve the imported function's name from the INT (hint/name table),
 * falling back to `Ordinal#0` when the entry is unusable. */
function readImportedFunctionName(
  hProcess: bigint,
  ctx: {
    base: bigint;
    headers: PeCoreHeaders;
    originalFirstThunkRva: number;
    firstThunkRva: number;
    index: number;
    thunkSize: number;
    ordinal: bigint;
  },
): string {
  const { base, headers, originalFirstThunkRva, firstThunkRva, index, thunkSize, ordinal } = ctx;
  let funcName = `Ordinal#0`;
  const intRva = originalFirstThunkRva || firstThunkRva;
  if (!intRva) return funcName;

  const intData = ReadProcessMemory(hProcess, base + BigInt(intRva + index * thunkSize), thunkSize);
  const intValue = headers.isPE32Plus
    ? intData.readBigUInt64LE(0)
    : BigInt(intData.readUInt32LE(0));

  if ((intValue & ordinal) !== 0n) {
    funcName = `Ordinal#${Number(intValue & 0xffffn)}`;
  } else if (intValue !== 0n) {
    const hintNameData = ReadProcessMemory(
      hProcess,
      base + BigInt(Number(intValue)),
      MAX_HINT_NAME_BYTES,
    );
    const ni = hintNameData.indexOf(0, 2);
    funcName = hintNameData.subarray(2, ni > 2 ? ni : MAX_HINT_NAME_BYTES).toString('ascii');
  }
  return funcName;
}
