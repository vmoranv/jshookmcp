import { defineWorkflow, sequenceStep } from '@server/workflows/WorkflowContract';

const shiftRefactorDeobfuscationWorkflow = defineWorkflow(
  'workflow.deobfuscation.shift-refactor.v1',
  'Shift-Refactor Deobfuscation',
  (w) =>
    w
      .description(
        'Deobfuscate JavaScript using Shift AST: string decoding, control flow analysis, and pattern-based transformations.'
      )
      .tags(['deobfuscation', 'ast', 'shift-refactor'])
      .timeoutMs(30 * 60_000)
      .buildGraph((ctx) => {
        const inputCode = ctx.getConfig<string>('input.code', '');
        const patterns = ctx.getConfig<string[]>('patterns', ['stringDecoding', 'controlFlowSimplification']);

        return sequenceStep('shift-refactor-root', (s) =>
          s
            .tool('parse-shift-ast', 'deobfuscation.parse_ast', {
              input: { code: inputCode, parser: 'shift' },
            })
            .parallel('apply-patterns', (p) => {
              patterns.forEach((pattern) => {
                p.tool(`apply-${pattern}`, 'deobfuscation.apply_transform', {
                  input: {
                    transform: pattern,
                    ast: '${parse-shift-ast.ast}',
                  },
                });
              });
              return p;
            })
            .tool('generate-code', 'deobfuscation.generate_code', {
              input: {
                ast: '${apply-patterns.ast}',
                generator: 'shift',
              },
            })
        );
      })
      .onStart((ctx) => {
        ctx.emitMetric('workflow_runs_total', 1, 'counter', {
          workflowId: 'workflow.deobfuscation.shift-refactor.v1',
          stage: 'start',
        });
      })
      .onFinish((ctx, result) => {
        ctx.emitMetric('workflow_output_size', (result as string)?.length || 0, 'histogram', {
          workflowId: 'workflow.deobfuscation.shift-refactor.v1',
        });
      })
      .onError((ctx, error) => {
        ctx.emitMetric('workflow_errors_total', 1, 'counter', {
          workflowId: 'workflow.deobfuscation.shift-refactor.v1',
          error: error.name,
        });
      })
);

export default shiftRefactorDeobfuscationWorkflow;