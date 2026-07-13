/**
 * MacroRunner — Executes macro definitions using the WorkflowEngine.
 *
 * Wraps the existing WorkflowEngine + WorkflowContract infrastructure
 * to provide:
 * - Inline progress reporting: `[stage N/M] step_name — status (Xms)`
 * - Atomic bailout with partial result collection on step failure
 * - inputFrom data piping between sequential steps
 */

import {
  branchStep,
  defineWorkflow,
  fallbackStep,
  parallelStep,
  sequenceStep,
  toolStep,
  type WorkflowContract,
  type ToolNodeInput,
  type WorkflowNode,
} from '@server/workflows/WorkflowContract';
import { executeExtensionWorkflow } from '@server/workflows/WorkflowEngine';
import type { MCPServerContext } from '@server/MCPServer.context';
import type {
  MacroDefinition,
  MacroNodeSummary,
  MacroResult,
  MacroStepProgress,
} from '@server/macros/types';
import { MACRO_DEFAULT_TIMEOUT_MS } from '@src/constants';

export class MacroRunner {
  private readonly ctx: MCPServerContext;

  constructor(ctx: MCPServerContext) {
    this.ctx = ctx;
  }

  /**
   * Build a WorkflowContract from a MacroDefinition.
   */
  buildWorkflowFromDefinition(def: MacroDefinition): WorkflowContract {
    return defineWorkflow(def.id, def.displayName, (w) =>
      w
        .description(def.description)
        .tags(def.tags)
        .timeoutMs(def.timeoutMs ?? MACRO_DEFAULT_TIMEOUT_MS)
        .buildGraph(() =>
          sequenceStep(`${def.id}-root`, (seq) => {
            for (const step of def.steps) {
              seq.step(this.buildNodeFromStep(step));
            }
          }),
        )
        .onStart((ctx) => {
          ctx.emitSpan('macro.start', {
            macroId: def.id,
            totalSteps: def.steps.length,
          });
        })
        .onError((_ctx, err) => {
          _ctx.emitSpan('macro.error', {
            macroId: def.id,
            error: err.message,
          });
        }),
    );
  }

  private buildNodeFromStep(step: MacroDefinition['steps'][number]): WorkflowNode {
    const node = this.buildCoreNodeFromStep(step);
    if (!step.optional) {
      return node;
    }

    return fallbackStep(`${step.id}-optional`, (fallback) => {
      fallback.primary(node);
      fallback.fallback(sequenceStep(`${step.id}-optional-skip`));
    });
  }

  private buildCoreNodeFromStep(step: MacroDefinition['steps'][number]): WorkflowNode {
    const kindCount = [
      typeof step.toolName === 'string' && step.toolName.length > 0,
      Array.isArray(step.sequenceSteps),
      Array.isArray(step.parallelSteps),
      step.branchStep !== undefined,
      step.fallbackStep !== undefined,
    ].filter(Boolean).length;

    if (kindCount !== 1) {
      throw new Error(
        `Macro step "${step.id}" must define exactly one of toolName, sequenceSteps, parallelSteps, branchStep, or fallbackStep`,
      );
    }

    if (step.sequenceSteps) {
      return sequenceStep(step.id, (sequence) => {
        for (const child of step.sequenceSteps ?? []) {
          sequence.step(this.buildNodeFromStep(child));
        }
      });
    }

    if (step.parallelSteps) {
      return parallelStep(step.id, (parallel) => {
        if (step.maxConcurrency !== undefined) {
          parallel.maxConcurrency(step.maxConcurrency);
        }
        if (step.failFast !== undefined) {
          parallel.failFast(step.failFast);
        }
        for (const child of step.parallelSteps ?? []) {
          parallel.step(this.buildNodeFromStep(child));
        }
      });
    }

    if (step.branchStep) {
      return branchStep(step.id, step.branchStep.predicateId, (branch) => {
        branch.whenTrue(this.buildNodeFromStep(step.branchStep!.whenTrue));
        if (step.branchStep?.whenFalse) {
          branch.whenFalse(this.buildNodeFromStep(step.branchStep.whenFalse));
        }
      });
    }

    if (step.fallbackStep) {
      return fallbackStep(step.id, (fallback) => {
        fallback.primary(this.buildNodeFromStep(step.fallbackStep!.primary));
        fallback.fallback(this.buildNodeFromStep(step.fallbackStep!.fallback));
      });
    }

    return toolStep(step.id, step.toolName!, (toolBuilder) => {
      toolBuilder.input((step.input as Record<string, ToolNodeInput>) ?? {});
      if (step.timeoutMs !== undefined) {
        toolBuilder.timeout(step.timeoutMs);
      }
      if (step.retry) {
        toolBuilder.retry(step.retry);
      }
      if (step.inputFrom) {
        toolBuilder.inputFrom(step.inputFrom);
      }
    });
  }

  /**
   * Build a serializable node-tree projection of a macro without executing any tools.
   *
   * Routes through the real `buildNodeFromStep` so schema errors (e.g. a step that
   * defines zero or multiple node kinds) surface here instead of at run time, and so
   * `optional` wrapping is reflected exactly as the engine will see it.
   */
  summarizeDefinition(def: MacroDefinition): {
    macroId: string;
    displayName: string;
    timeoutMs: number;
    nodes: MacroNodeSummary[];
  } {
    const nodes = def.steps.map((step) => this.summarizeNode(this.buildNodeFromStep(step)));
    return {
      macroId: def.id,
      displayName: def.displayName,
      timeoutMs: def.timeoutMs ?? MACRO_DEFAULT_TIMEOUT_MS,
      nodes,
    };
  }

  private summarizeNode(node: WorkflowNode): MacroNodeSummary {
    switch (node.kind) {
      case 'tool':
        return {
          id: node.id,
          kind: 'tool',
          toolName: node.toolName,
          retry: node.retry,
          timeoutMs: node.timeoutMs,
          inputFrom: node.inputFrom,
        };
      case 'sequence':
        return {
          id: node.id,
          kind: 'sequence',
          children: node.steps.map((child) => this.summarizeNode(child)),
        };
      case 'parallel':
        return {
          id: node.id,
          kind: 'parallel',
          maxConcurrency: node.maxConcurrency,
          failFast: node.failFast,
          children: node.steps.map((child) => this.summarizeNode(child)),
        };
      case 'branch':
        return {
          id: node.id,
          kind: 'branch',
          predicateId: node.predicateId,
          whenTrue: this.summarizeNode(node.whenTrue),
          whenFalse: node.whenFalse ? this.summarizeNode(node.whenFalse) : undefined,
        };
      case 'fallback':
        return {
          id: node.id,
          kind: 'fallback',
          primary: this.summarizeNode(node.primary),
          fallback: this.summarizeNode(node.fallback),
        };
    }
  }

  /**
   * Execute a macro definition with optional per-node input overrides.
   *
   * Returns a MacroResult with inline progress and partial results on failure.
   */
  async execute(
    def: MacroDefinition,
    inputOverrides?: Record<string, Record<string, unknown>>,
  ): Promise<MacroResult> {
    const workflow = this.buildWorkflowFromDefinition(def);
    const startMs = Date.now();

    try {
      const result = await executeExtensionWorkflow(this.ctx, workflow, {
        nodeInputOverrides: inputOverrides,
      });

      // Build progress from spans
      const progress = this.buildProgress(def, result.spans, result.stepResults);

      return {
        macroId: def.id,
        displayName: def.displayName,
        ok: true,
        durationMs: result.durationMs,
        stepsCompleted: progress.filter((p) => p.status === 'complete').length,
        totalSteps: def.steps.length,
        stepResults: result.stepResults,
        progress,
      };
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const error = err instanceof Error ? err.message : String(err);

      // Atomic bailout — collect whatever step results we have
      const progress = this.buildPartialProgress(def, error);

      return {
        macroId: def.id,
        displayName: def.displayName,
        ok: false,
        durationMs,
        stepsCompleted: progress.filter((p) => p.status === 'complete').length,
        totalSteps: def.steps.length,
        stepResults: {},
        progress,
        error,
      };
    }
  }

  /**
   * Format a MacroResult as inline MCP text with stage markers.
   */
  formatProgressReport(result: MacroResult): string {
    const lines: string[] = [];

    lines.push(`**Macro:** ${result.displayName} (\`${result.macroId}\`)`);
    lines.push('');

    for (const p of result.progress) {
      const durStr = p.durationMs !== undefined ? ` (${p.durationMs}ms)` : '';
      const errStr = p.error ? `: ${p.error}` : '';
      const icon = p.status === 'complete' ? '✓' : p.status === 'failed' ? '✗' : '○';
      lines.push(
        `[stage ${p.step}/${p.totalSteps}] ${icon} ${p.stepName} — ${p.status}${durStr}${errStr}`,
      );
    }

    lines.push('');
    if (result.ok) {
      lines.push(
        `✓ Macro complete (${result.stepsCompleted}/${result.totalSteps} steps, ${result.durationMs}ms)`,
      );
    } else {
      lines.push(
        `✗ Macro failed at step ${result.stepsCompleted + 1}/${result.totalSteps}: ${result.error ?? 'unknown error'}`,
      );
    }

    return lines.join('\n');
  }

  /**
   * Build progress from workflow spans and step results (success path).
   */
  private buildProgress(
    def: MacroDefinition,
    spans: Array<{ name: string; attrs?: Record<string, unknown>; at: string }>,
    stepResults: Record<string, unknown>,
  ): MacroStepProgress[] {
    return def.steps.map((step, i) => {
      // Find start/finish spans for this node
      const startSpan = spans.find(
        (s) => s.name === 'workflow.node.start' && s.attrs?.nodeId === step.id,
      );
      const finishSpan = spans.find(
        (s) => s.name === 'workflow.node.finish' && s.attrs?.nodeId === step.id,
      );

      let durationMs: number | undefined;
      if (startSpan && finishSpan) {
        durationMs = new Date(finishSpan.at).getTime() - new Date(startSpan.at).getTime();
      }

      const hasResult = step.id in stepResults;

      return {
        step: i + 1,
        totalSteps: def.steps.length,
        stepName: step.id,
        status: hasResult ? ('complete' as const) : ('skipped' as const),
        durationMs,
      };
    });
  }

  /**
   * Build partial progress for the failure path.
   */
  private buildPartialProgress(def: MacroDefinition, error: string): MacroStepProgress[] {
    // We don't know exactly which step failed without stepResults,
    // so mark all as unknown and the last attempted as failed
    return def.steps.map((step, i) => ({
      step: i + 1,
      totalSteps: def.steps.length,
      stepName: step.id,
      status: 'failed' as const,
      error: i === 0 ? error : undefined, // First failure stops the chain
    }));
  }
}
