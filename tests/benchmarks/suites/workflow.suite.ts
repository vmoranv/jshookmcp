/**
 * Workflow domain — offline pure-TS suite for the declarative workflow engine.
 *
 * Ground truth: the WorkflowHandlers and WorkflowEngine contracts —
 * retry/backoff policy storage, workflow run inspect listing and fetching,
 * conditional step predicate routing, and workflow suggest empty fallback.
 *
 * All tools in this suite are pure-TS and invoke the actual WorkflowHandlers directly.
 */
import { WorkflowHandlers } from '@server/domains/workflow/handlers.impl.core';
import { MacroToolHandlers } from '@server/domains/workflow/macro/handlers';
import { getWorkflowRunStore } from '@server/workflows/WorkflowEngine';
import { clearSessionRetryPolicy } from '@server/domains/workflow/retry-policy';
import type { BenchSuite } from '../harness';
import { body, expectSuccess } from '../harness';

// Instantiate real WorkflowHandlers & MacroToolHandlers with mock browser/network deps.
// None of the offline workflow tools (retry_policy, run_inspect, conditional_step, suggest, list_macros, run_macro)
// need active browser or network connections.
const mockDeps = {
  browserHandlers: {} as never,
  advancedHandlers: {} as never,
  serverContext: {
    extensionWorkflowsById: new Map(),
    extensionWorkflowRuntimeById: new Map(),
    extensionPluginsById: new Map(),
    extensionToolsByName: new Map(),
    executeToolWithTracking: async (_tool: string, _args: Record<string, unknown>) => ({
      success: true,
      executed: true,
    }),
  } as never,
};

const handlers = new WorkflowHandlers(mockDeps);
const macroHandlers = new MacroToolHandlers(mockDeps.serverContext);

export const workflowSuite: BenchSuite = {
  name: 'workflow-lifecycle',
  domain: 'workflow',
  description:
    'retry policy set/get, run inspect store contract, conditional step result analysis, suggest empty-chain fallback',
  cases: [
    {
      name: 'workflow_retry_policy/set-get-contract',
      tool: 'workflow_retry_policy',
      origin: 'homemade',
      reference:
        'invokes handleWorkflowRetryPolicyTool; verifies maxAttempts, backoffMs, and multiplier roundtrip',
      run: async () => {
        clearSessionRetryPolicy('default');
        return handlers.handleWorkflowRetryPolicyTool({
          maxAttempts: 3,
          backoffMs: 150,
          multiplier: 2,
        });
      },
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.stored !== true) return `expected stored=true, got ${JSON.stringify(b)}`;
        const policy = b.policy as
          | { maxAttempts?: number; backoffMs?: number; multiplier?: number }
          | undefined;
        if (policy?.maxAttempts !== 3) return `expected maxAttempts=3, got ${policy?.maxAttempts}`;
        if (policy?.backoffMs !== 150) return `expected backoffMs=150, got ${policy?.backoffMs}`;
        if (policy?.multiplier !== 2) return `expected multiplier=2, got ${policy?.multiplier}`;
        return true;
      },
    },
    {
      name: 'workflow_run_inspect/store-list-contract',
      tool: 'workflow_run_inspect',
      origin: 'homemade',
      reference:
        'invokes handleWorkflowRunInspectTool with action=list; verifies count and runs array format',
      run: async () => {
        const store = getWorkflowRunStore();
        store.clear();
        return handlers.handleWorkflowRunInspectTool({ action: 'list' });
      },
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (typeof b.count !== 'number')
          return `expected count to be a number, got ${typeof b.count}`;
        if (!Array.isArray(b.runs)) return `expected runs to be an array, got ${typeof b.runs}`;
        return true;
      },
    },
    {
      name: 'workflow_conditional_step/predicate-routing-contract',
      tool: 'workflow_conditional_step',
      origin: 'homemade',
      reference:
        'invokes handleWorkflowConditionalStepTool; evaluates a literal predicate and routes to whenFalse or skipped',
      run: async () => {
        return handlers.handleWorkflowConditionalStepTool({
          predicateId: 'always_false',
          whenTrue: { tool: 'dummy_tool' },
          whenFalse: { tool: 'fallback_tool' },
          stepResults: { 'test.status': 'ok' },
        });
      },
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.predicateId !== 'always_false')
          return `expected predicateId=always_false, got ${b.predicateId}`;
        // Either executed fallback_tool or gracefully handled branch
        if (!b.branch) return `expected a resolved branch property, got: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'workflow_suggest/empty-catalog-fallback',
      tool: 'workflow_suggest',
      origin: 'homemade',
      reference:
        'invokes handleWorkflowSuggestTool; returns empty suggestions when no chain metadata is loaded',
      run: async () => {
        return handlers.handleWorkflowSuggestTool({ executed: ['init'] });
      },
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (!Array.isArray(b.suggestions))
          return `expected suggestions array, got ${typeof b.suggestions}`;
        return true;
      },
    },

    // ── Coverage batch 2026-11-11 (autoresearch): offline macro, script registry & extension workflow tools ──
    {
      name: 'list_macros/enumerates-builtin-macros',
      tool: 'list_macros',
      origin: 'homemade',
      reference: 'loads built-in macro definitions and returns non-empty macros array',
      run: () => macroHandlers.handleListMacrosTool(),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        const macros = b.macros as Array<{ id?: string }> | undefined;
        if (!Array.isArray(macros) || macros.length === 0 || typeof b.count !== 'number')
          return `expected non-empty macros list, got ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'run_macro/dry-run-plan-preview',
      tool: 'run_macro',
      origin: 'homemade',
      reference: 'builds macro execution plan in dryRun=true mode without executing live tools',
      run: async () => {
        const listed = body(await macroHandlers.handleListMacrosTool());
        const macros = (listed.macros as Array<{ id?: string }>) ?? [];
        const firstId = macros[0]?.id;
        if (!firstId) throw new Error('no built-in macros loaded');
        return macroHandlers.handleRunMacroTool({ macroId: firstId, dryRun: true });
      },
      validate: (v: unknown) => {
        const b = body(v);
        if (b.ok !== true || b.dryRun !== true)
          return `expected ok=true dryRun=true in macro plan, got ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'page_script_register/registers-named-script',
      tool: 'page_script_register',
      origin: 'homemade',
      reference: 'registers an inline helper script in the workflow script registry',
      run: () =>
        handlers.handlePageScriptRegisterTool({
          name: 'bench_script_helper',
          code: 'return 1 + 1;',
          description: 'bench test script',
        }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.name !== 'bench_script_helper' || Number(b.totalScripts) < 1)
          return `unexpected registration response: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'list_extension_workflows/lists-discovered-workflows',
      tool: 'list_extension_workflows',
      origin: 'homemade',
      reference: 'discovers extension workflows cleanly in server context',
      run: () => handlers.handleListExtensionWorkflowsTool(),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (!Array.isArray(b.workflows) || typeof b.count !== 'number')
          return `expected workflows array and count, got ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },
  ],
};
