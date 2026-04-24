import { ExecutionSandbox } from '@modules/security/ExecutionSandbox';
import { detectSelfDefending } from '@modules/deobfuscator/AntiDebugEvasion';

export interface JSDefenderResult {
  code: string;
  removed: number;
  warnings: string[];
}

interface ConsoleInterceptionInfo {
  wrapperName: string;
  originalCalls: string[];
}

function detectConsoleInterception(code: string): ConsoleInterceptionInfo | null {
  const interceptionPatterns = [
    /var\s+(\w+)\s*=\s*console\.log\s*,\s*console\.log\s*=\s*function/,
    /console\.log\s*=\s*function\s*\([^)]*\)\s*\{\s*[^}]*\.apply\s*\([^,]+,\s*\[\s*"?[^"]+"?\s*\]\s*\)/,
    /Object\.defineProperty\s*\(\s*console\s*,\s*"log"\s*,\s*\{/,
    /console\s*=\s*\{\s*\.\.\.console\s*,\s*log\s*:\s*function/,
  ];

  for (const pattern of interceptionPatterns) {
    const match = code.match(pattern);
    if (match) {
      return {
        wrapperName: match[1] ?? 'intercepted_console',
        originalCalls: ['log', 'warn', 'error', 'info', 'debug'],
      };
    }
  }
  return null;
}

function detectFunctionCloning(code: string): string[] {
  const clonePatterns = [
    /function\s+(\w+)\s*\([^)]*\)\s*\{[\s\S]*?_0x\w+\s*&&\s*_0x\w+\s*\(/,
    /var\s+(\w+)\s*=\s*function\s*\([^)]*\)\s*\{[\s\S]*?return\s+_0x\w+\s*\(/,
    /(\w+)\s*=\s*function\s*\([^)]*\)\s*\{\s*try\s*\{[\s\S]*?_0x\w+\(["\']?[\w]+["\']?\)/,
  ];

  const clones: string[] = [];
  for (const pattern of clonePatterns) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(code)) !== null) {
      const fnName = match[1];
      if (fnName && !clones.includes(fnName)) {
        clones.push(fnName);
      }
    }
  }
  return clones;
}

function detectEncryptedValueTables(code: string): { name: string; values: string[] }[] {
  const tables: { name: string; values: string[] }[] = [];

  const tablePatterns = [
    /var\s+(\w+)\s*=\s*\[([\s\S]*?)\];/g,
    /let\s+(\w+)\s*=\s*\[([\s\S]*?)\];/g,
    /const\s+(\w+)\s*=\s*\[([\s\S]*?)\];/g,
  ];

  for (const pattern of tablePatterns) {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      const name = match[1] ?? '';
      const rawValues = match[2] ?? '';

      if (rawValues && rawValues.split(',').length > 2) {
        const stringLiteralCount = (rawValues.match(/["'`][^"'`]*["'`]/g) ?? []).length;
        const hexLiteralCount = (rawValues.match(/0x[0-9a-fA-F]+/gi) ?? []).length;

        if (stringLiteralCount > 2 || hexLiteralCount > 2) {
          const values = rawValues
            .split(',')
            .map((v: string) => v.trim())
            .filter((v: string) => v.length > 0);
          tables.push({ name, values });
        }
      }
    }
  }

  return tables;
}

function detectSelfDefendingChecks(code: string): string[] {
  const checks: string[] = [];

  const selfDefendPatterns = [
    /function\s+(\w+)\s*\(\s*\)\s*\{\s*if\s*\([^)]*===[^)]*\)\s*throw/,
    /if\s*\(\s*!?\w+\s*&&\s*\w+\s*!==\s*["'][^"']+["']\s*\)\s*\{[^}]*throw/,
    /while\s*\(\s*!?\w+\s*\)\s*\{[^}]*console[^}]*\}/,
  ];

  for (const pattern of selfDefendPatterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    const match = code.match(regex);
    if (match) {
      checks.push(match[0]);
    }
  }

  return checks;
}

function removeConsoleInterception(code: string, info: ConsoleInterceptionInfo): string {
  let result = code;

  const wrapperRestorePatterns = [
    new RegExp(`var\\s+${info.wrapperName}\\s*=\\s*console\\.log\\s*,\\s*console\\.log\\s*=\\s*function\\s*\\([^)]*\\)\\s*\\{[^}]*\\}\\s*;?`, 'g'),
    new RegExp(`console\\.log\\s*=\\s*function\\s*\\([^)]*\\)\\s*\\{[^}]*\\}\\s*;?`, 'g'),
    new RegExp(`Object\\.defineProperty\\s*\\(\\s*console\\s*,\\s*"log"\\s*,\\s*\\{[^}]*\\}\\s*\\)\\s*;?`, 'g'),
  ];

  for (const pattern of wrapperRestorePatterns) {
    result = result.replace(pattern, '');
  }

  result = result.replace(new RegExp(`console\\.log\\s*=\\s*${info.wrapperName}`, 'g'), '');

  return result;
}

function removeFunctionCloning(code: string, clones: string[]): string {
  let result = code;

  for (const fnName of clones) {
    const clonePattern = new RegExp(
      `var\\s+${fnName}\\s*=\\s*function\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?return\\s+${fnName}\\s*\\([^)]*\\)\\s*;?[\\s\\S]*?\\}` +
      `|function\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?return\\s+${fnName}\\s*\\([^)]*\\)\\s*;?[\\s\\S]*?\\}` +
      `|${fnName}\\s*=\\s*function\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\}`,
      'g',
    );
    result = result.replace(clonePattern, '');
  }

  return result;
}

async function evaluateEncryptedTable(table: { name: string; values: string[] }, sandbox: ExecutionSandbox): Promise<Map<number, string> | null> {
  if (table.values.length === 0) return null;

  const arrayLiteral = `[${table.values.join(',')}]`;

  const evalCode = `
    try {
      var __arr = ${arrayLiteral};
      var __result = __arr.map(function(v) {
        if (typeof v === 'string' && v.startsWith('_0x')) return v;
        if (typeof v === 'number') return String.fromCharCode(v);
        return v;
      });
      return JSON.stringify(__result);
    } catch(e) {
      return 'ERROR';
    }
  `;

  try {
    const result = await sandbox.execute({ code: evalCode, timeoutMs: 5000 });
    if (result.ok && typeof result.output === 'string' && result.output !== 'ERROR') {
      try {
        const parsed = JSON.parse(result.output) as string[];
        const map = new Map<number, string>();
        parsed.forEach((v, i) => map.set(i, v));
        return map;
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function replaceValueTableAccesses(code: string, tableName: string, tableMap: Map<number, string>): string {
  let result = code;

  const accessPatterns = [
    new RegExp(`${tableName}\\[(\\d+)\\]`, 'g'),
    new RegExp(`${tableName}\\s*\\[\\s*(\\d+)\\s*\\]`, 'g'),
  ];

  for (const pattern of accessPatterns) {
    result = result.replace(pattern, (_m, index: string) => {
      const idx = parseInt(index, 10);
      const value = tableMap.get(idx);
      if (value !== undefined) {
        return `"${value}"`;
      }
      return _m;
    });
  }

  return result;
}

export async function neutralizeJSDefender(code: string): Promise<JSDefenderResult> {
  const warnings: string[] = [];
  let removed = 0;
  let result = code;

  const consoleInfo = detectConsoleInterception(result);
  if (consoleInfo) {
    warnings.push(`Detected console interposition: wrapper="${consoleInfo.wrapperName}"`);
    const before = result.length;
    result = removeConsoleInterception(result, consoleInfo);
    removed += before - result.length;
  }

  const clones = detectFunctionCloning(result);
  if (clones.length > 0) {
    warnings.push(`Detected function cloning: ${clones.join(', ')}`);
    const before = result.length;
    result = removeFunctionCloning(result, clones);
    removed += before - result.length;
  }

  const tables = detectEncryptedValueTables(result);
  if (tables.length > 0) {
    warnings.push(`Detected encrypted value tables: ${tables.map((t) => `${t.name}(${t.values.length})`).join(', ')}`);
    const sandbox = new ExecutionSandbox();

    for (const table of tables) {
      const evaluated = await evaluateEncryptedTable(table, sandbox);
      if (evaluated) {
        const before = result.length;
        result = replaceValueTableAccesses(result, table.name, evaluated);
        removed += before - result.length;
      }
    }
  }

  const selfDefendChecks = detectSelfDefendingChecks(result);
  if (selfDefendChecks.length > 0) {
    if (detectSelfDefending(result)) {
      warnings.push(`Detected JSDefender self-defending code`);
    }
  }

  return { code: result, removed, warnings };
}

export function detectJSDefenderPatterns(code: string): { pattern: string; confidence: number }[] {
  const detections: { pattern: string; confidence: number }[] = [];

  const consoleInfo = detectConsoleInterception(code);
  if (consoleInfo) {
    detections.push({ pattern: 'console-interception', confidence: 0.8 });
  }

  const clones = detectFunctionCloning(code);
  if (clones.length > 0) {
    detections.push({ pattern: 'function-cloning', confidence: 0.85 });
  }

  const tables = detectEncryptedValueTables(code);
  if (tables.length > 0) {
    detections.push({ pattern: 'encrypted-value-tables', confidence: 0.75 });
  }

  if (detectSelfDefendingChecks(code).length > 0) {
    detections.push({ pattern: 'self-defending-checks', confidence: 0.7 });
  }

  if (code.includes('toString') && code.includes('charCodeAt') && tables.length > 0) {
    detections.push({ pattern: 'charcode-obfuscation', confidence: 0.6 });
  }

  if (code.includes('hashCode') || code.includes('_0x') && code.match(/_0x[a-f0-9]{8,}/)) {
    detections.push({ pattern: 'hash-preserving-clone', confidence: 0.7 });
  }

  return detections;
}
