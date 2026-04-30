import type { ToolResponse } from '@server/types';
import type { BranchNode } from '@server/workflows/WorkflowContract';
import type { InternalExecutionContext } from '@server/workflows/WorkflowEngine.types';
import { collectSuccessStats, parseToolPayload } from '@server/workflows/WorkflowDataBus';

function getWorkflowVariable(stepResults: Map<string, unknown>, keyPath: string): unknown {
  if (stepResults.has(keyPath)) {
    return stepResults.get(keyPath);
  }

  const [stepId, ...fieldSegments] = keyPath.split('.');
  if (!stepId || !stepResults.has(stepId)) {
    return undefined;
  }

  let current: unknown = stepResults.get(stepId);
  if (current && typeof current === 'object') {
    const payload = parseToolPayload(current as ToolResponse);
    if (payload) {
      current = payload;
    }
  }

  for (const segment of fieldSegments) {
    if (current && typeof current === 'object') {
      const arrayMatch = segment.match(/^(\d+)$/);
      if (arrayMatch && Array.isArray(current)) {
        current = current[Number(arrayMatch[1])];
        continue;
      }

      current = (current as Record<string, unknown>)[segment];
      continue;
    }

    return undefined;
  }

  return current;
}

function deepEquals(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (typeof left !== typeof right) {
    return false;
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    if (Array.isArray(left) !== Array.isArray(right)) {
      return false;
    }

    if (Array.isArray(left)) {
      const leftArray = left as unknown[];
      const rightArray = right as unknown[];
      return (
        leftArray.length === rightArray.length &&
        leftArray.every((value, index) => deepEquals(value, rightArray[index]))
      );
    }

    const leftKeys = Object.keys(left as object);
    const rightKeys = Object.keys(right as object);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every((key) =>
      deepEquals((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
    );
  }

  return false;
}

export async function evaluatePredicate(
  node: BranchNode,
  ctx: InternalExecutionContext,
): Promise<boolean> {
  if (node.predicateFn) {
    return await node.predicateFn(ctx);
  }

  if (node.predicateId === 'always_true') return true;
  if (node.predicateId === 'always_false') return false;
  if (node.predicateId === 'any_step_failed') {
    return [...ctx.stepResults.values()].some((value) => collectSuccessStats(value).failure > 0);
  }

  const successRateMatch = node.predicateId.match(/success_rate_gte_(\d+)/i);
  if (successRateMatch?.[1]) {
    const threshold = Number(successRateMatch[1]);
    const aggregate = [...ctx.stepResults.values()].reduce<{ success: number; failure: number }>(
      (acc, value) => {
        const next = collectSuccessStats(value);
        acc.success += next.success;
        acc.failure += next.failure;
        return acc;
      },
      { success: 0, failure: 0 },
    );
    const total = aggregate.success + aggregate.failure;
    return total > 0 && aggregate.success / total >= threshold / 100;
  }

  const equalsMatch = node.predicateId.match(/^variable_equals_(.+?)_(.+)$/);
  if (equalsMatch?.[1] && equalsMatch[2]) {
    return deepEquals(getWorkflowVariable(ctx.stepResults, equalsMatch[1]), equalsMatch[2]);
  }

  const containsMatch = node.predicateId.match(/^variable_contains_(.+?)_(.+)$/);
  if (containsMatch?.[1] && containsMatch[2]) {
    const value = getWorkflowVariable(ctx.stepResults, containsMatch[1]);
    if (typeof value !== 'string' && !Array.isArray(value)) {
      return false;
    }
    return String(value).includes(containsMatch[2]);
  }

  const matchesMatch = node.predicateId.match(/^variable_matches_(.+?)_(.+)$/);
  if (matchesMatch?.[1] && matchesMatch[2]) {
    const value = getWorkflowVariable(ctx.stepResults, matchesMatch[1]);
    if (typeof value !== 'string') {
      return false;
    }

    try {
      return new RegExp(matchesMatch[2]).test(value);
    } catch {
      return false;
    }
  }

  throw new Error(`Unknown workflow predicateId "${node.predicateId}"`);
}
