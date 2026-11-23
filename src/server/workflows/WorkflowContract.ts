/**
 * Server-side re-export of the shared workflow contract.
 *
 * The single source of truth lives in `packages/extension-sdk/src/workflow.ts`
 * (the public SDK surface); this module re-exports the subset the runtime
 * consumes so existing `@server/workflows/WorkflowContract` imports keep
 * working. The `WorkflowSpanNames` constant stays here, beside its
 * server-internal producers/consumers (`MacroRunner`, `WorkflowEngine`,
 * `scripts/audit/event-contracts.mjs`).
 */
export {
  type BranchNode,
  type FallbackNode,
  type ParallelNode,
  type RetryPolicy,
  type SequenceNode,
  type ToolNode,
  type ToolNodeInput,
  type WorkflowContract,
  type WorkflowExecutionContext,
  type WorkflowNode,
  type WorkflowRouteMetadata,
  branchStep,
  defineWorkflow,
  fallbackStep,
  parallelStep,
  sequenceStep,
  toolStep,
} from '@extension-sdk/workflow';

/**
 * Span names emitted through `WorkflowExecutionContext.emitSpan`.
 *
 * Declared here, beside the `emitSpan` signature that produces them, because
 * these names have a CONSUMER outside this module: `MacroRunner.buildProgress`
 * derives per-step durations by matching `nodeStart`/`nodeFinish` together with
 * `attrs.nodeId`.
 *
 * Both sides used bare string literals, with no shared constant and no type
 * check, so renaming either one would have made the consumer's `spans.find(...)`
 * return `undefined` and silently blanked `durationMs` — with no test failing.
 * That is the same shape as the `adb:device_connected` regression: a producer and
 * a consumer that agree by coincidence instead of by construction. The only
 * difference was that it had not gone off yet.
 *
 * `scripts/audit/event-contracts.mjs` fails the build if a name declared here
 * loses its producer.
 */
export const WorkflowSpanNames = {
  nodeStart: 'workflow.node.start',
  nodeFinish: 'workflow.node.finish',
  nodeFallback: 'workflow.node.fallback',
  preflight: 'workflow.preflight',
  evidenceAutoExport: 'workflow.evidence.auto-export',
  macroStart: 'macro.start',
  macroError: 'macro.error',
} as const;
