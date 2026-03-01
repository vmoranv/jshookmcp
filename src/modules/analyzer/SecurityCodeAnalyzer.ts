import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import type { SecurityRisk } from '../../types/index.js';
import { logger } from '../../utils/logger.js';

export function getMemberExpressionName(node: t.MemberExpression): string {
  const parts: string[] = [];

  let current: t.Expression | t.PrivateName = node;
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

export function identifySecurityRisks(
  code: string,
  aiAnalysis: Record<string, unknown>
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
        }
      },

      CallExpression(path) {
        const callee = path.node.callee;
        const line = path.node.loc?.start.line || 0;

        if (t.isIdentifier(callee)) {
          if (callee.name === 'eval') {
            risks.push({
              type: 'other',
              severity: 'critical',
              location: { file: 'current', line },
              description: 'Critical: Use of eval() allows arbitrary code execution',
              recommendation:
                'Refactor to avoid eval(). Use JSON.parse() for data, or proper function calls',
            });
          }

          if (callee.name === 'Function') {
            risks.push({
              type: 'other',
              severity: 'critical',
              location: { file: 'current', line },
              description: 'Critical: Function constructor allows code injection',
              recommendation: 'Use regular function declarations or arrow functions',
            });
          }

          if (['setTimeout', 'setInterval'].includes(callee.name)) {
            const firstArg = path.node.arguments[0];
            if (
              t.isStringLiteral(firstArg) ||
              (t.isIdentifier(firstArg) && firstArg.name !== 'function')
            ) {
              risks.push({
                type: 'other',
                severity: 'medium',
                location: { file: 'current', line },
                description: `${callee.name}() with string argument can lead to code injection`,
                recommendation: `Use ${callee.name}() with function reference instead of string`,
              });
            }
          }
        }

        if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
          const methodName = callee.property.name;

          if (['query', 'execute', 'exec', 'run'].includes(methodName)) {
            const firstArg = path.node.arguments[0];

            if (t.isBinaryExpression(firstArg) || t.isTemplateLiteral(firstArg)) {
              risks.push({
                type: 'sql-injection',
                severity: 'critical',
                location: { file: 'current', line },
                description: 'Potential SQL injection: Query built with string concatenation',
                recommendation: 'Use parameterized queries or prepared statements',
              });
            }
          }
        }
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
      self.findIndex((r) => r.type === risk.type && r.location.line === risk.location.line)
  );

  return uniqueRisks;
}
