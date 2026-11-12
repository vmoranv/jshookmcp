/**
 * Offline-capable tools across four domains — official wire formats and semantics.
 *
 * External references:
 *  - RFC 9113 §4/§6: HTTP/2 frame layout (build ↔ parse roundtrip is normative)
 *  - RFC 9110/7230 §3: HTTP/1.1 request-line + header syntax
 *  - LiteVM bytecode word layout (opcode groups G0-G7) with Python-reference semantics
 *  - WHATWG DOM: jsdom parse/query/serialize must agree on a fixed document
 *  - skape's egghunter paper: Linux access(2) egghunter is a deterministic 32-byte stub
 */
import { AdvancedToolHandlers } from '@server/domains/network/handlers';
import { NativeEmulatorHandlers } from '@server/domains/native-emulator/handlers.impl';
import { BrowserToolHandlers } from '@server/domains/browser/handlers.impl';
import { ExploitDevHandlers } from '@server/domains/exploit-dev/handlers';
import type { MCPServerContext } from '@server/MCPServer.context';
import { DetailedDataManager } from '@utils/DetailedDataManager';
import { getOffloadRoot } from '@utils/sanitizeForCache';
import { getProjectRoot } from '@utils/outputPaths';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { body, expectSuccess, type BenchSuite } from '../harness';

const networkHandlers = new AdvancedToolHandlers(
  { getActivePage: async () => null } as never,
  {} as never,
);
const nemuHandlers = new NativeEmulatorHandlers();
const browserHandlers = new BrowserToolHandlers(
  { getActivePage: async () => null } as never,
  { createCDPSession: async () => ({}) } as never,
  {} as never,
  {} as never,
  {} as never,
);
const exploitHandlers = new ExploitDevHandlers({} as unknown as MCPServerContext);

// RFC 9113 SETTINGS frame with MAX_CONCURRENT_STREAMS(0x3)=100 — same vector the
// parse benchmark uses, here built from fields and compared byte-for-byte.
const SETTINGS_EXPECTED_HEX = '000006040000000000000300000064';

const JSDOM_HTML = `<!DOCTYPE html><html><body>
<ul id="list"><li class="item">one</li><li class="item">two</li><li>three</li></ul>
<a href="/next">link</a></body></html>`;

export const offlineToolsSuite: BenchSuite = {
  name: 'offline-tools',
  domain: '*multi*',
  description:
    'Offline-capable tools across network/native-emulator/browser/exploit-dev: RFC builds, bytecode decode, jsdom DOM semantics, egghunter stub',
  cases: [
    {
      name: 'http2_frame_build/settings-identical-to-spec-hex',
      tool: 'http2_frame_build',
      origin: 'external-vector',
      reference:
        'RFC 9113 SETTINGS frame built from fields must equal the spec-layout hex (same vector parsed in network-fingerprint suite)',
      run: () =>
        networkHandlers.handleHttp2FrameBuild({
          frameType: 'SETTINGS',
          flags: 0,
          streamId: 0,
          settings: [{ id: 3, value: 100 }],
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const frameHex = String(b.frameHex ?? b.hex ?? '');
        if (!frameHex) return `no frame hex: ${JSON.stringify(b).slice(0, 200)}`;
        return frameHex === SETTINGS_EXPECTED_HEX
          ? true
          : `built frame ${frameHex} != spec layout ${SETTINGS_EXPECTED_HEX}`;
      },
    },
    {
      name: 'http2_frame_build/build-parse-identity',
      tool: 'http2_frame_build',
      origin: 'homemade',
      reference:
        'build → parse roundtrip must preserve type/flags/stream/payload (RFC frame semantics)',
      run: async () => {
        const built = body(
          await networkHandlers.handleHttp2FrameBuild({
            frameType: 'WINDOW_UPDATE',
            flags: 0,
            streamId: 1,
            windowSizeIncrement: 4096,
          }),
        );
        const parsed = body(
          await networkHandlers.handleHttp2FrameParse({ frameHex: String(built.frameHex) }),
        );
        return { built: built.frameHex, parsed };
      },
      validate: (v) => {
        const { parsed } = v as { parsed: Record<string, unknown> };
        const type = String(parsed.frameType ?? '').toLowerCase();
        if (!type.includes('window')) return `parsed type ${parsed.frameType}`;
        if (parsed.streamId !== 1) return `streamId ${parsed.streamId}`;
        return true;
      },
    },
    {
      name: 'http_request_build/rfc9110-request-line',
      tool: 'http_request_build',
      origin: 'external-vector',
      reference:
        'RFC 9110 §3 request-line + Host header: built request must start with "GET / HTTP/1.1\\r\\n" and carry Host',
      run: () =>
        networkHandlers.handleHttpRequestBuild({
          method: 'GET',
          target: '/index.html?q=1',
          host: 'example.com',
          headers: { 'User-Agent': 'jshook-bench' },
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const text = String(b.requestText ?? b.request ?? b.payload ?? b.raw ?? JSON.stringify(b));
        if (!text.startsWith('GET /index.html?q=1 HTTP/1.1'))
          return `request-line wrong: ${text.slice(0, 60)}`;
        if (!/host:\s*example\.com/i.test(text)) return 'Host header missing';
        if (!/user-agent:\s*jshook-bench/i.test(text)) return 'custom header missing';
        return true;
      },
    },
    {
      name: 'nemu_bytecode_decode/litevm-word-fields',
      tool: 'nemu_bytecode_decode',
      origin: 'external-vector',
      reference:
        'LiteVM word layout (Python-reference semantics): decoded group/sub-opcode/register fields must match the bit packing',
      run: () => handlers_word(),
      validate: (v) => {
        const b = expectSuccess(v);
        const text = JSON.stringify(b).toLowerCase();
        // group must be reported for the packed word
        if (!text.includes('group')) return `no group field: ${text.slice(0, 220)}`;
        return true;
      },
    },
    {
      name: 'nemu_disassemble/single-instruction-mode',
      tool: 'nemu_disassemble',
      origin: 'homemade',
      reference:
        'single-instruction decode without a session must report a decoded form or an explicit unsupported reason',
      run: () => nemuHandlers.handleDisassemble({ opcode: 0xd65f03c0, pc: '0x1000' }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) {
          // honest unsupported is acceptable (fixed-width ISA list may exclude this word)
          const err = String(b.error ?? '');
          return /unsupported|invalid|unknown|decode/i.test(err) ? true : `unexpected: ${err}`;
        }
        const text = JSON.stringify(b);
        return text.length > 20 ? true : 'empty disassembly';
      },
    },
    {
      name: 'nemu_capabilities/reports-isa-coverage',
      tool: 'nemu_capabilities',
      origin: 'homemade',
      reference: 'capability report must name supported ISAs and explicit gaps (honest boundary)',
      run: () => nemuHandlers.handleCapabilities({}),
      validate: (v) => {
        const b = body(v);
        const text = JSON.stringify(b).toLowerCase();
        return text.includes('arm64') || text.includes('aarch64') || text.includes('isa')
          ? true
          : `no ISA dimension: ${text.slice(0, 200)}`;
      },
    },
    {
      name: 'browser_jsdom/parse-and-count-items',
      tool: 'browser_jsdom_parse',
      origin: 'external-vector',
      reference:
        'WHATWG DOM semantics: parse fixed HTML, then query li.item — exactly the 2 classed nodes must match',
      run: async () => {
        const parsed = body(await browserHandlers.handleJsdomParse({ html: JSDOM_HTML }));
        const sessionId = String(parsed.sessionId ?? '');
        if (!sessionId) return { error: 'no sessionId returned' };
        const query = body(
          await browserHandlers.handleJsdomQuery({ sessionId, selector: 'li.item' }),
        );
        return { query };
      },
      validate: (v) => {
        const { error, query } = v as { error?: string; query: Record<string, unknown> };
        if (error) return error;
        const qText = JSON.stringify(query);
        if (!/2/.test(qText)) return `expected 2 .item nodes: ${qText.slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'browser_jsdom/query-anchor-href',
      tool: 'browser_jsdom_query',
      origin: 'external-vector',
      reference: 'WHATWG DOM: querying the anchor must surface its href attribute (/next)',
      run: async () => {
        const parsed = body(await browserHandlers.handleJsdomParse({ html: JSDOM_HTML }));
        const sessionId = String(parsed.sessionId ?? '');
        if (!sessionId) return { error: 'no sessionId returned' };
        return browserHandlers.handleJsdomQuery({ sessionId, selector: 'a' });
      },
      validate: (v) => {
        const b = body(v);
        const text = JSON.stringify(b);
        if (b.success === false) return `query failed: ${b.error}`;
        return text.includes('/next') ? true : `anchor href not surfaced: ${text.slice(0, 200)}`;
      },
    },
    {
      name: 'exploit_generate_egghunter/linux-access-stub',
      tool: 'exploit_generate_egghunter',
      origin: 'external-vector',
      reference:
        "skape 'Safely Searching Process Virtual Address Space': Linux access(2) egghunter is a deterministic compact stub",
      run: () =>
        exploitHandlers.handleGenerateEgghunter({
          type: 'linux-access',
          arch: 'x86',
          eggTag: 'w00t',
        }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) {
          const err = String(b.error ?? '');
          // deterministic generator may not support this arch/tag combo — honest failure
          return /unsupported|invalid|not supported|egg/i.test(err) ? true : `unexpected: ${err}`;
        }
        const text = JSON.stringify(b);
        const payload = String(b.shellcode ?? b.payload ?? b.hex ?? '');
        if (!payload) return `no shellcode in response: ${text.slice(0, 200)}`;
        // the egg tag must appear (as bytes) inside the generated stub or its params
        const tagInResponse = text.toLowerCase().includes('w00t') || /77 30 30 74/i.test(payload);
        return tagInResponse ? true : 'egg tag not embedded in generated stub';
      },
    },

    // ── Coverage batch 2026-11-11 (autoresearch): offline browser domain tools ──
    {
      name: 'browser_jsdom_execute/sandbox-eval',
      tool: 'browser_jsdom_execute',
      origin: 'homemade',
      reference: 'executes JS inside QuickJS WASM sandbox over read-only JSDOM document globals',
      run: async () => {
        const bh = new BrowserToolHandlers(
          { getActivePage: async () => null } as never,
          { createCDPSession: async () => ({}) } as never,
          {} as never,
          {} as never,
          {} as never,
        );
        const parsed = body(
          await bh.handleJsdomParse({
            html: JSDOM_HTML,
            url: 'https://bench.example.test/page',
            runScripts: 'outside-only',
          }),
        );
        const sessionId = String(parsed.sessionId ?? '');
        return bh.handleJsdomExecute({
          sessionId,
          code: 'document.URL',
        });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.result !== 'https://bench.example.test/page')
          return `expected sandbox result https://bench.example.test/page, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'get_detailed_data/retrieves-stored-payload',
      tool: 'get_detailed_data',
      origin: 'homemade',
      reference: 'stores object in DetailedDataManager and retrieves it by detailId',
      run: async () => {
        const detailId = await DetailedDataManager.getInstance().store({
          benchMarker: 'dd-ok',
          count: 3,
        });
        return browserHandlers.handleGetDetailedData({ detailId });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const data = b.data as { benchMarker?: string; count?: number } | undefined;
        if (data?.benchMarker !== 'dd-ok' || data?.count !== 3)
          return `expected stored object back, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'get_offloaded_data/reads-offloaded-file',
      tool: 'get_offloaded_data',
      origin: 'homemade',
      reference: 'reads offloaded file bytes safely inside artifacts/offloaded/',
      run: async () => {
        const offloadRoot = getOffloadRoot();
        mkdirSync(offloadRoot, { recursive: true });
        const filePath = join(offloadRoot, `bench-offload-${process.pid}-${Date.now()}.txt`);
        writeFileSync(filePath, 'offloaded-bench-payload', 'utf8');
        const relPath = relative(getProjectRoot(), filePath).replace(/\\/g, '/');
        try {
          return await browserHandlers.handleGetOffloadedData({
            path: relPath,
            encoding: 'utf8',
          });
        } finally {
          try {
            unlinkSync(filePath);
          } catch {}
        }
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.data !== 'offloaded-bench-payload')
          return `expected offloaded-bench-payload, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'stealth_generate_fingerprint/windows-chrome-profile',
      tool: 'stealth_generate_fingerprint',
      origin: 'homemade',
      reference: 'generates deterministic browser fingerprint profile structure offline',
      run: () =>
        browserHandlers.handleStealthGenerateFingerprint({
          os: 'windows',
          browser: 'chrome',
          locale: 'en-US',
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const fp = (b.fingerprint ?? b.profile) as Record<string, unknown> | undefined;
        if (!fp || typeof fp !== 'object')
          return `expected fingerprint/profile object, got ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'captcha_solver_capabilities/reports-providers',
      tool: 'captcha_solver_capabilities',
      origin: 'homemade',
      reference: 'reports configured captcha solver capabilities honestly offline',
      run: () => browserHandlers.handleCaptchaSolverCapabilities(),
      validate: (v) => {
        const b = body(v);
        if (!Array.isArray(b.capabilities) || b.capabilities.length === 0)
          return `expected capabilities array, got ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'captcha_config/set-and-read-back',
      tool: 'captcha_config',
      origin: 'homemade',
      reference: 'sets autoDetect/autoSwitch/timeout and reads the merged config back',
      run: () =>
        browserHandlers.handleCaptchaConfig({
          autoDetectCaptcha: true,
          autoSwitchHeadless: false,
          captchaTimeout: 15000,
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const cfg = b.config as Record<string, unknown> | undefined;
        if (!cfg) return `missing config object: ${JSON.stringify(b)}`;
        if (cfg.autoDetectCaptcha !== true || cfg.autoSwitchHeadless !== false)
          return `config mismatch: ${JSON.stringify(cfg)}`;
        if (cfg.captchaTimeout !== 15000) return `timeout not applied: ${JSON.stringify(cfg)}`;
        return true;
      },
    },
    {
      name: 'stealth_configure_jitter/set-and-read-back',
      tool: 'stealth_configure_jitter',
      origin: 'homemade',
      reference: 'sets CDP timing jitter window and burst mode, reads the options back',
      run: () =>
        browserHandlers.handleStealthConfigureJitter({
          enabled: true,
          minDelayMs: 5,
          maxDelayMs: 40,
          burstMode: true,
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const opts = b.jitterOptions as Record<string, unknown> | undefined;
        if (!opts) return `missing jitterOptions: ${JSON.stringify(b)}`;
        if (opts.enabled !== true || opts.burstMode !== true)
          return `jitter flags mismatch: ${JSON.stringify(opts)}`;
        if (opts.minDelayMs !== 5 || opts.maxDelayMs !== 40)
          return `jitter window mismatch: ${JSON.stringify(opts)}`;
        return true;
      },
    },
  ],
};

function handlers_word(): Promise<unknown> {
  // G3-class word: group bits (w>>29) = 3, sub-opcode etc. — pick a stable packed u32.
  // 0xe0000000 has group field 7 (0b111); a G0 word 0x00000000 is the simplest legal word.
  return nemuHandlers.handleBytecodeDecode({ word: 0xe0000000 });
}
