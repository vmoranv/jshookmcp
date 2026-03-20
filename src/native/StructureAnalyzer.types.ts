/**
 * Structure Analyzer types.
 *
 * @module StructureAnalyzer.types
 */

export type FieldType =
  | 'int8' | 'uint8' | 'int16' | 'uint16'
  | 'int32' | 'uint32' | 'int64' | 'uint64'
  | 'float' | 'double'
  | 'pointer' | 'vtable_ptr'
  | 'string_ptr' | 'bool'
  | 'padding' | 'unknown';

export interface InferredField {
  offset: number;
  size: number;
  type: FieldType;
  /** Auto-generated name: field_0x00, field_0x04, etc. */
  name: string;
  /** Current value as string */
  value: string;
  /** Heuristic confidence 0.0–1.0 */
  confidence: number;
  /** Additional notes (e.g. "likely vtable pointer") */
  notes?: string;
}

export interface InferredStruct {
  baseAddress: string;
  totalSize: number;
  fields: InferredField[];
  vtableAddress?: string;
  /** Class name from RTTI if detected */
  className?: string;
  /** RTTI inheritance chain */
  baseClasses?: string[];
  timestamp: number;
}

export interface VtableInfo {
  address: string;
  functionCount: number;
  functions: Array<{
    index: number;
    address: string;
    module?: string;
    moduleOffset?: number;
  }>;
  rttiName?: string;
  baseClasses?: string[];
}

export interface StructureAnalysisOptions {
  /** Size to analyze in bytes (default: 256) */
  size?: number;
  /** Additional instance addresses for cross-instance comparison */
  otherInstances?: string[];
  /** Whether to attempt RTTI parsing (default: true) */
  parseRtti?: boolean;
}

export interface CStructExport {
  name: string;
  definition: string;
  size: number;
  fieldCount: number;
}
