import { DAGNodeInfo, DAGSnapshot } from '../parser/types';

export interface DAGNodeInput {
  id: string;
  kind: DAGNodeInfo['kind'];
  rawDependencies: string[];
  blockId: string;
  line: number;
}

export class ReactiveDAG {
  readonly nodes: Map<string, DAGNodeInfo>;
  readonly evaluationOrder: string[];
  readonly cycles: string[][];

  private constructor(
    nodes: Map<string, DAGNodeInfo>,
    evaluationOrder: string[],
    cycles: string[][]
  ) {
    this.nodes = nodes;
    this.evaluationOrder = evaluationOrder;
    this.cycles = cycles;
  }

  static build(inputs: DAGNodeInput[]): ReactiveDAG {
    const nodes = new Map<string, DAGNodeInfo>();

    for (const input of inputs) {
      nodes.set(input.id, {
        id: input.id,
        kind: input.kind,
        dependencies: [],
        dependents: [],
        blockId: input.blockId,
        line: input.line,
      });
    }

    // Wire edges only between known nodes in the graph
    for (const input of inputs) {
      const node = nodes.get(input.id)!;
      const uniqueDeps = new Set<string>();

      for (const rawDep of input.rawDependencies) {
        // Resolve `table.Col` to `table` if `table.Col` isn't a standalone node
        let resolvedDep = rawDep;
        if (!nodes.has(resolvedDep) && resolvedDep.includes('.')) {
          const rootName = resolvedDep.split('.')[0];
          if (rootName && nodes.has(rootName)) {
            resolvedDep = rootName;
          }
        }
        if (nodes.has(resolvedDep)) {
          uniqueDeps.add(resolvedDep);
        }
      }

      node.dependencies = Array.from(uniqueDeps);
      for (const depId of node.dependencies) {
        nodes.get(depId)!.dependents.push(node.id);
      }
    }

    // Kahn's algorithm for topological sort
    const inDegree = new Map<string, number>();
    for (const [id, node] of nodes) {
      inDegree.set(id, node.dependencies.length);
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const evaluationOrder: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      evaluationOrder.push(current);

      const currentNode = nodes.get(current)!;
      for (const dependentId of currentNode.dependents) {
        const nextDeg = (inDegree.get(dependentId) ?? 0) - 1;
        inDegree.set(dependentId, nextDeg);
        if (nextDeg === 0) {
          queue.push(dependentId);
        }
      }
    }

    // Detect exact cycles among remaining unvisited nodes
    const cycles: string[][] = [];
    if (evaluationOrder.length < nodes.size) {
      const remaining = new Set<string>();
      for (const id of nodes.keys()) {
        if (!evaluationOrder.includes(id)) {
          remaining.add(id);
        }
      }

      const visited = new Set<string>();
      const onStack = new Set<string>();
      const stack: string[] = [];

      const dfs = (id: string): void => {
        visited.add(id);
        onStack.add(id);
        stack.push(id);

        const node = nodes.get(id)!;
        for (const depId of node.dependencies) {
          if (!remaining.has(depId)) continue;
          if (!visited.has(depId)) {
            dfs(depId);
          } else if (onStack.has(depId)) {
            const cycleStart = stack.indexOf(depId);
            if (cycleStart >= 0) {
              const cyclePath = [...stack.slice(cycleStart), depId];
              cycles.push(cyclePath);
            }
          }
        }

        stack.pop();
        onStack.delete(id);
      };

      for (const id of remaining) {
        if (!visited.has(id)) {
          dfs(id);
        }
      }
    }

    return new ReactiveDAG(nodes, evaluationOrder, cycles);
  }

  /**
   * Returns the minimal set of node IDs affected by `changedIds` (including `changedIds`
   * themselves and all transitive downstream dependents), ordered topologically.
   */
  getAffectedOrder(changedIds: Iterable<string>): string[] {
    const affected = new Set<string>();
    const stack: string[] = [];

    for (const id of changedIds) {
      if (this.nodes.has(id) && !affected.has(id)) {
        affected.add(id);
        stack.push(id);
      }
    }

    while (stack.length > 0) {
      const cur = stack.pop()!;
      const node = this.nodes.get(cur);
      if (!node) continue;
      for (const dep of node.dependents) {
        if (!affected.has(dep)) {
          affected.add(dep);
          stack.push(dep);
        }
      }
    }

    return this.evaluationOrder.filter((id) => affected.has(id));
  }

  toSnapshot(): DAGSnapshot {
    return {
      nodes: this.nodes,
      evaluationOrder: this.evaluationOrder,
      cycles: this.cycles,
    };
  }
}
