import type { StructureAnalyzer } from '@native/StructureAnalyzer';
import type { FieldType, InferredStruct } from '@native/StructureAnalyzer.types';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';
import { resolveMemoryDomainPid } from '@server/domains/memory/pid-resolver';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argBool, argNumber, argString, argStringArray } from '@server/domains/shared/parse-args';
import { parseJsonArg } from './validation';
import { parseAddressFormula } from './address-formula';

const TOOL_STRUCTURE_ANALYZE = 'memory_structure_analyze';
const TOOL_VTABLE_PARSE = 'memory_vtable_parse';
const TOOL_STRUCTURE_EXPORT_C = 'memory_structure_export_c';
const TOOL_STRUCTURE_COMPARE = 'memory_structure_compare';

const FIELD_TYPE_ALIASES: Record<string, FieldType> = {
  int8_t: 'int8',
  uint8_t: 'uint8',
  int16_t: 'int16',
  uint16_t: 'uint16',
  int32_t: 'int32',
  uint32_t: 'uint32',
  int64_t: 'int64',
  uint64_t: 'uint64',
  void_ptr: 'pointer',
  char_ptr: 'string_ptr',
};

function normalizeFieldType(value: unknown): FieldType {
  if (typeof value !== 'string' || value.length === 0) return 'unknown';
  const normalized = value.toLowerCase().replace(/\s+/g, '_').replace(/\*/g, '_ptr');
  return FIELD_TYPE_ALIASES[normalized] ?? (normalized as FieldType);
}

function normalizeStructureForExport(raw: unknown): InferredStruct {
  if (!raw || typeof raw !== 'object') {
    throw new Error('structure must be a JSON object');
  }

  const source = raw as Record<string, unknown>;
  const rawFields = Array.isArray(source.fields) ? source.fields : [];
  const fields = rawFields.map((entry, index) => {
    const field = entry as Record<string, unknown>;
    const offset = typeof field.offset === 'number' ? field.offset : 0;
    const size = typeof field.size === 'number' ? field.size : 1;

    return {
      offset,
      size,
      type: normalizeFieldType(field.type),
      name: typeof field.name === 'string' && field.name.length > 0 ? field.name : `field_${index}`,
      value: typeof field.value === 'string' ? field.value : '',
      confidence: typeof field.confidence === 'number' ? field.confidence : 1,
      notes: typeof field.notes === 'string' ? field.notes : undefined,
    };
  });
  const inferredSize = fields.reduce((max, field) => Math.max(max, field.offset + field.size), 0);
  const totalSize =
    typeof source.totalSize === 'number'
      ? source.totalSize
      : typeof source.size === 'number'
        ? source.size
        : inferredSize;

  return {
    baseAddress: typeof source.baseAddress === 'string' ? source.baseAddress : '0x0',
    totalSize,
    fields,
    vtableAddress: typeof source.vtableAddress === 'string' ? source.vtableAddress : undefined,
    className: typeof source.className === 'string' ? source.className : undefined,
    baseClasses: Array.isArray(source.baseClasses)
      ? source.baseClasses.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
    timestamp: typeof source.timestamp === 'number' ? source.timestamp : Date.now(),
  };
}

export class StructureHandlers {
  constructor(
    private readonly structAnalyzer: StructureAnalyzer,
    private readonly processManager?: UnifiedProcessManager,
    private readonly ctx?: MCPServerContext,
  ) {}

  private async resolvePid(value: unknown): Promise<number> {
    if (!this.processManager) {
      return value as number;
    }
    return await resolveMemoryDomainPid(value, this.processManager, this.ctx);
  }

  async handleStructureAnalyze(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const addressRaw = argString(args, 'address');
      if (!addressRaw) {
        throw new Error(
          `${TOOL_STRUCTURE_ANALYZE}: missing or invalid required argument "address" (expected hex or address formula, e.g. "0x7FF612340000 + 0x10")`,
        );
      }
      const formula = parseAddressFormula(addressRaw);
      if (!formula.address) {
        throw new Error(`${TOOL_STRUCTURE_ANALYZE}: ${formula.error}`);
      }
      const address = formula.address;
      const size = argNumber(args, 'size');
      if (size !== undefined && (!Number.isFinite(size) || size <= 0)) {
        throw new Error(
          `${TOOL_STRUCTURE_ANALYZE}: argument "size" must be a positive number, got: ${JSON.stringify(args.size)}`,
        );
      }
      const otherInstances = argStringArray(args, 'otherInstances');
      const parseRtti = argBool(args, 'parseRtti', true);
      const result = await this.structAnalyzer.analyzeStructure(pid, address, {
        size,
        otherInstances,
        parseRtti,
      });
      return {
        ...result,
        hint: result.className
          ? `Detected class: ${result.className}` +
            `${result.baseClasses?.length ? ` (inherits: ${result.baseClasses.join(' → ')})` : ''}`
          : `Inferred ${result.fields.length} fields. Use memory_structure_export_c to export as C struct.`,
      };
    });
  }

  async handleVtableParse(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const vtableRaw = argString(args, 'vtableAddress');
      if (!vtableRaw) {
        throw new Error(
          `${TOOL_VTABLE_PARSE}: missing or invalid required argument "vtableAddress"`,
        );
      }
      const formula = parseAddressFormula(vtableRaw);
      if (!formula.address) {
        throw new Error(`${TOOL_VTABLE_PARSE}: ${formula.error}`);
      }
      const vtableAddress = formula.address;
      return { ...(await this.structAnalyzer.parseVtable(pid, vtableAddress)) };
    });
  }

  async handleStructureExportC(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const structure = argString(args, 'structure');
      if (!structure) {
        throw new Error(
          `${TOOL_STRUCTURE_EXPORT_C}: missing or invalid required argument "structure" (expected JSON string), got: ${JSON.stringify(args.structure)}`,
        );
      }
      const parsed = parseJsonArg(structure, 'structure', TOOL_STRUCTURE_EXPORT_C);
      const normalized = normalizeStructureForExport(parsed);
      const name = typeof args.name === 'string' && args.name.length > 0 ? args.name : undefined;
      return { ...this.structAnalyzer.exportToCStruct(normalized, name) };
    });
  }

  async handleStructureCompare(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);

      const addr1Raw = argString(args, 'address1');
      if (!addr1Raw) {
        throw new Error(
          `${TOOL_STRUCTURE_COMPARE}: missing or invalid required argument "address1"`,
        );
      }
      const f1 = parseAddressFormula(addr1Raw);
      if (!f1.address) throw new Error(`${TOOL_STRUCTURE_COMPARE}: ${f1.error}`);
      const address1 = f1.address;

      const addr2Raw = argString(args, 'address2');
      if (!addr2Raw) {
        throw new Error(
          `${TOOL_STRUCTURE_COMPARE}: missing or invalid required argument "address2"`,
        );
      }
      const f2 = parseAddressFormula(addr2Raw);
      if (!f2.address) throw new Error(`${TOOL_STRUCTURE_COMPARE}: ${f2.error}`);
      const address2 = f2.address;
      const size = argNumber(args, 'size');
      if (size !== undefined && (!Number.isFinite(size) || size <= 0)) {
        throw new Error(
          `${TOOL_STRUCTURE_COMPARE}: argument "size" must be a positive number, got: ${JSON.stringify(args.size)}`,
        );
      }
      const result = await this.structAnalyzer.compareInstances(pid, address1, address2, size);
      return {
        matchingFieldCount: result.matching.length,
        differingFieldCount: result.differing.length,
        ...result,
      };
    });
  }
}
