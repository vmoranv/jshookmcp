/**
 * Call graph analysis handler.
 *
 * Analyzes runtime function call graph from in-page traces (`__aiHooks`, `__functionTracer`, etc.).
 */

import type { CodeCollector } from '@server/domains/shared/modules';
import { toResponse, toError, parseClampedNumber } from '@server/domains/graphql/handlers/shared';
import {
  GRAPHQL_MAX_GRAPH_NODES,
  GRAPHQL_MAX_GRAPH_EDGES,
} from '@server/domains/graphql/handlers.impl.core.runtime.shared';
import type {
  CallGraphEdge,
  CallGraphNode,
} from '@server/domains/graphql/handlers.impl.core.runtime.shared';
import { argString } from '@server/domains/shared/parse-args';
import { evaluateWithTimeout } from '@modules/collector/PageController';

export class CallGraphHandlers {
  constructor(private collector: CodeCollector) {}

  async handleCallGraphAnalyze(args: Record<string, unknown>) {
    try {
      const maxDepth = parseClampedNumber(args, 'maxDepth', 5, 1, 20);
      const filterPattern = argString(args, 'filterPattern')?.trim() || '';

      if (filterPattern) {
        try {
          RegExp(filterPattern);
        } catch (error) {
          return toError('Invalid filterPattern regex', {
            filterPattern,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const page = await this.collector.getActivePage();

      const rawResult = await evaluateWithTimeout(
        page,
        ({ maxDepth: depth, filterPattern: filter }) => {
          const globalScope = window as unknown as Window & Record<string, unknown>;
          const edgeMap = new Map<string, { source: string; target: string; count: number }>();
          const nodeMap = new Map<string, { id: string; name: string; callCount: number }>();

          let scannedRecords = 0;
          let acceptedRecords = 0;

          const filterRegex = filter ? new RegExp(filter) : null;

          const matchesFilter = (name: string): boolean => {
            if (!filterRegex) return true;
            filterRegex.lastIndex = 0;
            return filterRegex.test(name);
          };

          const includeEdge = (source: string, target: string): boolean => {
            if (!filterRegex) return true;
            return matchesFilter(source) || matchesFilter(target);
          };

          const incrementNode = (name: string, by = 1): void => {
            const existing = nodeMap.get(name);
            if (existing) {
              existing.callCount += by;
              return;
            }
            nodeMap.set(name, { id: name, name, callCount: by });
          };

          const addEdge = (sourceRaw: unknown, targetRaw: unknown): void => {
            const source = typeof sourceRaw === 'string' ? sourceRaw.trim() || '' : '';
            const target = typeof targetRaw === 'string' ? targetRaw.trim() || '' : '';

            if (!source || !target || source === target) return;
            if (!includeEdge(source, target)) return;

            const key = `${source}__->__${target}`;
            const existing = edgeMap.get(key);
            if (existing) {
              existing.count += 1;
            } else {
              edgeMap.set(key, { source, target, count: 1 });
            }

            incrementNode(source, 1);
            incrementNode(target, 1);
          };

          const processRecord = (record: Record<string, unknown>, fallbackName: string): void => {
            scannedRecords += 1;

            const calleeRaw =
              record.callee ??
              record.functionName ??
              record.fn ??
              record.name ??
              record.method ??
              record.target ??
              fallbackName;
            const callee =
              typeof calleeRaw === 'string' ? calleeRaw.trim() || fallbackName : fallbackName;

            const callerRaw = record.caller ?? record.parent ?? record.from ?? '';
            const caller = typeof callerRaw === 'string' ? callerRaw.trim() || '' : '';

            let used = false;

            if (caller && callee) {
              addEdge(caller, callee);
              used = true;
            }

            const stackValue = record.stack ?? record.stackTrace ?? record.trace;
            const frames =
              typeof stackValue === 'string' && stackValue.trim().length > 0
                ? stackValue
                    .split('\n')
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0)
                    .map((line) => {
                      const atMatch = line.match(/at\s+([^(<\s]+)/);
                      if (atMatch?.[1]) return atMatch[1];
                      const atFileMatch = line.match(/^([^(<\s]+)@/);
                      if (atFileMatch?.[1]) return atFileMatch[1];
                      return '';
                    })
                    .filter((name) => name.length > 0)
                : [];

            if (frames.length > 1) {
              const depthLimit = Math.min(depth, frames.length - 1);
              for (let index = 0; index < depthLimit; index += 1) {
                addEdge(frames[index + 1], frames[index]);
              }
              used = true;
            } else if (frames.length === 1 && callee && frames[0] !== callee) {
              addEdge(frames[0], callee);
              used = true;
            }

            if (used) acceptedRecords += 1;
          };

          // Scan __aiHooks
          const aiHooks = globalScope.__aiHooks;
          if (aiHooks && typeof aiHooks === 'object') {
            for (const [hookName, hookRecords] of Object.entries(aiHooks)) {
              if (!Array.isArray(hookRecords)) continue;
              for (const entry of hookRecords) {
                if (entry && typeof entry === 'object') {
                  processRecord(entry as Record<string, unknown>, hookName);
                }
              }
            }
          }

          // Scan tracer keys
          const tracerKeys = [
            '__functionTraceRecords',
            '__functionTracerRecords',
            '__functionCalls',
            '__callTrace',
            '__traceCalls',
          ];

          for (const key of tracerKeys) {
            const records = globalScope[key];
            if (!Array.isArray(records)) continue;
            for (const entry of records) {
              if (entry && typeof entry === 'object') {
                processRecord(entry as Record<string, unknown>, key);
              }
            }
          }

          // Scan __functionTracer.records
          const functionTracer = globalScope.__functionTracer;
          if (functionTracer && typeof functionTracer === 'object') {
            const records = (functionTracer as Record<string, unknown>).records;
            if (Array.isArray(records)) {
              for (const entry of records) {
                if (entry && typeof entry === 'object') {
                  processRecord(entry as Record<string, unknown>, 'functionTracer.records');
                }
              }
            }
          }

          const nodes = Array.from(nodeMap.values()).toSorted(
            (left, right) => right.callCount - left.callCount,
          );
          const edges = Array.from(edgeMap.values()).toSorted(
            (left, right) => right.count - left.count,
          );

          return {
            nodes,
            edges,
            stats: {
              scannedRecords,
              acceptedRecords,
              nodeCount: nodes.length,
              edgeCount: edges.length,
              maxDepth: depth,
              filterPattern: filter || null,
            },
          };
        },
        { maxDepth, filterPattern },
      );

      const result = rawResult as {
        nodes: CallGraphNode[];
        edges: CallGraphEdge[];
        stats: Record<string, unknown>;
      };

      const nodesTruncated = result.nodes.length > GRAPHQL_MAX_GRAPH_NODES;
      const edgesTruncated = result.edges.length > GRAPHQL_MAX_GRAPH_EDGES;

      return toResponse({
        success: true,
        nodes: result.nodes.slice(0, GRAPHQL_MAX_GRAPH_NODES),
        edges: result.edges.slice(0, GRAPHQL_MAX_GRAPH_EDGES),
        stats: {
          ...result.stats,
          nodesReturned: Math.min(result.nodes.length, GRAPHQL_MAX_GRAPH_NODES),
          edgesReturned: Math.min(result.edges.length, GRAPHQL_MAX_GRAPH_EDGES),
          nodesTruncated,
          edgesTruncated,
        },
      });
    } catch (error) {
      return toError(error);
    }
  }
}
