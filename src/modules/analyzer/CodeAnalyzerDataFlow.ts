import * as parser from '@babel/parser';
import { BABEL_PARSE_PLUGINS } from '@utils/babel-plugins';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import type { DataFlow } from '@internal-types/index';

import { logger } from '@utils/logger';
import { checkSanitizer } from '@modules/analyzer/SecurityCodeAnalyzer';
import {
  buildFunctionSummaries,
  calleeName,
  identifySource,
  type SourceInfo,
} from '@modules/analyzer/CodeAnalyzerDataFlow.summaries';
import { DATAFLOW_MAX_FIXPOINT_ITERATIONS } from '@src/constants';

type SinkType = DataFlow['sinks'][number]['type'];

interface SinkSite {
  args: Array<t.Expression | t.SpreadElement | t.ArgumentPlaceholder>;
  sinkType: SinkType;
  line: number;
}

/** Cap on the monotonic taint fixpoint loop (taint only grows, so it converges). */
const MAX_FIXPOINT_ITERATIONS = DATAFLOW_MAX_FIXPOINT_ITERATIONS;

/**
 * Sanitizers / value-sinking builtins: taint identity drops when a value
 * passes through one of these (or the call is safe to skip).
 */
const SANITIZERS = new Set([
  'encodeURIComponent',
  'encodeURI',
  'escape',
  'decodeURIComponent',
  'decodeURI',
  'htmlentities',
  'htmlspecialchars',
  'escapeHtml',
  'escapeHTML',
  'he.encode',
  'he.escape',
  'validator.escape',
  'validator.unescape',
  'validator.stripLow',
  'validator.blacklist',
  'validator.whitelist',
  'validator.trim',
  'validator.isEmail',
  'validator.isURL',
  'validator.isInt',
  'DOMPurify.sanitize',
  'DOMPurify.addHook',
  'crypto.encrypt',
  'crypto.hash',
  'crypto.createHash',
  'crypto.createHmac',
  'CryptoJS.AES.encrypt',
  'CryptoJS.SHA256',
  'CryptoJS.MD5',
  'bcrypt.hash',
  'bcrypt.compare',
  'btoa',
  'atob',
  'Buffer.from',
  'db.prepare',
  'db.query',
  'mysql.escape',
  'pg.query',
  'xss',
  'sanitizeHtml',
  'parseInt',
  'parseFloat',
  'Number',
  'String',
  'JSON.stringify',
  // NOTE: JSON.parse intentionally NOT a sanitizer — it returns a structured
  // object whose members are still attacker-controlled (`JSON.parse(x).data`).
  'String.prototype.replace',
  'String.prototype.trim',
  'Array.prototype.filter',
  'Array.prototype.map',
  // Value-sinking builtins: these return a number/boolean derived from the
  // argument, dropping the taint identity (e.g. `Math.max(tainted, 0)` no
  // longer carries the source). Listing them here keeps the unknown-callee
  // pass-through from over-reporting on pure numeric helpers.
  'Math.max',
  'Math.min',
  'Math.floor',
  'Math.ceil',
  'Math.round',
  'Math.abs',
  'Math.trunc',
  'Math.sign',
  'Math.sqrt',
  'Math.pow',
  'Math.log',
  'Math.exp',
  'Math.random',
  'Math.hypot',
  'Math.fround',
  'Number.prototype.toString',
  'Number.prototype.toFixed',
  'Number.prototype.toPrecision',
]);

/** Network-request APIs treated as taint sources. */
const NETWORK_SOURCE_METHODS = ['fetch', 'ajax', 'get', 'post', 'request', 'axios'];

/** DOM query APIs treated as taint sources. */
const DOM_SOURCE_METHODS = [
  'querySelector',
  'getElementById',
  'getElementsByClassName',
  'getElementsByTagName',
];

/** Global functions that execute strings — eval-class sinks. */
const EVAL_SINK_FUNCTIONS = ['eval', 'Function', 'setTimeout', 'setInterval'];

/** `document.write`-family sink methods. */
const DOCUMENT_WRITE_METHODS = ['write', 'writeln'];

/** SQL-execution sink methods. */
const SQL_SINK_METHODS = ['query', 'execute', 'exec', 'run'];

/** Command-execution sink methods. */
const COMMAND_SINK_METHODS = ['exec', 'spawn', 'execSync', 'spawnSync'];

/** File I/O sink methods. */
const FILE_SINK_METHODS = ['readFile', 'writeFile', 'readFileSync', 'writeFileSync', 'open'];

/** `location.*` properties treated as URL taint sources. */
const LOCATION_SOURCE_PROPS = ['href', 'search', 'hash', 'pathname'];

/** Web storage objects treated as storage taint sources. */
const STORAGE_OBJECT_NAMES = ['localStorage', 'sessionStorage'];

/** Assignment targets treated as DOM XSS sinks. */
const DOM_ASSIGNMENT_SINK_PROPS = ['innerHTML', 'outerHTML'];

function normalizeSourceType(sourceType: string): DataFlow['sources'][number]['type'] {
  if (
    sourceType === 'user_input' ||
    sourceType === 'storage' ||
    sourceType === 'network' ||
    sourceType === 'other'
  ) {
    return sourceType;
  }
  // Legacy first-pass marker ('url') and anything unexpected map to safe defaults.
  return sourceType === 'url' ? 'user_input' : 'other';
}

export async function analyzeDataFlowWithTaint(code: string): Promise<DataFlow> {
  const graph: DataFlow['graph'] = { nodes: [], edges: [] };
  const sources: DataFlow['sources'] = [];
  const sinks: DataFlow['sinks'] = [];
  const taintPaths: DataFlow['taintPaths'] = [];

  const taintMap = new Map<string, { sourceType: string; sourceLine: number }>();

  const sinkSites: SinkSite[] = [];

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: BABEL_PARSE_PLUGINS,
    });

    traverse(ast, {
      CallExpression(path) {
        const callee = path.node.callee;
        const line = /* istanbul ignore next */ path.node.loc?.start.line || 0;

        if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
          const methodName = callee.property.name;

          if (NETWORK_SOURCE_METHODS.includes(methodName)) {
            const sourceId = `source-network-${line}`;
            sources.push({ type: 'network', location: { file: 'current', line } });
            graph.nodes.push({
              id: sourceId,
              name: `${methodName}()`,
              type: 'source',
              location: { file: 'current', line },
            });

            const parent = path.parent;
            markTaintedSource(parent, 'network', line, taintMap);
          } else if (DOM_SOURCE_METHODS.includes(methodName)) {
            const sourceId = `source-dom-${line}`;
            sources.push({ type: 'user_input', location: { file: 'current', line } });
            graph.nodes.push({
              id: sourceId,
              name: `${methodName}()`,
              type: 'source',
              location: { file: 'current', line },
            });
          }
        }

        if (t.isIdentifier(callee)) {
          const funcName = callee.name;

          if (EVAL_SINK_FUNCTIONS.includes(funcName)) {
            const sinkId = `sink-eval-${line}`;
            sinks.push({ type: 'eval', location: { file: 'current', line } });
            graph.nodes.push({
              id: sinkId,
              name: `${funcName}()`,
              type: 'sink',
              location: { file: 'current', line },
            });

            checkTaintedArguments(path.node.arguments, taintMap, taintPaths, 'eval', line);
            sinkSites.push({ args: path.node.arguments, sinkType: 'eval', line });
          }
        }

        if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
          const methodName = callee.property.name;

          if (
            DOCUMENT_WRITE_METHODS.includes(methodName) &&
            t.isIdentifier(callee.object) &&
            callee.object.name === 'document'
          ) {
            const sinkId = `sink-document-write-${line}`;
            sinks.push({ type: 'xss', location: { file: 'current', line } });
            graph.nodes.push({
              id: sinkId,
              name: `document.${methodName}()`,
              type: 'sink',
              location: { file: 'current', line },
            });
            checkTaintedArguments(path.node.arguments, taintMap, taintPaths, 'xss', line);
            sinkSites.push({ args: path.node.arguments, sinkType: 'xss', line });
          }

          if (SQL_SINK_METHODS.includes(methodName)) {
            const sinkId = `sink-sql-${line}`;
            sinks.push({ type: 'sql-injection', location: { file: 'current', line } });
            graph.nodes.push({
              id: sinkId,
              name: `${methodName}() (SQL)`,
              type: 'sink',
              location: { file: 'current', line },
            });
            checkTaintedArguments(path.node.arguments, taintMap, taintPaths, 'sql-injection', line);
            sinkSites.push({ args: path.node.arguments, sinkType: 'sql-injection', line });
          }

          if (COMMAND_SINK_METHODS.includes(methodName)) {
            const sinkId = `sink-command-${line}`;
            sinks.push({ type: 'other', location: { file: 'current', line } });
            graph.nodes.push({
              id: sinkId,
              name: `${methodName}() (Command)`,
              type: 'sink',
              location: { file: 'current', line },
            });
            checkTaintedArguments(path.node.arguments, taintMap, taintPaths, 'other', line);
            sinkSites.push({ args: path.node.arguments, sinkType: 'other', line });
          }

          if (FILE_SINK_METHODS.includes(methodName)) {
            const sinkId = `sink-file-${line}`;
            sinks.push({ type: 'other', location: { file: 'current', line } });
            graph.nodes.push({
              id: sinkId,
              name: `${methodName}() (File)`,
              type: 'sink',
              location: { file: 'current', line },
            });
            checkTaintedArguments(path.node.arguments, taintMap, taintPaths, 'other', line);
            sinkSites.push({ args: path.node.arguments, sinkType: 'other', line });
          }
        }
      },

      MemberExpression(path) {
        const obj = path.node.object;
        const prop = path.node.property;
        const line = /* istanbul ignore next */ path.node.loc?.start.line || 0;

        if (t.isIdentifier(obj) && obj.name === 'location' && t.isIdentifier(prop)) {
          if (LOCATION_SOURCE_PROPS.includes(prop.name)) {
            const sourceId = `source-url-${line}`;
            sources.push({ type: 'user_input', location: { file: 'current', line } });
            graph.nodes.push({
              id: sourceId,
              name: `location.${prop.name}`,
              type: 'source',
              location: { file: 'current', line },
            });

            const parent = path.parent;
            markTaintedSource(parent, 'user_input', line, taintMap);
          }
        }

        if (
          t.isIdentifier(obj) &&
          obj.name === 'document' &&
          t.isIdentifier(prop) &&
          prop.name === 'cookie'
        ) {
          const sourceId = `source-cookie-${line}`;
          sources.push({ type: 'storage', location: { file: 'current', line } });
          graph.nodes.push({
            id: sourceId,
            name: 'document.cookie',
            type: 'source',
            location: { file: 'current', line },
          });
        }

        if (t.isIdentifier(obj) && STORAGE_OBJECT_NAMES.includes(obj.name)) {
          const sourceId = `source-storage-${line}`;
          sources.push({ type: 'storage', location: { file: 'current', line } });
          graph.nodes.push({
            id: sourceId,
            name: `${obj.name}.getItem()`,
            type: 'source',
            location: { file: 'current', line },
          });
        }

        if (
          t.isIdentifier(obj) &&
          obj.name === 'window' &&
          t.isIdentifier(prop) &&
          prop.name === 'name'
        ) {
          const sourceId = `source-window-name-${line}`;
          sources.push({ type: 'user_input', location: { file: 'current', line } });
          graph.nodes.push({
            id: sourceId,
            name: 'window.name',
            type: 'source',
            location: { file: 'current', line },
          });
        }

        if (
          t.isIdentifier(obj) &&
          obj.name === 'event' &&
          t.isIdentifier(prop) &&
          prop.name === 'data'
        ) {
          const sourceId = `source-postmessage-${line}`;
          sources.push({ type: 'network', location: { file: 'current', line } });
          graph.nodes.push({
            id: sourceId,
            name: 'event.data (postMessage)',
            type: 'source',
            location: { file: 'current', line },
          });
        }

        if (
          t.isIdentifier(obj) &&
          obj.name === 'message' &&
          t.isIdentifier(prop) &&
          prop.name === 'data'
        ) {
          const sourceId = `source-websocket-${line}`;
          sources.push({ type: 'network', location: { file: 'current', line } });
          graph.nodes.push({
            id: sourceId,
            name: 'WebSocket message.data',
            type: 'source',
            location: { file: 'current', line },
          });
        }
      },

      AssignmentExpression(path) {
        const left = path.node.left;
        const right = path.node.right;
        const line = /* istanbul ignore next */ path.node.loc?.start.line || 0;

        if (t.isMemberExpression(left) && t.isIdentifier(left.property)) {
          const propName = left.property.name;
          if (DOM_ASSIGNMENT_SINK_PROPS.includes(propName)) {
            const sinkId = `sink-dom-${line}`;
            sinks.push({ type: 'xss', location: { file: 'current', line } });
            graph.nodes.push({
              id: sinkId,
              name: propName,
              type: 'sink',
              location: { file: 'current', line },
            });

            sinkSites.push({ args: [right], sinkType: 'xss', line });

            if (t.isIdentifier(right) && taintMap.has(right.name)) {
              const taintInfo = taintMap.get(right.name)!;
              taintPaths.push({
                source: {
                  type: normalizeSourceType(taintInfo.sourceType),
                  location: { file: 'current', line: taintInfo.sourceLine },
                },
                sink: { type: 'xss', location: { file: 'current', line } },
                path: [
                  { file: 'current', line: taintInfo.sourceLine },
                  { file: 'current', line },
                ],
              });
            }
          }
        }
      },
    });

    traverse(ast, {
      VariableDeclarator(path) {
        const id = path.node.id;
        const init = path.node.init;

        if (t.isIdentifier(id) && init) {
          if (t.isCallExpression(init) && checkSanitizer(init, SANITIZERS)) {
            const arg = init.arguments[0];
            if (t.isIdentifier(arg) && taintMap.has(arg.name)) {
              logger.debug(`Taint cleaned by sanitizer: ${arg.name} -> ${id.name}`);
              return;
            }
          }

          if (t.isIdentifier(init) && taintMap.has(init.name)) {
            const taintInfo = taintMap.get(init.name)!;
            taintMap.set(id.name, taintInfo);
          } else if (t.isBinaryExpression(init)) {
            const leftTainted = t.isIdentifier(init.left) && taintMap.has(init.left.name);
            const rightTainted = t.isIdentifier(init.right) && taintMap.has(init.right.name);

            if (leftTainted || rightTainted) {
              const taintInfo = leftTainted
                ? taintMap.get((init.left as t.Identifier).name)!
                : taintMap.get((init.right as t.Identifier).name)!;
              taintMap.set(id.name, taintInfo);
            }
          }
          // Call-expression propagation is handled by the summary-aware Pass 3
          // below, which distinguishes taint-passing helpers from sanitizers and
          // tracks non-first argument positions.
        }
      },

      AssignmentExpression(path) {
        const left = path.node.left;
        const right = path.node.right;

        if (t.isIdentifier(right) && taintMap.has(right.name)) {
          const taintInfo = taintMap.get(right.name)!;
          markTaintedTarget(left, taintInfo, taintMap);
        } else if (t.isBinaryExpression(right)) {
          const leftTainted = t.isIdentifier(right.left) && taintMap.has(right.left.name);
          const rightTainted = t.isIdentifier(right.right) && taintMap.has(right.right.name);

          if (leftTainted || rightTainted) {
            const taintInfo = leftTainted
              ? taintMap.get((right.left as t.Identifier).name)!
              : taintMap.get((right.right as t.Identifier).name)!;
            markTaintedTarget(left, taintInfo, taintMap);
          }
        }
      },
    });

    // --- Pass 3: interprocedural + member-chain propagation, then sink re-scan ---
    // Additive only: extends the (flat, module-scoped) taintMap using per-function
    // summaries and member-chain access, then re-checks every recorded sink site
    // against the enriched map. This surfaces taint that flows through helpers and
    // property chains — paths the first two passes emit too late (sinks are scanned
    // before propagation completes) or not at all.
    const summaries = buildFunctionSummaries(ast, SANITIZERS, checkSanitizer);

    const moduleEval = (node: t.Node | null | undefined): SourceInfo | null => {
      if (!node) {
        return null;
      }
      if (t.isIdentifier(node)) {
        return taintMap.get(node.name) ?? null;
      }
      const source = identifySource(node);
      if (source) {
        return source;
      }
      if (t.isMemberExpression(node)) {
        return moduleEval(node.object);
      }
      if (t.isBinaryExpression(node)) {
        return (t.isExpression(node.left) ? moduleEval(node.left) : null) ?? moduleEval(node.right);
      }
      if (t.isCallExpression(node)) {
        if (checkSanitizer(node, SANITIZERS)) {
          return null;
        }
        const argInfos = node.arguments.map((arg) =>
          t.isExpression(arg) ? moduleEval(arg) : null,
        );
        const name = calleeName(node);
        if (name && summaries.has(name)) {
          const summary = summaries.get(name)!;
          for (const idx of summary.taintedParamIndices) {
            const argInfo = argInfos[idx];
            if (argInfo) {
              return argInfo;
            }
          }
          return summary.returnsSource;
        }
        // Unknown callee: conservatively pass through taint from any argument so
        // user helpers (`wrap(s)`) still propagate. Pure value-sinking builtins
        // that drop the taint identity (Math.*, parseInt, Number, ...) are listed
        // as sanitizers above and never reach this branch.
        for (const argInfo of argInfos) {
          if (argInfo) {
            return argInfo;
          }
        }
      }
      return null;
    };

    // Monotonic fixpoint over module-scope declarations/assignments (taint only
    // grows). Function bodies are skipped — they are captured by the summaries.
    let propagated = true;
    let guard = 0;
    while (propagated && guard < MAX_FIXPOINT_ITERATIONS) {
      propagated = false;
      guard += 1;
      traverse(ast, {
        Function(path) {
          path.skip();
        },
        VariableDeclarator(path) {
          const id = path.node.id;
          if (t.isIdentifier(id) && !taintMap.has(id.name) && path.node.init) {
            const info = moduleEval(path.node.init);
            if (info) {
              taintMap.set(id.name, info);
              propagated = true;
            }
          }
        },
        AssignmentExpression(path) {
          const name = targetName(path.node.left);
          if (name && !taintMap.has(name)) {
            const info = moduleEval(path.node.right);
            if (info) {
              taintMap.set(name, info);
              propagated = true;
            }
          }
        },
      });
    }

    const seenPaths = new Set(
      taintPaths.map((p) => `${p.source.location.line}->${p.sink.location.line}:${p.sink.type}`),
    );
    for (const site of sinkSites) {
      for (const arg of site.args) {
        if (!t.isExpression(arg)) {
          continue;
        }
        // Evaluate the argument with the same module-level evaluator used by the
        // fixpoint, so member chains (`el.innerHTML = obj.data`), concatenations
        // and helper calls are re-checked instead of only bare identifiers.
        const info = moduleEval(arg);
        if (!info) {
          continue;
        }
        const key = `${info.sourceLine}->${site.line}:${site.sinkType}`;
        if (seenPaths.has(key)) {
          continue;
        }
        seenPaths.add(key);
        taintPaths.push({
          source: {
            type: normalizeSourceType(info.sourceType),
            location: { file: 'current', line: info.sourceLine },
          },
          sink: { type: site.sinkType, location: { file: 'current', line: site.line } },
          path: [
            { file: 'current', line: info.sourceLine },
            { file: 'current', line: site.line },
          ],
        });
      }
    }
  } catch (error) {
    logger.warn('Data flow analysis failed', error);
  }

  return {
    graph,
    sources,
    sinks,
    taintPaths,
  };
}

function checkTaintedArguments(
  args: Array<t.Expression | t.SpreadElement | t.ArgumentPlaceholder>,
  taintMap: Map<string, { sourceType: string; sourceLine: number }>,
  taintPaths: DataFlow['taintPaths'],
  sinkType: SinkType,
  line: number,
): void {
  args.forEach((arg) => {
    if (t.isIdentifier(arg) && taintMap.has(arg.name)) {
      const taintInfo = taintMap.get(arg.name)!;
      taintPaths.push({
        source: {
          type: normalizeSourceType(taintInfo.sourceType),
          location: { file: 'current', line: taintInfo.sourceLine },
        },
        sink: {
          type: sinkType,
          location: { file: 'current', line },
        },
        path: [
          { file: 'current', line: taintInfo.sourceLine },
          { file: 'current', line },
        ],
      });
    }
  });
}

/**
 * Resolve the variable name a taint-marking assignment targets. Member targets
 * (`a.b = ...`, `a.b.c = ...`) conservatively mark their base object, since the
 * taint map is flat and member-chain reads are resolved through the base.
 */
function targetName(target: t.Node): string | null {
  if (t.isIdentifier(target)) {
    return target.name;
  }
  if (t.isMemberExpression(target)) {
    return targetName(target.object);
  }
  return null;
}

function markTaintedTarget(
  target: t.Node,
  info: { sourceType: string; sourceLine: number },
  taintMap: Map<string, { sourceType: string; sourceLine: number }>,
): void {
  const name = targetName(target);
  if (name) {
    taintMap.set(name, info);
  }
}

/**
 * Propagate a browser-controlled source into its assignment target. Handles
 * both declaration (`const x = fetch(...)`) and assignment (`obj.resp = ...`)
 * forms, marking member-expression targets through their base object.
 */
function markTaintedSource(
  parent: t.Node,
  sourceType: string,
  line: number,
  taintMap: Map<string, { sourceType: string; sourceLine: number }>,
): void {
  const info = { sourceType, sourceLine: line };
  if (t.isVariableDeclarator(parent)) {
    markTaintedTarget(parent.id, info, taintMap);
  } else if (t.isAssignmentExpression(parent)) {
    markTaintedTarget(parent.left, info, taintMap);
  }
}
