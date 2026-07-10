import { runTransformWorkbench } from '@modules/transform/workbench';
import type { BinaryMagicHintInput } from '@src/config/binary-magic';
import { fail, toTextResponse } from './shared';

export class WorkbenchHandlers {
  async handleTransformWorkbench(args: Record<string, unknown>) {
    try {
      const inputBase64 = readRequiredString(args, 'inputBase64');
      const steps = readSteps(args['steps']);
      const previewBytes =
        typeof args['previewBytes'] === 'number' && Number.isFinite(args['previewBytes'])
          ? args['previewBytes']
          : undefined;
      const includeOutputBase64 =
        typeof args['includeOutputBase64'] === 'boolean' ? args['includeOutputBase64'] : undefined;
      const customMagicHints = readCustomMagicHints(args['customMagicHints']);
      const maxInputBytes = readOptionalFiniteNumber(args, 'maxInputBytes');
      const maxOutputBytes = readOptionalFiniteNumber(args, 'maxOutputBytes');
      const maxSteps = readOptionalFiniteNumber(args, 'maxSteps');
      return toTextResponse(
        runTransformWorkbench({
          inputBase64,
          steps,
          ...(previewBytes !== undefined ? { previewBytes } : {}),
          ...(includeOutputBase64 !== undefined ? { includeOutputBase64 } : {}),
          ...(customMagicHints.length > 0 ? { customMagicHints } : {}),
          ...(maxInputBytes !== undefined ? { maxInputBytes } : {}),
          ...(maxOutputBytes !== undefined ? { maxOutputBytes } : {}),
          ...(maxSteps !== undefined ? { maxSteps } : {}),
        }),
      );
    } catch (error) {
      return fail('transform_workbench', error);
    }
  }
}

function readOptionalFiniteNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readCustomMagicHints(value: unknown): BinaryMagicHintInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('customMagicHints must be an array');
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error('customMagicHints entries must be objects');
    }
    const record = entry as Record<string, unknown>;
    const label = record['label'];
    if (typeof label !== 'string' || label.trim().length === 0) {
      throw new Error('customMagicHints label must be a non-empty string');
    }
    const prefixHex = record['prefixHex'];
    const prefixAscii = record['prefixAscii'];
    const description = record['description'];
    return {
      label: label.trim(),
      ...(typeof prefixHex === 'string' ? { prefixHex } : {}),
      ...(typeof prefixAscii === 'string' ? { prefixAscii } : {}),
      ...(typeof description === 'string' ? { description } : {}),
    };
  });
}

function readRequiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function readSteps(
  value: unknown,
): Array<{ op: string; key?: string; keyHex?: string; iv?: string; ivHex?: string }> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('steps must contain at least one transform step');
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('Each step must be an object');
    const record = entry as Record<string, unknown>;
    const op = record['op'];
    if (typeof op !== 'string' || op.trim().length === 0) {
      throw new Error('step.op is required');
    }
    return {
      op: op.trim(),
      ...(typeof record['key'] === 'string' ? { key: record['key'] } : {}),
      ...(typeof record['keyHex'] === 'string' ? { keyHex: record['keyHex'] } : {}),
      ...(typeof record['iv'] === 'string' ? { iv: record['iv'] } : {}),
      ...(typeof record['ivHex'] === 'string' ? { ivHex: record['ivHex'] } : {}),
    };
  });
}
