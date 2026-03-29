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
import {
  openProcessForMemory,
  CloseHandle,
  ReadProcessMemory,
  EnumProcessModules,
  GetModuleBaseName,
  GetModuleFileNameEx,
  GetModuleInformation,
} from '@native/Win32API';
import type {
  PEHeaders,
  PESection,
  ImportEntry,
  ImportFunction,
  ExportEntry,
  InlineHookDetection,
  SectionAnomaly,
} from './PEAnalyzer.types';
import { IMAGE_SCN, IMAGE_DIRECTORY_ENTRY } from './PEAnalyzer.types';

// ── Constants ──

const MZ_MAGIC = 0x5a4d;
const PE_SIGNATURE = 0x00004550;
const PE32PLUS_MAGIC = 0x20b;
const SECTION_HEADER_SIZE = 40;
const IMPORT_DESCRIPTOR_SIZE = 20;
const COMPARE_BYTES = 16; // Bytes to compare for inline hook detection

// ── PEAnalyzer Class ──

export class PEAnalyzer {
  /**
   * Parse PE headers from a module's base address in process memory.
   */
  async parseHeaders(pid: number, moduleBase: string): Promise<PEHeaders> {
    const base = BigInt(moduleBase);
    const hProcess = openProcessForMemory(pid);

    try {
      // Read DOS header (64 bytes)
      const dosData = ReadProcessMemory(hProcess, base, 64);
      const e_magic = dosData.readUInt16LE(0);
      if (e_magic !== MZ_MAGIC) {
        throw new Error(`Invalid DOS header: expected 0x5A4D, got 0x${e_magic.toString(16)}`);
      }
      const e_lfanew = dosData.readUInt32LE(60);

      // Read NT headers (4 + 20 + 240 for PE32+)
      const ntData = ReadProcessMemory(hProcess, base + BigInt(e_lfanew), 264);
      const ntSignature = ntData.readUInt32LE(0);
      if (ntSignature !== PE_SIGNATURE) {
        throw new Error(`Invalid PE signature: expected 0x4550, got 0x${ntSignature.toString(16)}`);
      }

      // File header (offset 4, 20 bytes)
      const machine = ntData.readUInt16LE(4);
      const numberOfSections = ntData.readUInt16LE(6);
      const timeDateStamp = ntData.readUInt32LE(8);
      const characteristics = ntData.readUInt16LE(22);

      // Optional header (offset 24)
      const magic = ntData.readUInt16LE(24);
      const isPE32Plus = magic === PE32PLUS_MAGIC;

      let imageBase: bigint;
      let entryPoint: number;
      let sizeOfImage: number;
      let numberOfRvaAndSizes: number;

      if (isPE32Plus) {
        entryPoint = ntData.readUInt32LE(40);
        imageBase = ntData.readBigUInt64LE(48);
        sizeOfImage = ntData.readUInt32LE(80);
        numberOfRvaAndSizes = ntData.readUInt32LE(132);
      } else {
        entryPoint = ntData.readUInt32LE(40);
        imageBase = BigInt(ntData.readUInt32LE(52));
        sizeOfImage = ntData.readUInt32LE(80);
        numberOfRvaAndSizes = ntData.readUInt32LE(116);
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
      const headers = await this._readCoreHeaders(hProcess, base);
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
      const headers = await this._readCoreHeaders(hProcess, base);
      const importRva = headers.dataDirectories[IMAGE_DIRECTORY_ENTRY.IMPORT];
      if (!importRva || importRva.rva === 0) return [];

      const imports: ImportEntry[] = [];
      let descOffset = importRva.rva;

      // Walk IMAGE_IMPORT_DESCRIPTOR chain (20 bytes each, terminated by all-zeros)
      for (let i = 0; i < 500; i++) {
        // Safety limit
        const desc = ReadProcessMemory(hProcess, base + BigInt(descOffset), IMPORT_DESCRIPTOR_SIZE);
        const nameRva = desc.readUInt32LE(12);
        if (nameRva === 0) break; // Terminator

        // Read DLL name
        const nameData = ReadProcessMemory(hProcess, base + BigInt(nameRva), 256);
        const nullIdx = nameData.indexOf(0);
        const dllName = nameData.subarray(0, nullIdx > 0 ? nullIdx : 256).toString('ascii');

        // Read thunk array (simplified — just collect names)
        const originalFirstThunkRva = desc.readUInt32LE(0) || desc.readUInt32LE(16);
        const functions = this._readThunkArray(
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
      const headers = await this._readCoreHeaders(hProcess, base);
      const exportDir = headers.dataDirectories[IMAGE_DIRECTORY_ENTRY.EXPORT];
      if (!exportDir || exportDir.rva === 0) return [];

      // Read IMAGE_EXPORT_DIRECTORY (40 bytes)
      const expData = ReadProcessMemory(hProcess, base + BigInt(exportDir.rva), 40);
      const numberOfNames = expData.readUInt32LE(24);
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

      for (let i = 0; i < Math.min(numberOfNames, 2000); i++) {
        const nameRva = namesBuf.readUInt32LE(i * 4);
        const ordIndex = ordsBuf.readUInt16LE(i * 2);

        // Read function name
        const nameBuf = ReadProcessMemory(hProcess, base + BigInt(nameRva), 256);
        const nullIdx = nameBuf.indexOf(0);
        const name = nameBuf.subarray(0, nullIdx > 0 ? nullIdx : 256).toString('ascii');

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
    } finally {
      CloseHandle(hProcess);
    }
  }

  /**
   * Detect inline hooks by comparing first bytes of exported functions (disk vs memory).
   */
  async detectInlineHooks(pid: number, moduleName?: string): Promise<InlineHookDetection[]> {
    const hProcess = openProcessForMemory(pid);
    const detections: InlineHookDetection[] = [];

    try {
      // Find module by name
      const modules = this._enumerateModulesInternal(hProcess);
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
            const diskOffset = this._rvaToFileOffset(diskData, funcRva);
            if (diskOffset < 0 || diskOffset + COMPARE_BYTES > diskData.length) continue;
            const diskBytes = diskData.subarray(diskOffset, diskOffset + COMPARE_BYTES);

            // Compare
            if (!memBytes.equals(diskBytes)) {
              const hookType = this._classifyHook(memBytes);
              const jumpTarget = this._decodeJumpTarget(
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

  private async _readCoreHeaders(hProcess: bigint, base: bigint) {
    const dosData = ReadProcessMemory(hProcess, base, 64);
    const e_lfanew = dosData.readUInt32LE(60);

    const ntData = ReadProcessMemory(hProcess, base + BigInt(e_lfanew), 264);
    const numSections = ntData.readUInt16LE(6);
    const sizeOfOptionalHeader = ntData.readUInt16LE(20);
    const magic = ntData.readUInt16LE(24);
    const isPE32Plus = magic === PE32PLUS_MAGIC;
    const numberOfRvaAndSizes = isPE32Plus ? ntData.readUInt32LE(132) : ntData.readUInt32LE(116);

    // Data directories start after fixed optional header fields
    const dataDirectoriesOffset = isPE32Plus ? 136 : 120;
    const dataDirectories: { rva: number; size: number }[] = [];
    for (let i = 0; i < Math.min(numberOfRvaAndSizes, 16); i++) {
      const off = dataDirectoriesOffset + i * 8;
      if (off + 8 <= ntData.length) {
        dataDirectories.push({
          rva: ntData.readUInt32LE(off),
          size: ntData.readUInt32LE(off + 4),
        });
      }
    }

    const firstSectionOffset = e_lfanew + 4 + 20 + sizeOfOptionalHeader;

    return { numSections, isPE32Plus, firstSectionOffset, dataDirectories };
  }

  private _readThunkArray(
    hProcess: bigint,
    base: bigint,
    thunkRva: number,
    isPE32Plus: boolean,
  ): ImportFunction[] {
    const thunkSize = isPE32Plus ? 8 : 4;
    const functions: ImportFunction[] = [];
    const IMAGE_ORDINAL_FLAG = isPE32Plus ? 0x8000000000000000n : 0x80000000n;

    for (let i = 0; i < 2000; i++) {
      // Safety limit
      const thunkData = ReadProcessMemory(
        hProcess,
        base + BigInt(thunkRva + i * thunkSize),
        thunkSize,
      );
      const thunkValue = isPE32Plus
        ? thunkData.readBigUInt64LE(0)
        : BigInt(thunkData.readUInt32LE(0));

      if (thunkValue === 0n) break; // End of array

      if ((thunkValue & IMAGE_ORDINAL_FLAG) !== 0n) {
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
        const hintNameData = ReadProcessMemory(hProcess, base + BigInt(hintNameRva), 258);
        const hint = hintNameData.readUInt16LE(0);
        const nullIdx = hintNameData.indexOf(0, 2);
        const name = hintNameData.subarray(2, nullIdx > 2 ? nullIdx : 258).toString('ascii');

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

  private _enumerateModulesInternal(
    hProcess: bigint,
  ): { name: string; base: string; path: string; size: number }[] {
    const modules: { name: string; base: string; path: string; size: number }[] = [];

    try {
      const { modules: modHandles, count } = EnumProcessModules(hProcess);
      for (let i = 0; i < count; i++) {
        const hMod = modHandles[i]!;
        const name = GetModuleBaseName(hProcess, hMod);
        const info = GetModuleInformation(hProcess, hMod);

        const modulePath = GetModuleFileNameEx(hProcess, hMod) ?? name;

        if (info.success) {
          modules.push({
            name,
            base: `0x${info.info.lpBaseOfDll.toString(16)}`,
            path: modulePath,
            size: info.info.SizeOfImage,
          });
        }
      }
    } catch (e) {
      logger.debug(`Module enumeration failed: ${e}`);
    }

    return modules;
  }

  private _rvaToFileOffset(peData: Buffer, rva: number): number {
    // Read section headers to convert RVA to file offset
    const e_lfanew = peData.readUInt32LE(60);
    const numSections = peData.readUInt16LE(e_lfanew + 6);
    const sizeOfOptionalHeader = peData.readUInt16LE(e_lfanew + 20);
    const secStart = e_lfanew + 24 + sizeOfOptionalHeader;

    for (let i = 0; i < numSections; i++) {
      const off = secStart + i * 40;
      if (off + 40 > peData.length) break;

      const virtualAddr = peData.readUInt32LE(off + 12);
      const virtualSize = peData.readUInt32LE(off + 8);
      const rawOffset = peData.readUInt32LE(off + 20);

      if (rva >= virtualAddr && rva < virtualAddr + virtualSize) {
        return rawOffset + (rva - virtualAddr);
      }
    }

    return -1; // Not found
  }

  private _classifyHook(memBytes: Buffer): InlineHookDetection['hookType'] {
    if (memBytes[0] === 0xe9) return 'jmp_rel32';
    if (memBytes[0] === 0xff && memBytes[1] === 0x25) return 'jmp_abs64';
    if (memBytes[0] === 0x68 && memBytes[5] === 0xc3) return 'push_ret';
    return 'unknown';
  }

  private _decodeJumpTarget(memBytes: Buffer, funcAddr: bigint): string {
    if (memBytes[0] === 0xe9) {
      // JMP rel32 — target = addr + 5 + rel32
      const rel32 = memBytes.readInt32LE(1);
      return `0x${(funcAddr + 5n + BigInt(rel32)).toString(16)}`;
    }
    if (memBytes[0] === 0xff && memBytes[1] === 0x25) {
      // JMP [rip+disp32] — in x64, followed by 8-byte address
      if (memBytes.length >= 14) {
        const target = memBytes.readBigUInt64LE(6);
        return `0x${target.toString(16)}`;
      }
    }
    if (memBytes[0] === 0x68) {
      // PUSH imm32; RET
      const target = memBytes.readUInt32LE(1);
      return `0x${target.toString(16)}`;
    }
    return '0x0';
  }
}

export const peAnalyzer = new PEAnalyzer();
