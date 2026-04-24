import { defineWorkflow, sequenceStep } from '@server/workflows/WorkflowContract';

const javascriptObfuscatorProWorkflow = defineWorkflow(
  'workflow.deobfuscation.javascript-obfuscator-pro.v1',
  'JavaScript Obfuscator Pro VM Deobfuscation',
  (w) =>
    w
      .description('Deobfuscate VM/bytecode using JavaScript Obfuscator Pro API.')
      .tags(['deobfuscation', 'vm', 'bytecode', 'javascript-obfuscator'])
      .timeoutMs(60 * 60_000)
      .buildGraph((ctx) => {
        const inputCode = ctx.getConfig<string>('input.code', '');
        const vmAnalysis = ctx.getConfig<boolean>('vm.analysis', true);

        return sequenceStep('obfuscator-pro-root', (s) =>
          s
            .tool('analyze-vm', 'deobfuscation.analyze_vm_bytecode', {
              input: { code: inputCode },
            })
            .branch('vm-analysis-branch', 'vm_analysis_required', (b) =>
              b
                .predicateFn(() => vmAnalysis)
                .whenTrue(
                  sequenceStep('vm-analysis', (seq) =>
                    seq
                      .tool('emulate-vm', 'deobfuscation.emulate_vm', {
                        input: { bytecode: '${analyze-vm.bytecode}' },
                      })
                      .tool('reconstruct-control-flow', 'deobfuscation.reconstruct_control_flow', {
                        input: { vmState: '${emulate-vm.state}' },
                      })
                  )
                )
                .whenFalse(
                  sequenceStep('skip-analysis', (seq) =>
                    seq.tool('skip-analysis', 'console_execute', {
                      input: { expression: '({ status: "skipped_vm_analysis" })' },
                    })
                  )
                )
            )
            .tool('generate-deobfuscated-code', 'deobfuscation.generate_code', {
              input: {
                ast: '${vm-analysis-branch.ast}',
                generator: 'escodegen',
              },
            })
        );
      })
      .onStart((ctx) => {
        ctx.emitMetric('workflow_runs_total', 1, 'counter', {
          workflowId: 'workflow.deobfuscation.javascript-obfuscator-pro.v1',
          stage: 'start',
        });
      })
      .onError((ctx, error) => {
        ctx.emitMetric('workflow_errors_total', 1, 'counter', {
          workflowId: 'workflow.deobfuscation.javascript-obfuscator-pro.v1',
          error: error.name,
        });
      })
);

export default javascriptObfuscatorProWorkflow;