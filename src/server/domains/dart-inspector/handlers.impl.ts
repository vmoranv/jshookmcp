/**
 * dart-inspector domain — single tool handler that wraps the
 * {@link StringsExtractor} module.
 *
 * Responsibilities:
 *  - Type-safe argument extraction via `parseArgs` utilities.
 *  - Compile every customRule input into a `CategoryRule` (rejecting
 *    ReDoS heuristics and invalid regex with a `ToolError(VALIDATION)`).
 *  - Defer streaming extraction and categorization to the module layer.
 *  - Wrap the result in the standard MCP envelope via {@link handleSafe}.
 */

import { StringsExtractor } from '@modules/dart-inspector/StringsExtractor';
import { compileRuleInput } from '@modules/dart-inspector/classifiers';
import type {
  CategoryRule,
  CategoryRuleInput,
  ExtractOptions,
  RuleMode,
} from '@modules/dart-inspector/types';
import { ToolError } from '@errors/ToolError';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';
import {
  argBool,
  argEnum,
  argNumber,
  argObject,
  argStringRequired,
} from '@server/domains/shared/parse-args';

const ENCODING_SET = new Set(['ascii', 'utf16le', 'both'] as const);
const RULE_MODE_SET = new Set(['append', 'prepend', 'replace'] as const);

/**
 * Coerce the raw `customRules` argument into a list of compiled
 * {@link CategoryRule}s, throwing {@link ToolError}(`VALIDATION`) on
 * malformed shape.
 */
function compileCustomRules(raw: unknown): CategoryRule[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new ToolError('VALIDATION', 'customRules must be an array of rule objects');
  }
  return raw.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ToolError('VALIDATION', `customRules[${index}] must be an object`);
    }
    const input = entry as Record<string, unknown>;
    const { category, pattern, flags, exclude, excludeFlags } = input;
    if (typeof category !== 'string') {
      throw new ToolError('VALIDATION', `customRules[${index}].category must be a string`);
    }
    if (typeof pattern !== 'string') {
      throw new ToolError('VALIDATION', `customRules[${index}].pattern must be a string`);
    }
    const ruleInput: CategoryRuleInput = { category, pattern };
    if (typeof flags === 'string') ruleInput.flags = flags;
    if (typeof exclude === 'string') ruleInput.exclude = exclude;
    if (typeof excludeFlags === 'string') ruleInput.excludeFlags = excludeFlags;
    if (typeof input['confidence'] === 'number') {
      ruleInput.confidence = input['confidence'];
    }
    if (typeof input['enableWhenFileNameMatches'] === 'string') {
      ruleInput.enableWhenFileNameMatches = input['enableWhenFileNameMatches'];
    }
    if (typeof input['enableWhenFileNameFlags'] === 'string') {
      ruleInput.enableWhenFileNameFlags = input['enableWhenFileNameFlags'];
    }
    return compileRuleInput(ruleInput);
  });
}

export class DartInspectorHandlers {
  private readonly extractor: StringsExtractor;

  constructor(extractor: StringsExtractor = new StringsExtractor()) {
    this.extractor = extractor;
  }

  handleDartStringsExtract(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const filePath = argStringRequired(args, 'filePath');
      const customRules = compileCustomRules(args['customRules']);

      const opts: ExtractOptions = {};
      const minLength = argNumber(args, 'minLength');
      if (minLength !== undefined) opts.minLength = minLength;
      const includeRaw = argBool(args, 'includeRaw');
      if (includeRaw !== undefined) opts.includeRaw = includeRaw;
      const includeOffsets = argBool(args, 'includeOffsets');
      if (includeOffsets !== undefined) opts.includeOffsets = includeOffsets;
      const encoding = argEnum(args, 'encoding', ENCODING_SET);
      if (encoding !== undefined) opts.encoding = encoding;
      const maxChunkBytes = argNumber(args, 'maxChunkBytes');
      if (maxChunkBytes !== undefined) opts.maxChunkBytes = maxChunkBytes;
      const maxOffsetsPerString = argNumber(args, 'maxOffsetsPerString');
      if (maxOffsetsPerString !== undefined) opts.maxOffsetsPerString = maxOffsetsPerString;
      const ruleMode = argEnum(args, 'ruleMode', RULE_MODE_SET) as RuleMode | undefined;
      if (ruleMode !== undefined) opts.ruleMode = ruleMode;
      const regexTimeoutMs = argNumber(args, 'regexTimeoutMs');
      if (regexTimeoutMs !== undefined) opts.regexTimeoutMs = regexTimeoutMs;
      if (customRules !== undefined) opts.customRules = customRules;

      const scanWindowRaw = argObject(args, 'scanWindow');
      if (scanWindowRaw !== undefined) {
        const start =
          typeof scanWindowRaw['start'] === 'number' ? scanWindowRaw['start'] : undefined;
        const end = typeof scanWindowRaw['end'] === 'number' ? scanWindowRaw['end'] : undefined;
        opts.scanWindow = { start, end };
      }
      const scanStride = argNumber(args, 'scanStride');
      if (scanStride !== undefined) opts.scanStride = scanStride;

      const strings = await this.extractor.extractFromFile(filePath, opts);
      return { strings };
    });
  }
}
