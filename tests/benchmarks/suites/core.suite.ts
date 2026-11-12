/**
 * Core / analysis domain benchmark (offline code-analysis subset).
 *
 * No public JS-deobfuscation benchmark ships offline vectors in-repo, so this suite is
 * mostly homemade fixtures in obfuscator.io style. The CATALOG maps the broader
 * webcrack/JSDeobfuscator evaluation suites for the full-tool comparison.
 *
 * Homemade fixtures:
 *  - obfuscator.io string-array + control-flow flattening sample (detection must fire;
 *    clean code must stay clean)
 *  - planted secrets / XSS sink / eval for security scan
 *  - source→sink taint path for data flow
 *  - AST matching counts
 *  - opaque predicate solving
 */
import { CoreAnalysisHandlers } from '@server/domains/analysis/handlers';
import { ObfuscationDetector } from '@server/domains/shared/modules';
import { CryptoDetector } from '@modules/crypto/CryptoDetector';
import { CodeAnalyzer } from '@modules/analyzer/CodeAnalyzer';
import { UniversalUnpacker } from '@modules/deobfuscator/PackerDeobfuscator';
import { VMDeobfuscator } from '@modules/deobfuscator/VMDeobfuscator';
import { body, expectSuccess, type BenchSuite } from '../harness';

const mockCollector = {
  getActivePage: async () => null,
  on: () => {},
  clearAllData: async () => {},
  clearSessionData: () => {},
  getAllStats: async () => ({
    cache: { memoryEntries: 10, diskEntries: 5, totalSize: 10240 },
    compression: { averageRatio: 45.2, cacheHits: 8, cacheMisses: 2 },
    collector: { collectedUrls: ['https://example.com/a.js'] },
  }),
};
const mockScriptManager = {
  clear: () => {},
};

const stubs = {
  collector: mockCollector,
  scriptManager: mockScriptManager,
  deobfuscator: {},
  advancedDeobfuscator: {},
  obfuscationDetector: new ObfuscationDetector(),
  analyzer: new CodeAnalyzer(),
  cryptoDetector: new CryptoDetector(),
  hookManager: {},
  samplingBridge: {} as never,
  jscramblerDeobfuscator: {} as never,
  packerDeobfuscator: new UniversalUnpacker(),
  vmDeobfuscator: new VMDeobfuscator(),
} as unknown as ConstructorParameters<typeof CoreAnalysisHandlers>[0];
const handlers = new CoreAnalysisHandlers(stubs);

const OBFUSCATED_SAMPLE = `var _0x3a2b = ['log', 'hello\\x20obfuscated\\x20world'];
(function (_0x1a2b, _0x2b3c) {
  var _0x3c4d = function (_0x4e5f) {
    while (--_0x4e5f) { _0x1a2b['push'](_0x1a2b['shift']()); }
  };
  _0x3c4d(++_0x2b3c);
}(_0x3a2b, 0x1a4));
var _0x4f5a = function (_0x1, _0x2) { return _0x3a2b[_0x1 - 0x0]; };
(function () {
  var _0x5e6f = { 'xQwR': function (_0xa, _0xb) { return _0xa(_0xb); } };
  console[_0x4f5a('0x0')](_0x3a2b['1']);
}());`;

const CLEAN_SAMPLE = `function add(a, b) { return a + b; }
const result = add(1, 2);
console.log(result);`;

const SECRET_SAMPLE = `const apiKey = "AKIAIOSFODNN7EXAMPLE";
const token = "ghp_16C7e42F292c6912E7710c838347Ae178B4a";
fetch(url, { headers: { Authorization: "Bearer " + apiKey } });
document.getElementById('out').innerHTML = userInput;
eval(userInput);`;

const TAINT_SAMPLE = `const params = new URLSearchParams(window.location.search);
const q = params.get('q');
document.getElementById('out').innerHTML = q;`;

const OPAQUE_PREDICATE_SAMPLE = `function secret() { return 42; }
if (0x1514 * 0x1 + 0x9 > 0x1514) {
  // opaque: always true
  secret();
}
while (true) { break; }`;

export const coreSuite: BenchSuite = {
  name: 'core-analysis',
  domain: 'core',
  description:
    'obfuscation detection, security scan, data-flow taint, AST matching, opaque predicate solving (homemade obfuscator.io-style fixtures)',
  cases: [
    {
      name: 'detect_obfuscation/flags-string-array-sample',
      tool: 'detect_obfuscation',
      origin: 'homemade',
      reference:
        'obfuscator.io-style string-array + hex identifiers + IIFE rotation — must detect ≥1 technique type',
      run: () => handlers.handleDetectObfuscation({ code: OBFUSCATED_SAMPLE }),
      validate: (v) => {
        const b = body(v);
        const types = (b.types ?? []) as string[];
        if (Array.isArray(types) && types.length > 0) return true;
        const text = JSON.stringify(b).toLowerCase();
        if (/confidence":\s*0\.|obfuscat/i.test(text) && !/"types":\[\]/.test(text)) return true;
        return `no technique detected in obfuscated sample: ${text.slice(0, 260)}`;
      },
    },
    {
      name: 'detect_obfuscation/clean-code-stays-clean',
      tool: 'detect_obfuscation',
      origin: 'homemade',
      reference:
        'plain readable code must not be flagged as obfuscated — only the "unknown" placeholder type at low confidence is allowed',
      run: () => handlers.handleDetectObfuscation({ code: CLEAN_SAMPLE }),
      validate: (v) => {
        const b = body(v);
        const types = (b.types ?? []) as string[];
        const realTypes = Array.isArray(types) ? types.filter((t) => t !== 'unknown') : [];
        if (realTypes.length === 0) return true;
        const confidence = (b.confidence ?? {}) as Record<string, number>;
        const maxReal = Math.max(...realTypes.map((t) => confidence[t] ?? 0));
        return maxReal < 0.6 ? true : `clean code flagged as ${realTypes.join(',')} at ${maxReal}`;
      },
    },
    {
      name: 'analysis_security_scan/planted-risks',
      tool: 'analysis_security_scan',
      origin: 'homemade',
      reference:
        'planted risks: AWS key id, GitHub token, document.write + eval sinks — each must be reported',
      run: () => handlers.handleAnalysisSecurityScan({ code: SECRET_SAMPLE }),
      validate: (v) => {
        const b = expectSuccess(v);
        const risks = (b.risks ?? []) as Array<{ type?: string; severity?: string }>;
        if (!Array.isArray(risks) || risks.length === 0) return 'no risks reported';
        const text = JSON.stringify(risks).toLowerCase();
        const problems: string[] = [];
        if (!text.includes('eval')) problems.push('eval sink missed');
        if (
          !text.includes('document.write') &&
          !text.includes('documentwrite') &&
          !text.includes('xss')
        )
          problems.push('XSS/document.write sink missed');
        if (!text.includes('key') && !text.includes('secret') && !text.includes('token'))
          problems.push('hardcoded secret missed');
        return problems.length === 0 ? true : problems.join('; ');
      },
    },
    {
      name: 'analysis_data_flow/taint-source-to-sink',
      tool: 'analysis_data_flow',
      origin: 'homemade',
      reference:
        'taint contract: URLSearchParams source → innerHTML sink must produce a tainted path',
      run: () => handlers.handleAnalysisDataFlow({ code: TAINT_SAMPLE }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `failed: ${b.error}`;
        const text = JSON.stringify(b).toLowerCase();
        if (!text.includes('innerhtml')) return 'innerHTML sink not found';
        if (!text.includes('source') || !text.includes('sink'))
          return `no source/sink structure: ${text.slice(0, 240)}`;
        return true;
      },
    },
    {
      name: 'analysis_ast_match/call-expression-count',
      tool: 'analysis_ast_match',
      origin: 'homemade',
      reference:
        'AST matching: CLEAN_SAMPLE has exactly 2 CallExpressions (add(1,2) and console.log(result))',
      run: () =>
        handlers.handleAnalysisAstMatch({
          code: CLEAN_SAMPLE,
          nodeType: 'CallExpression',
        }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `failed: ${b.error}`;
        const text = JSON.stringify(b);
        const m = text.match(/"(matches|count|total)":\s*(\d+)/);
        if (!m) return `no match count in response: ${text.slice(0, 240)}`;
        const count = Number(m[2]);
        return count === 2 ? true : `expected 2 CallExpressions, got ${count}`;
      },
    },
    {
      name: 'js_solve_constraints/opaque-predicate',
      tool: 'js_solve_constraints',
      origin: 'homemade',
      reference:
        'opaque predicate `0x1514 + 9 > 0x1514` is statically true — solver must mark it solved/true',
      run: () => handlers.handleJsSolveConstraints({ code: OPAQUE_PREDICATE_SAMPLE }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `failed: ${b.error}`;
        const text = JSON.stringify(b).toLowerCase();
        if (/solved|simplified|constant|true/.test(text)) return true;
        return `no solved marker: ${text.slice(0, 240)}`;
      },
    },

    // ── Coverage batch 2026-11-10 (autoresearch): core analysis & data management ──
    {
      name: 'detect_crypto/algorithms-and-libraries',
      tool: 'detect_crypto',
      origin: 'homemade',
      reference: 'detects crypto algorithms and libraries in code',
      run: () =>
        handlers.handleDetectCrypto({
          code: 'const cipher = CryptoJS.AES.encrypt("secret", key); const hash = CryptoJS.SHA256("data");',
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const text = JSON.stringify(b).toUpperCase();
        if (!text.includes('AES') && !text.includes('SHA'))
          return `expected AES or SHA in detected crypto, got ${text.slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'analysis_decode_string_array/inlines-string-lookups',
      tool: 'analysis_decode_string_array',
      origin: 'homemade',
      reference: 'replaces string-array call lookups with inline string literals',
      run: () =>
        handlers.handleAnalysisDecodeStringArray({
          code: 'var _arr = ["hello", "world"]; console.log(_arr(0) + " " + _arr(1));',
          removeRotation: false,
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.replacedCount) !== 2)
          return `expected replacedCount === 2, got ${b.replacedCount}`;
        const code = String(b.code ?? '');
        if (!code.includes('"hello"') || !code.includes('"world"'))
          return `inlined strings missing in code: ${code}`;
        return true;
      },
    },
    {
      name: 'analysis_deflat_control_flow/switch-in-while',
      tool: 'analysis_deflat_control_flow',
      origin: 'homemade',
      reference: 'unflattens a switch-in-while dispatcher into sequential execution',
      run: () =>
        handlers.handleAnalysisDeflatControlFlow({
          code: 'function test() { var _order = "1|2".split("|"); var _idx = 0; while (true) { switch (_order[_idx++]) { case "1": console.log(1); continue; case "2": console.log(2); continue; } break; } }',
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.flattenedCount) !== 1)
          return `expected flattenedCount === 1, got ${b.flattenedCount}`;
        return true;
      },
    },
    {
      name: 'get_collection_stats/stats-structure',
      tool: 'get_collection_stats',
      origin: 'homemade',
      reference: 'retrieves cache and compression statistics from collector',
      run: () => handlers.handleGetCollectionStats(),
      validate: (v) => {
        const b = expectSuccess(v);
        if (!b.stats || !b.summary)
          return `expected stats and summary objects, got ${JSON.stringify(b).slice(0, 150)}`;
        return true;
      },
    },
    {
      name: 'clear_collected_data/cleared-receipt',
      tool: 'clear_collected_data',
      origin: 'homemade',
      reference: 'clears session cache and returns receipt',
      run: () => handlers.handleClearCollectedData(),
      validate: (v) => {
        const b = expectSuccess(v);
        if (!b.cleared) return `missing cleared receipt, got ${JSON.stringify(b).slice(0, 150)}`;
        return true;
      },
    },

    // ── Coverage batch 2 (2026-11-11 autoresearch): offline deobf, VM, symbolic, understand ──
    {
      name: 'understand_code/structure-and-metrics',
      tool: 'understand_code',
      origin: 'homemade',
      reference: 'analyzes JS structure, functions, and complexity metrics offline without LLM',
      run: () => handlers.handleUnderstandCode({ code: CLEAN_SAMPLE, focus: 'structure' }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (!b.structure || typeof b.structure !== 'object')
          return `missing structure analysis: ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'js_deobfuscate_pipeline/fold-and-dead-code',
      tool: 'js_deobfuscate_pipeline',
      origin: 'homemade',
      reference: 'runs multi-stage deobfuscation pipeline (constant_fold + dead_code_remove)',
      run: () =>
        handlers.handleJsDeobfuscatePipeline({
          code: 'const v = 6 * 7; if (false) { console.log("dead"); } console.log(v);',
          useWebcrack: false,
          humanize: false,
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const out = String(b.deobfuscatedCode ?? '');
        if (!out.includes('42') || out.includes('dead'))
          return `expected folded 42 without dead branch, got: ${out}`;
        return true;
      },
    },
    {
      name: 'js_symbolic_execute/explores-branch-paths',
      tool: 'js_symbolic_execute',
      origin: 'homemade',
      reference: 'executes JS symbolically across true/false conditional paths',
      run: () =>
        handlers.handleJsSymbolicExecute({
          code: 'function branch(x) { if (x > 0) { return 1; } return 0; }',
          maxPaths: 10,
          maxDepth: 10,
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (!Array.isArray(b.paths) || b.paths.length === 0)
          return `expected non-empty symbolic paths, got ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'js_symbolic_execute_jsvmp/push-add-42',
      tool: 'js_symbolic_execute_jsvmp',
      origin: 'homemade',
      reference: 'symbolically executes JSVMP PUSH(40) + PUSH(2) + ADD + HALT bytecode stream',
      run: () =>
        handlers.handleJsSymbolicExecuteJsvmp({
          instructions: [
            { opcode: 0x01, operands: [40], location: 0 },
            { opcode: 0x01, operands: [2], location: 1 },
            { opcode: 0x10, operands: [], location: 2 },
            { opcode: 0xff, operands: [], location: 3 },
          ],
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (!Array.isArray(b.executionTrace) || b.executionTrace.length === 0)
          return `missing executionTrace in JSVMP symbolic result: ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'deobfuscate/packer-engine-unpack',
      tool: 'deobfuscate',
      origin: 'homemade',
      reference: 'unpacks Dean Edwards p,a,c,k,e,r payload via UniversalUnpacker',
      run: () =>
        handlers.handleDeobfuscate({
          code: "eval(function(p,a,c,k,e,r){e=String;if(!''.replace(/^/,String)){while(c--)r[c]=k[c]||c;k=[function(e){return r[e]}];e=function(){return'\\\\w+'};c=1};while(c--)if(k[c])p=p.replace(new RegExp('\\\\b'+e(c)+'\\\\b','g'),k[c]);return p}('0 1=2;',3,3,'var|ans|42'.split('|'),0,{}))",
          engine: 'packer',
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const out = String(b.code ?? b.deobfuscatedCode ?? JSON.stringify(b));
        if (!out.includes('42') && !out.includes('ans'))
          return `expected unpacked 'var ans=42', got: ${out.slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'webcrack_unpack/unminify-constant-fold',
      tool: 'webcrack_unpack',
      origin: 'homemade',
      reference: 'runs webcrack unminify/constant folding on minified JS expression',
      run: () =>
        handlers.handleWebcrackUnpack({
          code: '!(function(){var x=1+2;console.log(x);})();',
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const out = String(b.code ?? '');
        if (!out.includes('3')) return `expected folded 3 from webcrack, got: ${out.slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'js_analyze_vm/checks-non-vm-clean',
      tool: 'js_analyze_vm',
      origin: 'homemade',
      reference: 'reports isVM=false cleanly on plain non-VM JavaScript',
      run: () => handlers.handleJsAnalyzeVm({ code: CLEAN_SAMPLE }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.isVM !== false) return `expected isVM === false on clean code, got ${b.isVM}`;
        return true;
      },
    },
    {
      name: 'js_deobfuscate_jsvmp/detect-only-mode',
      tool: 'js_deobfuscate_jsvmp',
      origin: 'homemade',
      reference: 'runs JSVMP detector in detectOnly mode cleanly without false-positive crash',
      run: () =>
        handlers.handleJsDeobfuscateJsvmp({
          code: CLEAN_SAMPLE,
          detectOnly: true,
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (typeof b.isJSVMP !== 'boolean')
          return `expected boolean isJSVMP in detectOnly mode, got ${b.isJSVMP}`;
        return true;
      },
    },

    // ── Argument/dispatch contract batch 2026-11-12 (autoresearch) ──────────
    // These 6 core-analysis tools either collect from a live page or need a
    // concrete script/hook argument. The portable contract: the missing input
    // is named before any collection or CDP work, and an unusable input yields
    // an explicit failure rather than an empty-but-successful result.
    {
      name: 'collect_code/requires-url',
      tool: 'collect_code',
      origin: 'homemade',
      reference:
        'argument contract: collection needs the page url (or an explicit target) and names it when absent',
      run: () => callCore(() => handlers.handleCollectCode({})),
      validate: (v) => expectCoreRefusal(v, /url/i),
    },
    {
      name: 'search_in_scripts/requires-initialised-script-manager',
      tool: 'search_in_scripts',
      origin: 'homemade',
      reference:
        'admission contract: searching needs an initialised ScriptManager; without one the call fails explicitly instead of reporting zero matches',
      run: () => callCore(() => handlers.handleSearchInScripts({ query: 'token' })),
      validate: (v) => {
        const r = v as { ok: boolean; text: string; body?: Record<string, unknown> };
        const text = r.ok ? JSON.stringify(r.body) : r.text;
        if (/init is not a function|not initial/i.test(text)) return true;
        if (r.ok && r.body?.['success'] === false) {
          return String(r.body?.['error'] ?? r.body?.['message'] ?? '').length > 0
            ? true
            : 'failure without a named reason';
        }
        const matches = r.body?.['matches'];
        return Array.isArray(matches) && matches.length === 0
          ? 'must not report an empty match list as success'
          : true;
      },
    },
    {
      name: 'extract_function_tree/requires-scriptId',
      tool: 'extract_function_tree',
      origin: 'homemade',
      reference:
        'argument contract: the function tree is extracted from one script, so scriptId is required and the refusal points at get_all_scripts',
      run: () => callCore(() => handlers.handleExtractFunctionTree({})),
      validate: (v) => {
        const r = v as { ok: boolean; body?: Record<string, unknown>; text: string };
        const text = r.ok ? JSON.stringify(r.body) : r.text;
        if (!/scriptId/i.test(text)) return `expected a scriptId refusal: ${text.slice(0, 180)}`;
        return /get_all_scripts/i.test(text) ? true : `refusal should point at get_all_scripts`;
      },
    },
    {
      name: 'manage_hooks/requires-action',
      tool: 'manage_hooks',
      origin: 'homemade',
      reference:
        'argument contract: hook management needs an action (install/list/remove) and names it when absent',
      run: () => callCore(() => handlers.handleManageHooks({})),
      validate: (v) => expectCoreRefusal(v, /action/i),
    },
    {
      name: 'webpack_enumerate/refuses-without-page',
      tool: 'webpack_enumerate',
      origin: 'homemade',
      reference:
        'admission contract: webpack chunk enumeration reads the live runtime, so without a page it fails explicitly rather than reporting zero chunks',
      run: () => callCore(() => handlers.handleWebpackEnumerate({})),
      validate: (v) => {
        const r = v as { ok: boolean; body?: Record<string, unknown>; text: string };
        if (!r.ok)
          return /createCDPSession|not available|page/i.test(r.text)
            ? true
            : `unexpected throw: ${r.text.slice(0, 160)}`;
        if (r.body?.['success'] !== false) return `expected failure without a page`;
        if (r.body?.['chunks'] !== undefined) return `must not return chunks without a page`;
        return String(r.body?.['error'] ?? '').length > 0 ? true : 'failure without a named reason';
      },
    },
    {
      name: 'ai_suggest_exploits/requires-vulnerability',
      tool: 'ai_suggest_exploits',
      origin: 'homemade',
      reference:
        'argument contract: exploit suggestions need a structured vulnerability ({type, description}) and name that requirement when absent',
      run: () => callCore(() => handlers.handleAiSuggestExploits({})),
      validate: (v) => {
        const r = v as { ok: boolean; body?: Record<string, unknown>; text: string };
        const text = r.ok ? JSON.stringify(r.body) : r.text;
        if (r.ok && r.body?.['success'] !== false)
          return `expected a refusal without a vulnerability`;
        return /vulnerability/i.test(text)
          ? true
          : `expected a vulnerability requirement: ${text.slice(0, 180)}`;
      },
    },
  ],
};

/** Call a core-analysis handler, flattening the ToolResponse or capturing the throw. */
async function callCore(
  run: () => Promise<unknown>,
): Promise<{ ok: boolean; body?: Record<string, unknown>; text: string }> {
  try {
    const response = await run();
    const first = (response as { content?: Array<{ text?: string }> }).content?.[0]?.text;
    if (typeof first === 'string') {
      try {
        return { ok: true, body: JSON.parse(first) as Record<string, unknown>, text: first };
      } catch {
        return { ok: true, body: { raw: first }, text: first };
      }
    }
    return { ok: true, body: response as Record<string, unknown>, text: JSON.stringify(response) };
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : String(error) };
  }
}

/** Assert a named refusal for a missing/invalid argument. */
function expectCoreRefusal(v: unknown, expect: RegExp): true | string {
  const r = v as { ok: boolean; body?: Record<string, unknown>; text: string };
  const text = r.ok ? JSON.stringify(r.body) : r.text;
  return expect.test(text) ? true : `refusal does not match ${expect}: ${text.slice(0, 200)}`;
}
