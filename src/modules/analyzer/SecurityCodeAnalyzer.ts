import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import type { SecurityRisk } from '@internal-types/index';
import { logger } from '@utils/logger';

export function getMemberExpressionName(node: t.MemberExpression): string {
  const parts: string[] = [];

  let current: t.Expression | t.PrivateName | t.Super = node;
  while (t.isMemberExpression(current)) {
    if (t.isIdentifier(current.property)) {
      parts.unshift(current.property.name);
    }
    current = current.object;
  }

  if (t.isIdentifier(current)) {
    parts.unshift(current.name);
  }

  return parts.join('.');
}

export function checkSanitizer(node: t.CallExpression, sanitizers: Set<string>): boolean {
  const { callee } = node;

  if (t.isIdentifier(callee)) {
    return sanitizers.has(callee.name);
  }

  if (t.isMemberExpression(callee)) {
    const fullName = getMemberExpressionName(callee);
    return sanitizers.has(fullName);
  }

  return false;
}

/** Calee names treated as recursive merges prone to prototype pollution. */
const MERGE_CALLEE_NAMES: ReadonlySet<string> = new Set([
  'merge',
  'extend',
  'deepCopy',
  'deepMerge',
  'defaults',
  'assign',
]);

/** Identifier callees that issue network requests. */
const SSRF_CALLEE_IDS: ReadonlySet<string> = new Set(['fetch', 'axios', 'request']);
/** Method names on a network object that issue requests. */
const SSRF_METHODS: ReadonlySet<string> = new Set([
  'get',
  'post',
  'put',
  'delete',
  'request',
  'open',
]);
/** Objects whose methods are network calls. */
const SSRF_OBJECTS: ReadonlySet<string> = new Set(['http', 'https', 'axios', 'xhr']);

/** Filesystem method names that need a traversal check. */
const FS_METHODS: ReadonlySet<string> = new Set([
  'readFile',
  'writeFile',
  'readFileSync',
  'writeFileSync',
  'createReadStream',
  'createWriteStream',
  'unlink',
  'open',
]);

/** Argument names that look user-controlled for the traversal heuristic. */
const USER_INPUT_ARG_RE = /^(path|file|dir|name|filename|userInput|req|query|params|input)/i;

/** SQL sink method names. */
const SQL_METHODS = ['query', 'execute', 'exec', 'run'];
/** Timer functions that shell-evaluate a string first argument. */
const TIMER_CALLEES = ['setTimeout', 'setInterval'];

/** `eval(...)` — arbitrary code execution. */
function checkEvalCall(callee: t.Identifier, line: number): SecurityRisk | null {
  if (callee.name !== 'eval') return null;
  return {
    type: 'other',
    severity: 'critical',
    location: { file: 'current', line },
    description: 'Critical: Use of eval() allows arbitrary code execution',
    recommendation: 'Refactor to avoid eval(). Use JSON.parse() for data, or proper function calls',
  };
}

/** `Function(...)` — code injection through the constructor. */
function checkFunctionConstructor(callee: t.Identifier, line: number): SecurityRisk | null {
  if (callee.name !== 'Function') return null;
  return {
    type: 'other',
    severity: 'critical',
    location: { file: 'current', line },
    description: 'Critical: Function constructor allows code injection',
    recommendation: 'Use regular function declarations or arrow functions',
  };
}

/** `setTimeout("code")` / `setInterval("code")` — the string is evaluated. */
function checkTimerStringArg(
  node: t.CallExpression,
  calleeName: string,
  line: number,
): SecurityRisk | null {
  const firstArg = node.arguments[0];
  const isEvaluated =
    t.isStringLiteral(firstArg) || (t.isIdentifier(firstArg) && firstArg.name !== 'function');
  if (!isEvaluated) return null;
  return {
    type: 'other',
    severity: 'medium',
    location: { file: 'current', line },
    description: `${calleeName}() with string argument can lead to code injection`,
    recommendation: `Use ${calleeName}() with function reference instead of string`,
  };
}

/** `db.query(<concatenated>)` — SQL built by string concat or template. */
function checkSqlConcat(
  node: t.CallExpression,
  callee: t.MemberExpression,
  line: number,
): SecurityRisk | null {
  if (!t.isIdentifier(callee.property) || !SQL_METHODS.includes(callee.property.name)) {
    return null;
  }
  const firstArg = node.arguments[0];
  if (!t.isBinaryExpression(firstArg) && !t.isTemplateLiteral(firstArg)) {
    return null;
  }
  return {
    type: 'sql-injection',
    severity: 'critical',
    location: { file: 'current', line },
    description: 'Potential SQL injection: Query built with string concatenation',
    recommendation: 'Use parameterized queries or prepared statements',
  };
}

/** `merge(a, b)` and `Object.assign({}, untrusted)` — prototype pollution. */
function checkPrototypePollution(
  node: t.CallExpression,
  callee: t.CallExpression['callee'],
  line: number,
): SecurityRisk[] {
  const risks: SecurityRisk[] = [];
  const argCount = node.arguments.length;

  if (argCount >= 2 && t.isIdentifier(callee) && MERGE_CALLEE_NAMES.has(callee.name)) {
    risks.push({
      type: 'prototype-pollution',
      severity: 'medium',
      location: { file: 'current', line },
      description: `Potential prototype pollution: ${callee.name}() merges untrusted data`,
      recommendation: 'Use a merge that blocks __proto__/constructor keys, or Object.create(null)',
    });
  }

  // Object.assign({}, userInput) — empty-target assign with untrusted source
  if (argCount >= 2 && t.isMemberExpression(callee)) {
    const calleeFullName = getMemberExpressionName(callee);
    const target = node.arguments[0];
    if (
      calleeFullName === 'Object.assign' &&
      t.isObjectExpression(target) &&
      target.properties.length === 0
    ) {
      risks.push({
        type: 'prototype-pollution',
        severity: 'medium',
        location: { file: 'current', line },
        description: 'Potential prototype pollution: Object.assign({}, untrusted) copies __proto__',
        recommendation: 'Use Object.create(null) as the target or sanitize source keys',
      });
    }
  }

  return risks;
}

/** `fetch(x)` / `axios.get(x)` with a non-literal URL — SSRF. */
function checkSsrf(
  node: t.CallExpression,
  callee: t.CallExpression['callee'],
  line: number,
): SecurityRisk | null {
  const urlArg = node.arguments[0];
  const isNonLiteralUrl =
    urlArg !== undefined && !t.isStringLiteral(urlArg) && !t.isNumericLiteral(urlArg);
  if (!isNonLiteralUrl) return null;

  const isCalleeRequest =
    (t.isIdentifier(callee) && SSRF_CALLEE_IDS.has(callee.name)) ||
    (t.isMemberExpression(callee) &&
      t.isIdentifier(callee.property) &&
      SSRF_METHODS.has(callee.property.name) &&
      t.isIdentifier(callee.object) &&
      SSRF_OBJECTS.has(callee.object.name));
  if (!isCalleeRequest) return null;

  return {
    type: 'ssrf',
    severity: 'high',
    location: { file: 'current', line },
    description: 'Potential SSRF: network request with a non-literal URL argument',
    recommendation: 'Validate the URL against an allowlist of trusted hosts before requesting',
  };
}

/** `fs.readFile(path)` / `path.join(name)` where the arg looks user-controlled. */
function checkPathTraversal(
  node: t.CallExpression,
  callee: t.CallExpression['callee'],
  line: number,
): SecurityRisk | null {
  const isFsCall =
    (t.isMemberExpression(callee) &&
      t.isIdentifier(callee.property) &&
      FS_METHODS.has(callee.property.name)) ||
    (t.isIdentifier(callee) && (callee.name === 'join' || callee.name === 'resolve'));
  if (!isFsCall) return null;

  for (const arg of node.arguments) {
    if (t.isIdentifier(arg) && USER_INPUT_ARG_RE.test(arg.name)) {
      return {
        type: 'path-traversal',
        severity: 'high',
        location: { file: 'current', line },
        description: `Potential path traversal: filesystem call with user-input-named arg "${arg.name}"`,
        recommendation:
          'Normalize and confine paths to a trusted base directory (path.resolve + prefix check)',
      };
    }
  }
  return null;
}

/** Run every CallExpression detector and collect their findings. */
function analyzeCallExpression(node: t.CallExpression, line: number): SecurityRisk[] {
  const risks: SecurityRisk[] = [];
  const callee = node.callee;

  if (t.isIdentifier(callee)) {
    const evalRisk = checkEvalCall(callee, line);
    if (evalRisk) risks.push(evalRisk);

    const functionRisk = checkFunctionConstructor(callee, line);
    if (functionRisk) risks.push(functionRisk);

    if (TIMER_CALLEES.includes(callee.name)) {
      const timerRisk = checkTimerStringArg(node, callee.name, line);
      if (timerRisk) risks.push(timerRisk);
    }
  }

  if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
    const sqlRisk = checkSqlConcat(node, callee, line);
    if (sqlRisk) risks.push(sqlRisk);
  }

  risks.push(...checkPrototypePollution(node, callee, line));

  const ssrfRisk = checkSsrf(node, callee, line);
  if (ssrfRisk) risks.push(ssrfRisk);

  const traversalRisk = checkPathTraversal(node, callee, line);
  if (traversalRisk) risks.push(traversalRisk);

  return risks;
}

export function identifySecurityRisks(
  code: string,
  aiAnalysis: Record<string, unknown>,
): SecurityRisk[] {
  const risks: SecurityRisk[] = [];

  if (Array.isArray(aiAnalysis.securityRisks)) {
    aiAnalysis.securityRisks.forEach((risk: unknown) => {
      if (typeof risk === 'object' && risk !== null) {
        const r = risk as Record<string, unknown>;
        risks.push({
          type: (r.type as SecurityRisk['type']) || 'other',
          severity: (r.severity as SecurityRisk['severity']) || 'low',
          location: { file: 'current', line: (r.location as { line?: number } | null)?.line || 0 },
          description: (r.description as string) || '',
          recommendation: (r.recommendation as string) || '',
        });
      }
    });
  }

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    traverse(ast, {
      AssignmentExpression(path) {
        const left = path.node.left;
        const line = path.node.loc?.start.line || 0;

        if (t.isMemberExpression(left) && t.isIdentifier(left.property)) {
          const propName = left.property.name;

          if (['innerHTML', 'outerHTML', 'insertAdjacentHTML'].includes(propName)) {
            risks.push({
              type: 'xss',
              severity: 'high',
              location: { file: 'current', line },
              description: `Potential XSS vulnerability: Direct assignment to ${propName} without sanitization`,
              recommendation:
                'Use textContent for plain text, or DOMPurify.sanitize() for HTML content',
            });
          }

          if (
            propName === 'write' &&
            t.isIdentifier(left.object) &&
            left.object.name === 'document'
          ) {
            risks.push({
              type: 'xss',
              severity: 'high',
              location: { file: 'current', line },
              description: 'Dangerous use of document.write() which can lead to XSS',
              recommendation: 'Use modern DOM manipulation methods instead',
            });
          }

          // Prototype pollution: obj.__proto__ = val or obj.constructor.prototype.x = val
          const assignFullName = getMemberExpressionName(left);
          if (
            propName === '__proto__' ||
            /(^|\.)constructor\.prototype(\.|$)/.test(assignFullName)
          ) {
            risks.push({
              type: 'prototype-pollution',
              severity: 'high',
              location: { file: 'current', line },
              description: `Potential prototype pollution: assignment to ${assignFullName}`,
              recommendation:
                'Avoid __proto__/constructor.prototype assignment; use Object.create(null) or Map for untrusted keys',
            });
          }

          // Open redirect: location.href/assign/replace = non-literal
          if (/^location\.(href|assign|replace)$/i.test(assignFullName)) {
            const right = path.node.right;
            if (!t.isStringLiteral(right) && !t.isNumericLiteral(right)) {
              risks.push({
                type: 'open-redirect',
                severity: 'high',
                location: { file: 'current', line },
                description: `Potential open redirect: ${assignFullName} assigned a non-literal value`,
                recommendation: 'Validate redirect targets against an allowlist of trusted origins',
              });
            }
          }
        }
      },

      CallExpression(path) {
        const line = path.node.loc?.start.line || 0;
        risks.push(...analyzeCallExpression(path.node, line));
      },

      MemberExpression(path) {
        const obj = path.node.object;
        const prop = path.node.property;
        const line = path.node.loc?.start.line || 0;

        if (
          t.isIdentifier(obj) &&
          obj.name === 'Math' &&
          t.isIdentifier(prop) &&
          prop.name === 'random'
        ) {
          const parent = path.parent;
          if (t.isCallExpression(parent) || t.isBinaryExpression(parent)) {
            risks.push({
              type: 'other',
              severity: 'medium',
              location: { file: 'current', line },
              description: 'Math.random() is not cryptographically secure',
              recommendation:
                'Use crypto.getRandomValues() or crypto.randomBytes() for security-sensitive operations',
            });
          }
        }
      },

      VariableDeclarator(path) {
        const id = path.node.id;
        const init = path.node.init;
        const line = path.node.loc?.start.line || 0;

        if (t.isIdentifier(id) && t.isStringLiteral(init)) {
          const varName = id.name.toLowerCase();
          const value = init.value;

          const sensitivePatterns = [
            { pattern: /(password|passwd|pwd)/i, type: 'password' },
            { pattern: /(api[_-]?key|apikey)/i, type: 'API key' },
            { pattern: /(secret|token|auth)/i, type: 'secret' },
            { pattern: /(private[_-]?key|privatekey)/i, type: 'private key' },
          ];

          for (const { pattern, type } of sensitivePatterns) {
            if (pattern.test(varName) && value.length > 8) {
              risks.push({
                type: 'other',
                severity: 'critical',
                location: { file: 'current', line },
                description: `Hardcoded ${type} detected in source code`,
                recommendation: `Store ${type} in environment variables or secure configuration`,
              });
              break;
            }
          }
        }
      },
    });
  } catch (error) {
    logger.warn('Static security analysis failed', error);
  }

  const uniqueRisks = risks.filter(
    (risk, index, self) =>
      index ===
      self.findIndex((r) => r.type === risk.type && r.location.line === risk.location.line),
  );

  return uniqueRisks;
}
