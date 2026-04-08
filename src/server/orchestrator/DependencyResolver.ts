interface ToolDependency {
  from: string;
  to: string;
  relation: string;
}

interface ManifestLike {
  toolDependencies?: ToolDependency[];
}

interface DependencyEdge {
  from: string;
  to: string;
  relation: string;
  weight: number;
}

export class DependencyResolver {
  private edges: DependencyEdge[] = [];

  buildFromManifests(manifests: ManifestLike[]): void {
    this.edges = manifests.flatMap((manifest) =>
      (manifest.toolDependencies ?? []).map((dependency) => ({
        ...dependency,
        weight: 1.0,
      })),
    );
  }

  getEdges(): DependencyEdge[] {
    return [...this.edges];
  }

  topologicalSort(): string[] | null {
    const nodes = new Set<string>();
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const edge of this.edges) {
      nodes.add(edge.from);
      nodes.add(edge.to);
      adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
      inDegree.set(edge.from, inDegree.get(edge.from) ?? 0);
    }

    const queue = [...nodes].filter((node) => (inDegree.get(node) ?? 0) === 0);
    const order: string[] = [];

    while (queue.length > 0) {
      const node = queue.shift();
      if (!node) {
        continue;
      }

      order.push(node);
      for (const successor of adjacency.get(node) ?? []) {
        const nextDegree = (inDegree.get(successor) ?? 0) - 1;
        inDegree.set(successor, nextDegree);
        if (nextDegree === 0) {
          queue.push(successor);
        }
      }
    }

    return order.length === nodes.size ? order : null;
  }

  detectCycles(): string[][] {
    const order = this.topologicalSort();
    if (order !== null) {
      return [];
    }

    return this.edges.length > 0 ? [this.edges.map((edge) => edge.from)] : [];
  }

  getPredecessors(tool: string): string[] {
    return this.edges.filter((edge) => edge.to === tool).map((edge) => edge.from);
  }

  getSuccessors(tool: string): string[] {
    return this.edges.filter((edge) => edge.from === tool).map((edge) => edge.to);
  }
}
