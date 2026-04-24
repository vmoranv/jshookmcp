/**
 * WASMHarvester — Extract and analyze WebAssembly bytes from JS+WASM hybrids.
 *
 * Modern obfuscation uses WASM for:
 *   - String decryption (WASM function called from JS with encrypted payload)
 *   - Computation offloading (crypto, encoding, integrity checks in WASM)
 *   - WASMixer-style bundling (JS + WASM interleaved)
 *   - WASM Cloak (WASM module contains the entire payload, JS is a thin loader)
 *
 * This module:
 *   1. Detects JS+WASM boundaries (where JS meets WASM)
 *   2. Extracts WASM byte arrays from JS source
 *   3. Parses WASM module headers (magic bytes, version, sections)
 *   4. Identifies JS↔WASM interface (imported/exported functions)
 *   5. Attempts WASM disassembly (section headers, function counts, memory layout)
 *   6. Provides boundary information for the IR and runtime harvester
 *
 * Inspired by:
 *   - WASMixer (CCS 2025) JS+WASM bundling analysis
 *   - WASM Cloak detection research
 *   - wasm-dis/wasm-objdump style header parsing
 *
 * Design: Functional, immutable, UTF-8 safe. All binary parsing uses Uint8Array.
 */

import { logger } from '@utils/logger';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';

// ── Types ──

export interface WASMBoundary {
  /** Where in the source the boundary was found */
  location: {
    line: number;
    column: number;
    index: number;
  };
  /** Type of boundary */
  type:
    | 'instantiate'
    | 'compile'
    | 'inline-bytes'
    | 'base64-encoded'
    | 'fetch-load'
    | 'constructor';
  /** The JS variable or expression that holds the WASM reference */
  wasmReference: string;
  /** Snippet of source around the boundary */
  snippet: string;
  /** Confidence in detection (0-1) */
  confidence: number;
}

export interface WASMModuleHeader {
  /** Whether valid WASM magic bytes were found */
  hasValidMagic: boolean;
  /** WASM version (usually 1) */
  version: number | null;
  /** Total size of the WASM module in bytes */
  totalSize: number;
  /** Parsed section headers */
  sections: WASMSectionHeader[];
  /** Number of imported functions */
  importCount: number;
  /** Number of exported functions */
  exportCount: number;
  /** Memory specifications */
  memorySpecs: { minPages: number; maxPages?: number; shared: boolean }[];
  /** Function signatures (names only) */
  functionNames: string[];
  /** Whether the module appears complete (has code + data sections) */
  isComplete: boolean;
}

export interface WASMSectionHeader {
  /** Section ID (0-12) */
  id: number;
  /** Section name (for known IDs) */
  name: string;
  /** Section size in bytes */
  size: number;
  /** Offset within the WASM module */
  offset: number;
  /** Number of entries in this section (for function/type/import/export sections) */
  entryCount: number;
}

export interface WASMJSInterface {
  /** Functions imported from JS into WASM */
  jsImports: WASMImport[];
  /** Functions exported from WASM to JS */
  wasmExports: WASMExport[];
  /** Memory references (WASM memory shared with JS) */
  memoryReferences: WASMMemoryRef[];
  /** Table references (WASM tables) */
  tableReferences: WASMTableRef[];
  /** Global variable references */
  globalReferences: WASMGlobalRef[];
}

export interface WASMImport {
  module: string;
  name: string;
  signature: string;
  paramCount: number;
  returnType: string;
}

export interface WASMExport {
  name: string;
  kind: 'function' | 'memory' | 'table' | 'global';
  index: number;
  signature?: string;
  paramCount?: number;
}

export interface WASMMemoryRef {
  name: string;
  minPages: number;
  maxPages?: number;
  isShared: boolean;
  bufferAccess: boolean;
}

export interface WASMTableRef {
  name: string;
  elementType: string;
  minSize: number;
  maxSize?: number;
}

export interface WASMGlobalRef {
  name: string;
  type: string;
  mutable: boolean;
  initialValue?: string;
}

export interface WASMExtractionResult {
  /** Whether extraction succeeded */
  ok: boolean;
  /** Raw WASM bytes extracted */
  wasmBytes: Uint8Array | null;
  /** Number of WASM modules found */
  moduleCount: number;
  /** Boundaries detected */
  boundaries: WASMBoundary[];
  /** Parsed module headers */
  headers: WASMModuleHeader[];
  /** JS↔WASM interfaces */
  interfaces: WASMJSInterface[];
  /** Decoded strings from WASM data sections */
  decodedStrings: { offset: number; value: string }[];
  /** Warnings */
  warnings: string[];
  /** Total extraction time in ms */
  durationMs: number;
  /** Whether this is a WASMixer-bundled sample */
  isWASMixer: boolean;
  /** Whether this is a WASM Cloak sample */
  isWASMClOak: boolean;
}

export interface WASMHarvesterOptions {
  /** Maximum WASM module size to extract (bytes), default 50MB */
  maxModuleSize?: number;
  /** Whether to attempt full WASM disassembly */
  disassemble?: boolean;
  /** Whether to extract strings from WASM data sections */
  extractStrings?: boolean;
  /** Whether to decode base64-encoded WASM */
  decodeBase64?: boolean;
  /** Whether to trace JS↔WASM boundaries */
  traceInterfaces?: boolean;
  /** Maximum number of boundaries to extract */
  maxBoundaries?: number;
}

const DEFAULT_OPTIONS: Required<WASMHarvesterOptions> = {
  maxModuleSize: 50 * 1024 * 1024,
  disassemble: false,
  extractStrings: true,
  decodeBase64: true,
  traceInterfaces: true,
  maxBoundaries: 50,
};

// ── WASM Magic Bytes ──

const WASM_MAGIC = new Uint8Array([0x00, 0x61, 0x73, 0x6d]); // \0asm

const WASM_SECTION_NAMES: Record<number, string> = {
  0: 'custom',
  1: 'type',
  2: 'import',
  3: 'function',
  4: 'table',
  5: 'memory',
  6: 'global',
  7: 'export',
  8: 'start',
  9: 'element',
  10: 'code',
  11: 'data',
  12: 'datacount',
};

// ── Main API ──

/**
 * Extract and analyze WASM modules from JavaScript source code.
 *
 * This is the primary entry point. It:
 *   1. Detects JS+WASM boundaries
 *   2. Extracts WASM byte arrays
 *   3. Parses WASM module headers
 *   4. Identifies JS↔WASM interfaces
 *   5. Optionally extracts strings from data sections
 *   6. Identifies WASMixer/WASM Cloak patterns
 */
export function harvestWASM(code: string, options?: WASMHarvesterOptions): WASMExtractionResult {
  const startTime = Date.now();
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];
  const boundaries: WASMBoundary[] = [];
  const headers: WASMModuleHeader[] = [];
  const interfaces: WASMJSInterface[] = [];
  const decodedStrings: { offset: number; value: string }[] = [];

  try {
    // ── Step 1: Detect boundaries ──
    const detectedBoundaries = detectWASMBoundaries(code, opts.maxBoundaries);
    boundaries.push(...detectedBoundaries);

    // ── Step 2: Extract WASM bytes ──
    const extractionResults = extractWASMBytes(code, opts);
    let moduleCount = 0;

    for (const extraction of extractionResults) {
      moduleCount++;

      if (extraction.bytes && extraction.bytes.length > 0) {
        // ── Step 3: Parse WASM headers ──
        const header = parseWASMHeader(extraction.bytes);
        headers.push(header);

        if (!header.hasValidMagic) {
          warnings.push(
            `WASM module ${moduleCount} has invalid magic bytes (may be encrypted or WASMicer-obfuscated)`,
          );
        }

        // ── Step 4: Trace JS↔WASM interfaces ──
        if (opts.traceInterfaces) {
          const iface = traceJSWASMInterface(code, extraction.bytes, header);
          interfaces.push(iface);
        }

        // ── Step 5: Extract strings from data sections ──
        if (opts.extractStrings && header.isComplete) {
          const strings = extractStringsFromWASM(extraction.bytes, header);
          decodedStrings.push(...strings);
        }
      }
    }

    if (!moduleCount && boundaries.length > 0) {
      // Boundaries detected but bytes not extractable (likely fetch-loaded WASM)
      moduleCount = boundaries.length;
      warnings.push(
        `${boundaries.length} WASM boundaries detected but no inline WASM bytes found (may be externally loaded)`,
      );
    }

    // ── Step 6: Detect WASMicer/WASM Cloak patterns ──
    const isWASMicer = detectWASMicerPatterns(code);
    const isWASMClOak = detectWASMClOakPatterns(code);

    logger.info(
      `WASMHarvester: ${boundaries.length} boundaries, ${moduleCount} modules, ` +
        `${decodedStrings.length} strings, WASMicer=${isWASMicer}, WASMClOak=${isWASMClOak}`,
    );

    return {
      ok: boundaries.length > 0 || moduleCount > 0,
      wasmBytes: extractionResults.length > 0 ? extractionResults[0]!.bytes : null,
      moduleCount,
      boundaries,
      headers,
      interfaces,
      decodedStrings,
      warnings,
      durationMs: Date.now() - startTime,
      isWASMixer: isWASMicer,
      isWASMClOak: isWASMClOak,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(`WASMHarvester: extraction failed: ${msg}`);
    return {
      ok: false,
      wasmBytes: null,
      moduleCount: 0,
      boundaries,
      headers,
      interfaces,
      decodedStrings,
      warnings: [`Extraction failed: ${msg}`],
      durationMs: Date.now() - startTime,
      isWASMixer: false,
      isWASMClOak: false,
    };
  }
}

// ── Boundary Detection ──

function detectWASMBoundaries(code: string, maxBoundaries: number): WASMBoundary[] {
  const boundaries: WASMBoundary[] = [];

  // Pattern 1: WebAssembly.instantiate(buffer, imports)
  const instantiatePattern = /WebAssembly\s*\.\s*instantiate\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = instantiatePattern.exec(code)) !== null && boundaries.length < maxBoundaries) {
    const index = match.index;
    const line = code.slice(0, index).split('\n').length;
    const snippet = extractSnippet(code, index);
    boundaries.push({
      location: { line, column: getColumn(code, index), index },
      type: 'instantiate',
      wasmReference: extractWASMReference(code, index),
      snippet,
      confidence: 0.9,
    });
  }

  // Pattern 2: WebAssembly.compile(buffer)
  const compilePattern = /WebAssembly\s*\.\s*compile\s*\(/g;
  while ((match = compilePattern.exec(code)) !== null && boundaries.length < maxBoundaries) {
    const index = match.index;
    const line = code.slice(0, index).split('\n').length;
    boundaries.push({
      location: { line, column: getColumn(code, index), index },
      type: 'compile',
      wasmReference: extractWASMReference(code, index),
      snippet: extractSnippet(code, index),
      confidence: 0.85,
    });
  }

  // Pattern 3: new WebAssembly.Module(buffer)
  const constructorPattern = /new\s+WebAssembly\s*\.\s*Module\s*\(/g;
  while ((match = constructorPattern.exec(code)) !== null && boundaries.length < maxBoundaries) {
    const index = match.index;
    const line = code.slice(0, index).split('\n').length;
    boundaries.push({
      location: { line, column: getColumn(code, index), index },
      type: 'constructor',
      wasmReference: extractWASMReference(code, index),
      snippet: extractSnippet(code, index),
      confidence: 0.85,
    });
  }

  // Pattern 4: Inline WASM bytes (Uint8Array with WASM magic)
  const inlinePattern = /new\s+Uint8Array\s*\(\s*\[/g;
  while ((match = inlinePattern.exec(code)) !== null && boundaries.length < maxBoundaries) {
    const index = match.index;
    const arrayStart = index;
    const arrayContent = extractUint8ArrayContent(code, arrayStart);

    // Check if this looks like WASM bytes (starts with magic bytes or high entropy)
    if (arrayContent && looksLikeWASMByteString(arrayContent)) {
      const line = code.slice(0, index).split('\n').length;
      boundaries.push({
        location: { line, column: getColumn(code, index), index },
        type: 'inline-bytes',
        wasmReference: extractVariableName(code, index),
        snippet: extractSnippet(code, index),
        confidence: 0.7,
      });
    }
  }

  // Pattern 5: Base64-encoded WASM
  if (boundaries.length < maxBoundaries) {
    const base64Pattern = /["']([A-Za-z0-9+/]{100,}={0,2})["']/g;
    while ((match = base64Pattern.exec(code)) !== null && boundaries.length < maxBoundaries) {
      const b64Content = match[1] ?? '';
      if (b64Content && looksLikeBase64WASM(b64Content)) {
        const index = match.index;
        const line = code.slice(0, index).split('\n').length;
        boundaries.push({
          location: { line, column: getColumn(code, index), index },
          type: 'base64-encoded',
          wasmReference: `base64(${b64Content.length} chars)`,
          snippet: extractSnippet(code, index),
          confidence: 0.6,
        });
      }
    }
  }

  // Pattern 6: fetch() loading WASM
  const fetchPattern = /fetch\s*\(\s*["'][^"']*\.wasm["']/gi;
  while ((match = fetchPattern.exec(code)) !== null && boundaries.length < maxBoundaries) {
    const index = match.index;
    const line = code.slice(0, index).split('\n').length;
    boundaries.push({
      location: { line, column: getColumn(code, index), index },
      type: 'fetch-load',
      wasmReference: match[0],
      snippet: extractSnippet(code, index),
      confidence: 0.5,
    });
  }

  return boundaries;
}

// ── WASM Byte Extraction ──

interface WASMByteExtraction {
  bytes: Uint8Array | null;
  source: string;
  offset: number;
}

function extractWASMBytes(
  code: string,
  opts: Required<WASMHarvesterOptions>,
): WASMByteExtraction[] {
  const results: WASMByteExtraction[] = [];

  // Method 1: Extract from inline Uint8Array
  const inlineArrays = extractInlineUint8Arrays(code);
  for (const extraction of inlineArrays) {
    if (extraction.bytes && extraction.bytes.length > 8) {
      // Validate WASM magic
      if (
        extraction.bytes[0] === 0x00 &&
        extraction.bytes[1] === 0x61 &&
        extraction.bytes[2] === 0x73 &&
        extraction.bytes[3] === 0x6d
      ) {
        results.push(extraction);
      } else if (extraction.bytes.length > 100) {
        // Large byte arrays that aren't WASM but might be encrypted WASM
        results.push(extraction);
      }
    }
  }

  // Method 2: Extract from base64 strings
  if (opts.decodeBase64) {
    const base64Arrays = extractBase64WASM(code);
    for (const extraction of base64Arrays) {
      if (extraction.bytes) {
        results.push(extraction);
      }
    }
  }

  // Limit total extractions
  if (results.length > 10) {
    results.splice(10);
  }

  // Apply size limits
  for (const result of results) {
    if (result.bytes && result.bytes.length > opts.maxModuleSize) {
      logger.warn(
        `WASMHarvester: truncating ${result.bytes.length} bytes to ${opts.maxModuleSize}`,
      );
      result.bytes = result.bytes.slice(0, opts.maxModuleSize);
    }
  }

  return results;
}

function extractInlineUint8Arrays(code: string): WASMByteExtraction[] {
  const results: WASMByteExtraction[] = [];

  // Match: new Uint8Array([0x00, 0x61, 0x73, ...])
  const pattern = /new\s+Uint8Array\s*\(\s*\[([\s\S]*?)\]\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(code)) !== null) {
    const content = match[1] ?? '';
    try {
      const bytes = parseByteLiteralArray(content);
      if (bytes.length > 4) {
        results.push({
          bytes,
          source: 'inline-uint8array',
          offset: match.index,
        });
      }
    } catch {
      // Skip malformed byte arrays
    }
  }

  // Match: Uint8Array.from([...])
  const fromPattern = /Uint8Array\s*\.\s*from\s*\(\s*\[([\s\S]*?)\]\s*\)/g;
  while ((match = fromPattern.exec(code)) !== null) {
    const content = match[1] ?? '';
    try {
      const bytes = parseByteLiteralArray(content);
      if (bytes.length > 4) {
        results.push({
          bytes,
          source: 'uint8array-from',
          offset: match.index,
        });
      }
    } catch {
      // Skip malformed
    }
  }

  // Match: new Uint8Array(buffer) where buffer is ArrayBuffer
  // This requires tracing the buffer assignment, so we just note the boundary
  return results;
}

function extractBase64WASM(code: string): WASMByteExtraction[] {
  const results: WASMByteExtraction[] = [];

  const pattern = /["'`]([A-Za-z0-9+/]{100,}={0,2})["'`]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(code)) !== null) {
    const b64Content = match[1] ?? '';
    if (!b64Content) continue;
    try {
      const decoded = Buffer.from(b64Content, 'base64');
      // Check for WASM magic bytes
      if (
        decoded.length >= 4 &&
        decoded[0] === 0x00 &&
        decoded[1] === 0x61 &&
        decoded[2] === 0x73 &&
        decoded[3] === 0x6d
      ) {
        results.push({
          bytes: new Uint8Array(decoded),
          source: 'base64-decoded',
          offset: match.index,
        });
      }
    } catch {
      // Not valid base64 or not WASM
    }
  }

  return results;
}

// ── WASM Header Parsing ──

function parseWASMHeader(bytes: Uint8Array): WASMModuleHeader {
  const header: WASMModuleHeader = {
    hasValidMagic: false,
    version: null,
    totalSize: bytes.length,
    sections: [],
    importCount: 0,
    exportCount: 0,
    memorySpecs: [],
    functionNames: [],
    isComplete: false,
  };

  if (bytes.length < 8) {
    return header;
  }

  // Check magic bytes: \0asm
  header.hasValidMagic =
    bytes[0] === WASM_MAGIC[0] &&
    bytes[1] === WASM_MAGIC[1] &&
    bytes[2] === WASM_MAGIC[2] &&
    bytes[3] === WASM_MAGIC[3];

  if (!header.hasValidMagic) {
    return header;
  }

  // Version (bytes 4-7)
  header.version = bytes[4]! | (bytes[5]! << 8) | (bytes[6]! << 16) | (bytes[7]! << 24);

  // Parse sections
  let offset = 8;
  let hasCode = false;
  let hasData = false;

  while (offset < bytes.length - 2) {
    const sectionId = bytes[offset]!;
    offset++;

    // Read LEB128-encoded section size
    const { value: sectionSize, bytesRead: sizeBytesRead } = readLEB128(bytes, offset);
    offset += sizeBytesRead;

    const sectionStart = offset;
    const sectionName = WASM_SECTION_NAMES[sectionId] ?? `unknown(${sectionId})`;

    let entryCount = 0;
    try {
      // For sections with entries, try to read the count
      if ([1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12].includes(sectionId)) {
        const { value: count } = readLEB128(bytes, offset);
        entryCount = count ?? 0;
      }
    } catch {
      // LEB128 parse failed for entry count
    }

    const sectionHeader: WASMSectionHeader = {
      id: sectionId,
      name: sectionName,
      size: sectionSize ?? 0,
      offset: sectionStart,
      entryCount,
    };

    header.sections.push(sectionHeader);

    // Track specific section types
    if (sectionId === 2) header.importCount = entryCount; // import section
    if (sectionId === 7) header.exportCount = entryCount; // export section
    if (sectionId === 5) {
      // memory section
      try {
        header.memorySpecs.push(parseMemorySection(bytes, sectionStart, sectionSize));
      } catch {
        header.memorySpecs.push({ minPages: 1, shared: false });
      }
    }
    if (sectionId === 10) hasCode = true; // code section
    if (sectionId === 11) hasData = true; // data section

    // Extract function names from export section
    if (sectionId === 7 && entryCount > 0) {
      try {
        const names = parseExportNames(bytes, sectionStart, sectionSize, entryCount);
        header.functionNames.push(...names);
      } catch {
        // Skip malformed export sections
      }
    }

    // Move to next section
    offset = sectionStart + sectionSize;

    // Safety: if section size would exceed buffer, stop
    if (offset > bytes.length) break;
  }

  header.isComplete = hasCode && hasData;

  return header;
}

function parseMemorySection(
  bytes: Uint8Array,
  start: number,
  _size: number,
): { minPages: number; maxPages?: number; shared: boolean } {
  let offset = start;
  const { value: count } = readLEB128(bytes, offset);
  offset += count === 0 ? 0 : LEB128Size(bytes, offset);

  // Read limits
  const limitsType = bytes[offset]!;
  offset++;

  const { value: minPages } = readLEB128(bytes, offset);
  const safeMinPages = minPages ?? 1;

  if (limitsType === 0x00) {
    // min only
    return { minPages: safeMinPages, shared: false };
  } else if (limitsType === 0x01) {
    // min + max
    offset += LEB128Size(bytes, offset);
    const { value: maxPages } = readLEB128(bytes, offset);
    return { minPages: safeMinPages, maxPages: maxPages ?? undefined, shared: false };
  } else if (limitsType === 0x02) {
    // shared memory
    offset += LEB128Size(bytes, offset);
    const { value: maxPages } = readLEB128(bytes, offset);
    return { minPages: safeMinPages, maxPages: maxPages ?? undefined, shared: true };
  }

  return { minPages: safeMinPages, shared: false };
}

function parseExportNames(
  bytes: Uint8Array,
  start: number,
  _size: number,
  _count: number,
): string[] {
  const names: string[] = [];
  let offset = start;

  try {
    // Skip the count (already known)
    const { bytesRead: countBytesRead } = readLEB128(bytes, offset);
    offset += countBytesRead;

    // Read each export entry
    for (let i = 0; i < Math.min(_count, 100); i++) {
      if (offset >= bytes.length) break;

      // Read name length
      const { value: nameLen, bytesRead: nameLenBytes } = readLEB128(bytes, offset);
      offset += nameLenBytes;

      // Read name
      if (offset + nameLen > bytes.length) break;
      const nameBytes = bytes.slice(offset, offset + nameLen);
      try {
        names.push(new TextDecoder('utf-8', { fatal: false }).decode(nameBytes));
      } catch {
        names.push(`export_${i}`);
      }
      offset += nameLen;

      // Skip kind byte + index
      offset++; // kind
      const { bytesRead: idxBytes } = readLEB128(bytes, offset);
      offset += idxBytes;
    }
  } catch {
    // Malformed export section
  }

  return names;
}

// ── JS↔WASM Interface Tracing ──

function traceJSWASMInterface(
  code: string,
  _bytes: Uint8Array | null,
  header: WASMModuleHeader,
): WASMJSInterface {
  const jsImports: WASMImport[] = [];
  const wasmExports: WASMExport[] = [];
  const memoryReferences: WASMMemoryRef[] = [];
  const tableReferences: WASMTableRef[] = [];
  const globalReferences: WASMGlobalRef[] = [];

  // Parse JS for WASM import objects: { env: { func: (...) => ... } }
  try {
    const ast = parser.parse(ensureUTF8Safe(code), {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });

    traverse(ast, {
      // Track WebAssembly.instantiate calls
      CallExpression(path) {
        const callee = path.node.callee;
        if (
          t.isMemberExpression(callee) &&
          t.isIdentifier(callee.object, { name: 'WebAssembly' }) &&
          t.isIdentifier(callee.property)
        ) {
          const method = callee.property.name;

          // Second argument to instantiate is the import object
          if (
            (method === 'instantiate' || method === 'instantiateStreaming') &&
            path.node.arguments.length >= 2
          ) {
            const importArg = path.node.arguments[1];
            if (t.isObjectExpression(importArg)) {
              for (const prop of importArg.properties) {
                if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                  const moduleName = prop.key.name;
                  if (t.isObjectExpression(prop.value)) {
                    for (const innerProp of prop.value.properties) {
                      if (t.isObjectProperty(innerProp) && t.isIdentifier(innerProp.key)) {
                        jsImports.push({
                          module: moduleName,
                          name: innerProp.key.name,
                          signature: 'unknown',
                          paramCount: 0,
                          returnType: 'unknown',
                        });
                      }
                    }
                  }
                }
              }
            }
          }

          // After instantiation, access instance.exports.*
          // This is traced by the export tracking below
        }
      },

      // Track instance.exports access and memory.buffer access
      MemberExpression(path) {
        // Check for instance.exports.*
        if (
          t.isMemberExpression(path.node.object) &&
          t.isIdentifier(path.node.object.property, { name: 'exports' })
        ) {
          if (t.isIdentifier(path.node.property)) {
            wasmExports.push({
              name: path.node.property.name,
              kind: 'function',
              index: wasmExports.length,
            });
          }
        }

        // Check for memory.buffer access
        if (
          t.isMemberExpression(path.node) &&
          t.isIdentifier(path.node.property, { name: 'buffer' })
        ) {
          memoryReferences.push({
            name: 'memory.buffer',
            minPages: 1,
            isShared: false,
            bufferAccess: true,
          });
        }
      },
    });
  } catch {
    // AST parse failed, continue with regex-based detection
  }

  // Fill in exports from parsed header
  for (const name of header.functionNames) {
    if (!wasmExports.find((e) => e.name === name)) {
      wasmExports.push({
        name,
        kind: 'function',
        index: wasmExports.length,
      });
    }
  }

  // Add memory specs from header
  for (const memSpec of header.memorySpecs) {
    memoryReferences.push({
      name: 'memory',
      minPages: memSpec.minPages,
      maxPages: memSpec.maxPages,
      isShared: memSpec.shared,
      bufferAccess: false,
    });
  }

  return {
    jsImports,
    wasmExports,
    memoryReferences,
    tableReferences,
    globalReferences,
  };
}

// ── String Extraction from WASM Data Sections ──

function extractStringsFromWASM(
  bytes: Uint8Array,
  header: WASMModuleHeader,
): { offset: number; value: string }[] {
  const strings: { offset: number; value: string }[] = [];

  // Find the data section
  const dataSection = header.sections.find((s) => s.id === 11); // data section
  if (!dataSection) return strings;

  // Scan the data section for UTF-8 strings (minimum 4 printable chars)
  const startOffset = dataSection.offset;
  const endOffset = Math.min(startOffset + dataSection.size, bytes.length);

  let currentStringStart = -1;
  let currentStringBytes: number[] = [];

  for (let i = startOffset; i < endOffset; i++) {
    const byte = bytes[i]!;
    const isPrintable = byte >= 0x20 && byte <= 0x7e;

    if (isPrintable) {
      if (currentStringStart === -1) currentStringStart = i;
      currentStringBytes.push(byte);
    } else {
      if (currentStringBytes.length >= 4) {
        try {
          const value = new TextDecoder('utf-8', { fatal: false }).decode(
            new Uint8Array(currentStringBytes),
          );
          strings.push({ offset: currentStringStart, value: ensureUTF8Safe(value) });
        } catch {
          // Skip non-decodable strings
        }
      }
      currentStringStart = -1;
      currentStringBytes = [];
    }
  }

  // Flush remaining
  if (currentStringBytes.length >= 4) {
    try {
      const value = new TextDecoder('utf-8', { fatal: false }).decode(
        new Uint8Array(currentStringBytes),
      );
      strings.push({ offset: currentStringStart, value: ensureUTF8Safe(value) });
    } catch {
      // Skip
    }
  }

  return strings.slice(0, 500); // Limit to 500 strings
}

// ── WASMicer / WASM Cloak Detection ──

function detectWASMicerPatterns(code: string): boolean {
  // WASMicer patterns: interleaved JS+WASM, WASM bundled inline
  const patterns = [
    /WebAssembly\s*\.\s*instantiate\s*\(\s*new\s+Uint8Array\s*\(\s*\[/,
    /wasmBytes|wasmModule|__wasm_module__/,
    /\.wasm\.js\b|wasm_bundle|wasm_inline/,
    /atob\s*\(\s*['"][A-Za-z0-9+/]{200,}={0,2}['"]\s*\)\s*;\s*WebAssembly/,
  ];
  return patterns.filter((p) => p.test(code)).length >= 2;
}

function detectWASMClOakPatterns(code: string): boolean {
  // WASM Cloak patterns: thin JS loader, encrypted WASM payload, runtime decryption
  const patterns = [
    /decrypt\s*\(\s*WebAssembly|wasmDecrypt|decryptModule/i,
    /new\s+WebAssembly\s*\.\s*Module\s*\(\s*decrypt\s*\(/i,
    /WebAssembly\s*\.\s*instantiate\s*\(\s*\w+\s*\.\s*decrypt\s*\(/i,
    /wasm.*encrypt|encrypt.*wasm/i,
  ];
  return patterns.filter((p) => p.test(code)).length >= 1;
}

// ── Utility Functions ──

function readLEB128(bytes: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let result = 0;
  let shift = 0;
  let bytesRead = 0;
  let byte: number;

  do {
    if (offset + bytesRead >= bytes.length) {
      return { value: result, bytesRead };
    }
    byte = bytes[offset + bytesRead]!;
    bytesRead++;
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while ((byte & 0x80) !== 0);

  return { value: result, bytesRead };
}

function LEB128Size(bytes: Uint8Array, offset: number): number {
  let size = 0;
  while (offset + size < bytes.length) {
    if ((bytes[offset + size]! & 0x80) === 0) {
      return size + 1;
    }
    size++;
  }
  return size + 1;
}

function parseByteLiteralArray(content: string): Uint8Array {
  // Parse "0x00, 0x61, 0x73, 0x6d, ..." or "0, 97, 115, 109, ..."
  const bytes: number[] = [];
  const parts = content.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === '') continue;

    let value: number;
    if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
      value = parseInt(trimmed, 16);
    } else {
      value = parseInt(trimmed, 10);
    }

    if (isNaN(value) || value < 0 || value > 255) {
      // Invalid byte value, skip
      continue;
    }

    bytes.push(value);
  }

  return new Uint8Array(bytes);
}

/**
 * Check if a raw string (Uint8Array literal content) looks like WASM bytes.
 * Used for boundary detection before parsing the actual bytes.
 */
function looksLikeWASMByteString(content: string): boolean {
  // Check for magic byte literals: 0x00, 0x61, 0x73, 0x6d
  const hasMagic =
    /0x00/.test(content) && /0x61/.test(content) && /0x73/.test(content) && /0x6d/.test(content);
  if (hasMagic) return true;

  // Check for high density of byte literals (likely a large byte array)
  const byteLiteralCount = (content.match(/0x[0-9a-f]{2}/gi) ?? []).length;
  if (byteLiteralCount > 50) return true;

  return false;
}

function looksLikeBase64WASM(b64Content: string): boolean {
  try {
    const decoded = Buffer.from(b64Content, 'base64');
    if (decoded.length < 4) return false;
    // Check for WASM magic bytes
    return decoded[0] === 0x00 && decoded[1] === 0x61 && decoded[2] === 0x73 && decoded[3] === 0x6d;
  } catch {
    return false;
  }
}

function extractUint8ArrayContent(code: string, startIndex: number): string | null {
  // Find the matching ] for the [
  let depth = 0;
  let bracketStart = -1;

  for (let i = startIndex; i < code.length && i < startIndex + 100000; i++) {
    if (code[i] === '[') {
      if (depth === 0) bracketStart = i;
      depth++;
    } else if (code[i] === ']') {
      depth--;
      if (depth === 0 && bracketStart !== -1) {
        return code.slice(bracketStart + 1, i);
      }
    }
  }

  return null;
}

function extractWASMReference(code: string, index: number): string {
  // Extract the variable name or expression that holds the WASM object
  const before = code.slice(Math.max(0, index - 100), index);
  const after = code.slice(index, Math.min(code.length, index + 200));

  // Look for variable assignment
  const varMatch = before.match(/(?:var|let|const)\s+(\w+)\s*=\s*$/);
  if (varMatch) return varMatch[1] ?? 'wasmRef';

  // Look for property access
  const propMatch = after.match(/^\s*(?:WebAssembly\s*\.\s*\w+)/);
  if (propMatch) return propMatch[1] ?? 'WebAssembly';

  return 'WebAssembly';
}

function extractVariableName(code: string, index: number): string {
  const before = code.slice(Math.max(0, index - 200), index);
  const varMatch = before.match(/(?:var|let|const)\s+(\w+)\s*=\s*$/);
  if (varMatch) return varMatch[1] ?? 'wasmBytes';
  return 'wasmBytes';
}

function extractSnippet(code: string, index: number, radius: number = 80): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(code.length, index + radius);
  return code.slice(start, end).replace(/\n/g, ' ').trim();
}

function getColumn(code: string, index: number): number {
  const lastNewline = code.lastIndexOf('\n', index);
  return lastNewline === -1 ? index : index - lastNewline - 1;
}

/**
 * Ensure string is UTF-8 safe — replace invalid sequences with replacement character.
 * Addresses the user-reported issue where js-beautify/webcrack truncated files to 0
 * on certain charset/encoding edge cases.
 */
function ensureUTF8Safe(str: string): string {
  try {
    if (typeof str !== 'string') return '';
    return str
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '\uFFFD')
      .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
  } catch {
    return str.replace(/[^\x00-\x7F]/g, '\uFFFD');
  }
}
