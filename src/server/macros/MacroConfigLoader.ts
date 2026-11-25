/**
 * MacroConfigLoader — Load user-defined macros from JSON config files.
 *
 * Discovers and validates JSON macro definitions from a directory
 * (typically `macros/` in the project root).
 */

import { readdir, readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { logger } from '@utils/logger';
import type { MacroDefinition, MacroStepDefinition } from './types';

interface MacroJsonStep {
  id: string;
  toolName?: string;
  input?: Record<string, unknown>;
  inputFrom?: Record<string, string>;
  timeoutMs?: number;
  retry?: {
    maxAttempts: number;
    backoffMs: number;
    multiplier?: number;
  };
  optional?: boolean;
  sequenceSteps?: MacroJsonStep[];
  parallelSteps?: MacroJsonStep[];
  maxConcurrency?: number;
  failFast?: boolean;
  branchStep?: {
    predicateId: string;
    whenTrue: MacroJsonStep;
    whenFalse?: MacroJsonStep;
  };
  fallbackStep?: {
    primary: MacroJsonStep;
    fallback: MacroJsonStep;
  };
}

interface MacroJsonSchema {
  id: string;
  displayName: string;
  description?: string;
  tags?: string[];
  timeoutMs?: number;
  steps: MacroJsonStep[];
}

/**
 * Load all valid macro definitions from JSON files in a directory.
 * Invalid files are logged as warnings and skipped.
 */
async function loadFromDirectory(dir: string): Promise<MacroDefinition[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    // Directory doesn't exist — not an error, just no user macros
    return [];
  }

  const jsonFiles = files.filter((f) => extname(f) === '.json');
  const macros: MacroDefinition[] = [];

  for (const file of jsonFiles) {
    const path = resolve(dir, file);
    try {
      const raw = JSON.parse(await readFile(path, 'utf-8')) as unknown;
      if (validate(raw)) {
        macros.push(toDefinition(raw));
        logger.info(`[macros] Loaded user macro "${raw.id}" from ${file}`);
      } else {
        logger.warn(`[macros] Skipping ${file}: invalid macro schema`);
      }
    } catch (err) {
      logger.warn(`[macros] Skipping ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return macros;
}

const MAX_STEP_DEPTH = 64;

/**
 * Type guard — validates that raw JSON matches the expected macro schema.
 */
function validate(raw: unknown): raw is MacroJsonSchema {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.id !== 'string' || !obj.id) return false;
  if (typeof obj.displayName !== 'string' || !obj.displayName) return false;
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) return false;
  if (obj.description !== undefined && typeof obj.description !== 'string') return false;
  if (
    obj.tags !== undefined &&
    (!Array.isArray(obj.tags) || !obj.tags.every((tag) => typeof tag === 'string'))
  ) {
    return false;
  }
  if (obj.timeoutMs !== undefined && !isNonNegativeFiniteNumber(obj.timeoutMs)) return false;

  for (const step of obj.steps) {
    if (!validateStep(step)) return false;
  }

  return true;
}

function hasSingleStepKind(step: Record<string, unknown>): boolean {
  let kinds = 0;
  if (typeof step.toolName === 'string' && step.toolName.length > 0) kinds++;
  if (Array.isArray(step.sequenceSteps)) kinds++;
  if (Array.isArray(step.parallelSteps)) kinds++;
  if (isRecord(step.branchStep)) kinds++;
  if (isRecord(step.fallbackStep)) kinds++;
  return kinds === 1;
}

function validateStep(raw: unknown, depth = 0): raw is MacroJsonStep {
  if (depth >= MAX_STEP_DEPTH) return false;
  if (!raw || typeof raw !== 'object') return false;
  const step = raw as Record<string, unknown>;
  if (typeof step.id !== 'string' || !step.id) return false;

  if (!hasSingleStepKind(step)) return false;
  if (step.retry !== undefined && !validateRetryPolicy(step.retry)) return false;
  if (step.input !== undefined && !isRecord(step.input)) return false;
  if (step.inputFrom !== undefined && !isStringRecord(step.inputFrom)) return false;
  if (step.timeoutMs !== undefined && !isNonNegativeFiniteNumber(step.timeoutMs)) return false;
  if (step.optional !== undefined && typeof step.optional !== 'boolean') return false;
  if (step.maxConcurrency !== undefined && !isPositiveInteger(step.maxConcurrency)) return false;
  if (step.failFast !== undefined && typeof step.failFast !== 'boolean') return false;

  if (step.sequenceSteps !== undefined) {
    if (!Array.isArray(step.sequenceSteps) || step.sequenceSteps.length === 0) return false;
    return step.sequenceSteps.every((child) => validateStep(child, depth + 1));
  }

  if (step.parallelSteps !== undefined) {
    if (!Array.isArray(step.parallelSteps) || step.parallelSteps.length === 0) return false;
    return step.parallelSteps.every((child) => validateStep(child, depth + 1));
  }

  if (isRecord(step.branchStep)) {
    if (typeof step.branchStep.predicateId !== 'string' || !step.branchStep.predicateId) {
      return false;
    }
    if (!validateStep(step.branchStep.whenTrue, depth + 1)) return false;
    return (
      step.branchStep.whenFalse === undefined || validateStep(step.branchStep.whenFalse, depth + 1)
    );
  }

  if (isRecord(step.fallbackStep)) {
    return (
      validateStep(step.fallbackStep.primary, depth + 1) &&
      validateStep(step.fallbackStep.fallback, depth + 1)
    );
  }

  return true;
}

function validateRetryPolicy(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  return (
    isPositiveInteger(raw.maxAttempts) &&
    isNonNegativeFiniteNumber(raw.backoffMs) &&
    (raw.multiplier === undefined || isNonNegativeFiniteNumber(raw.multiplier))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function isPositiveInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) > 0;
}

function isNonNegativeFiniteNumber(value: unknown): boolean {
  return Number.isFinite(value) && Number(value) >= 0;
}

/**
 * Convert validated JSON to a MacroDefinition.
 */
function toDefinition(json: MacroJsonSchema): MacroDefinition {
  return {
    id: json.id,
    displayName: json.displayName,
    description: json.description ?? '',
    tags: json.tags ?? [],
    timeoutMs: json.timeoutMs,
    steps: json.steps.map(toStepDefinition),
  };
}

function toStepDefinition(step: MacroJsonStep): MacroStepDefinition {
  return {
    id: step.id,
    toolName: step.toolName,
    input: step.input,
    inputFrom: step.inputFrom,
    timeoutMs: step.timeoutMs,
    retry: step.retry,
    optional: step.optional,
    sequenceSteps: step.sequenceSteps?.map(toStepDefinition),
    parallelSteps: step.parallelSteps?.map(toStepDefinition),
    maxConcurrency: step.maxConcurrency,
    failFast: step.failFast,
    branchStep: step.branchStep
      ? {
          predicateId: step.branchStep.predicateId,
          whenTrue: toStepDefinition(step.branchStep.whenTrue),
          whenFalse: step.branchStep.whenFalse
            ? toStepDefinition(step.branchStep.whenFalse)
            : undefined,
        }
      : undefined,
    fallbackStep: step.fallbackStep
      ? {
          primary: toStepDefinition(step.fallbackStep.primary),
          fallback: toStepDefinition(step.fallbackStep.fallback),
        }
      : undefined,
  };
}

export const MacroConfigLoader = {
  loadFromDirectory,
  validate,
} as const;
