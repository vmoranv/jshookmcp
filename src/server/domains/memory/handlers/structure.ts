/**
 * StructureHandlers — structure analysis, vtable parsing, C struct export, comparison.
 */
import type { StructureAnalyzer } from '@native/StructureAnalyzer';
import type { FieldType, InferredStruct } from '@native/StructureAnalyzer.types';

function toTextResponse(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function toErrorResponse(tool: string, error: unknown) {
  return toTextResponse({
    success: false,
    tool,
    error: error instanceof Error ? error.message : String(error),
  });
}

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
  constructor(private readonly structAnalyzer: StructureAnalyzer) {}

  async handleStructureAnalyze(args: Record<string, unknown>) {
    try {
      const result = await this.structAnalyzer.analyzeStructure(
        args.pid as number,
        args.address as string,
        {
          size: args.size as number | undefined,
          otherInstances: args.otherInstances as string[] | undefined,
          parseRtti: args.parseRtti as boolean | undefined,
        },
      );
      return toTextResponse({
        success: true,
        ...result,
        hint: result.className
          ? `Detected class: ${result.className}${result.baseClasses?.length ? ` (inherits: ${result.baseClasses.join(' → ')})` : ''}`
          : `Inferred ${result.fields.length} fields. Use memory_structure_export_c to export as C struct.`,
      });
    } catch (error) {
      return toErrorResponse('memory_structure_analyze', error);
    }
  }

  async handleVtableParse(args: Record<string, unknown>) {
    try {
      return toTextResponse({
        success: true,
        ...(await this.structAnalyzer.parseVtable(
          args.pid as number,
          args.vtableAddress as string,
        )),
      });
    } catch (error) {
      return toErrorResponse('memory_vtable_parse', error);
    }
  }

  async handleStructureExportC(args: Record<string, unknown>) {
    try {
      const parsed = JSON.parse(args.structure as string);
      const structure = normalizeStructureForExport(parsed);
      return toTextResponse({
        success: true,
        ...this.structAnalyzer.exportToCStruct(structure, args.name as string | undefined),
      });
    } catch (error) {
      return toErrorResponse('memory_structure_export_c', error);
    }
  }

  async handleStructureCompare(args: Record<string, unknown>) {
    try {
      const result = await this.structAnalyzer.compareInstances(
        args.pid as number,
        args.address1 as string,
        args.address2 as string,
        args.size as number | undefined,
      );
      return toTextResponse({
        success: true,
        matchingFieldCount: result.matching.length,
        differingFieldCount: result.differing.length,
        ...result,
      });
    } catch (error) {
      return toErrorResponse('memory_structure_compare', error);
    }
  }
}
