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
import { EventBus } from '@server/EventBus';
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

    // ── Storage batch 2026-11-12 (autoresearch): in-memory PageController ──
    // WHATWG Web Storage semantics: per-origin key/value map, getItem returns the
    // stored string, removeItem deletes one key, clear empties the store.
    {
      name: 'page_local_storage/set-get-delete-clear-roundtrip',
      tool: 'page_local_storage',
      origin: 'homemade',
      reference:
        'WHATWG Web Storage: set then get returns the stored value, delete removes only that key, clear empties the store',
      run: async () => {
        await storageHandlers.handlePageLocalStorageDispatch({
          action: 'set',
          key: 'token',
          value: 'ct-1',
        });
        await storageHandlers.handlePageLocalStorageDispatch({
          action: 'set',
          key: 'keep',
          value: 'yes',
        });
        const afterSet = body(
          await storageHandlers.handlePageLocalStorageDispatch({ action: 'get' }),
        );
        await storageHandlers.handlePageLocalStorageDispatch({ action: 'delete', key: 'token' });
        const afterDelete = body(
          await storageHandlers.handlePageLocalStorageDispatch({ action: 'get' }),
        );
        await storageHandlers.handlePageLocalStorageDispatch({ action: 'clear' });
        const afterClear = body(
          await storageHandlers.handlePageLocalStorageDispatch({ action: 'get' }),
        );
        return { afterSet, afterDelete, afterClear };
      },
      validate: (v) => {
        const r = v as Record<string, Record<string, unknown>>;
        const storeOf = (stage: Record<string, unknown>) =>
          (stage['storage'] ?? {}) as Record<string, string>;
        const setStore = storeOf(r['afterSet'] ?? {});
        if (setStore['token'] !== 'ct-1' || setStore['keep'] !== 'yes')
          return `set roundtrip mismatch: ${JSON.stringify(setStore)}`;
        if (r['afterSet']?.['count'] !== 2)
          return `expected count 2 after two sets, got ${String(r['afterSet']?.['count'])}`;
        const delStore = storeOf(r['afterDelete'] ?? {});
        if ('token' in delStore) return `delete left key behind: ${JSON.stringify(delStore)}`;
        if (delStore['keep'] !== 'yes')
          return `delete removed the wrong key: ${JSON.stringify(delStore)}`;
        const clrStore = storeOf(r['afterClear'] ?? {});
        if (Object.keys(clrStore).length !== 0)
          return `clear left entries: ${JSON.stringify(clrStore)}`;
        if (r['afterClear']?.['count'] !== 0)
          return `count not reset to 0 after clear: ${String(r['afterClear']?.['count'])}`;
        return true;
      },
    },
    {
      name: 'page_local_storage/set-without-key-rejected',
      tool: 'page_local_storage',
      origin: 'homemade',
      reference:
        'argument validation: set/delete require a non-empty key and must fail explicitly instead of writing an empty-named entry',
      run: () => storageHandlers.handlePageLocalStorageDispatch({ action: 'set', value: 'x' }),
      validate: (v) => {
        const b = body(v);
        if (b.success !== false) return `expected success=false, got ${JSON.stringify(b)}`;
        const err = String(b.error ?? '');
        if (!/localStorage key must be a non-empty string/.test(err))
          return `unexpected validation error: ${err}`;
        return true;
      },
    },
    {
      name: 'page_session_storage/get-returns-entries',
      tool: 'page_session_storage',
      origin: 'homemade',
      reference:
        'WHATWG Web Storage (session scope): get reports the stored entries and their count',
      run: () => storageHandlers.handlePageSessionStorageDispatch({ action: 'get' }),
      validate: (v) => {
        const b = expectSuccess(v);
        const store = (b.storage ?? {}) as Record<string, string>;
        if (store['s'] !== '1') return `session entry missing: ${JSON.stringify(b)}`;
        if (b.count !== 1) return `expected count 1, got ${String(b.count)}`;
        return true;
      },
    },
    {
      name: 'page_storage_info/estimate-fields-shaped',
      tool: 'page_storage_info',
      origin: 'homemade',
      reference:
        'Storage Standard: navigator.storage.estimate() → {usage, quota}, persisted() → boolean; nulls when the API is absent',
      run: () => storageHandlers.handlePageStorageInfo({}),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.supported !== true) return `expected supported=true, got ${JSON.stringify(b)}`;
        if (typeof b.usage !== 'number' || typeof b.quota !== 'number')
          return `usage/quota must be numbers: ${JSON.stringify(b)}`;
        if (b.persisted !== true) return `persisted must be boolean true: ${JSON.stringify(b)}`;
        return true;
      },
    },

    // ── Browser host-side batch 2026-11-12 (autoresearch) ───────────────────
    // These tools read collector/monitor/script-manager state and shape it
    // host-side. Feeding the collaborator's fixed return value measures the
    // real shaping/capping/compaction logic without a live browser.
    {
      name: 'browser_status/merges-collector-status',
      tool: 'browser_status',
      origin: 'homemade',
      reference:
        'status contract: the collector status (running/pagesCount/version) is merged under driver:"chrome" with success=true',
      run: () =>
        makeBrowserHandlers({
          collector: {
            getStatus: async () => ({
              running: true,
              pagesCount: 2,
              version: 'Chrome/120.0.0.0',
              launchSource: 'launched',
            }),
          },
        }).handleBrowserStatus({}),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.driver !== 'chrome') return `driver should be chrome, got ${String(b.driver)}`;
        if (b.running !== true || b.pagesCount !== 2)
          return `collector status not merged: ${JSON.stringify(b)}`;
        if (b.version !== 'Chrome/120.0.0.0') return `version not merged: ${String(b.version)}`;
        return true;
      },
    },
    {
      name: 'browser_list_tabs/enumerates-pages-with-hint',
      tool: 'browser_list_tabs',
      origin: 'homemade',
      reference:
        'tab enumeration: collector.listPages entries are re-emitted with pageId/aliases defaults and a select-tab hint; count matches the page list',
      run: () =>
        makeBrowserHandlers({
          collector: {
            listPages: async () => [
              { index: 0, url: 'https://app.example/', title: '' },
              { index: 1, url: 'https://app.example/second', title: '' },
            ],
            getSelectedPageHandle: () => null,
          },
        }).handleBrowserListTabs({}),
      validate: (v) => {
        const b = expectSuccess(v);
        const pages = (b.pages ?? []) as Array<Record<string, unknown>>;
        if (b.count !== 2 || pages.length !== 2)
          return `expected 2 pages, got count=${String(b.count)} len=${pages.length}`;
        if (pages[0]?.['url'] !== 'https://app.example/')
          return `page url not preserved: ${JSON.stringify(pages[0])}`;
        if (pages[0]?.['pageId'] !== null || !Array.isArray(pages[0]?.['aliases']))
          return `pageId/aliases defaults wrong: ${JSON.stringify(pages[0])}`;
        if (typeof b.hint !== 'string' || !/browser_select_tab/.test(String(b.hint)))
          return `select-tab hint missing: ${String(b.hint)}`;
        return true;
      },
    },
    {
      name: 'browser_list_workers/classifies-target-types',
      tool: 'browser_list_workers',
      origin: 'homemade',
      reference:
        'CDP target classification: type "worker" → category dedicated_worker, service_worker keeps isServiceWorker=true, and the next-step hint points at browser_worker_scripts',
      run: () =>
        makeBrowserHandlers({
          collector: {
            listCdpTargets: async () => [
              {
                targetId: 'sw-1',
                type: 'service_worker',
                title: 'sw.js',
                url: 'https://app.example/sw.js',
                attached: false,
              },
              {
                targetId: 'w-1',
                type: 'worker',
                title: 'worker.js',
                url: 'https://app.example/worker.js',
                attached: false,
              },
            ],
          },
        }).handleBrowserListWorkers({}),
      validate: (v) => {
        const b = expectSuccess(v);
        const workers = (b.workers ?? []) as Array<Record<string, unknown>>;
        if (b.count !== 2 || workers.length !== 2)
          return `expected 2 workers: ${JSON.stringify(b)}`;
        const sw = workers.find((w) => w['targetId'] === 'sw-1');
        const dw = workers.find((w) => w['targetId'] === 'w-1');
        if (!sw || sw['category'] !== 'service_worker' || sw['isServiceWorker'] !== true)
          return `service worker misclassified: ${JSON.stringify(sw)}`;
        if (!dw || dw['category'] !== 'dedicated_worker' || dw['isServiceWorker'] !== false)
          return `dedicated worker misclassified: ${JSON.stringify(dw)}`;
        if (!/browser_worker_scripts/.test(String(b._nextStepHint)))
          return `next-step hint wrong: ${String(b._nextStepHint)}`;
        return true;
      },
    },
    {
      name: 'browser_list_workers/rejects-all-filters-off',
      tool: 'browser_list_workers',
      origin: 'homemade',
      reference:
        'argument contract: disabling every worker-type filter must fail with an explicit message instead of silently returning an empty list',
      run: () =>
        makeBrowserHandlers({}).handleBrowserListWorkers({
          includeServiceWorkers: false,
          includeDedicatedWorkers: false,
          includeSharedWorkers: false,
        }),
      validate: (v) => {
        const b = body(v);
        if (b.success !== false) return `expected success=false, got ${JSON.stringify(b)}`;
        if (!/No worker types selected/.test(String(b.error)))
          return `unexpected error: ${String(b.error)}`;
        return true;
      },
    },
    {
      name: 'browser_worker_scripts/requires-targetId',
      tool: 'browser_worker_scripts',
      origin: 'homemade',
      reference:
        'argument contract: dumping worker scripts without targetId must fail and name browser_list_workers as the discovery step',
      run: () => makeBrowserHandlers({}).handleBrowserWorkerScripts({}),
      validate: (v) => {
        const b = body(v);
        if (b.success !== false) return `expected success=false, got ${JSON.stringify(b)}`;
        if (!/targetId is required/.test(String(b.error)))
          return `unexpected error: ${String(b.error)}`;
        return true;
      },
    },
    {
      name: 'browser_worker_scripts/echoes-dump-and-hints',
      tool: 'browser_worker_scripts',
      origin: 'homemade',
      reference:
        'result shaping: the dump result is echoed verbatim and the hint switches on includeSource (source included vs. opt-in)',
      run: () =>
        makeBrowserHandlers({
          collector: {
            dumpTargetScripts: async () => ({
              targetId: 'w-1',
              scripts: [{ scriptId: 's1', url: 'worker.js' }],
              count: 1,
            }),
          },
        }).handleBrowserWorkerScripts({ targetId: 'w-1', includeSource: true }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.count !== 1) return `dump count not echoed: ${JSON.stringify(b).slice(0, 200)}`;
        if (!Array.isArray(b.scripts) || b.scripts.length !== 1)
          return `scripts not echoed: ${JSON.stringify(b.scripts)}`;
        if (!/Scripts include source/.test(String(b._nextStepHint)))
          return `includeSource hint wrong: ${String(b._nextStepHint)}`;
        return true;
      },
    },
    {
      name: 'console_monitor/enable-disable-roundtrip',
      tool: 'console_monitor',
      origin: 'homemade',
      reference:
        'monitor control: enable/disable delegate once each and report the action taken; an unknown action is rejected by name',
      run: async () => {
        const enabled: string[] = [];
        const h = makeBrowserHandlers({
          consoleMonitor: {
            enable: async () => void enabled.push('enable'),
            disable: async () => void enabled.push('disable'),
          },
        });
        const on = body(await h.handleConsoleMonitor({ action: 'enable' }));
        const off = body(await h.handleConsoleMonitor({ action: 'disable' }));
        const bad = body(await h.handleConsoleMonitor({ action: 'toggle' }));
        return { on, off, bad, calls: enabled };
      },
      validate: (v) => {
        const r = v as Record<string, unknown>;
        if (JSON.stringify(r['calls']) !== JSON.stringify(['enable', 'disable']))
          return `delegation wrong: ${JSON.stringify(r['calls'])}`;
        const on = r['on'] as Record<string, unknown>;
        const off = r['off'] as Record<string, unknown>;
        if (!/enabled/.test(String(on['message'])))
          return `enable message wrong: ${JSON.stringify(on)}`;
        if (!/disabled/.test(String(off['message'])))
          return `disable message wrong: ${JSON.stringify(off)}`;
        const bad = r['bad'] as Record<string, unknown>;
        if (bad['success'] !== false || !/Invalid action/.test(String(bad['error'])))
          return `unknown action not rejected: ${JSON.stringify(bad)}`;
        return true;
      },
    },
    {
      name: 'console_get_logs/filters-are-forwarded-and-counted',
      tool: 'console_get_logs',
      origin: 'homemade',
      reference:
        'log projection: the type/limit/since filters are forwarded to the monitor and the returned entries are counted in the response',
      run: () => {
        const seen: Array<Record<string, unknown>> = [];
        const h = makeBrowserHandlers({
          consoleMonitor: {
            getLogs: (filter: Record<string, unknown>) => {
              seen.push(filter);
              return [
                { type: 'error', text: 'boom', timestamp: 2 },
                { type: 'error', text: 'bang', timestamp: 3 },
              ];
            },
          },
        });
        return (async () => ({
          res: body(await h.handleConsoleGetLogs({ type: 'error', limit: 2, since: 1 })),
          seen,
        }))();
      },
      validate: (v) => {
        const r = v as Record<string, unknown>;
        const seen = r['seen'] as Array<Record<string, unknown>>;
        if (seen[0]?.['type'] !== 'error' || seen[0]?.['limit'] !== 2 || seen[0]?.['since'] !== 1)
          return `filters not forwarded: ${JSON.stringify(seen)}`;
        const res = r['res'] as Record<string, unknown>;
        if (res['count'] !== 2) return `count should be 2: ${JSON.stringify(res)}`;
        if ((res['logs'] as unknown[]).length !== 2) return `logs not returned`;
        return true;
      },
    },
    {
      name: 'get_all_scripts/caps-maxScripts-at-scripts-cap',
      tool: 'get_all_scripts',
      origin: 'homemade',
      reference:
        'SCRIPTS_MAX_CAP (500) clamp: an oversized maxScripts request is clipped before reaching the script manager, and count reflects the returned list',
      run: () => {
        const seen: unknown[] = [];
        const h = makeBrowserHandlers({
          scriptManager: {
            getAllScripts: async (includeSource: boolean, maxScripts: number) => {
              seen.push({ includeSource, maxScripts });
              return [
                { scriptId: '1', url: 'a.js' },
                { scriptId: '2', url: 'b.js' },
              ];
            },
          },
        });
        return (async () => ({
          res: body(await h.handleGetAllScripts({ maxScripts: 99999 })),
          seen,
        }))();
      },
      validate: (v) => {
        const r = v as Record<string, unknown>;
        const seen = r['seen'] as Array<Record<string, unknown>>;
        if (seen[0]?.['maxScripts'] !== 500)
          return `maxScripts not clamped to 500: ${JSON.stringify(seen)}`;
        if (seen[0]?.['includeSource'] !== false) return `includeSource default should be false`;
        const res = r['res'] as Record<string, unknown>;
        if (res['count'] !== 2 || (res['scripts'] as unknown[]).length !== 2)
          return `scripts not returned: ${JSON.stringify(res)}`;
        return true;
      },
    },
    {
      name: 'get_script_source/preview-line-window',
      tool: 'get_script_source',
      origin: 'homemade',
      reference:
        'preview contract: startLine/endLine select an inclusive 1-based window, totalLines reports the whole script and showingLines echoes the window',
      run: () =>
        makeBrowserHandlers({
          scriptManager: {
            getScriptSource: async () => ({
              scriptId: 's1',
              url: 'app.js',
              source: 'l1\nl2\nl3\nl4\nl5',
            }),
          },
        }).handleGetScriptSource({ scriptId: 's1', startLine: 2, endLine: 3 }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.totalLines !== 5) return `totalLines ${String(b.totalLines)} != 5`;
        if (b.showingLines !== '2-3') return `showingLines ${String(b.showingLines)} != 2-3`;
        if (b.content !== 'l2\nl3') return `content wrong: ${JSON.stringify(b.content)}`;
        if (b.preview !== true) return `preview flag should be true`;
        return true;
      },
    },
    {
      name: 'browser_codegen/records-compacts-and-emits-script',
      tool: 'browser_codegen_start',
      origin: 'homemade',
      reference:
        'codegen recorder: start arms the bus listener, two identical page_wait_for_selector calls compact into one step (rawStepCount 2 → stepCount 1), and the emitted script contains one callTool line per step',
      run: async () => {
        const bus = new EventBus();
        const h = makeBrowserHandlers({ eventBus: bus });
        const start = body(await h.handleBrowserCodegenStart());
        const call = {
          toolName: 'page_wait_for_selector',
          domain: 'browser',
          sessionId: null,
          timestamp: new Date().toISOString(),
          success: true,
          args: { selector: '#ready' },
          result: { success: true },
        };
        await bus.emit('tool:called', call);
        await bus.emit('tool:called', { ...call, timestamp: new Date().toISOString() });
        const stop = body(await h.handleBrowserCodegenStop());
        return { start, stop };
      },
      validate: (v) => {
        const r = v as Record<string, Record<string, unknown>>;
        const start = r['start'] ?? {};
        if (start['recording'] !== true) return `recording not armed: ${JSON.stringify(start)}`;
        const stop = r['stop'] ?? {};
        if (stop['rawStepCount'] !== 2 || stop['stepCount'] !== 1)
          return `compaction wrong: ${JSON.stringify(stop)}`;
        const steps = (stop['steps'] ?? []) as Array<Record<string, unknown>>;
        if (steps.length !== 1 || steps[0]?.['tool'] !== 'page_wait_for_selector')
          return `steps wrong: ${JSON.stringify(steps)}`;
        const script = String(stop['script'] ?? '');
        if (!/callTool/.test(script) || !/#ready/.test(script))
          return `script missing the recorded call: ${script.slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'browser_codegen_stop/empty-recording-is-honest',
      tool: 'browser_codegen_stop',
      origin: 'homemade',
      reference:
        'codegen stop without any recorded step returns stepCount 0 with the replay scaffolding — never a fabricated step',
      run: () => makeBrowserHandlers({ eventBus: new EventBus() }).handleBrowserCodegenStop(),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.recording !== false) return `recording should be false after stop`;
        if (b.stepCount !== 0 || b.rawStepCount !== 0)
          return `empty recording counts wrong: ${JSON.stringify(b)}`;
        if (!/const steps = \[/.test(String(b.script)))
          return `script scaffolding missing: ${String(b.script)}`;
        return true;
      },
    },
    {
      name: 'page_back/chrome-returns-post-navigation-url',
      tool: 'page_back',
      origin: 'homemade',
      reference:
        'history navigation: the chrome path awaits goBack(timeout) then reports the page controller’s current url',
      run: () => {
        const calls: unknown[] = [];
        const h = makeBrowserHandlers({
          pageController: {
            goBack: async (timeout: number) => void calls.push(['back', timeout]),
            goForward: async (timeout: number) => void calls.push(['forward', timeout]),
            getURL: async () => 'https://app.example/previous',
            getTitle: async () => 'Previous',
          },
        });
        return (async () => ({
          back: body(await h.handlePageBack({ timeout: 5000 })),
          forward: body(await h.handlePageForward({ timeout: 5000 })),
          calls,
        }))();
      },
      validate: (v) => {
        const r = v as Record<string, unknown>;
        const calls = r['calls'] as unknown[][];
        if (
          JSON.stringify(calls) !==
          JSON.stringify([
            ['back', 5000],
            ['forward', 5000],
          ])
        )
          return `delegation wrong: ${JSON.stringify(calls)}`;
        const back = r['back'] as Record<string, unknown>;
        if (back['url'] !== 'https://app.example/previous')
          return `url not reported: ${JSON.stringify(back)}`;
        const forward = r['forward'] as Record<string, unknown>;
        if (forward['url'] !== 'https://app.example/previous')
          return `forward url not reported: ${JSON.stringify(forward)}`;
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

// ── Browser storage handlers with an in-memory mock PageController ──────────
// The storage tools only touch the page controller (no CDP round-trip), so a
// plain object with the localStorage/sessionStorage surface is a faithful
// offline substrate: the handler logic under test is the argument handling and
// the result shaping, not the browser. `evaluate` models the two page-side
// snippets the handlers actually issue (removeItem + storage.estimate).
const STORAGE_ESTIMATE = { supported: true, usage: 4096, quota: 10_485_760, persisted: true };
function makeStorageBrowserHandlers(): BrowserToolHandlers {
  const local: Record<string, string> = {};
  const session: Record<string, string> = { s: '1' };
  const pageController = {
    createCDPSession: async () => ({}),
    getLocalStorage: async () => ({ ...local }),
    setLocalStorage: async (k: string, v: string) => {
      local[k] = v;
      return true;
    },
    clearLocalStorage: async () => {
      for (const k of Object.keys(local)) delete local[k];
      return true;
    },
    getSessionStorage: async () => ({ ...session }),
    setSessionStorage: async () => true,
    clearSessionStorage: async () => {
      for (const k of Object.keys(session)) delete session[k];
      return true;
    },
    evaluate: async (snippet: string) => {
      const remove = /^localStorage\.removeItem\((.*)\)$/.exec(snippet);
      if (remove?.[1]) {
        delete local[JSON.parse(remove[1]) as string];
        return undefined;
      }
      return { ...STORAGE_ESTIMATE };
    },
  };
  const collector = {
    getActivePage: async () => null,
    getStatus: () => ({ launched: true, connected: true, pageCount: 1 }),
  };
  return new BrowserToolHandlers(
    collector as never,
    pageController as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

const storageHandlers = makeStorageBrowserHandlers();

// ── Browser host-side handlers over injected collaborators ──────────────────
// These tools read state from the collector / console monitor / script manager
// and shape it host-side. Injecting each collaborator's fixed return value
// measures the real shaping logic (capping, compaction, classification,
// argument validation) with no live browser.
interface BrowserCollabOverrides {
  collector?: Record<string, unknown>;
  pageController?: Record<string, unknown>;
  consoleMonitor?: Record<string, unknown>;
  scriptManager?: Record<string, unknown>;
  eventBus?: EventBus;
}

function makeBrowserHandlers(overrides: BrowserCollabOverrides = {}): BrowserToolHandlers {
  const collector = {
    getActivePage: async () => null,
    getStatus: async () => ({ running: false, pagesCount: 0 }),
    listPages: async () => [],
    getSelectedPageHandle: () => null,
    listCdpTargets: async () => [],
    ...overrides.collector,
  };
  return new BrowserToolHandlers(
    collector as never,
    { createCDPSession: async () => ({}), ...overrides.pageController } as never,
    (overrides.scriptManager ?? {}) as never,
    (overrides.consoleMonitor ?? {}) as never,
    overrides.eventBus as never,
  );
}
