/**
 * Runtime type guards for extension module exports.
 */
import type { ExtensionBuilder } from '@server/plugins/PluginContract';
import type { WorkflowContract } from '@server/workflows/WorkflowContract';

export function isExtensionBuilder(value: unknown): value is ExtensionBuilder {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return !!(
    typeof candidate.id === 'string' &&
    typeof candidate.version === 'string' &&
    Array.isArray(candidate.tools) &&
    (candidate.workflows === undefined || Array.isArray(candidate.workflows))
  );
}

export function isWorkflowContract(value: unknown): value is WorkflowContract {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return !!(
    candidate.kind === 'workflow-contract' &&
    candidate.version === 1 &&
    typeof candidate.id === 'string' &&
    typeof candidate.displayName === 'string' &&
    typeof candidate.build === 'function'
  );
}
