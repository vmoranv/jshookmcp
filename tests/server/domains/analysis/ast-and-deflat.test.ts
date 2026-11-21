import { describe, expect, it, vi } from 'vitest';
import { CoreAnalysisHandlers } from '@server/domains/analysis/handlers';
import type { Deobfuscator } from '@modules/deobfuscator/Deobfuscator';
import type { AdvancedDeobfuscator } from '@modules/deobfuscator/AdvancedDeobfuscator';
import type { ObfuscationDetector } from '@modules/detector/ObfuscationDetector';
import type { CodeAnalyzer } from '@modules/analyzer/CodeAnalyzer';
import type { CryptoDetector } from '@modules/crypto/CryptoDetector';
import type { HookManager } from '@modules/hook/HookManager';
import type { CodeCollector } from '@server/domains/shared/modules/collector';
import type { ScriptManager } from '@modules/debugger/ScriptManager';
import type { LLMSamplingBridge } from '@server/LLMSamplingBridge';
import type { JScramberDeobfuscator } from '@modules/deobfuscator/JScramblerDeobfuscator';
import type { UniversalUnpacker } from '@modules/deobfuscator/PackerDeobfuscator';
import type { VMDeobfuscator } from '@modules/deobfuscator/VMDeobfuscator';

function parseJson(response: {
  content: Array<{ type: string; text?: string }>;
}): Record<string, unknown> {
  return JSON.parse(response.content[0]?.text ?? '{}') as Record<string, unknown>;
}

const stubDeps = {
  collector: {} as CodeCollector,
  scriptManager: {} as ScriptManager,
  deobfuscator: {} as Deobfuscator,
  advancedDeobfuscator: {} as AdvancedDeobfuscator,
  obfuscationDetector: {
    detect: () => ({ techniques: [] }),
    generateReport: () => '',
  } as unknown as ObfuscationDetector,
  analyzer: {} as CodeAnalyzer,
  cryptoDetector: {} as CryptoDetector,
  hookManager: {} as HookManager,
  samplingBridge: {
    isSamplingSupported: vi.fn().mockReturnValue(false),
    sampleText: vi.fn(),
  } as unknown as LLMSamplingBridge,
  jscramblerDeobfuscator: { deobfuscate: vi.fn() } as unknown as JScramberDeobfuscator,
  packerDeobfuscator: { deobfuscate: vi.fn() } as unknown as UniversalUnpacker,
  vmDeobfuscator: {
    detectVMProtection: vi.fn(),
    deobfuscateVM: vi.fn(),
  } as unknown as VMDeobfuscator,
};

const handler = new CoreAnalysisHandlers(stubDeps);

const code = `
eval("console.log('hello')");
function foo() { eval("x"); }
document.getElementById("test");
window.location.href = "http://example.com";
`.trim();

describe('analysis_ast_match', () => {
  it('finds CallExpression nodes', async () => {
    const res = await handler.handleAnalysisAstMatch({
      code,
      nodeType: 'CallExpression',
    });
    const json = parseJson(res);
    expect(json.success).toBe(true);
    expect(json.total).toBeGreaterThanOrEqual(3);
  });

  it('filters by callee.name', async () => {
    const res = await handler.handleAnalysisAstMatch({
      code,
      nodeType: 'CallExpression',
      filter: JSON.stringify({ 'callee.name': 'eval' }),
    });
    const json = parseJson(res);
    expect(json.success).toBe(true);
    expect(json.total).toBe(2);
    const matches = json.matches as Array<{ code: string }>;
    for (const m of matches) {
      expect(m.code).toContain('eval');
    }
  });

  it('finds MemberExpression nodes', async () => {
    const res = await handler.handleAnalysisAstMatch({
      code,
      nodeType: 'MemberExpression',
    });
    const json = parseJson(res);
    expect(json.success).toBe(true);
    expect(json.total).toBeGreaterThanOrEqual(1);
  });

  it('requires code', async () => {
    const res = await handler.handleAnalysisAstMatch({ nodeType: 'CallExpression' });
    const json = parseJson(res);
    expect(json.success).toBe(false);
    expect(json.error).toContain('code is required');
  });

  it('requires nodeType', async () => {
    const res = await handler.handleAnalysisAstMatch({ code: 'var x = 1;' });
    const json = parseJson(res);
    expect(json.success).toBe(false);
    expect(json.error).toContain('nodeType is required');
  });

  it('returns empty matches for nonexistent type', async () => {
    const res = await handler.handleAnalysisAstMatch({
      code: 'var x = 1;',
      nodeType: 'FakeNodeType',
    });
    const json = parseJson(res);
    expect(json.success).toBe(true);
    expect(json.total).toBe(0);
  });

  it('respects maxResults', async () => {
    const res = await handler.handleAnalysisAstMatch({
      code: 'a.b; c.d; e.f; g.h; i.j;',
      nodeType: 'MemberExpression',
      maxResults: 2,
    });
    const json = parseJson(res);
    expect(json.success).toBe(true);
    expect(json.total).toBe(2);
  });

  it('rejects invalid JSON filter', async () => {
    const res = await handler.handleAnalysisAstMatch({
      code: 'eval("x")',
      nodeType: 'CallExpression',
      filter: 'not-json',
    });
    const json = parseJson(res);
    expect(json.success).toBe(false);
    expect(json.error).toContain('valid JSON');
  });

  it('reports parse errors', async () => {
    const res = await handler.handleAnalysisAstMatch({
      code: 'function { invalid syntax',
      nodeType: 'FunctionDeclaration',
    });
    const json = parseJson(res);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Parse error');
  });
});

describe('analysis_deflat_control_flow', () => {
  it('flattens a simple CFF while/switch/dispatcher', async () => {
    const cffCode = `
var _0x = "a|b|c".split("|");
var _0i = 0;
while (true) {
  switch (_0x[_0i++]) {
    case "a": console.log("first"); break;
    case "b": console.log("second"); break;
    case "c": console.log("third"); break;
  }
  break;
}`.trim();

    const res = await handler.handleAnalysisDeflatControlFlow({ code: cffCode });
    const json = parseJson(res);
    expect(json.success).toBe(true);
    expect(json.flattenedCount).toBe(1);
    const output = json.code as string;
    expect(output).toContain('first');
    expect(output).toContain('second');
    expect(output).toContain('third');
    expect(output).not.toContain('while');
  });

  it('returns code unchanged when no CFF pattern found', async () => {
    const plainCode = 'console.log("hello");';
    const res = await handler.handleAnalysisDeflatControlFlow({ code: plainCode });
    const json = parseJson(res);
    expect(json.success).toBe(true);
    expect(json.flattenedCount).toBe(0);
  });

  it('requires code', async () => {
    const res = await handler.handleAnalysisDeflatControlFlow({});
    const json = parseJson(res);
    expect(json.success).toBe(false);
    expect(json.error).toContain('code is required');
  });

  it('reports parse errors', async () => {
    const res = await handler.handleAnalysisDeflatControlFlow({
      code: 'function { broken',
    });
    const json = parseJson(res);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Parse error');
  });

  it('handles dispatcher array assigned after declaration', async () => {
    const cffCode = `
var _0x;
_0x = "a|b".split("|");
var _0i = 0;
while (true) {
  switch (_0x[_0i++]) {
    case "a": console.log("first"); break;
    case "b": console.log("second"); break;
  }
  break;
}`.trim();

    const res = await handler.handleAnalysisDeflatControlFlow({ code: cffCode });
    const json = parseJson(res);
    expect(json.success).toBe(true);
    expect(json.flattenedCount).toBe(1);
    expect(json.code).toContain('first');
    expect(json.code).toContain('second');
  });

  it('only removes dispatcher bindings from the flattened loop scope', async () => {
    const cffCode = `
function outer() {
  var _0x = "a|b".split("|");
  var _0i = 0;
  while (true) {
    switch (_0x[_0i++]) {
      case "a": console.log("first"); continue;
      case "b": console.log("second"); break;
    }
    break;
  }
}
function sibling() {
  var _0x = ["keep"];
  var _0i = 1;
  return _0x[_0i - 1];
}`.trim();

    const res = await handler.handleAnalysisDeflatControlFlow({
      code: cffCode,
      removeDispatcher: true,
    });
    const json = parseJson(res);
    expect(json.success).toBe(true);
    expect(json.flattenedCount).toBe(1);
    expect(json.dispatchersRemoved).toBe(2);
    const output = json.code as string;
    expect(output).toContain('console.log("first");');
    expect(output).toContain('console.log("second");');
    expect(output).toContain('function sibling()');
    expect(output).toContain('var _0x = ["keep"];');
    expect(output).toContain('var _0i = 1;');
  });
});

describe('analysis_decode_string_array', () => {
  it('decodes simple string array lookups', async () => {
    const input = `
var _0x = ["alpha", "beta"];
console.log(_0x(0), _0x("1"));
`.trim();

    const res = await handler.handleAnalysisDecodeStringArray({ code: input });
    const json = parseJson(res);
    expect(json.success).toBe(true);
    expect(json.replacedCount).toBe(2);
    expect(json.code).toContain('"alpha"');
    expect(json.code).toContain('"beta"');
  });

  it('respects maxReplacements', async () => {
    const input = `
var _0x = ["alpha", "beta"];
console.log(_0x(0), _0x(1));
`.trim();

    const res = await handler.handleAnalysisDecodeStringArray({
      code: input,
      maxReplacements: 1,
    });
    const json = parseJson(res);
    expect(json.success).toBe(true);
    expect(json.replacedCount).toBe(1);
  });

  it('requires code', async () => {
    const res = await handler.handleAnalysisDecodeStringArray({});
    const json = parseJson(res);
    expect(json.success).toBe(false);
    expect(json.error).toContain('code is required');
  });

  it('reports parse errors', async () => {
    const res = await handler.handleAnalysisDecodeStringArray({ code: 'function {' });
    const json = parseJson(res);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Parse error');
  });
});
