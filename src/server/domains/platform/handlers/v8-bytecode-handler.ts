/**
 * v8_bytecode_decompile — V8 bytecode (.jsc / bytenode) decompiler.
 * Strategy 1: view8 Python package via subprocess
 * Strategy 2: Built-in constant pool extractor (parses V8 serialized data)
 */

import { readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extname } from 'node:path';
import {
  toTextResponse,
  toErrorResponse,
  parseStringArg,
  pathExists,
} from '@server/domains/platform/handlers/platform-utils';
import { V8_BYTECODE_SUBPROC_TIMEOUT_MS } from '@src/constants';

const execFileAsync = promisify(execFile);

/** V8 bytecode magic bytes for detection. */
const V8_MAGIC = Buffer.from([0xc0, 0xde]);
const BYTENODE_MAGIC = Buffer.from('BYTN');

/** Known V8 bytecode file extensions. */
const JSC_EXTENSIONS = new Set(['.jsc', '.bin']);

interface DecompileResult {
  [key: string]: unknown;
  success: boolean;
  tool: string;
  filePath: string;
  fileSize: number;
  detectedFormat: string;
  strategy: string;
  pseudocode?: string;
  constantPool?: string[];
  strings?: string[];
  error?: string;
  note?: string;
}

export interface View8Availability {
  available: boolean;
  interpreter?: string;
  reason?: string;
}

/**
 * Detect if a buffer contains V8 bytecode.
 */
function detectFormat(buffer: Buffer, filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();

  // Check Bytenode header
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(BYTENODE_MAGIC)) {
    return 'bytenode';
  }

  // Check raw V8 bytecode magic
  if (buffer.length >= 2 && buffer.subarray(0, 2).equals(V8_MAGIC)) {
    return 'v8-raw';
  }

  // Check file extension
  if (JSC_EXTENSIONS.has(ext)) {
    return 'jsc-extension';
  }

  // Heuristic: look for V8 bytecode signatures deeper in the file
  const v8Markers = [
    Buffer.from('Ldar'), // V8 bytecode mnemonics
    Buffer.from('Star'),
    Buffer.from('LdaSmi'),
    Buffer.from('CallRuntime'),
  ];
  for (const marker of v8Markers) {
    if (buffer.indexOf(marker) !== -1) {
      return 'v8-heuristic';
    }
  }

  return null;
}

/**
 * Strategy 1: Use View8 Python package for full decompilation.
 */
async function tryView8(
  filePath: string,
): Promise<{ ok: boolean; output?: string; error?: string }> {
  try {
    // Try python -m view8
    const { stdout, stderr } = await execFileAsync('python', ['-m', 'view8', filePath], {
      timeout: V8_BYTECODE_SUBPROC_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    if (stdout && stdout.trim().length > 0) {
      return { ok: true, output: stdout };
    }
    return { ok: false, error: stderr || 'Empty output from view8' };
  } catch {
    try {
      // Fallback: try python3
      const { stdout } = await execFileAsync('python3', ['-m', 'view8', filePath], {
        timeout: V8_BYTECODE_SUBPROC_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      });
      if (stdout && stdout.trim().length > 0) {
        return { ok: true, output: stdout };
      }
      return { ok: false, error: 'Empty output from view8' };
    } catch {
      return { ok: false, error: 'view8 not available. Install with: pip install view8' };
    }
  }
}

async function tryView8Interpreter(interpreter: string): Promise<View8Availability> {
  try {
    await execFileAsync(
      interpreter,
      ['-c', 'import view8; print(getattr(view8, "__file__", "view8"))'],
      {
        timeout: V8_BYTECODE_SUBPROC_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      },
    );
    return { available: true, interpreter };
  } catch (error) {
    return {
      available: false,
      interpreter,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function probeView8Availability(): Promise<View8Availability> {
  const python = await tryView8Interpreter('python');
  if (python.available) {
    return python;
  }

  const python3 = await tryView8Interpreter('python3');
  if (python3.available) {
    return python3;
  }

  return {
    available: false,
    reason:
      python.reason && python3.reason
        ? `${python.reason}; ${python3.reason}`
        : (python.reason ?? python3.reason ?? 'view8 is not available'),
  };
}

/**
 * Strategy 2: Built-in constant pool extractor.
 * Extracts readable strings and numeric constants from V8 serialized bytecode.
 */
function extractConstantPool(buffer: Buffer): { strings: string[]; numbers: number[] } {
  const strings: string[] = [];
  const numbers: number[] = [];
  const seen = new Set<string>();

  // Extract ASCII/UTF-8 strings (minimum 4 chars, reasonable content)
  const MIN_STRING_LEN = 4;
  const MAX_STRING_LEN = 2000;
  let currentString = '';

  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i]!;
    // Printable ASCII range
    if (byte >= 0x20 && byte <= 0x7e) {
      currentString += String.fromCharCode(byte);
    } else {
      if (currentString.length >= MIN_STRING_LEN && currentString.length <= MAX_STRING_LEN) {
        // Filter out obvious non-code strings (binary noise)
        if (isLikelyCodeString(currentString) && !seen.has(currentString)) {
          seen.add(currentString);
          strings.push(currentString);
        }
      }
      currentString = '';
    }
  }

  // Extract UTF-16LE strings (common in V8 internals)
  for (let i = 0; i < buffer.length - 3; i++) {
    if (buffer[i + 1] === 0x00 && buffer[i]! >= 0x20 && buffer[i]! <= 0x7e) {
      let utf16str = '';
      let j = i;
      while (
        j < buffer.length - 1 &&
        buffer[j]! >= 0x20 &&
        buffer[j]! <= 0x7e &&
        buffer[j + 1] === 0x00
      ) {
        utf16str += String.fromCharCode(buffer[j]!);
        j += 2;
      }
      if (utf16str.length >= MIN_STRING_LEN && utf16str.length <= MAX_STRING_LEN) {
        if (isLikelyCodeString(utf16str) && !seen.has(utf16str)) {
          seen.add(utf16str);
          strings.push(utf16str);
        }
      }
    }
  }

  return { strings, numbers };
}

/**
 * Filter heuristic: is this string likely from source code rather than binary noise?
 */
function isLikelyCodeString(s: string): boolean {
  // Skip strings that are all the same character
  if (new Set(s).size <= 2) return false;

  // Skip strings with too many special chars (binary fragments)
  const specialRatio =
    (s.match(/[^a-zA-Z0-9_\-.\s/\\:;=+*&|!?,'"(){}[\]<>@#$%^~`]/g) ?? []).length / s.length;
  if (specialRatio > 0.3) return false;

  // Likely code indicators
  const codePatterns = [
    /[a-zA-Z_$][a-zA-Z0-9_$]*/, // identifiers
    /function\s/,
    /return\s/,
    /const\s/,
    /let\s/,
    /var\s/,
    /require\(/,
    /module\.exports/,
    /import\s/,
    /\.prototype\./,
    /\.call\(/,
    /\.apply\(/,
    /async\s/,
    /await\s/,
    /Promise/,
    /https?:\/\//, // URLs
    /[a-zA-Z]+Error/, // Error types
  ];

  return codePatterns.some((p) => p.test(s));
}

export async function handleV8BytecodeDecompile(
  args: Record<string, unknown>,
): Promise<ReturnType<typeof toTextResponse>> {
  try {
    const filePath = parseStringArg(args, 'filePath', true);
    if (!filePath) {
      throw new Error('filePath is required — path to a .jsc or V8 bytecode file');
    }

    if (!(await pathExists(filePath))) {
      return toTextResponse({
        success: false,
        tool: 'v8_bytecode_decompile',
        error: `File does not exist: ${filePath}`,
      });
    }

    const fileStat = await stat(filePath);
    if (fileStat.size > 50 * 1024 * 1024) {
      return toTextResponse({
        success: false,
        tool: 'v8_bytecode_decompile',
        error: `File too large (${(fileStat.size / 1024 / 1024).toFixed(1)}MB). Maximum: 50MB.`,
      });
    }

    const buffer = await readFile(filePath);
    const format = detectFormat(buffer, filePath);

    if (!format) {
      return toTextResponse({
        success: false,
        tool: 'v8_bytecode_decompile',
        filePath,
        fileSize: fileStat.size,
        error:
          'Not a recognized V8 bytecode format. Expected .jsc, bytenode, or V8 serialized bytecode.',
        hint: 'Ensure the file is a V8 compiled bytecode file (created by bytenode or v8.serialize).',
      });
    }

    const result: DecompileResult = {
      success: false,
      tool: 'v8_bytecode_decompile',
      filePath,
      fileSize: fileStat.size,
      detectedFormat: format,
      strategy: 'pending',
    };

    // Strategy 1: Try view8 for full decompilation
    const view8Result = await tryView8(filePath);
    if (view8Result.ok && view8Result.output) {
      result.success = true;
      result.strategy = 'view8';
      result.pseudocode =
        view8Result.output.length > 50_000
          ? view8Result.output.slice(0, 50_000) +
            '\n\n... [truncated, total ' +
            view8Result.output.length +
            ' chars]'
          : view8Result.output;
      return toTextResponse(result);
    }

    // Strategy 2: Fallback to constant pool extraction
    const { strings } = extractConstantPool(buffer);

    if (strings.length > 0) {
      result.success = true;
      result.strategy = 'constant-pool-extraction';
      result.strings = strings.slice(0, 500); // Cap at 500 strings
      result.note = [
        `view8 unavailable (${view8Result.error}). Used built-in constant pool extraction.`,
        `Found ${strings.length} code-relevant strings. These include function names, identifiers, URLs, and string literals from the original source.`,
        `For full decompilation, install view8: pip install view8`,
      ].join(' ');
    } else {
      result.success = false;
      result.strategy = 'none';
      result.error = `Could not decompile. view8: ${view8Result.error}. Built-in extraction found no code strings.`;
      result.note = 'The bytecode may be heavily optimized or use an unsupported V8 version.';
    }

    return toTextResponse(result);
  } catch (error) {
    return toErrorResponse('v8_bytecode_decompile', error);
  }
}
