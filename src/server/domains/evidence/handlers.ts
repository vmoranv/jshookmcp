/**
 * Evidence domain handlers — delegates to ReverseEvidenceGraph.
 */
import { asJsonResponse, asTextResponse } from '@server/domains/shared/response';
import { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';

export class EvidenceHandlers {
  constructor(private readonly graph: ReverseEvidenceGraph) {}

  private serializeNodes(nodes: ReturnType<ReverseEvidenceGraph['queryByUrl']>) {
    return nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      metadata: node.metadata,
    }));
  }

  handleQueryUrl(args: Record<string, unknown>) {
    const url = args.url as string;
    const nodes = this.graph.queryByUrl(url);
    return asJsonResponse({
      query: { type: 'url', value: url },
      resultCount: nodes.length,
      nodes: this.serializeNodes(nodes),
    });
  }

  handleQueryFunction(args: Record<string, unknown>) {
    const name = args.name as string;
    const nodes = this.graph.queryByFunction(name);
    return asJsonResponse({
      query: { type: 'function', value: name },
      resultCount: nodes.length,
      nodes: this.serializeNodes(nodes),
    });
  }

  handleQueryScript(args: Record<string, unknown>) {
    const scriptId = args.scriptId as string;
    const nodes = this.graph.queryByScriptId(scriptId);
    return asJsonResponse({
      query: { type: 'scriptId', value: scriptId },
      resultCount: nodes.length,
      nodes: this.serializeNodes(nodes),
    });
  }

  handleExportJson() {
    return asJsonResponse(this.graph.exportJson());
  }

  handleExportMarkdown() {
    return asTextResponse(this.graph.exportMarkdown());
  }

  handleChain(args: Record<string, unknown>) {
    const nodeId = args.nodeId as string;
    const direction = (args.direction as 'forward' | 'backward') ?? 'forward';
    const chain = this.graph.getEvidenceChain(nodeId, direction);
    return asJsonResponse({
      startNode: nodeId,
      direction,
      chainLength: chain.length,
      nodes: this.serializeNodes(chain),
    });
  }
}
