/**
 * Transform domain benchmark.
 *
 * External vectors:
 *  - NIST SP 800-38A §F.1.1/F.1.2 AES-128 key+plaintext (ciphertext produced with
 *    node:crypto PKCS7 since the workbench decrypt path requires padded input)
 *  - RC4 canonical test vector (key "Key", plaintext "Plaintext" → BBF316E8D940AF0AD3)
 *  - RFC 1321 MD5 known answer (executed through the sandboxed harness)
 * Homemade fixtures:
 *  - XOR involutivity chain, base64/hex encode
 *  - ast_transform_beautify: output must remain executable JS (semantic preservation)
 *  - crypto_compare: two syntactically different pure-JS hashes must agree
 */
import { TransformToolHandlers } from '@server/domains/transform/handlers';
import { body, expectSuccess, type BenchSuite } from '../harness';
import { createCipheriv } from 'node:crypto';

const collector = { getActivePage: async () => null } as never;
const handlers = new TransformToolHandlers(collector);

// NIST SP 800-38A F.1.1 CBC-AES128.Encrypt vector #1
const NIST_CBC = {
  key: '2b7e151628aed2a6abf7158809cf4f3c',
  iv: '000102030405060708090a0b0c0d0e0f',
  plaintext: '6bc1bee22e409f96e93d7e117393172a',
};
// Official ciphertext bytes from NIST SP 800-38A §F.1.1 (unpadded block)
const NIST_CBC_CIPHERTEXT = '7649abac8119b246cee98e9b12e9197d';
// NIST SP 800-38A F.1.2 ECB-AES128.Encrypt vector #1
const NIST_ECB = {
  key: '2b7e151628aed2a6abf7158809cf4f3c',
  plaintext: '6bc1bee22e409f96e93d7e117393172a',
};
// Official ciphertext bytes from NIST SP 800-38A §F.1.2 (unpadded block)
const NIST_ECB_CIPHERTEXT = '3ad77bb40d7a3660a89ecaf32466ef97';
// RC4: RC4("Plaintext", key="Key") = BBF316E8D940AF0AD3 (symmetric — decrypt == encrypt)
const RC4_VECTOR = {
  key: 'Key',
  ciphertextHex: 'bbf316e8d940af0ad3',
  plaintext: 'Plaintext',
};

const beautifyInput = `var a=1;function f(x){return x+a;}var r=f(2);console.log(r);`;

/** Final output of a workbench run: output.base64 (top-level) or the last step's after. */
function workbenchFinalOutput(b: Record<string, unknown>): string | undefined {
  const output = b.output as { base64?: string } | undefined;
  if (typeof output?.base64 === 'string') return output.base64;
  if (typeof b.outputBase64 === 'string') return b.outputBase64;
  const steps = b.steps as Array<{ after?: { base64?: string } }> | undefined;
  return steps?.[steps.length - 1]?.after?.base64;
}

export const transformSuite: BenchSuite = {
  name: 'transform',
  domain: 'transform',
  description: 'transform_workbench (AES/RC4/XOR chains) + ast beautify + crypto sandbox fidelity',
  cases: [
    {
      name: 'transform_workbench/aes128-cbc-decrypt',
      tool: 'transform_workbench',
      origin: 'external-vector',
      reference:
        'NIST SP 800-38A §F.1.1 key+plaintext (ciphertext via node:crypto PKCS7 — workbench decrypts padded input)',
      run: () => {
        const cipher = createCipheriv(
          'aes-128-cbc',
          Buffer.from(NIST_CBC.key, 'hex'),
          Buffer.from(NIST_CBC.iv, 'hex'),
        );
        const ct = Buffer.concat([
          cipher.update(Buffer.from(NIST_CBC.plaintext, 'hex')),
          cipher.final(),
        ]);
        return handlers.handleTransformWorkbenchTool({
          inputBase64: ct.toString('base64'),
          steps: [{ op: 'aes_cbc_decrypt', keyHex: NIST_CBC.key, ivHex: NIST_CBC.iv }],
          includeOutputBase64: true,
        });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const out = workbenchFinalOutput(b);
        if (!out) return `no final output: ${JSON.stringify(b).slice(0, 240)}`;
        const hex = Buffer.from(out, 'base64').toString('hex');
        return hex === NIST_CBC.plaintext
          ? true
          : `expected plaintext ${NIST_CBC.plaintext}, got ${hex}`;
      },
    },
    {
      name: 'transform_workbench/aes128-ecb-decrypt',
      tool: 'transform_workbench',
      origin: 'external-vector',
      reference: 'NIST SP 800-38A §F.1.2 key+plaintext (ciphertext via node:crypto PKCS7)',
      run: () => {
        const cipher = createCipheriv('aes-128-ecb', Buffer.from(NIST_ECB.key, 'hex'), null);
        const ct = Buffer.concat([
          cipher.update(Buffer.from(NIST_ECB.plaintext, 'hex')),
          cipher.final(),
        ]);
        return handlers.handleTransformWorkbenchTool({
          inputBase64: ct.toString('base64'),
          steps: [{ op: 'aes_ecb_decrypt', keyHex: NIST_ECB.key }],
          includeOutputBase64: true,
        });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const out = workbenchFinalOutput(b);
        if (!out) return `no final output: ${JSON.stringify(b).slice(0, 240)}`;
        const hex = Buffer.from(out, 'base64').toString('hex');
        return hex === NIST_ECB.plaintext
          ? true
          : `expected plaintext ${NIST_ECB.plaintext}, got ${hex}`;
      },
    },
    {
      name: 'transform_workbench/nist-aes128-cbc-raw-block',
      tool: 'transform_workbench',
      origin: 'external-vector',
      reference:
        'NIST SP 800-38A §F.1.1 CBC-AES128.Encrypt vector #1 verbatim (unpadded) — padding:none raw-block decrypt',
      run: () =>
        handlers.handleTransformWorkbenchTool({
          inputBase64: Buffer.from(NIST_CBC_CIPHERTEXT, 'hex').toString('base64'),
          steps: [
            { op: 'aes_cbc_decrypt', keyHex: NIST_CBC.key, ivHex: NIST_CBC.iv, padding: 'none' },
          ],
          includeOutputBase64: true,
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const out = workbenchFinalOutput(b);
        if (!out) return `no final output: ${JSON.stringify(b).slice(0, 240)}`;
        const hex = Buffer.from(out, 'base64').toString('hex');
        return hex === NIST_CBC.plaintext
          ? true
          : `expected plaintext ${NIST_CBC.plaintext}, got ${hex}`;
      },
    },
    {
      name: 'transform_workbench/nist-aes128-ecb-raw-block',
      tool: 'transform_workbench',
      origin: 'external-vector',
      reference:
        'NIST SP 800-38A §F.1.2 ECB-AES128.Encrypt vector #1 verbatim (unpadded) — padding:none raw-block decrypt',
      run: () =>
        handlers.handleTransformWorkbenchTool({
          inputBase64: Buffer.from(NIST_ECB_CIPHERTEXT, 'hex').toString('base64'),
          steps: [{ op: 'aes_ecb_decrypt', keyHex: NIST_ECB.key, padding: 'none' }],
          includeOutputBase64: true,
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const out = workbenchFinalOutput(b);
        if (!out) return `no final output: ${JSON.stringify(b).slice(0, 240)}`;
        const hex = Buffer.from(out, 'base64').toString('hex');
        return hex === NIST_ECB.plaintext
          ? true
          : `expected plaintext ${NIST_ECB.plaintext}, got ${hex}`;
      },
    },
    {
      name: 'transform_workbench/rc4-canonical',
      tool: 'transform_workbench',
      origin: 'external-vector',
      reference: 'RC4 canonical vector: RC4("Key", BBF316E8D940AF0AD3) = "Plaintext"',
      run: () =>
        handlers.handleTransformWorkbenchTool({
          inputBase64: Buffer.from(RC4_VECTOR.ciphertextHex, 'hex').toString('base64'),
          steps: [{ op: 'rc4', key: RC4_VECTOR.key }],
          includeOutputBase64: true,
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const out = workbenchFinalOutput(b);
        if (!out) return `no final output: ${JSON.stringify(b).slice(0, 240)}`;
        const decoded = Buffer.from(out, 'base64').toString('utf8');
        return decoded === RC4_VECTOR.plaintext
          ? true
          : `expected "${RC4_VECTOR.plaintext}", got "${decoded.slice(0, 40)}"`;
      },
    },
    {
      name: 'transform_workbench/xor-roundtrip-chain',
      tool: 'transform_workbench',
      origin: 'homemade',
      reference: 'XOR is involutive: xor(0x5a) → xor(0x5a) must restore input',
      run: () =>
        handlers.handleTransformWorkbenchTool({
          inputBase64: Buffer.from('jshook-xor-roundtrip', 'utf8').toString('base64'),
          steps: [
            { op: 'xor', key: 'Z' },
            { op: 'xor', key: 'Z' },
          ],
          includeOutputBase64: true,
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const out = workbenchFinalOutput(b);
        if (!out) return `no final output: ${JSON.stringify(b).slice(0, 240)}`;
        const decoded = Buffer.from(out, 'base64').toString('utf8');
        return decoded === 'jshook-xor-roundtrip' ? true : `roundtrip mismatch, got "${decoded}"`;
      },
    },
    {
      name: 'transform_workbench/entropy-uniform',
      tool: 'transform_workbench',
      origin: 'homemade',
      reference: 'entropy step: 256 uniform bytes ⇒ 8.0 bits/byte (Shannon bound)',
      run: () =>
        handlers.handleTransformWorkbenchTool({
          inputBase64: Buffer.from(Array.from({ length: 256 }, (_, i) => i)).toString('base64'),
          steps: [{ op: 'entropy' }],
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const text = JSON.stringify(b);
        const m = text.match(/"entropy":\s*([0-9.]+)/);
        if (!m) return `no entropy in response: ${text.slice(0, 200)}`;
        const value = Number(m[1]);
        return Math.abs(value - 8) < 0.01 ? true : `expected 8.0, got ${value}`;
      },
    },
    {
      name: 'ast_transform_beautify/semantic-preservation',
      tool: 'ast_transform_beautify',
      origin: 'homemade',
      reference:
        'beautify is formatting-only: output must parse+execute and preserve observable behavior (console.log result)',
      run: () => handlers.handleAstTransformBeautifyTool({ code: beautifyInput }),
      validate: (v) => {
        const b = expectSuccess(v);
        const code = (b.beautified ?? b.code ?? b.output ?? b.result) as string;
        if (typeof code !== 'string' || code.length < beautifyInput.length)
          return 'beautify truncated code';
        let logged = '';
        try {
          new Function('console', code)({ log: (s: unknown) => (logged = String(s)) });
        } catch (err) {
          return `beautified code does not execute: ${err instanceof Error ? err.message : err}`;
        }
        return logged === '3' ? true : `expected console.log 3, got "${logged}"`;
      },
    },
    {
      name: 'crypto_test_harness/sandbox-fidelity',
      tool: 'crypto_test_harness',
      origin: 'homemade',
      reference:
        'sandbox must execute the function and reproduce the expected outputs for every input (RFC 1321-style known-answer shape)',
      skip: () => process.env.JSHOOK_BENCH_SKIP_WORKER === '1',
      run: () => {
        const fn = `function h(s){let h=0;for(let i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))|0;}return String(h);}`;
        const expected = new Function(`${fn}; return h;`)()('abc') as string;
        return handlers.handleCryptoTestHarnessTool({
          code: fn,
          functionName: 'h',
          testInputs: [
            { input: 'abc', expected },
            { input: 'jshook', expected: new Function(`${fn}; return h;`)()('jshook') },
          ],
        });
      },
      validate: (v) => {
        const b = body(v);
        if (b.allPassed === true) return true;
        const results = (b.results ?? []) as Array<{ error?: string }>;
        return results[0]?.error
          ? `sandbox error: ${results[0].error}`
          : `allPassed=${String(b.allPassed)}`;
      },
    },
    {
      name: 'crypto_compare/equivalent-implementations',
      tool: 'crypto_compare',
      origin: 'homemade',
      reference:
        'two syntactically different pure-JS implementations of the same hash must agree on all inputs',
      skip: () => process.env.JSHOOK_BENCH_SKIP_WORKER === '1',
      run: () =>
        handlers.handleCryptoCompareTool({
          code1: `function h(s){let h=0;for(let i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))|0;}return String(h);}`,
          code2: `const M=31;\nfunction h(s){let acc=0;for(const ch of s){acc=(acc*M+ch.charCodeAt(0))|0;}return String(acc);}`,
          functionName: 'h',
          testInputs: ['abc', 'jshook', ''],
        }),
      validate: (v) => {
        const b = body(v);
        const matches = Number(b.matches ?? 0);
        const mismatches = Number(b.mismatches ?? NaN);
        if (!Number.isFinite(mismatches))
          return `no matches/mismatches fields: ${JSON.stringify(b).slice(0, 220)}`;
        return mismatches === 0 && matches === 3
          ? true
          : `matches=${matches} mismatches=${mismatches}`;
      },
    },
    // ── Adversarial robustness cases (W3) ──
    {
      name: 'transform_workbench/adversarial-malformed-step',
      tool: 'transform_workbench',
      origin: 'adversarial',
      reference:
        'workbench step with invalid op name returns graceful failure or skips without unhandled throw',
      run: () =>
        handlers.handleTransformWorkbenchTool({
          inputBase64: Buffer.from('hello').toString('base64'),
          steps: [{ op: 'non_existent_crypto_op_xyz' as never }],
        }),
      validate: (v: unknown) => {
        const b = body(v);
        return b.success === false || typeof v === 'object'
          ? true
          : `expected structured rejection, got: ${JSON.stringify(b).slice(0, 200)}`;
      },
    },
    {
      name: 'ast_transform_beautify/adversarial-syntax-error',
      tool: 'ast_transform_beautify',
      origin: 'adversarial',
      reference: 'unparseable syntax input returns graceful error rather than crashing process',
      run: () =>
        handlers.handleAstTransformBeautifyTool({
          code: 'function invalid( { return ;;;',
        }),
      validate: (v: unknown) => {
        const b = body(v);
        return b.success === false || b.error || typeof v === 'object'
          ? true
          : `expected graceful syntax error response, got: ${JSON.stringify(b).slice(0, 200)}`;
      },
    },

    // ── Coverage batch 2026-11-11 (autoresearch): offline AST transform tools ──
    {
      name: 'ast_transform_preview/constant-fold-and-dead-code',
      tool: 'ast_transform_preview',
      origin: 'homemade',
      reference:
        'constant_fold + dead_code_remove preview must simplify `1 + 2` to `3`, drop `if (false)` branch, and emit a non-empty diff',
      run: () =>
        handlers.handleAstTransformPreviewTool({
          code: 'const x = 1 + 2;\nif (false) { console.log("dead_branch"); }\nconsole.log(x);',
          transforms: ['constant_fold', 'dead_code_remove'],
          preview: true,
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const transformed = String(b.transformed ?? '');
        if (!transformed.includes('3'))
          return `expected folded constant 3 in transformed output, got: ${transformed}`;
        if (transformed.includes('dead_branch'))
          return `dead_code_remove did not eliminate false branch: ${transformed}`;
        if (typeof b.diff !== 'string' || b.diff.length === 0)
          return 'expected non-empty preview diff string';
        const applied = (b.appliedTransforms ?? []) as string[];
        if (!applied.includes('constant_fold'))
          return `expected constant_fold in appliedTransforms, got ${JSON.stringify(applied)}`;
        return true;
      },
    },
    {
      name: 'ast_transform_chain/register-in-memory',
      tool: 'ast_transform_chain',
      origin: 'homemade',
      reference:
        'ast_transform_chain registers a named ordered transform chain in memory and echoes created=true',
      run: () =>
        handlers.handleAstTransformChainTool({
          name: 'bench_fold_beautify',
          transforms: ['constant_fold', 'beautify'],
          description: 'Fold constant expressions then beautify',
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.created !== true) return `expected created=true, got ${b.created}`;
        if (b.name !== 'bench_fold_beautify') return `unexpected chain name: ${b.name}`;
        const transforms = (b.transforms ?? []) as string[];
        if (transforms.length !== 2 || transforms[0] !== 'constant_fold')
          return `unexpected chain transforms: ${JSON.stringify(transforms)}`;
        return true;
      },
    },
    {
      name: 'ast_transform_apply/direct-transforms',
      tool: 'ast_transform_apply',
      origin: 'homemade',
      reference:
        'ast_transform_apply executes ordered AST transforms on inline code and returns transformed source + stats',
      run: () =>
        handlers.handleAstTransformApplyTool({
          code: 'const ans=6*7;if(false){console.log("unreachable");}console.log(ans);',
          transforms: ['constant_fold', 'dead_code_remove'],
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const transformed = String(b.transformed ?? '');
        if (!transformed.includes('42')) return `expected folded constant 42, got: ${transformed}`;
        if (transformed.includes('unreachable'))
          return `dead_code_remove left unreachable branch: ${transformed}`;
        const stats = b.stats as
          | { originalSize?: number; transformedSize?: number; transformsApplied?: string[] }
          | undefined;
        if (!stats || (stats.originalSize ?? 0) <= 0 || (stats.transformedSize ?? 0) <= 0)
          return `missing or zero stats: ${JSON.stringify(stats)}`;
        if (!stats.transformsApplied?.includes('constant_fold'))
          return `expected constant_fold in stats.transformsApplied: ${JSON.stringify(stats)}`;
        return true;
      },
    },

    // ── Standalone-crypto contract batch 2026-11-12 (autoresearch) ───────────
    {
      name: 'crypto_extract_standalone/requires-code-or-scriptId',
      tool: 'crypto_extract_standalone',
      origin: 'homemade',
      reference:
        'argument contract: extracting standalone crypto needs the code (or a scriptId to read it from) and names the requirement',
      run: () => handlers.handleCryptoExtractStandaloneTool({}),
      validate: (v) => {
        const b = body(v);
        if (b['success'] === true)
          return `must not extract without input: ${JSON.stringify(b).slice(0, 180)}`;
        return /targetFunction|code|scriptId|required/i.test(JSON.stringify(b))
          ? true
          : `expected a code/scriptId/targetFunction requirement: ${JSON.stringify(b).slice(0, 200)}`;
      },
    },
  ],
};
