import type { MCPServerContext } from '@server/MCPServer.context';
import type { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';
import { getEffectivePrerequisites } from '@server/ToolRouter.policy';
import type { getRoutingState } from '@server/ToolRouter.probe';
import type { ToolNode, WorkflowNode } from '@server/workflows/WorkflowContract';
import type { PreflightWarning } from '@server/workflows/WorkflowEngine.types';

function collectToolNodes(node: WorkflowNode): ToolNode[] {
  switch (node.kind) {
    case 'tool':
      return [node];
    case 'sequence':
    case 'parallel':
      return node.steps.flatMap((step) => collectToolNodes(step));
    case 'branch':
      return [
        ...collectToolNodes(node.whenTrue),
        ...(node.whenFalse ? collectToolNodes(node.whenFalse) : []),
      ];
    case 'fallback':
      return [...collectToolNodes(node.primary), ...collectToolNodes(node.fallback)];
    default:
      return [];
  }
}

export function getEvidenceState(ctx: MCPServerContext): {
  hasGraph: boolean;
  nodeCount: number;
  edgeCount: number;
} {
  try {
    const evidenceGraph = ctx.getDomainInstance<ReverseEvidenceGraph>('evidenceGraph');
    return evidenceGraph
      ? { hasGraph: true, nodeCount: evidenceGraph.nodeCount, edgeCount: evidenceGraph.edgeCount }
      : { hasGraph: false, nodeCount: 0, edgeCount: 0 };
  } catch {
    return { hasGraph: false, nodeCount: 0, edgeCount: 0 };
  }
}

export function collectUnsatisfiedPrerequisites(
  graph: WorkflowNode,
  routingState: Awaited<ReturnType<typeof getRoutingState>>,
): PreflightWarning[] {
  const prerequisites = getEffectivePrerequisites();
  const warnings: PreflightWarning[] = [];

  for (const toolNode of collectToolNodes(graph)) {
    const toolPrerequisites = prerequisites[toolNode.toolName] ?? [];
    for (const prerequisite of toolPrerequisites) {
      if (prerequisite.check(routingState)) {
        continue;
      }

      warnings.push({
        nodeId: toolNode.id,
        toolName: toolNode.toolName,
        condition: prerequisite.condition,
        fix: prerequisite.fix,
      });
    }
  }

  return warnings;
}
