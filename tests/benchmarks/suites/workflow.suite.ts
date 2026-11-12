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

    // ── Contract batch 2026-11-12 (autoresearch) ────────────────────────────
    // The five workflow tools either need a live page or a concrete input.
    // Portable contract: the missing input is named before any page access, an
    // unknown script is reported as not-found, and an unavailable extension
    // runtime says so instead of pretending the workflow ran.
    {
      name: 'api_probe_batch/requires-baseUrl',
      tool: 'api_probe_batch',
      origin: 'homemade',
      reference: 'argument contract: batch probing needs the base URL to probe against',
      run: () =>
        new WorkflowHandlers({ getActivePage: async () => null } as never).handleApiProbeBatch({}),
      validate: (v) => {
        const text = JSON.stringify(body(v));
        return /baseUrl/i.test(text) ? true : `expected a baseUrl error: ${text.slice(0, 200)}`;
      },
    },
    {
      name: 'js_bundle_search/requires-url-and-patterns',
      tool: 'js_bundle_search',
      origin: 'homemade',
      reference:
        'argument contract: bundle search needs both the bundle url and the patterns to look for',
      run: () =>
        new WorkflowHandlers({ getActivePage: async () => null } as never).handleJsBundleSearch({}),
      validate: (v) => {
        const text = JSON.stringify(body(v));
        if (!/url/i.test(text)) return `expected a url error: ${text.slice(0, 200)}`;
        return /patterns/i.test(text)
          ? true
          : `refusal should name patterns: ${text.slice(0, 200)}`;
      },
    },
    {
      name: 'page_script_run/unknown-script-not-found',
      tool: 'page_script_run',
      origin: 'homemade',
      reference:
        'lookup contract: an unnamed script resolves to nothing and the response says "not found" instead of running an arbitrary script',
      run: () =>
        new WorkflowHandlers({ getActivePage: async () => null } as never).handlePageScriptRun({}),
      validate: (v) => {
        const text = JSON.stringify(body(v));
        return /not found/i.test(text)
          ? true
          : `expected a not-found answer: ${text.slice(0, 200)}`;
      },
    },
    {
      name: 'reverse_session/create-returns-session-id',
      tool: 'reverse_session',
      origin: 'homemade',
      reference:
        'session contract: the default create action issues a session with an id and timestamp (pure in-memory, no browser needed)',
      run: () =>
        new WorkflowHandlers({ getActivePage: async () => null } as never).handleReverseSession({}),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== true)
          return `create should succeed offline: ${JSON.stringify(b).slice(0, 200)}`;
        const session = b['session'] as Record<string, unknown> | undefined;
        if (!session) return 'session object missing';
        if (typeof session['sessionId'] !== 'string' || !session['sessionId'].length)
          return 'sessionId missing';
        return typeof session['createdAt'] === 'string' ? true : 'createdAt missing';
      },
    },
    {
      name: 'run_extension_workflow/unavailable-runtime-is-named',
      tool: 'run_extension_workflow',
      origin: 'homemade',
      reference:
        'capability contract: without the extension workflow runtime the tool says so explicitly instead of reporting a completed run',
      run: () =>
        new WorkflowHandlers({
          getActivePage: async () => null,
        } as never).handleRunExtensionWorkflow({ name: 'bench-workflow' }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] === true)
          return `must not claim a run without the runtime: ${JSON.stringify(b).slice(0, 200)}`;
        return /runtime is unavailable|not available/i.test(JSON.stringify(b))
          ? true
          : `failure should name the missing runtime: ${JSON.stringify(b).slice(0, 200)}`;
      },
    },
  ],
};
