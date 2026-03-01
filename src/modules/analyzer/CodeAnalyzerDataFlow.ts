import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import type { DataFlow } from '../../types/index.js';
import type { LLMService } from '../../services/LLMService.js';
import { generateTaintAnalysisPrompt } from '../../services/prompts/taint.js';
import { logger } from '../../utils/logger.js';
import { checkSanitizer } from './SecurityCodeAnalyzer.js';

type DataFlowTaintPath = DataFlow['taintPaths'][number];
type LlmTaintPathCandidate = Partial<Pick<DataFlowTaintPath, 'source' | 'sink' | 'path'>>;
type LlmTaintAnalysisResult = { taintPaths?: unknown[] };

export async function analyzeDataFlowWithTaint(code: string, llm?: LLMService): Promise<DataFlow> {
  const graph: DataFlow['graph'] = { nodes: [], edges: [] };
  const sources: DataFlow['sources'] = [];
  const sinks: DataFlow['sinks'] = [];
  const taintPaths: DataFlow['taintPaths'] = [];

  const taintMap = new Map<string, { sourceType: string; sourceLine: number }>();

  const sanitizers = new Set([
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
    'JSON.parse',
    'String.prototype.replace',
    'String.prototype.trim',
    'Array.prototype.filter',
    'Array.prototype.map',
  ]);

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    traverse(ast, {
      CallExpression(path) {
        const callee = path.node.callee;
        const line = path.node.loc?.start.line || 0;

        if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
          const methodName = callee.property.name;

          if (['fetch', 'ajax', 'get', 'post', 'request', 'axios'].includes(methodName)) {
            const sourceId = `source-network-${line}`;
            sources.push({ type: 'network', location: { file: 'current', line } });
            graph.nodes.push({
              id: sourceId,
              name: `${methodName}()`,
              type: 'source',
              location: { file: 'current', line },
            });

            const parent = path.parent;
            if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
              taintMap.set(parent.id.name, { sourceType: 'network', sourceLine: line });
            }
          } else if (
            [
              'querySelector',
              'getElementById',
              'getElementsByClassName',
              'getElementsByTagName',
            ].includes(methodName)
          ) {
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

          if (['eval', 'Function', 'setTimeout', 'setInterval'].includes(funcName)) {
            const sinkId = `sink-eval-${line}`;
            sinks.push({ type: 'eval', location: { file: 'current', line } });
            graph.nodes.push({
              id: sinkId,
              name: `${funcName}()`,
              type: 'sink',
              location: { file: 'current', line },
            });

            checkTaintedArguments(path.node.arguments, taintMap, taintPaths, funcName, line);
          }
        }

        if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
          const methodName = callee.property.name;

          if (
            ['write', 'writeln'].includes(methodName) &&
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
            checkTaintedArguments(path.node.arguments, taintMap, taintPaths, methodName, line);
          }

          if (['query', 'execute', 'exec', 'run'].includes(methodName)) {
            const sinkId = `sink-sql-${line}`;
            sinks.push({ type: 'sql-injection', location: { file: 'current', line } });
            graph.nodes.push({
              id: sinkId,
              name: `${methodName}() (SQL)`,
              type: 'sink',
              location: { file: 'current', line },
            });
            checkTaintedArguments(path.node.arguments, taintMap, taintPaths, methodName, line);
          }

          if (['exec', 'spawn', 'execSync', 'spawnSync'].includes(methodName)) {
            const sinkId = `sink-command-${line}`;
            sinks.push({ type: 'other', location: { file: 'current', line } });
            graph.nodes.push({
              id: sinkId,
              name: `${methodName}() (Command)`,
              type: 'sink',
              location: { file: 'current', line },
            });
            checkTaintedArguments(path.node.arguments, taintMap, taintPaths, methodName, line);
          }

          if (
            ['readFile', 'writeFile', 'readFileSync', 'writeFileSync', 'open'].includes(methodName)
          ) {
            const sinkId = `sink-file-${line}`;
            sinks.push({ type: 'other', location: { file: 'current', line } });
            graph.nodes.push({
              id: sinkId,
              name: `${methodName}() (File)`,
              type: 'sink',
              location: { file: 'current', line },
            });
            checkTaintedArguments(path.node.arguments, taintMap, taintPaths, methodName, line);
          }
        }
      },

      MemberExpression(path) {
        const obj = path.node.object;
        const prop = path.node.property;
        const line = path.node.loc?.start.line || 0;

        if (t.isIdentifier(obj) && obj.name === 'location' && t.isIdentifier(prop)) {
          if (['href', 'search', 'hash', 'pathname'].includes(prop.name)) {
            const sourceId = `source-url-${line}`;
            sources.push({ type: 'user_input', location: { file: 'current', line } });
            graph.nodes.push({
              id: sourceId,
              name: `location.${prop.name}`,
              type: 'source',
              location: { file: 'current', line },
            });

            const parent = path.parent;
            if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
              taintMap.set(parent.id.name, { sourceType: 'url', sourceLine: line });
            }
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

        if (t.isIdentifier(obj) && ['localStorage', 'sessionStorage'].includes(obj.name)) {
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

        if (t.isIdentifier(obj) && obj.name === 'event' && t.isIdentifier(prop) && prop.name === 'data') {
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
        const line = path.node.loc?.start.line || 0;

        if (t.isMemberExpression(left) && t.isIdentifier(left.property)) {
          const propName = left.property.name;
          if (['innerHTML', 'outerHTML'].includes(propName)) {
            const sinkId = `sink-dom-${line}`;
            sinks.push({ type: 'xss', location: { file: 'current', line } });
            graph.nodes.push({
              id: sinkId,
              name: propName,
              type: 'sink',
              location: { file: 'current', line },
            });

            if (t.isIdentifier(right) && taintMap.has(right.name)) {
              const taintInfo = taintMap.get(right.name)!;
              taintPaths.push({
                source: {
                  type: taintInfo.sourceType as DataFlow['sources'][0]['type'],
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
          if (t.isCallExpression(init) && checkSanitizer(init, sanitizers)) {
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
          } else if (t.isCallExpression(init)) {
            const arg = init.arguments[0];
            if (t.isIdentifier(arg) && taintMap.has(arg.name)) {
              const taintInfo = taintMap.get(arg.name)!;
              taintMap.set(id.name, taintInfo);
            }
          }
        }
      },

      AssignmentExpression(path) {
        const left = path.node.left;
        const right = path.node.right;

        if (t.isIdentifier(left) && t.isIdentifier(right) && taintMap.has(right.name)) {
          const taintInfo = taintMap.get(right.name)!;
          taintMap.set(left.name, taintInfo);
        }
      },
    });
  } catch (error) {
    logger.warn('Data flow analysis failed', error);
  }

  if (taintPaths.length > 0 && llm) {
    try {
      await enhanceTaintAnalysisWithLLM(llm, code, sources, sinks, taintPaths);
    } catch (error) {
      logger.warn('LLM-enhanced taint analysis failed', error);
    }
  }

  return {
    graph,
    sources,
    sinks,
    taintPaths,
  };
}

async function enhanceTaintAnalysisWithLLM(
  llm: LLMService,
  code: string,
  sources: DataFlow['sources'],
  sinks: DataFlow['sinks'],
  taintPaths: DataFlow['taintPaths']
): Promise<void> {
  if (taintPaths.length === 0) return;

  try {
    const sourcesList = sources.map((s) => `${s.type} at line ${s.location.line}`);
    const sinksList = sinks.map((s) => `${s.type} at line ${s.location.line}`);

    const messages = generateTaintAnalysisPrompt(
      code.length > 4000 ? code.substring(0, 4000) : code,
      sourcesList,
      sinksList
    );

    const response = await llm.chat(messages, {
      temperature: 0.2,
      maxTokens: 2000,
    });

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const llmResult = JSON.parse(jsonMatch[0]) as LlmTaintAnalysisResult;

      if (Array.isArray(llmResult.taintPaths)) {
        logger.info(`LLM identified ${llmResult.taintPaths.length} additional taint paths`);

        llmResult.taintPaths.forEach((rawPath) => {
          const path = rawPath as LlmTaintPathCandidate;
          const exists = taintPaths.some(
            (p) =>
              p.source.location.line === path.source?.location?.line &&
              p.sink.location.line === path.sink?.location?.line
          );

          if (!exists && path.source && path.sink) {
            taintPaths.push({
              source: path.source,
              sink: path.sink,
              path: path.path || [],
            });
          }
        });
      }
    }
  } catch (error) {
    logger.debug('LLM taint analysis enhancement failed', error);
  }
}

function checkTaintedArguments(
  args: Array<t.Expression | t.SpreadElement | t.ArgumentPlaceholder>,
  taintMap: Map<string, { sourceType: string; sourceLine: number }>,
  taintPaths: DataFlow['taintPaths'],
  _funcName: string,
  line: number
): void {
  args.forEach((arg) => {
    if (t.isIdentifier(arg) && taintMap.has(arg.name)) {
      const taintInfo = taintMap.get(arg.name)!;
      taintPaths.push({
        source: {
          type: taintInfo.sourceType as DataFlow['sources'][0]['type'],
          location: { file: 'current', line: taintInfo.sourceLine },
        },
        sink: {
          type: 'eval',
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
