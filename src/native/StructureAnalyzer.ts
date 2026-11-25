/**
 * Structure Analyzer — heuristic memory structure inference.
 *
 * Analyzes memory at a given address to infer field types, detect vtables,
 * parse RTTI, and export C-style struct definitions.
 *
 * Uses PlatformMemoryAPI for cross-platform memory operations.
 *
 * @module StructureAnalyzer
 */

import { STRUCT_ANALYZE_DEFAULT_SIZE, STRUCT_VTABLE_MAX_FUNCTIONS } from '@src/constants';
import type {
  InferredField,
  InferredStruct,
  VtableInfo,
  FieldType,
  StructureAnalysisOptions,
  CStructExport,
} from './StructureAnalyzer.types';
import { createPlatformProvider } from './platform/factory.js';
import type { PlatformMemoryAPI } from './platform/PlatformMemoryAPI.js';
import type { ProcessHandle } from './platform/types.js';
import { RttiParser, demangleMsvcName } from './StructureAnalyzer.RttiParser.js';
import { FieldClassifier } from './StructureAnalyzer.FieldClassifier.js';
import { StructAnalyzerUtils } from './StructureAnalyzer.Utils.js';

export class StructureAnalyzer {
  private providerCache: PlatformMemoryAPI | null = null;
  private utils: StructAnalyzerUtils | null = null;
  private classifier: FieldClassifier | null = null;
  private rttiParser: RttiParser | null = null;

  private get provider(): PlatformMemoryAPI {
    if (!this.providerCache) {
      this.providerCache = createPlatformProvider();
      this.initializeComponents();
    }
    return this.providerCache;
  }

  private set provider(value: PlatformMemoryAPI | null) {
    this.providerCache = value;
    if (value) {
      this.initializeComponents();
    }
  }

  private ensureComponents(): void {
    if (!this.utils) {
      // Force lazy initialization by accessing provider
      void this.provider;
    }
  }

  private initializeComponents(): void {
    if (!this.providerCache) return;

    this.utils = new StructAnalyzerUtils(this.providerCache);
    this.classifier = new FieldClassifier(
      this.providerCache,
      this.utils.readCString.bind(this.utils),
      this.utils.isValidReadablePointer.bind(this.utils),
      this.utils.isValidExecutablePointer.bind(this.utils),
    );
    this.rttiParser = new RttiParser(
      this.providerCache,
      this.utils.readCString.bind(this.utils),
      this.utils.isValidReadablePointer.bind(this.utils),
    );
  }

  /**
   * Infer the structure layout at a given address.
   */
  async analyzeStructure(
    pid: number,
    address: string,
    options?: StructureAnalysisOptions,
  ): Promise<InferredStruct> {
    const size = options?.size ?? STRUCT_ANALYZE_DEFAULT_SIZE;
    const baseAddr = BigInt(address.startsWith('0x') ? address : `0x${address}`);

    const handle = this.provider.openProcess(pid, false);
    try {
      const buf = (await this.provider.readMemory(handle, baseAddr, size)).data;
      const fields: InferredField[] = [];
      let offset = 0;

      while (offset < size) {
        const remaining = size - offset;
        if (remaining < 1) break;

        const classification = await this.classifier!.classifyValue(buf, handle, offset, remaining);
        fields.push({
          offset,
          size: classification.size,
          type: classification.type,
          name: `field_0x${offset.toString(16).padStart(2, '0').toUpperCase()}`,
          value: classification.value,
          confidence: classification.confidence,
          notes: classification.notes,
        });

        offset += classification.size;
      }

      // Check first field for vtable
      let vtableAddress: string | undefined;
      let className: string | undefined;
      let baseClasses: string[] | undefined;

      if (fields.length > 0 && fields[0]!.type === 'vtable_ptr') {
        vtableAddress = fields[0]!.value;

        // Try RTTI parsing
        if (options?.parseRtti !== false && vtableAddress) {
          try {
            const vtableAddr = BigInt(
              vtableAddress.startsWith('0x') ? vtableAddress : `0x${vtableAddress}`,
            );
            const rtti = await this.rttiParser!.parseRtti(vtableAddr, handle);
            if (rtti) {
              className = rtti.className;
              baseClasses = rtti.baseClasses;
            }
          } catch {
            // RTTI parsing is best-effort
          }
        }
      }

      return {
        baseAddress: `0x${baseAddr.toString(16).toUpperCase()}`,
        totalSize: size,
        fields,
        vtableAddress,
        className,
        baseClasses,
        timestamp: Date.now(),
      };
    } finally {
      this.provider.closeProcess(handle);
    }
  }

  /**
   * Parse vtable at given address.
   * A vtable is an array of function pointers in executable memory.
   */
  async parseVtable(pid: number, vtableAddress: string): Promise<VtableInfo> {
    const vtableAddr = BigInt(
      vtableAddress.startsWith('0x') ? vtableAddress : `0x${vtableAddress}`,
    );
    const handle = this.provider.openProcess(pid, false);

    try {
      const functions: VtableInfo['functions'] = [];
      const modules = await this.utils!.getModuleEntries(pid);

      for (let i = 0; i < STRUCT_VTABLE_MAX_FUNCTIONS; i++) {
        const ptrAddr = vtableAddr + BigInt(i * 8);
        let funcPtr: bigint;
        try {
          const buf = (await this.provider.readMemory(handle, ptrAddr, 8)).data;
          funcPtr = buf.readBigUInt64LE(0);
        } catch {
          break;
        }

        // Each entry must point to executable memory
        if (!this.utils!.isValidExecutablePointer(handle, funcPtr)) break;

        const modInfo = this.utils!.resolveToModule(funcPtr, modules);
        functions.push({
          index: i,
          address: `0x${funcPtr.toString(16).toUpperCase()}`,
          module: modInfo?.module,
          moduleOffset: modInfo?.offset,
        });
      }

      // Try RTTI: vtable[-1] (8 bytes before vtable) on MSVC x64
      let rttiName: string | undefined;
      let baseClassList: string[] | undefined;
      try {
        const rtti = await this.rttiParser!.parseRtti(vtableAddr, handle);
        if (rtti) {
          rttiName = rtti.className;
          baseClassList = rtti.baseClasses;
        }
      } catch {
        // Best-effort
      }

      return {
        address: `0x${vtableAddr.toString(16).toUpperCase()}`,
        functionCount: functions.length,
        functions,
        rttiName,
        baseClasses: baseClassList,
      };
    } finally {
      this.provider.closeProcess(handle);
    }
  }

  /**
   * Export an inferred struct as C-style definition.
   */
  exportToCStruct(structure: InferredStruct, name?: string): CStructExport {
    this.ensureComponents();
    const structName = name ?? structure.className ?? 'UnknownStruct';
    const lines: string[] = [];

    lines.push(
      `struct ${structName} { // size: 0x${structure.totalSize.toString(16).toUpperCase()} (${structure.totalSize} ` +
        `bytes)`,
    );

    for (const field of structure.fields) {
      const cType = this.utils!.fieldTypeToCType(field.type, field.size);
      const offsetStr = `0x${field.offset.toString(16).padStart(2, '0').toUpperCase()}`;
      const comment = field.notes
        ? `// +${offsetStr} ${field.notes}`
        : `// +${offsetStr} = ${field.value}`;

      if (field.type === 'padding') {
        lines.push(`    uint8_t _pad_${field.offset.toString(16)}[${field.size}]; ${comment}`);
      } else {
        lines.push(`    ${cType} ${field.name}; ${comment}`);
      }
    }

    lines.push('};');

    const definition = lines.join('\n');
    return {
      name: structName,
      definition,
      size: structure.totalSize,
      fieldCount: structure.fields.filter((f) => f.type !== 'padding').length,
    };
  }

  /**
   * Compare two structure instances to find differing vs constant fields.
   */
  async compareInstances(
    pid: number,
    address1: string,
    address2: string,
    size?: number,
  ): Promise<{
    matching: InferredField[];
    differing: Array<{ offset: number; value1: string; value2: string; type: FieldType }>;
  }> {
    const analysisSize = size ?? STRUCT_ANALYZE_DEFAULT_SIZE;
    const [struct1, struct2] = await Promise.all([
      this.analyzeStructure(pid, address1, { size: analysisSize, parseRtti: false }),
      this.analyzeStructure(pid, address2, { size: analysisSize, parseRtti: false }),
    ]);

    const matching: InferredField[] = [];
    const differing: Array<{ offset: number; value1: string; value2: string; type: FieldType }> =
      [];

    // Align fields by offset
    const fieldMap2 = new Map(struct2.fields.map((f) => [f.offset, f]));

    for (const f1 of struct1.fields) {
      const f2 = fieldMap2.get(f1.offset);
      if (!f2) continue;

      if (f1.value === f2.value && f1.type === f2.type) {
        matching.push(f1);
      } else {
        differing.push({
          offset: f1.offset,
          value1: f1.value,
          value2: f2.value,
          type: f1.type,
        });
      }
    }

    return { matching, differing };
  }

  /**
   * Parse RTTI at vtable address (backward compatibility wrapper).
   *
   * @deprecated Internal method exposed for testing. Use analyzeStructure or parseVtable instead.
   */
  async parseRtti(
    pid: number,
    vtableAddress: string,
    existingHandle?: ProcessHandle,
  ): Promise<{ className: string; baseClasses: string[] } | null> {
    // `rttiParser` is created by initializeComponents(); with an externally
    // supplied handle the provider getter was never touched, so initialize the
    // lazy components before dereferencing them.
    this.ensureComponents();
    const vtableAddr = BigInt(
      vtableAddress.startsWith('0x') ? vtableAddress : `0x${vtableAddress}`,
    );
    const ownHandle = !existingHandle;
    const handle = existingHandle ?? this.provider.openProcess(pid, false);

    try {
      return await this.rttiParser!.parseRtti(vtableAddr, handle);
    } finally {
      if (ownHandle) this.provider.closeProcess(handle);
    }
  }

  /**
   * Demangle MSVC name (backward compatibility wrapper).
   *
   * @deprecated Internal method exposed for testing.
   * @internal
   */
  // @ts-expect-error - Private method only used in tests via `(analyzer as any).demangleMsvcName`
  private demangleMsvcName(name: string): string {
    // Delegate to the shared implementation in RttiParser (single source of truth).
    return demangleMsvcName(name);
  }

  /**
   * Check if pointer is valid and readable (backward compatibility wrapper).
   *
   * @deprecated Internal method exposed for testing.
   * @internal
   */
  // @ts-expect-error - Private method only used in tests via `(analyzer as any).isValidReadablePointer`
  private isValidReadablePointer(handle: ProcessHandle, address: bigint): boolean {
    this.ensureComponents();
    return this.utils!.isValidReadablePointer(handle, address);
  }

  /**
   * Check if pointer is valid and executable (backward compatibility wrapper).
   *
   * @deprecated Internal method exposed for testing.
   * @internal
   */
  // @ts-expect-error - Private method only used in tests via `(analyzer as any).isValidExecutablePointer`
  private isValidExecutablePointer(handle: ProcessHandle, address: bigint): boolean {
    this.ensureComponents();
    return this.utils!.isValidExecutablePointer(handle, address);
  }

  /**
   * Convert field type to C type (backward compatibility wrapper).
   *
   * @deprecated Internal method exposed for testing.
   * @internal
   */
  // @ts-expect-error - Private method only used in tests via `(analyzer as any).fieldTypeToCType`
  private fieldTypeToCType(type: FieldType, size: number): string {
    this.ensureComponents();
    return this.utils!.fieldTypeToCType(type, size);
  }

  /**
   * Classify value at offset (backward compatibility wrapper).
   *
   * @deprecated Internal method exposed for testing.
   * @internal
   */
  // @ts-expect-error - Private method only used in tests via `(analyzer as any).classifyValue`
  private async classifyValue(
    buf: Buffer,
    handle: ProcessHandle,
    _baseAddrOrOffset: bigint | number,
    offsetOrRemaining: number,
    remaining?: number,
  ): Promise<{ type: FieldType; size: number; value: string; confidence: number; notes?: string }> {
    this.ensureComponents();
    // Support both old 5-arg signature (buf, handle, baseAddr, offset, remaining)
    // and new 4-arg signature (buf, handle, offset, remaining)
    if (remaining !== undefined) {
      // Old signature: baseAddr is ignored, use offset and remaining
      return this.classifier!.classifyValue(buf, handle, offsetOrRemaining, remaining);
    } else {
      // New signature: _baseAddrOrOffset is actually offset, offsetOrRemaining is remaining
      return this.classifier!.classifyValue(
        buf,
        handle,
        _baseAddrOrOffset as number,
        offsetOrRemaining,
      );
    }
  }
}

export const structureAnalyzer = new StructureAnalyzer();
