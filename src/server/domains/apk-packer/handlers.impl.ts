/**
 * apk-packer domain — two tool handlers wrapping the PackerDetector module.
 *
 * Responsibilities:
 *  - Type-safe argument extraction via `parseArgs` utilities.
 *  - Compile every customSignature input into a runtime PackerSignature
 *    (rejecting ReDoS heuristics, oversize sources, and malformed shapes
 *    with a `ToolError(VALIDATION)`).
 *  - Defer matching to the module layer.
 *  - Wrap the result in the standard MCP envelope via {@link handleSafe}.
 */

import { ToolError } from '@errors/ToolError';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';
import { argEnum, argString } from '@server/domains/shared/parse-args';
import { DEFAULT_SIGNATURES } from '@modules/apk-packer/fingerprints';
import { PackerDetector } from '@modules/apk-packer/PackerDetector';
import { compileSignatureInput } from '@modules/apk-packer/classifiers';
import type {
  DetectOptions,
  PackerSignature,
  PackerSignatureInput,
  SignatureMode,
} from '@modules/apk-packer/types';

const RULE_MODE_SET = new Set(['append', 'prepend', 'replace'] as const);
const CONFIDENCE_SET = new Set(['high', 'medium', 'low'] as const);

/**
 * Coerce a raw `customSignatures` arg into compiled {@link PackerSignature}s.
 * Throws {@link ToolError}(`VALIDATION`) on malformed shape.
 */
function compileCustomSignatures(raw: unknown): PackerSignature[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new ToolError('VALIDATION', 'customSignatures must be an array of signature objects');
  }
  return raw.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ToolError('VALIDATION', `customSignatures[${index}] must be an object`);
    }
    const input = entry as Record<string, unknown>;
    const { name, vendor, libPatterns, confidence, notes } = input;
    if (typeof name !== 'string') {
      throw new ToolError('VALIDATION', `customSignatures[${index}].name must be a string`);
    }
    if (typeof vendor !== 'string') {
      throw new ToolError('VALIDATION', `customSignatures[${index}].vendor must be a string`);
    }
    if (!Array.isArray(libPatterns)) {
      throw new ToolError(
        'VALIDATION',
        `customSignatures[${index}].libPatterns must be a string array`,
      );
    }
    for (let i = 0; i < libPatterns.length; i++) {
      if (typeof libPatterns[i] !== 'string') {
        throw new ToolError(
          'VALIDATION',
          `customSignatures[${index}].libPatterns[${i}] must be a string`,
        );
      }
    }
    const signatureInput: PackerSignatureInput = {
      name,
      vendor,
      libPatterns: libPatterns as string[],
    };
    if (typeof confidence === 'string') {
      if (!CONFIDENCE_SET.has(confidence as 'high' | 'medium' | 'low')) {
        throw new ToolError(
          'VALIDATION',
          `customSignatures[${index}].confidence must be one of: high, medium, low`,
        );
      }
      (signatureInput as { confidence?: 'high' | 'medium' | 'low' }).confidence = confidence as
        | 'high'
        | 'medium'
        | 'low';
    }
    if (typeof notes === 'string') {
      (signatureInput as { notes?: string }).notes = notes;
    }
    return compileSignatureInput(signatureInput);
  });
}

/** Serialize a built-in or compiled signature for list-signatures output. */
function serializeSignature(sig: PackerSignature): Record<string, unknown> {
  return {
    name: sig.name,
    vendor: sig.vendor,
    libPatterns: sig.libPatterns.map((p) =>
      typeof p === 'string' ? { type: 'literal', value: p } : { type: 'regex', value: p.source },
    ),
    ...(sig.confidence ? { confidence: sig.confidence } : {}),
    ...(sig.notes ? { notes: sig.notes } : {}),
  };
}

export class ApkPackerHandlers {
  private readonly detector: PackerDetector;

  constructor(detector: PackerDetector = new PackerDetector()) {
    this.detector = detector;
  }

  handleApkPackerDetect(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const apkPath = argString(args, 'apkPath');
      const dirPath = argString(args, 'dirPath');
      if (!apkPath && !dirPath) {
        throw new ToolError('VALIDATION', 'Either apkPath or dirPath must be provided');
      }
      if (apkPath && dirPath) {
        throw new ToolError('VALIDATION', 'Provide only one of apkPath or dirPath, not both');
      }
      const customSignatures = compileCustomSignatures(args['customSignatures']);
      const ruleMode = argEnum(args, 'ruleMode', RULE_MODE_SET) as SignatureMode | undefined;

      const opts: DetectOptions = {};
      if (customSignatures !== undefined) opts.customSignatures = customSignatures;
      if (ruleMode !== undefined) opts.ruleMode = ruleMode;

      const result = apkPath
        ? await this.detector.detectFromApk(apkPath, opts)
        : await this.detector.detectFromDir(dirPath as string, opts);

      return {
        packers: result.packers,
        confidence: result.confidence,
        layerCount: result.layerCount,
      };
    });
  }

  handleApkPackerListSignatures(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const vendorFilter = argString(args, 'vendor');
      const filtered = vendorFilter
        ? DEFAULT_SIGNATURES.filter((s) =>
            s.vendor.toLowerCase().includes(vendorFilter.toLowerCase()),
          )
        : DEFAULT_SIGNATURES;
      return { signatures: filtered.map(serializeSignature) };
    });
  }
}
