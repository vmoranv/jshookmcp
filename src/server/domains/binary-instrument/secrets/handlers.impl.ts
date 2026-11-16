/**
 * binary-secrets domain — single tool handler that wraps the
 * {@link KeyExtractor} module.
 *
 * Responsibilities:
 *  - Type-safe argument extraction via `parseArgs` utilities.
 *  - Validate option shapes (e.g. `keyLengths` is an array of integers,
 *    `formats` is a subset of {'raw','base64','hex','custom'}).
 *  - Defer the streaming scan to the module layer.
 *  - Wrap the result in the standard MCP envelope via {@link handleSafe}.
 */

import { KeyExtractor } from '@modules/binary-secrets/KeyExtractor';
import type { ExtractKeysOptions, KeyFormat, CustomPattern } from '@modules/binary-secrets/types';
import { ToolError } from '@errors/ToolError';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';
import {
  argBool,
  argNumber,
  argObject,
  argStringRequired,
} from '@server/domains/shared/parse-args';

const FORMAT_SET = new Set<KeyFormat>(['raw', 'base64', 'hex', 'custom']);

function coerceKeyLengths(raw: unknown): readonly number[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new ToolError('VALIDATION', 'keyLengths must be an array of positive integers');
  }
  const out: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v <= 0) {
      throw new ToolError(
        'VALIDATION',
        `keyLengths[${i}] must be a positive integer (got ${String(v)})`,
      );
    }
    out.push(v);
  }
  return out;
}

function coerceFormats(raw: unknown): readonly KeyFormat[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new ToolError('VALIDATION', 'formats must be an array of strings');
  }
  const out: KeyFormat[] = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (typeof v !== 'string' || !FORMAT_SET.has(v as KeyFormat)) {
      throw new ToolError(
        'VALIDATION',
        `formats[${i}] must be one of: raw, base64, hex, custom (got ${String(v)})`,
      );
    }
    out.push(v as KeyFormat);
  }
  return out;
}

/** Validate the shape of customPatterns (compile-time ReDoS guards live in the module). */
function coerceCustomPatterns(raw: unknown): readonly CustomPattern[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new ToolError('VALIDATION', 'customPatterns must be an array of {pattern, category?}');
  }
  const out: CustomPattern[] = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i] as Record<string, unknown> | null;
    if (!v || typeof v !== 'object' || typeof v['pattern'] !== 'string') {
      throw new ToolError('VALIDATION', `customPatterns[${i}].pattern must be a string`);
    }
    const category = v['category'];
    if (category !== undefined && typeof category !== 'string') {
      throw new ToolError('VALIDATION', `customPatterns[${i}].category must be a string`);
    }
    out.push({ pattern: v['pattern'], ...(category !== undefined ? { category } : {}) });
  }
  return out;
}

export class BinarySecretsHandlers {
  private readonly extractor: KeyExtractor;

  constructor(extractor: KeyExtractor = new KeyExtractor()) {
    this.extractor = extractor;
  }

  handleBinaryKeyExtract(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const filePath = argStringRequired(args, 'filePath');
      const opts: Writable<ExtractKeysOptions> = {};

      const keyLengths = coerceKeyLengths(args['keyLengths']);
      if (keyLengths !== undefined) opts.keyLengths = keyLengths;

      const minEntropy = argNumber(args, 'minEntropy');
      if (minEntropy !== undefined) opts.minEntropy = minEntropy;

      const formats = coerceFormats(args['formats']);
      if (formats !== undefined) opts.formats = formats;

      const customPatterns = coerceCustomPatterns(args['customPatterns']);
      if (customPatterns !== undefined) opts.customPatterns = customPatterns;

      const includeContext = argBool(args, 'includeContext');
      if (includeContext !== undefined) opts.includeContext = includeContext;

      const contextBytes = argNumber(args, 'contextBytes');
      if (contextBytes !== undefined) opts.contextBytes = contextBytes;

      const maxResults = argNumber(args, 'maxResults');
      if (maxResults !== undefined) opts.maxResults = maxResults;

      const maxChunkBytes = argNumber(args, 'maxChunkBytes');
      if (maxChunkBytes !== undefined) opts.maxChunkBytes = maxChunkBytes;

      const scanWindowRaw = argObject(args, 'scanWindow');
      if (scanWindowRaw !== undefined) {
        const start =
          typeof scanWindowRaw['start'] === 'number' ? scanWindowRaw['start'] : undefined;
        const end = typeof scanWindowRaw['end'] === 'number' ? scanWindowRaw['end'] : undefined;
        opts.scanWindow = { start, end };
      }

      const result = await this.extractor.extractFromFile(filePath, opts);
      return { result };
    });
  }
}

type Writable<T> = { -readonly [P in keyof T]: T[P] };
