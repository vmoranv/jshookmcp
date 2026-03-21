/**
 * Types for the macro orchestration system.
 *
 * Macros are composite tools that chain multiple primitive MCP tool
 * calls using the existing WorkflowEngine infrastructure.
 */

/** Progress report for a single macro step. */
export interface MacroStepProgress {
  step: number;
  totalSteps: number;
  stepName: string;
  status: 'running' | 'complete' | 'failed' | 'skipped';
  durationMs?: number;
  error?: string;
}

/** Result of a macro execution. */
export interface MacroResult {
  macroId: string;
  displayName: string;
  ok: boolean;
  durationMs: number;
  stepsCompleted: number;
  totalSteps: number;
  stepResults: Record<string, unknown>;
  progress: MacroStepProgress[];
  error?: string;
  partialOutput?: unknown;
}

/** Definition of a macro — used by both built-in and JSON-configured macros. */
export interface MacroDefinition {
  id: string;
  displayName: string;
  description: string;
  tags: string[];
  timeoutMs?: number;
  steps: MacroStepDefinition[];
}

/** A single step within a macro definition. */
export interface MacroStepDefinition {
  id: string;
  toolName: string;
  input?: Record<string, unknown>;
  /** Reference a previous step's output field as input (e.g., { code: 'step_1.code' }). */
  inputFrom?: Record<string, string>;
  timeoutMs?: number;
  /** If true, failure of this step doesn't stop the macro. */
  optional?: boolean;
}
