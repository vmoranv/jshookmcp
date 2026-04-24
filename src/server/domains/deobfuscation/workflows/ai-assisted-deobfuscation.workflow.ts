import { defineWorkflow, sequenceStep } from '@server/workflows/WorkflowContract';

const aiAssistedDeobfuscationWorkflow = defineWorkflow(
  'workflow.deobfuscation.ai-assisted.v1',
  'AI-Assisted Deobfuscation',
  (w) =>
    w
      .description(
        'Use AI to detect obfuscation patterns, explain code, and suggest deobfuscation strategies.'
      )
      .tags(['deobfuscation', 'ai', 'huggingface', 'openai'])
      .timeoutMs(20 * 60_000)
      .buildGraph((ctx) => {
        const inputCode = ctx.getConfig<string>('input.code', '');
        const useOpenAI = ctx.getConfig<boolean>('ai.useOpenAI', true);

        return sequenceStep('ai-assisted-root', (s) =>
          s
            .tool('detect-patterns', 'deobfuscation.detect_obfuscation_patterns', {
              input: { code: inputCode },
              retry: { maxAttempts: 3, backoffMs: 1000 },
            })
            .branch('ai-explanation-branch', 'use_openai_for_explanation', (b) =>
              b
                .predicateFn(() => useOpenAI)
                .whenTrue(
                  sequenceStep('explain-with-openai', (seq) =>
                    seq.tool('explain-with-openai', 'deobfuscation.explain_code_openai', {
                      input: {
                        code: inputCode,
                        patterns: '${detect-patterns.patterns}',
                      },
                    })
                  )
                )
                .whenFalse(
                  sequenceStep('explain-with-huggingface', (seq) =>
                    seq.tool('explain-with-huggingface', 'deobfuscation.explain_code_huggingface', {
                      input: {
                        code: inputCode,
                        patterns: '${detect-patterns.patterns}',
                      },
                    })
                  )
                )
            )
            .tool('suggest-transformations', 'deobfuscation.suggest_transformations', {
              input: {
                patterns: '${detect-patterns.patterns}',
                explanation: '${ai-explanation-branch.explanation}',
              },
              retry: { maxAttempts: 2, backoffMs: 1000 },
            })
            .tool('humanize-code', 'deobfuscation.humanizeCode', {
              input: {
                code: inputCode,
                models: ['openai', 'huggingface'],
                aggressiveness: 7,
              },
            })
        );
      })
      .onStart((ctx) => {
        ctx.emitMetric('workflow_runs_total', 1, 'counter', {
          workflowId: 'workflow.deobfuscation.ai-assisted.v1',
          stage: 'start',
        });
      })
      .onError((ctx, error) => {
        ctx.emitMetric('workflow_errors_total', 1, 'counter', {
          workflowId: 'workflow.deobfuscation.ai-assisted.v1',
          error: error.name,
        });
      })
);

export default aiAssistedDeobfuscationWorkflow;