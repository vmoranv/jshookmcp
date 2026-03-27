/**
 * StructureHandlers — structure analysis, vtable parsing, C struct export, comparison.
 */
import type { StructureAnalyzer } from '@native/StructureAnalyzer';
import type { InferredStruct } from '@native/StructureAnalyzer.types';

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
      const structure = JSON.parse(args.structure as string) as InferredStruct;
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
