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
  IATHookDetection,
  SectionAnomaly,
  PEParsedBuffer,
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
      const headers = await this.readCoreHeaders(hProcess, base);
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

          const thunkSize = headers.isPE32Plus ? 8 : 4;
          const IMAGE_ORDINAL_FLAG = headers.isPE32Plus ? 0x8000000000000000n : 0x80000000n;
          let descOffset = importDir.rva;

          // Walk IMAGE_IMPORT_DESCRIPTOR chain (20 bytes each).
          for (let i = 0; i < 500; i++) {
            const desc = ReadProcessMemory(
              hProcess,
              base + BigInt(descOffset),
              IMPORT_DESCRIPTOR_SIZE,
            );
            const nameRva = desc.readUInt32LE(12);
            if (nameRva === 0) break; // Terminator

            const firstThunkRva = desc.readUInt32LE(16); // IAT (loader-filled)
            const originalFirstThunkRva = desc.readUInt32LE(0); // INT (hint/name)

            // Read DLL name.
            const nameData = ReadProcessMemory(hProcess, base + BigInt(nameRva), 256);
            const nullIdx = nameData.indexOf(0);
            const dllName = nameData.subarray(0, nullIdx > 0 ? nullIdx : 256).toString('ascii');

            // Resolve the declared source module's loaded range.
            const dllStem = dllName.toLowerCase().replace(/\.dll$/i, '');
            const sourceMod =
              modules.find((m) => m.name.toLowerCase() === dllName.toLowerCase()) ??
              modules.find((m) => m.name.toLowerCase().replace(/\.dll$/i, '') === dllStem);
            const srcBase = sourceMod ? BigInt(sourceMod.base) : 0n;
            const srcEnd = sourceMod ? srcBase + BigInt(sourceMod.size) : 0n;

            // Walk IAT thunks.
            for (let j = 0; j < 2000; j++) {
              const iatAbs = base + BigInt(firstThunkRva + j * thunkSize);
              const thunkData = ReadProcessMemory(hProcess, iatAbs, thunkSize);
              const funcAddr = headers.isPE32Plus
                ? thunkData.readBigUInt64LE(0)
                : BigInt(thunkData.readUInt32LE(0));
              if (funcAddr === 0n) break; // End of IAT

              // Resolve function name from INT (OriginalFirstThunk) if present.
              let funcName = `Ordinal#0`;
              const intRva = originalFirstThunkRva || firstThunkRva;
              if (intRva) {
                const intData = ReadProcessMemory(
                  hProcess,
                  base + BigInt(intRva + j * thunkSize),
                  thunkSize,
                );
                const intValue = headers.isPE32Plus
                  ? intData.readBigUInt64LE(0)
                  : BigInt(intData.readUInt32LE(0));
                if ((intValue & IMAGE_ORDINAL_FLAG) !== 0n) {
                  funcName = `Ordinal#${Number(intValue & 0xffffn)}`;
                } else if (intValue !== 0n) {
                  const hintNameData = ReadProcessMemory(
                    hProcess,
                    base + BigInt(Number(intValue)),
                    258,
                  );
                  const ni = hintNameData.indexOf(0, 2);
                  funcName = hintNameData.subarray(2, ni > 2 ? ni : 258).toString('ascii');
                }
              }

              // Flag if the resolved address is outside the source module range.
              if (sourceMod && (funcAddr < srcBase || funcAddr >= srcEnd)) {
                let actualModule: string | null = null;
                for (const m of modules) {
                  const mb = BigInt(m.base);
                  if (funcAddr >= mb && funcAddr < mb + BigInt(m.size)) {
                    actualModule = m.name;
                    break;
                  }
                }
                detections.push({
                  moduleName: mod.name,
                  importDll: dllName,
                  functionName: funcName,
                  iatAddress: `0x${iatAbs.toString(16)}`,
                  expectedModule: sourceMod.name,
                  actualTarget: `0x${funcAddr.toString(16)}`,
                  actualModule,
                });
              }
            }
            descOffset += IMPORT_DESCRIPTOR_SIZE;
          }
        } catch (e) {
          logger.debug(`IAT hook check skipped for ${mod.name}: ${e}`);
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

  private async readCoreHeaders(hProcess: bigint, base: bigint) {
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

  private readThunkArray(
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

  private enumerateModulesInternal(
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

  private rvaToFileOffset(peData: Buffer, rva: number): number {
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
    if (memBytes.length === 0) return 'unknown';
    const b0 = memBytes[0]!;
    // INT3 breakpoint (single or repeated 0xCC).
    if (b0 === 0xcc) return 'int3_breakpoint';
    // Padding: all bytes identical (NOP sled, zero-fill). Excludes 0xCC above.
    if (memBytes.length >= 2 && memBytes.every((b) => b === b0)) return 'padding';
    if (b0 === 0xe9) return 'jmp_rel32';
    if (b0 === 0xe8) return 'call_rel32';
    if (b0 === 0xeb) return 'short_jmp';
    if (b0 === 0xff && memBytes[1] === 0x25) return 'jmp_abs64';
    // MOV r32, imm32 (B8-BF) followed by FF E0-EF (JMP r32) or FF D0-DF (CALL r32).
    // Layout: [B8-BF][imm32 4 bytes][FF][E0-EF | D0-DF] = 7 bytes minimum.
    if (b0 >= 0xb8 && b0 <= 0xbf && memBytes.length >= 8) {
      if (memBytes[6] === 0xff) {
        const reg = memBytes[7]!;
        if (reg >= 0xe0 && reg <= 0xef) return 'mov_jmp';
        if (reg >= 0xd0 && reg <= 0xdf) return 'mov_call';
      }
    }
    if (b0 === 0x68 && memBytes[5] === 0xc3) return 'push_ret';
    return 'unknown';
  }

  /**
   * Decode the jump/call target address for a classified hook.
   *
   * Returns `'0x0'` when the pattern has no extractable target
   * (INT3, padding, unknown). For `mov_jmp`/`mov_call` the target is the
   * immediate loaded by the MOV instruction (the absolute address the hook
   * redirects to), matching pe-sieve's `parseMovJmp` extraction.
   */
  private decodeJumpTarget(memBytes: Buffer, funcAddr: bigint): string {
    if (memBytes.length === 0) return '0x0';
    const b0 = memBytes[0]!;
    // JMP rel32 / CALL rel32 — target = funcAddr + 5 + rel32
    if (b0 === 0xe9 || b0 === 0xe8) {
      const rel32 = memBytes.readInt32LE(1);
      return `0x${(funcAddr + 5n + BigInt(rel32)).toString(16)}`;
    }
    // Short JMP rel8 — target = funcAddr + 2 + rel8
    if (b0 === 0xeb) {
      const rel8 = memBytes.readInt8(1);
      return `0x${(funcAddr + 2n + BigInt(rel8)).toString(16)}`;
    }
    if (b0 === 0xff && memBytes[1] === 0x25) {
      // JMP [rip+disp32] — in x64, the 8-byte absolute target follows the 6-byte instruction.
      if (memBytes.length >= 14) {
        const target = memBytes.readBigUInt64LE(6);
        return `0x${target.toString(16)}`;
      }
    }
    // MOV r32, imm32 (B8-BF) — target is the loaded immediate (mov_jmp / mov_call).
    if (b0 >= 0xb8 && b0 <= 0xbf) {
      const imm32 = memBytes.readUInt32LE(1);
      return `0x${imm32.toString(16)}`;
    }
    if (b0 === 0x68) {
      // PUSH imm32; RET — target = pushed immediate
      const target = memBytes.readUInt32LE(1);
      return `0x${target.toString(16)}`;
    }
    return '0x0';
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
    const e_lfanew = buffer.readUInt32LE(60);

    // Read NT headers
    const ntSignature = buffer.readUInt32LE(e_lfanew);
    if (ntSignature !== PE_SIGNATURE) {
      throw new Error(
        `Invalid PE signature in buffer: expected 0x4550, got 0x${ntSignature.toString(16)}`,
      );
    }

    // File header (offset = e_lfanew + 4)
    const fileHeaderOffset = e_lfanew + 4;
    const machine = buffer.readUInt16LE(fileHeaderOffset);
    const numberOfSections = buffer.readUInt16LE(fileHeaderOffset + 2);
    const timeDateStamp = buffer.readUInt32LE(fileHeaderOffset + 4);

    // Optional header magic (offset = e_lfanew + 24)
    // Note: isPE32Plus determination available for future PE32+ specific handling
    // const magic = buffer.readUInt16LE(e_lfanew + 24);
    // const isPE32Plus = magic === PE32PLUS_MAGIC;

    // Section table offset = e_lfanew + 24 + sizeOfOptionalHeader
    const sizeOfOptionalHeader = buffer.readUInt16LE(fileHeaderOffset + 16);
    const sectionTableOffset = e_lfanew + 24 + sizeOfOptionalHeader;

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
      // 1. Parse memory PE (we need sections, so use the internal method)
      // Read DOS header
      const dosData = ReadProcessMemory(hProcess, base, 64);
      const e_lfanew = dosData.readUInt32LE(60);

      // Read NT headers to get section count
      const ntData = ReadProcessMemory(hProcess, base + BigInt(e_lfanew), 264);
      const fileHeaderOffset = 4;
      const numberOfSections = ntData.readUInt16LE(fileHeaderOffset + 2);
      const sizeOfOptionalHeader = ntData.readUInt16LE(fileHeaderOffset + 16);
      const sectionTableOffset = e_lfanew + 24 + sizeOfOptionalHeader;

      // Parse memory sections
      const memorySections: Array<{ name: string; virtualAddress: number; virtualSize: number }> =
        [];
      for (let i = 0; i < numberOfSections; i++) {
        const sectionOffset = sectionTableOffset + i * SECTION_HEADER_SIZE;
        const sectionData = ReadProcessMemory(
          hProcess,
          base + BigInt(sectionOffset),
          SECTION_HEADER_SIZE,
        );
        const nameBytes = sectionData.subarray(0, 8);
        const name = nameBytes.toString('utf8').split(String.fromCharCode(0))[0]!;
        const virtualSize = sectionData.readUInt32LE(8);
        const virtualAddress = sectionData.readUInt32LE(12);
        memorySections.push({ name, virtualAddress, virtualSize });
      }

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
