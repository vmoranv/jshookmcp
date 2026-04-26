/**
 * Evidence domain handlers — delegates to ReverseEvidenceGraph.
 */
import { asJsonResponse, asTextResponse } from '@server/domains/shared/response';
import { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';

export class EvidenceHandlers {
  constructor(private readonly graph: ReverseEvidenceGraph) {}

  private pickStringArg(args: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = args[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    return undefined;
  }

  private serializeNodes(nodes: ReturnType<ReverseEvidenceGraph['queryByUrl']>) {
    return nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      metadata: node.metadata,
    }));
  }

  handleQueryDispatch(args: Record<string, unknown>) {
    const by = args['by'] as string;
    switch (by) {
      case 'function':
        return this.handleQueryFunction({
          ...args,
          name: this.pickStringArg(args, ['name', 'value', 'query']),
        });
      case 'script':
        return this.handleQueryScript({
          ...args,
          scriptId: this.pickStringArg(args, ['scriptId', 'value', 'query']),
        });
      default:
        return this.handleQueryUrl({
          ...args,
          url: this.pickStringArg(args, ['url', 'value', 'query']),
        });
    }
  }
  handleExportDispatch(args: Record<string, unknown>) {
    const format = args['format'] as string;
    if (format === 'markdown') return this.handleExportMarkdown();
    return this.handleExportJson();
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
