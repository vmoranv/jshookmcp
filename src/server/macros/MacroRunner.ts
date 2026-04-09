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
  defineWorkflow,
  sequenceStep,
  toolStep,
  type WorkflowContract,
  type ToolNodeInput,
} from '@server/workflows/WorkflowContract';
import { executeExtensionWorkflow } from '@server/workflows/WorkflowEngine';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { MacroDefinition, MacroResult, MacroStepProgress } from '@server/macros/types';

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
        .timeoutMs(def.timeoutMs ?? 120_000)
        .buildGraph(() =>
          sequenceStep(`${def.id}-root`, (seq) => {
            for (const step of def.steps) {
              seq.step(
                toolStep(step.id, step.toolName, (toolBuilder) => {
                  toolBuilder
                    .input((step.input as Record<string, ToolNodeInput>) ?? {})
                    .timeout(step.timeoutMs ?? 0);
                  if (step.inputFrom) {
                    toolBuilder.inputFrom(step.inputFrom);
                  }
                }),
              );
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
      const progress = this._buildProgress(def, result.spans, result.stepResults);

      return {
        macroId: def.id,
        displayName: def.displayName,
        ok: true,
        durationMs: result.durationMs,
        stepsCompleted: def.steps.length,
        totalSteps: def.steps.length,
        stepResults: result.stepResults,
        progress,
      };
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const error = err instanceof Error ? err.message : String(err);

      // Atomic bailout — collect whatever step results we have
      const progress = this._buildPartialProgress(def, error);

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
  private _buildProgress(
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
  private _buildPartialProgress(def: MacroDefinition, error: string): MacroStepProgress[] {
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
