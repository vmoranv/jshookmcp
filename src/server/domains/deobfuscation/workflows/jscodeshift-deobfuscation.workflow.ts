import { defineWorkflow, sequenceStep } from '@server/workflows/WorkflowContract';

const jscodeshiftDeobfuscationWorkflow = defineWorkflow(
  'workflow.deobfuscation.jscodeshift.v1',
  'AST-Based Deobfuscation (jscodeshift + recast)',
  (w) =>
    w
      .description(
        'Deobfuscate JavaScript using AST transformations: control flow normalization, dead code elimination, and constant propagation.'
      )
      .tags(['deobfuscation', 'ast', 'jscodeshift', 'recast'])
      .timeoutMs(30 * 60_000)
      .buildGraph((ctx) => {
        const inputCode = ctx.getConfig<string>('input.code', '');
        const transformRules = ctx.getConfig<string[]>('transformRules', [
          'controlFlowNormalization',
          'deadCodeElimination',
          'constantPropagation',
        ]);

        return sequenceStep('jscodeshift-root', (s) =>
          s
            .tool('parse-ast', 'deobfuscation.parse_ast', {
              input: { code: inputCode, parser: 'recast' },
            })
            .parallel('transformations', (p) => {
              transformRules.forEach((rule) => {
                p.tool(`apply-${rule}`, 'deobfuscation.apply_transform', {
                  input: {
                    transform: rule,
                    ast: '${parse-ast.ast}',
                  },
                });
              });
              return p;
            })
            .tool('generate-code', 'deobfuscation.generate_code', {
              input: {
                ast: '${transformations.ast}',
                generator: 'escodegen',
              },
            })
        );
      })
      .onStart((ctx) => {
        ctx.emitMetric('workflow_runs_total', 1, 'counter', {
          workflowId: 'workflow.deobfuscation.jscodeshift.v1',
          stage: 'start',
        });
      })
      .onFinish((ctx, result) => {
        ctx.emitMetric('workflow_output_size', (result as string)?.length || 0, 'histogram', {
          workflowId: 'workflow.deobfuscation.jscodeshift.v1',
        });
      })
      .onError((ctx, error) => {
        ctx.emitMetric('workflow_errors_total', 1, 'counter', {
          workflowId: 'workflow.deobfuscation.jscodeshift.v1',
          error: error.name,
        });
      })
);

export default jscodeshiftDeobfuscationWorkflow;