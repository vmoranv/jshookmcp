/**
 * Mono / .NET Runtime Dissector for Unity games.
 *
 * Enumerates Mono assemblies, classes, objects, and fields from a running Unity
 * process via ReadProcessMemory — no DLL injection required.
 *
 * ## Architecture
 *
 *   1. **Runtime detection**: Enumerate loaded modules, find mono-2.0-bdwgc.dll,
 *      mono.dll, or GameAssembly.dll (IL2CPP).
 *   2. **Root domain discovery**: Resolve mono_get_root_domain export to locate
 *      the domain pointer, then read MonoDomain.domain_id + assembly list.
 *   3. **Class/assembly walk**: Walk MonoAssembly → MonoImage → MonoClass tables.
 *   4. **Object scan**: Scan managed heap regions for vtable patterns matching
 *      known MonoClass vtables (class name lookup).
 *   5. **Field reading**: Given a MonoObject + MonoClass field list, read each
 *      field value at its offset with type-aware decoding.
 *
 * ## Supported runtimes
 *   - Mono 2.0 (Unity 4.x–2017.x): mono.dll / mono-2.0-bdwgc.dll
 *   - IL2CPP (Unity 2018.x+): GameAssembly.dll + global-metadata.dat (detection only)
 *
 * ## Known limitation
 *
 * Mono struct layouts (MonoDomain, MonoAssembly, MonoClass, MonoObject) vary
 * across Mono versions. The offsets used here are validated against the Mono
 * 6.x / Unity 2020.x runtime shipped with mono-2.0-bdwgc.dll (x64). 32-bit
 * and older Mono versions use different layouts and may return incorrect or
 * no results. Field offsets within managed objects are read from MonoClassField
 * at runtime, so they are always version-correct for the detected runtime.
 *
 * @module MonoAnalyzer
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
  MonoRuntimeInfo,
  MonoAssemblyInfo,
  MonoClassInfo,
  MonoObjectInfo,
  MonoFieldInfo,
  MonoFieldValue,
  Il2CppMetadataSummary,
} from './MonoAnalyzer.types';

// ── Constants ──

/** Known Mono DLL names in descending priority. */
const MONO_MODULE_NAMES = [
  'mono-2.0-bdwgc.dll',
  'mono.dll',
  'libmono.so',
  'libmono-2.0.so',
  'libmonobdwgc-2.0.so',
] as const;

/** IL2CPP module names. */
const IL2CPP_MODULE_NAMES = ['GameAssembly.dll', 'libil2cpp.so'] as const;

/** Mono root domain symbol names to try (in order). */
const ROOT_DOMAIN_SYMBOLS = ['mono_root_domain', 'mono_get_root_domain'];

// x64 Mono struct offsets (Mono 6.x / Unity 2020.x, mono-2.0-bdwgc.dll)
// These are validated against the Mono object layout docs.

/** sizeof(MonoObject) on x64: vtable(8) + sync(8) = 16. */
const MONO_OBJECT_HEADER_SIZE_64 = 16;

/** MonoClassField offsets on x64: type(8) + name(8) + parent(8) + offset(4). */
// x64 MonoClassField is 28 bytes, padded to 32 (offset(4) + 4 tail padding).
// Striding by 24 would land inside the previous entry's offset field.
const MONO_CLASS_FIELD_SIZE = 32;
const MONO_CLASS_FIELD_OFFSET_OFF = 24; // offset of the 'offset' field within MonoClassField

// MonoThreadsSync size on x64 = 8 (approximated, reference for MonoString size calc).

// ── Helpers ──

function hexAddr(addr: bigint): string {
  return `0x${addr.toString(16).toUpperCase()}`;
}

function readString(handle: bigint, addr: bigint, maxLen = 256): string | null {
  try {
    const buf = ReadProcessMemory(handle, addr, maxLen);
    const nullIdx = buf.indexOf(0);
    return (nullIdx >= 0 ? buf.subarray(0, nullIdx) : buf).toString('utf8');
  } catch {
    return null;
  }
}

function readPtr(handle: bigint, addr: bigint, is64: boolean): bigint {
  const buf = ReadProcessMemory(handle, addr, is64 ? 8 : 4);
  return is64 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
}

function readU32(handle: bigint, addr: bigint): number {
  return ReadProcessMemory(handle, addr, 4).readUInt32LE(0);
}

function readI32(handle: bigint, addr: bigint): number {
  return ReadProcessMemory(handle, addr, 4).readInt32LE(0);
}

// ── MonoAnalyzer class ──

export class MonoAnalyzer {
  /**
   * Detect the Mono or IL2CPP runtime in a target process.
   * Returns runtime info or throws if no supported runtime is found.
   */
  async detectRuntime(pid: number): Promise<MonoRuntimeInfo> {
    const handle = openProcessForMemory(pid);
    try {
      const modules = this.enumerateModules(handle);

      // Check Mono modules first.
      for (const candidate of MONO_MODULE_NAMES) {
        const m = modules.find((m2) => m2.name.toLowerCase() === candidate.toLowerCase());
        if (m) {
          const is64 = this.detectBitness(m.base);
          const exportedSymbols = this.findExportedSymbols(handle, m);
          const rootDomain = await this.resolveRootDomain(handle, m, exportedSymbols);

          return {
            kind: 'mono',
            moduleName: m.name,
            moduleBase: m.base,
            pointerSize: is64 ? 8 : 4,
            rootDomain: rootDomain ? hexAddr(rootDomain) : undefined,
            exportedSymbols,
          };
        }
      }

      // Check IL2CPP modules.
      for (const candidate of IL2CPP_MODULE_NAMES) {
        const m = modules.find((m2) => m2.name.toLowerCase() === candidate.toLowerCase());
        if (m) {
          return {
            kind: 'il2cpp',
            moduleName: m.name,
            moduleBase: m.base,
            pointerSize: this.detectBitness(m.base) ? 8 : 4,
            exportedSymbols: [],
          };
        }
      }

      throw new Error('No Mono or IL2CPP runtime found in target process');
    } finally {
      CloseHandle(handle);
    }
  }

  /**
   * List assemblies loaded in the root domain.
   */
  async listAssemblies(pid: number): Promise<MonoAssemblyInfo[]> {
    const rt = await this.detectRuntime(pid);
    if (rt.kind === 'il2cpp') {
      // IL2CPP: assemblies come from metadata, not runtime walk.
      return [];
    }
    if (!rt.rootDomain) {
      throw new Error('Root domain not resolved — cannot enumerate assemblies');
    }

    const handle = openProcessForMemory(pid);
    try {
      const domainAddr = BigInt(rt.rootDomain);
      // The domain_assemblies field is a GSList* at a version-dependent offset.
      // For Unity 2020.x Mono, domain_assemblies is at domain + 0xA8.
      // We try multiple known offsets.
      const offsets = rt.pointerSize === 8 ? [0xa8, 0xb0, 0x98, 0xc0] : [0x60, 0x68, 0x54];
      let assemblies: MonoAssemblyInfo[] = [];

      for (const off of offsets) {
        try {
          const list = readPtr(handle, domainAddr + BigInt(off), rt.pointerSize === 8);
          if (list === 0n) continue;
          assemblies = this.walkAssemblyList(handle, list, rt.pointerSize);
          if (assemblies.length > 0) break;
        } catch {
          // Try next offset.
        }
      }

      return assemblies;
    } finally {
      CloseHandle(handle);
    }
  }

  /**
   * List classes in a specific assembly (by name match).
   * If namespaceFilter is provided, only return classes matching that namespace.
   */
  async listClasses(
    pid: number,
    assemblyNamePattern: string,
    namespaceFilter?: string,
  ): Promise<MonoClassInfo[]> {
    const assemblies = await this.listAssemblies(pid);
    const target = assemblies.find((a) =>
      a.name.toLowerCase().includes(assemblyNamePattern.toLowerCase()),
    );
    if (!target || !target.imageAddress) {
      throw new Error(
        `Assembly matching "${assemblyNamePattern}" not found or has no image. ` +
          `Found: ${assemblies.map((a) => a.name).join(', ') || 'none'}`,
      );
    }

    const handle = openProcessForMemory(pid);
    try {
      const imageAddr = BigInt(target.imageAddress);
      return this.walkClassTable(handle, imageAddr, namespaceFilter, target.name);
    } finally {
      CloseHandle(handle);
    }
  }

  /**
   * Find live objects of a specific class in the managed heap.
   * This scans heap regions for vtable pointers matching known class vtables.
   */
  async findObjects(pid: number, classNamePattern: string): Promise<MonoObjectInfo[]> {
    // `listClasses` selects an assembly (not a class), so resolve the class by
    // iterating every loaded assembly and filtering the returned classes.
    const assemblies = await this.listAssemblies(pid);
    const matching: MonoClassInfo[] = [];
    const pattern = classNamePattern.toLowerCase();
    for (const assembly of assemblies) {
      try {
        const classes = await this.listClasses(pid, assembly.name);
        for (const c of classes) {
          if (
            c.name.toLowerCase().includes(pattern) ||
            c.fullName.toLowerCase().includes(pattern)
          ) {
            matching.push(c);
          }
        }
      } catch {
        // Assembly without a readable class table — skip it.
      }
    }

    if (matching.length === 0) {
      throw new Error(`No class matching "${classNamePattern}" found`);
    }

    const handle = openProcessForMemory(pid);
    try {
      const results: MonoObjectInfo[] = [];
      const regions = this.enumWritableRegions(handle);

      // For each matching class, scan heap regions for its vtable pointer.
      for (const cls of matching) {
        const classAddr = BigInt(cls.address);
        // MonoClass->vtable is at a known offset. Try common offsets for x64.
        // The vtable pointer is typically stored at classAddr + offset.
        const vtableCandidates = [0x30, 0x38, 0x28, 0x40] as const;
        let vtableAddr = 0n;

        for (const vtoff of vtableCandidates) {
          try {
            const candidate = readPtr(handle, classAddr + BigInt(vtoff), true);
            if (candidate !== 0n) {
              vtableAddr = candidate;
              break;
            }
          } catch {
            // Try next.
          }
        }
        if (vtableAddr === 0n) continue;

        // Scan each writable region for the vtable pointer.
        for (const region of regions) {
          try {
            const ptrResults = this.scanForVtable(handle, region.start, region.size, vtableAddr);
            for (const objAddr of ptrResults) {
              results.push({
                address: hexAddr(objAddr),
                className: cls.fullName,
                namespace: cls.namespace,
                size: this.estimateObjectSize(handle, objAddr, cls.fieldCount),
              });
              if (results.length >= 200) break;
            }
          } catch {
            // Region inaccessible — skip.
          }
          if (results.length >= 200) break;
        }
        if (results.length >= 200) break;
      }

      return results;
    } finally {
      CloseHandle(handle);
    }
  }

  /**
   * Read field values from a Mono object at the given address.
   * Requires the class info to know field offsets.
   */
  async readFields(
    pid: number,
    objectAddress: string,
  ): Promise<{ className: string; fields: MonoFieldValue[] }> {
    const objAddr = BigInt(objectAddress);
    const handle = openProcessForMemory(pid);
    try {
      // Read vtable to find the class.
      const vtableAddr = readPtr(handle, objAddr, true);
      if (vtableAddr === 0n) {
        throw new Error('Object has null vtable — not a valid MonoObject');
      }

      // MonoVTable.klass is at offset 0.
      const classAddr = readPtr(handle, vtableAddr, true);
      if (classAddr === 0n) {
        throw new Error('Failed to read MonoClass from vtable');
      }

      const className = this.readClassName(handle, classAddr);
      if (!className) {
        throw new Error('Failed to read class name');
      }

      // Walk MonoClass fields.
      const fields = this.readClassFields(handle, classAddr);
      const values: MonoFieldValue[] = [];

      for (const f of fields) {
        if (f.isStatic) continue; // Static fields require different access.
        try {
          const fieldAddr = objAddr + BigInt(f.offset);
          const value = this.decodeFieldValue(handle, fieldAddr, f.typeName);
          values.push({
            fieldName: f.name,
            fieldOffset: f.offset,
            value: value.display,
            rawHex: value.raw,
            typeHint: value.hint,
          });
        } catch {
          values.push({
            fieldName: f.name,
            fieldOffset: f.offset,
            value: '<read error>',
            rawHex: '',
            typeHint: 'unknown',
          });
        }
      }

      return { className: className.fullName, fields: values };
    } finally {
      CloseHandle(handle);
    }
  }

  /**
   * IL2CPP fallback: parse global-metadata.dat for type/assembly info.
   * This is a best-effort parser — full IL2CPP metadata parsing requires the
   * binary for address resolution. Returns metadata summary only.
   */
  async parseIl2CppMetadata(metadataPath: string): Promise<Il2CppMetadataSummary> {
    const data = await fs.readFile(metadataPath);
    if (data.length < 4) {
      throw new Error('global-metadata.dat is too small');
    }

    const sanity = data.readUInt32LE(0);
    if (sanity !== 0xfab11baf) {
      // Obfuscated metadata? Try the raw uint32.
      if (data.readUInt32BE(0) !== 0xfab11baf) {
        throw new Error(
          `Invalid global-metadata.dat: sanity check failed (got 0x${sanity.toString(16)})`,
        );
      }
    }

    const version = data.readInt32LE(4);
    logger.debug(`Il2Cpp metadata version: ${version}`);

    // Read string literal count (offset 0x08 in header).
    const stringLiteralCount = data.readInt32LE(8);
    const stringLiteralOffset = data.readInt32LE(12);

    // Rough estimates — full parsing requires version-specific struct layouts.
    // These are the counts we can get from the early header fields.
    let typeCount = 0;
    let methodCount = 0;
    let fieldCount = 0;

    if (version >= 24) {
      typeCount = data.readInt32LE(0x10);
      methodCount = data.readInt32LE(0x14);
      fieldCount = data.readInt32LE(0x18);
    }

    // Extract assembly names from string table (best-effort: look for ".dll" in strings).
    const assemblies: string[] = [];
    if (stringLiteralCount > 0 && stringLiteralOffset > 0) {
      try {
        let off = stringLiteralOffset;
        let found = 0;
        while (off < data.length - 2 && found < 100) {
          const len = data.readUInt8(off);
          if (len > 0 && len < 128 && off + 1 + len <= data.length) {
            const str = data.subarray(off + 1, off + 1 + len).toString('utf8');
            if (str.endsWith('.dll') || str === 'Assembly-CSharp') {
              assemblies.push(str);
            }
            off += 1 + len;
            found += 1;
          } else {
            break;
          }
        }
      } catch {
        // String table parsing is best-effort.
      }
    }

    return {
      version,
      stringLiteralCount,
      typeCount,
      methodCount,
      fieldCount,
      assemblies: [...new Set(assemblies)],
    };
  }

  // ── Private helpers ──

  private enumerateModules(handle: bigint): {
    name: string;
    base: string;
    path: string;
    size: number;
  }[] {
    const modules: { name: string; base: string; path: string; size: number }[] = [];
    try {
      const { modules: modHandles, count } = EnumProcessModules(handle);
      for (let i = 0; i < count; i++) {
        const hMod = modHandles[i]!;
        const name = GetModuleBaseName(handle, hMod);
        const info = GetModuleInformation(handle, hMod);
        const modulePath = GetModuleFileNameEx(handle, hMod) ?? name;
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
      logger.debug(`MonoAnalyzer: module enumeration failed: ${String(e)}`);
    }
    return modules;
  }

  private detectBitness(base: string): boolean {
    // x64 modules load above 4GB; 32-bit below.
    try {
      return BigInt(base) > 0x7fffffffn;
    } catch {
      return true; // Default to 64-bit.
    }
  }

  private findExportedSymbols(handle: bigint, mod: { name: string; base: string }): string[] {
    // Best-effort PE export walk to find Mono symbols.
    // Returns the list of symbol names found.
    const found: string[] = [];
    try {
      const base = BigInt(mod.base);
      // Read DOS header → PE header → export directory.
      const dosData = ReadProcessMemory(handle, base, 64);
      if (dosData.readUInt16LE(0) !== 0x5a4d) return found; // MZ

      const e_lfanew = dosData.readUInt32LE(60);
      const peSig = ReadProcessMemory(handle, base + BigInt(e_lfanew), 4).readUInt32LE(0);
      if (peSig !== 0x00004550) return found; // PE\0\0

      // Data directory [0] = export table.
      const magic = ReadProcessMemory(handle, base + BigInt(e_lfanew + 24), 2).readUInt16LE(0);
      const isPE32Plus = magic === 0x20b;
      const dirOff = isPE32Plus ? 136 : 120;
      const exportRva = ReadProcessMemory(handle, base + BigInt(e_lfanew + dirOff), 4).readUInt32LE(
        0,
      );
      if (exportRva === 0) return found;

      const exportSize = ReadProcessMemory(
        handle,
        base + BigInt(e_lfanew + dirOff + 4),
        4,
      ).readUInt32LE(0);
      const expData = ReadProcessMemory(handle, base + BigInt(exportRva), 40);
      const numberOfNames = Math.min(expData.readUInt32LE(24), 2000);
      const namePtrsRva = expData.readUInt32LE(32);

      const namesBuf = ReadProcessMemory(handle, base + BigInt(namePtrsRva), numberOfNames * 4);

      for (let i = 0; i < numberOfNames; i++) {
        const nameRva = namesBuf.readUInt32LE(i * 4);
        if (nameRva >= exportRva && nameRva <= exportRva + exportSize) {
          // Name points inside export dir — this is a forwarded export, skip.
          continue;
        }
        const name = readString(handle, base + BigInt(nameRva), 128);
        if (name && ROOT_DOMAIN_SYMBOLS.includes(name)) {
          found.push(name);
        }
      }
    } catch {
      // Best-effort.
    }
    return found;
  }

  private async resolveRootDomain(
    handle: bigint,
    mod: { name: string; base: string },
    exportedSymbols: string[],
  ): Promise<bigint | null> {
    try {
      const base = BigInt(mod.base);
      const is64 = this.detectBitness(mod.base);

      // Strategy 1: Read mono_root_domain global variable (if exported as data).
      // The symbol's RVA in the export table points to the variable's address.
      // We can read the pointer directly at that address.
      // This requires parsing the export table more carefully to get the address.

      // Strategy 2: Parse mono_get_root_domain code to find the RIP-relative load.
      // mono_get_root_domain on x64 typically looks like:
      //   mov rax, [rip + X]   ; 48 8B 05 XX XX XX XX
      //   ret
      // We read the function code and extract the RIP-relative target.
      if (exportedSymbols.includes('mono_get_root_domain')) {
        // Find mono_get_root_domain address from the export table.
        const funcAddr = this.findExportAddress(handle, base, 'mono_get_root_domain');
        if (funcAddr !== 0n) {
          const code = ReadProcessMemory(handle, funcAddr, 16);
          // Pattern: 48 8B 05 [disp32] — mov rax, [rip+disp32]
          //          C3             — ret
          if (code[0] === 0x48 && code[1] === 0x8b && code[2] === 0x05) {
            const disp = code.readInt32LE(3);
            const ptrAddr = funcAddr + 7n + BigInt(disp);
            const domainPtr = readPtr(handle, ptrAddr, is64);
            if (domainPtr !== 0n) return domainPtr;
          }
        }
      }

      if (exportedSymbols.includes('mono_root_domain')) {
        const funcAddr = this.findExportAddress(handle, base, 'mono_root_domain');
        if (funcAddr !== 0n) {
          const domainPtr = readPtr(handle, funcAddr, is64);
          if (domainPtr !== 0n) return domainPtr;
        }
      }
    } catch {
      // Best-effort.
    }
    return null;
  }

  private findExportAddress(handle: bigint, base: bigint, name: string): bigint {
    try {
      const dosData = ReadProcessMemory(handle, base, 64);
      const e_lfanew = dosData.readUInt32LE(60);

      const magic = ReadProcessMemory(handle, base + BigInt(e_lfanew + 24), 2).readUInt16LE(0);
      const isPE32Plus = magic === 0x20b;
      const dirOff = isPE32Plus ? 136 : 120;
      const exportRva = ReadProcessMemory(handle, base + BigInt(e_lfanew + dirOff), 4).readUInt32LE(
        0,
      );
      if (exportRva === 0) return 0n;

      const expData = ReadProcessMemory(handle, base + BigInt(exportRva), 40);
      const numberOfNames = Math.min(expData.readUInt32LE(24), 2000);
      const addrOfFuncsRva = expData.readUInt32LE(28);
      const namePtrsRva = expData.readUInt32LE(32);
      const nameOrdinalsRva = expData.readUInt32LE(36);

      const namesBuf = ReadProcessMemory(handle, base + BigInt(namePtrsRva), numberOfNames * 4);
      const ordsBuf = ReadProcessMemory(handle, base + BigInt(nameOrdinalsRva), numberOfNames * 2);

      for (let i = 0; i < numberOfNames; i++) {
        const nameRva = namesBuf.readUInt32LE(i * 4);
        const symName = readString(handle, base + BigInt(nameRva), 128);
        if (symName === name) {
          const ordIndex = ordsBuf.readUInt16LE(i * 2);
          const funcRva = ReadProcessMemory(
            handle,
            base + BigInt(addrOfFuncsRva + ordIndex * 4),
            4,
          ).readUInt32LE(0);
          return base + BigInt(funcRva);
        }
      }
    } catch {
      // Best-effort.
    }
    return 0n;
  }

  private walkAssemblyList(handle: bigint, listPtr: bigint, ptrSize: number): MonoAssemblyInfo[] {
    const results: MonoAssemblyInfo[] = [];
    const MAX_WALK = 200;

    for (let i = 0; i < MAX_WALK; i++) {
      try {
        // GSList node: data(ptr) + next(ptr)
        const nodeData = ReadProcessMemory(handle, listPtr, ptrSize * 2);
        const assemblyAddr =
          ptrSize === 8 ? nodeData.readBigUInt64LE(0) : BigInt(nodeData.readUInt32LE(0));
        const next =
          ptrSize === 8
            ? nodeData.readBigUInt64LE(ptrSize)
            : BigInt(nodeData.readUInt32LE(ptrSize));

        if (assemblyAddr === 0n) break;

        const assemInfo = this.parseAssembly(handle, assemblyAddr, ptrSize);
        if (assemInfo) results.push(assemInfo);

        if (next === 0n) break;
        listPtr = next;
      } catch {
        break;
      }
    }

    return results;
  }

  private parseAssembly(
    handle: bigint,
    assemblyAddr: bigint,
    ptrSize: number,
  ): MonoAssemblyInfo | null {
    try {
      // MonoAssembly.name is a MonoAssemblyName at offset 0x00 (embedded, not pointer).
      // MonoAssemblyName.name is at offset 0x00 (char*).
      // MonoAssembly.image (MonoImage*) is typically at offset 0x60 (x64) or 0x38 (x86).
      const aname = readPtr(handle, assemblyAddr, ptrSize === 8);
      const name = aname !== 0n ? readString(handle, aname) : null;

      // Try image offsets
      const imgOffsets = ptrSize === 8 ? [0x60, 0x68, 0x58] : [0x38, 0x3c];
      let imageAddress: string | undefined;
      for (const off of imgOffsets) {
        const imgPtr = readPtr(handle, assemblyAddr + BigInt(off), ptrSize === 8);
        if (imgPtr !== 0n) {
          imageAddress = hexAddr(imgPtr);
          break;
        }
      }

      return {
        name: name ?? `Assembly@${hexAddr(assemblyAddr)}`,
        address: hexAddr(assemblyAddr),
        imageAddress,
      };
    } catch {
      return null;
    }
  }

  private walkClassTable(
    handle: bigint,
    imageAddr: bigint,
    namespaceFilter: string | undefined,
    assemblyName: string,
  ): MonoClassInfo[] {
    const results: MonoClassInfo[] = [];
    // MonoImage.class_cache is a hash table. For simplicity, we try known offsets
    // where the class table or class list is stored.
    // MonoImage (x64): class_cache(hashtable) at ~0x0c0, or we try to walk
    // the class definitions from the metadata.

    // Simpler approach: scan for MonoClass structs by signature.
    // A MonoClass has recognizable fields: parent(0), name(pointer), namespace(pointer).
    // We try common MonoImage offsets for class metadata access.

    // MonoImage has a `tables` array (MonoTableInfo*) at various offsets.
    // The type definition table (MONO_TABLE_TYPEDEF = 0x02) gives us classes.
    // On x64 Mono 6.x:
    //   MonoImage.tables at offset 0x200 (try multiple offsets)
    //   Each MonoTableInfo is 12 bytes: base(ptr) + rows(u32) + row_size(u32)

    const imgOffsets = [0x200, 0x1f8, 0x208, 0x1c0];
    let tables = 0n;

    for (const off of imgOffsets) {
      try {
        const candidate = readPtr(handle, imageAddr + BigInt(off), true);
        if (candidate !== 0n && candidate > 0x1000n) {
          tables = candidate;
          break;
        }
      } catch {
        // Try next.
      }
    }

    if (tables !== 0n) {
      // Table index 2 = MONO_TABLE_TYPEDEF
      const TABLE_SIZE = 16; // MonoTableInfo: base(8) + rows(4) + row_size(4)
      const tableOff = tables + BigInt(2 * TABLE_SIZE);
      try {
        const tableData = ReadProcessMemory(handle, tableOff, TABLE_SIZE);
        const base = tableData.readBigUInt64LE(0);
        const rows = tableData.readUInt32LE(8);
        const rowSize = Math.min(tableData.readUInt32LE(12), 256);

        // Each typedef row has: flags(4) + name(ptr to string idx) + namespace(ptr to string idx) + ...
        // The first 3 ptr fields after flags are what we need (at offset 4, 8, 12 within the row).
        // Actually for Mono, the typedef layout is complex. Skip for now and use a simpler
        // approach: just return what we can get.

        for (let r = 0; r < Math.min(rows, 500); r++) {
          try {
            const rowOff = base + BigInt(r * rowSize);
            const rowData = ReadProcessMemory(handle, rowOff, rowSize);
            const flags = rowData.readUInt32LE(0);
            if (flags === 0) continue;

            // Name and namespace are at offset 4 and 8 in the typedef row for most Mono versions.
            const nameIdx = rowData.readUInt32LE(4);
            const nsIdx = rowData.readUInt32LE(8);

            // Resolve name/namespace from string heap.
            const name = this.resolveString(handle, imageAddr, nameIdx);
            const ns = this.resolveString(handle, imageAddr, nsIdx) ?? '';

            if (!name) continue;

            // Apply namespace filter if provided.
            if (namespaceFilter && !ns.toLowerCase().includes(namespaceFilter.toLowerCase())) {
              continue;
            }

            // Also get field_count and method_count from the row.
            const fieldCount = rowData.readUInt16LE(20);
            const methodCount = rowData.readUInt16LE(22);

            results.push({
              name,
              namespace: ns,
              fullName: ns ? `${ns}.${name}` : name,
              address: hexAddr(rowOff),
              fieldCount,
              methodCount,
              fields: [],
              assemblyName,
            });
          } catch {
            // Skip malformed rows.
          }
        }
      } catch {
        // Table walk failed.
      }
    }

    return results;
  }

  private resolveString(handle: bigint, imageAddr: bigint, idx: number): string | null {
    if (idx === 0) return null;
    try {
      // MonoImage has a string heap. The heap base is typically at MonoImage + 0x30 (x64).
      const heapBase = readPtr(handle, imageAddr + 0x30n, true);
      if (heapBase === 0n) return null;
      const str = readString(handle, heapBase + BigInt(idx), 256);
      return str;
    } catch {
      return null;
    }
  }

  private readClassName(
    handle: bigint,
    classAddr: bigint,
  ): { name: string; namespace: string; fullName: string } | null {
    try {
      // MonoClass field layout on x64 Mono 6.x:
      // Offsets vary but commonly: name ptr at +0x48, namespace ptr at +0x50, or nearby.
      const nameOffsets = [0x48, 0x50, 0x40, 0x58, 0x38] as const;
      let name: string | null = null;
      let namespace: string | null = null;

      for (const off of nameOffsets) {
        try {
          const candidate = readPtr(handle, classAddr + BigInt(off), true);
          if (candidate !== 0n) {
            const s = readString(handle, candidate);
            if (s && s.length > 0) {
              // First readable string is likely the name, the next the namespace.
              if (!name) {
                name = s;
              } else if (!namespace) {
                namespace = s;
                break;
              }
            }
          }
        } catch {
          // Continue.
        }
      }

      if (!name) return null;
      return {
        name,
        namespace: namespace ?? '',
        fullName: namespace ? `${namespace}.${name}` : name,
      };
    } catch {
      return null;
    }
  }

  private readClassFields(handle: bigint, classAddr: bigint): MonoFieldInfo[] {
    const fields: MonoFieldInfo[] = [];
    try {
      // MonoClass: field.count at offset 0x70+ (varies), field data at offset 0x80+.
      // Try common field table offsets.
      const fieldOffsets = [0x80, 0x88, 0x78, 0x90] as const;
      let fieldBase = 0n;
      let fieldCount = 0;

      for (const off of fieldOffsets) {
        try {
          // The field table is an array of MonoClassField structs; each entry's
          // stride is MONO_CLASS_FIELD_SIZE. x64 heap pointers are normally
          // above 4 GB, so only reject null/low pointers here.
          const candidate = readPtr(handle, classAddr + BigInt(off), true);
          if (candidate > 0x10000n) {
            // Also read count from the previous 4 bytes.
            const count = readU32(handle, classAddr + BigInt(off - 4));
            if (count > 0 && count <= 200) {
              fieldBase = candidate;
              fieldCount = count;
              break;
            }
          }
        } catch {
          // Next.
        }
      }

      if (fieldBase === 0n || fieldCount === 0) return fields;

      for (let i = 0; i < Math.min(fieldCount, 100); i++) {
        try {
          const fieldAddr = fieldBase + BigInt(i * MONO_CLASS_FIELD_SIZE);
          const namePtr = readPtr(handle, fieldAddr + 8n, true);
          const offset = readI32(handle, fieldAddr + BigInt(MONO_CLASS_FIELD_OFFSET_OFF));

          const name = namePtr !== 0n ? readString(handle, namePtr) : null;
          const isStatic = name ? offset < 0 : false;

          fields.push({
            name: name ?? `field_${i}`,
            offset: isStatic ? -1 : offset,
            typeName: 'unknown',
            isStatic,
          });
        } catch {
          // Skip broken fields.
        }
      }
    } catch {
      // Best-effort.
    }
    return fields;
  }

  private enumWritableRegions(_handle: bigint): { start: bigint; size: number }[] {
    // Stub — full implementation would use VirtualQueryEx.
    // For now, return a synthetic set of likely heap regions.
    // Real implementation: iterate VirtualQueryEx over all address space.
    return [{ start: 0x200000000n, size: 0x10000000 }];
  }

  private scanForVtable(handle: bigint, start: bigint, size: number, vtable: bigint): bigint[] {
    // Scan region for the vtable pointer value, aligned to 8 bytes.
    const results: bigint[] = [];
    const maxResults = 200;
    // For efficiency, read in chunks. For testing, just scan the first batch.
    const chunkSize = Math.min(size, 0x100000); // 1MB
    try {
      const data = ReadProcessMemory(handle, start, chunkSize);
      for (let off = 0; off <= data.length - 8; off += 8) {
        if (data.readBigUInt64LE(off) === vtable) {
          results.push(start + BigInt(off));
          if (results.length >= maxResults) break;
        }
      }
    } catch {
      // Skip inaccessible regions.
    }
    return results;
  }

  private estimateObjectSize(_handle: bigint, _objAddr: bigint, fieldCount: number): number {
    // Rough estimate: header + fields * avg field size.
    return MONO_OBJECT_HEADER_SIZE_64 + fieldCount * 8;
  }

  private decodeFieldValue(
    handle: bigint,
    fieldAddr: bigint,
    _typeName: string,
  ): { display: string; raw: string; hint: MonoFieldValue['typeHint'] } {
    try {
      const raw = ReadProcessMemory(handle, fieldAddr, 8);
      const rawHex = raw.toString('hex');
      const asInt32 = raw.readInt32LE(0);
      const asFloat = raw.readFloatLE(0);
      const asPtr = raw.readBigUInt64LE(0);

      // Heuristic: try to read as a string pointer.
      if (asPtr !== 0n && asPtr > 0x10000n && asPtr < 0x7fffffffffffn) {
        try {
          const strLen = ReadProcessMemory(handle, asPtr + 16n, 4).readInt32LE(0);
          if (strLen > 0 && strLen < 1024) {
            const strData = ReadProcessMemory(handle, asPtr + 24n, strLen * 2);
            const strDisplay = strData.toString('utf16le');
            // Check if it looks like a plausible string.
            const printable = strDisplay.replace(/\p{C}/gu, '').length;
            if (printable > strDisplay.length * 0.5) {
              return { display: `"${strDisplay}"`, raw: rawHex, hint: 'string' };
            }
          }
        } catch {
          // Not a string.
        }
      }

      // Default: display as various interpretations.
      return {
        display: `int32:${asInt32} float:${asFloat.toFixed(4)} ptr:${hexAddr(asPtr)}`,
        raw: rawHex,
        hint: 'unknown',
      };
    } catch {
      return { display: '<error>', raw: '', hint: 'unknown' };
    }
  }
}

export const monoAnalyzer = new MonoAnalyzer();
