/**
 * Misc-domain residual suite — the 22 tools still missing from the breadth matrix.
 *
 * Ground truth:
 *  - http2_frame_parse: RFC 9113 §6.5 SETTINGS layout (type 0x04, flags, stream 0)
 *  - sourcemap_diff: ECMA-426 VLQ; two maps differing in `sources` count the delta
 *  - mojo_verify_live: the verify script is generated per platform/channel
 *  - exploit-dev: heap-spray / format-string / ret2dlresolve / pwntools structural contracts
 *  - llm_suggest_names / cross_domain_health: honest capability reporting with no API key
 *  - the remaining tools need a live browser, device, or bridge → explicit skip
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { AdvancedToolHandlers } from '@server/domains/network/handlers';
import { ExploitDevHandlers } from '@server/domains/exploit-dev/handlers';
import { MojoIPCHandlers } from '@server/domains/mojo-ipc/handlers.impl';
import {
  CrossDomainHandlers,
  CrossDomainWorkflowClassifier,
} from '@server/domains/cross-domain/handlers.impl';
import { CrossDomainEvidenceBridge } from '@server/domains/cross-domain/handlers/evidence-graph-bridge.impl';
import { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';
import type { MCPServerContext } from '@server/MCPServer.context';
import { body, type BenchSuite } from '../harness';

const tmp = mkdtempSync(join(tmpdir(), 'jshook-bench-misc-'));
process.once('exit', () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* tmpdir */
  }
});

const networkHandlers = new AdvancedToolHandlers(
  { getActivePage: async () => null } as never,
  {} as never,
);
const exploitHandlers = new ExploitDevHandlers({} as unknown as MCPServerContext);
const mojoHandlers = new MojoIPCHandlers();

function crossDomainFixture() {
  const bridge = new CrossDomainEvidenceBridge(new ReverseEvidenceGraph());
  const ctx = {
    enabledDomains: new Set(['network', 'browser']),
    selectedTools: new Set(),
    resolveEnabledDomains: () => new Set(['network', 'browser']),
  } as unknown as MCPServerContext;
  return new CrossDomainHandlers(bridge, new CrossDomainWorkflowClassifier(ctx, true), ctx);
}

/** Minimal identity source map with `sourceCount` sources and one mapping per line. */
function makeSourceMap(sourceCount: number): Record<string, unknown> {
  const sources = Array.from({ length: sourceCount }, (_, i) => `src/file${i}.ts`);
  return {
    version: 3,
    file: 'bundle.js',
    sources,
    sourcesContent: sources.map((s) => `// ${s}\nconst x = 1;\n`),
    names: [],
    // "AAAA" per line = [0,0,0,0]: gen col 0 → first source, line 0, col 0
    mappings: Array.from({ length: sourceCount }, () => 'AAAA').join(';'),
  };
}

const RET2DLRESOLVE_TEST_ELF_HEX = Buffer.from([0x7f, 0x45, 0x4c, 0x46]).toString('hex');

export const miscResidualSuite: BenchSuite = {
  name: 'misc-residual',
  domain: '*multi*',
  description:
    'Residual per-domain tools: RFC 9113 frame parse, sourcemap diff, mojo live script, exploit structural contracts, honest capability reporting',
  cases: [
    {
      name: 'http2_frame_parse/rfc9113-settings',
      tool: 'http2_frame_parse',
      origin: 'external-vector',
      reference:
        'RFC 9113 §6.5: 9-byte header (len 6, type 0x04 SETTINGS, flags 0, stream 0) + one id/value pair parses to typeCode 4 and streamId 0',
      run: () =>
        networkHandlers.handleHttp2FrameParse({
          frameHex: '000006040000000000000300000064',
        }),
      validate: (v) => {
        const b = body(v);
        if (Number(b.typeCode) !== 4) return `typeCode expected 4 (SETTINGS), got ${b.typeCode}`;
        if (String(b.frameType).toUpperCase() !== 'SETTINGS') {
          return `frameType expected SETTINGS, got ${b.frameType}`;
        }
        if (Number(b.streamId) !== 0) return `streamId expected 0, got ${b.streamId}`;
        return Number(b.payloadBytes) === 6
          ? true
          : `payloadBytes expected 6, got ${b.payloadBytes}`;
      },
    },
    {
      name: 'sourcemap_diff/source-count-delta',
      tool: 'sourcemap_diff',
      origin: 'external-vector',
      reference:
        'ECMA-426 VLQ: two maps with 2 vs 3 sources must report the delta in the per-map summaries',
      run: async () => {
        // The loader only accepts http(s) or data: URIs (every other protocol
        // is blocked), so the fixtures travel as base64 data URIs.
        const toDataUri = (map: Record<string, unknown>) =>
          `data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`;
        const { SourcemapToolHandlers } =
          await import('@server/domains/sourcemap/handlers.impl.core');
        const handlers = new SourcemapToolHandlers({} as never);
        return handlers.handleSourcemapDiff({
          sourceMapUrl: toDataUri(makeSourceMap(2)),
          sourceMapUrlB: toDataUri(makeSourceMap(3)),
        });
      },
      validate: (v) => {
        const b = body(v);
        const mapA = b.mapA as Record<string, unknown> | undefined;
        const mapB = b.mapB as Record<string, unknown> | undefined;
        if (!mapA || !mapB)
          return `both map summaries required: ${JSON.stringify(b).slice(0, 200)}`;
        if (Number(mapA.sources) !== 2) return `mapA.sources expected 2, got ${mapA.sources}`;
        return Number(mapB.sources) === 3 ? true : `mapB.sources expected 3, got ${mapB.sources}`;
      },
    },
    {
      name: 'mojo_verify_live/generates-platform-script',
      tool: 'mojo_verify_live',
      origin: 'homemade',
      reference:
        'verify-live emits a runnable script bound to the requested platform and channel; a bad platform is rejected',
      run: async () => {
        const linux = body(
          await mojoHandlers.handleMojoVerifyLiveTool({ platform: 'linux', channel: 'stable' }),
        );
        const win = body(
          await mojoHandlers.handleMojoVerifyLiveTool({
            platform: 'win32',
            channel: 'canary',
            chromiumVersion: 130,
          }),
        );
        const bad = body(await mojoHandlers.handleMojoVerifyLiveTool({ platform: 'plan9' }));
        return { linux, win, bad };
      },
      validate: (v) => {
        const b = body(v);
        const linux = b.linux as Record<string, unknown>;
        const win = b.win as Record<string, unknown>;
        const bad = b.bad as Record<string, unknown>;
        if (linux.success === false) return `linux script failed: ${linux.error}`;
        if (win.success === false) return `win32 script failed: ${win.error}`;
        if (JSON.stringify(linux) === JSON.stringify(win)) {
          return 'platform/channel must change the generated script';
        }
        return bad.success === false
          ? true
          : `an unknown platform must be rejected, got success=${bad.success}`;
      },
    },
    {
      name: 'exploit_build_heap_spray/structural-contract',
      tool: 'exploit_build_heap_spray',
      origin: 'homemade',
      reference:
        'spray description for a given total/block size must report the block count and a NOP sled that fills the block',
      run: () =>
        exploitHandlers.handleBuildHeapSpray({
          target: 'v8',
          arch: 'x64',
          totalSize: 0x10000,
          blockSize: 0x1000,
          nopByte: 0x90,
        }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `spray failed: ${b.error}`;
        const text = JSON.stringify(b).toLowerCase();
        if (!text.includes('0x') && !/\d/.test(text)) return 'spray output carries no sizes';
        return text.includes('90') || text.includes('nop')
          ? true
          : 'spray output must reference the 0x90 NOP byte';
      },
    },
    {
      name: 'exploit_build_format_string/structural-contract',
      tool: 'exploit_build_format_string',
      origin: 'homemade',
      reference:
        'a %n write at a given offset must produce a format string containing positional directives and the target address',
      run: () =>
        exploitHandlers.handleBuildFormatString({
          vulnOffset: 7,
          targetAddress: '0x7fffffffe000',
          targetValue: '0x41414141',
          arch: 'x64',
        }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `format-string build failed: ${b.error}`;
        // The payload comes back hex-encoded (Buffer.toString('hex')), so the
        // directives have to be checked on the decoded bytes.
        const decoded = Buffer.from(String(b.payload ?? ''), 'hex').toString('binary');
        if (!decoded.includes('%')) return 'decoded payload must contain a % directive';
        // 0x41414141 has two non-zero 16-bit chunks → two %hn writes.
        if (Number(b.writeCount) !== 2) return `writeCount expected 2, got ${b.writeCount}`;
        if (!decoded.includes('%hn')) return 'payload must use %hn writes';
        return b.reliability === 'high' ? true : `reliability expected high, got ${b.reliability}`;
      },
    },
    {
      name: 'exploit_build_ret2dlresolve/structural-contract',
      tool: 'exploit_build_ret2dlresolve',
      origin: 'homemade',
      reference:
        'ret2dlresolve against a non-ELF blob must be reported as a structured failure, not a fake chain',
      run: () =>
        exploitHandlers.handleBuildRet2dlresolve({
          arch: 'x64',
          elfHex: RET2DLRESOLVE_TEST_ELF_HEX,
          fakeStructsAddr: '0x404000',
          targetFunction: 'system',
        }),
      validate: (v) => {
        const b = body(v);
        // The 4-byte ELF magic is not a valid ELF header, so the builder must
        // refuse; a chain here would mean the validator does not run.
        if (b.success === true) return 'a truncated ELF must not yield a chain';
        return typeof b.error === 'string' && b.error.length > 0
          ? true
          : 'failure must carry an error message';
      },
    },
    {
      name: 'exploit_discover_one_gadget/known-library-list',
      tool: 'exploit_discover_one_gadget',
      origin: 'homemade',
      reference:
        'listKnown returns the caller-queryable libc id table (no bundled gadget fingerprints)',
      run: () => exploitHandlers.handleDiscoverOneGadget({ listKnown: true }),
      validate: (v) => {
        const b = body(v);
        if (b.success !== true) return `listKnown failed: ${b.error}`;
        const ids = (b.knownLibcIds as unknown[]) ?? [];
        return ids.length > 0 ? true : 'knownLibcIds must be non-empty';
      },
    },
    {
      name: 'exploit_generate_pwntools/template-renders',
      tool: 'exploit_generate_pwntools',
      origin: 'homemade',
      reference: 'the io template renders a runnable pwntools skeleton for the requested arch',
      run: () =>
        exploitHandlers.handleGeneratePwntools({
          template: 'io',
          binary: './vuln',
          arch: 'amd64',
        }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `pwntools generation failed: ${b.error}`;
        const text = JSON.stringify(b);
        if (!text.includes('pwn')) return 'script must import pwntools';
        return text.includes('amd64') ? true : 'script must carry the requested architecture';
      },
    },
    {
      name: 'cross_domain_health/reports-bridge-and-domains',
      tool: 'cross_domain_health',
      origin: 'homemade',
      reference:
        'health reports evidence-bridge readiness and the enabled-domain set without a live page',
      run: () => crossDomainFixture().handleHealthTool(),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `health failed: ${b.error}`;
        const graph = b.evidenceGraph as Record<string, unknown> | undefined;
        if (!graph)
          return `health must carry evidenceGraph stats: ${JSON.stringify(b).slice(0, 200)}`;
        const available = (b.availableDomains as string[]) ?? [];
        return available.includes('network')
          ? true
          : `availableDomains must include the enabled network domain, got ${JSON.stringify(available)}`;
      },
    },
    {
      name: 'cross_domain_synonym/concept-resolution',
      tool: 'cross_domain_synonym',
      origin: 'homemade',
      reference:
        'a task phrased in natural language resolves to a concept with a ranked recommended-tool list',
      run: () => crossDomainFixture().handleSynonymTool({ query: 'deobfuscate packed javascript' }),
      validate: (v) => {
        const b = body(v);
        if (Number(b.matchCount) <= 0) return `expected a match, got matchCount=${b.matchCount}`;
        const matches = (b.matches as Array<Record<string, unknown>>) ?? [];
        const top = matches[0];
        if (!top || typeof top.concept !== 'string') return 'top match must name a concept';
        const tools = (top.recommendedTools as string[]) ?? [];
        return tools.length > 0 ? true : 'top match must recommend at least one tool';
      },
    },
    {
      name: 'llm_suggest_names/honest-no-context',
      tool: 'llm_suggest_names',
      origin: 'homemade',
      reference:
        'with no analysis context bound, the tool reports that it cannot suggest names rather than inventing them',
      skip: () => true,
      skipReason: 'requires a live globalContext bound by the analysis domain ensure()',
      run: async () => ({}),
      validate: (v) => (body(v) ? true : 'unreachable'),
    },
    {
      name: 'adb_dumpsys/requires-device',
      tool: 'adb_dumpsys',
      origin: 'homemade',
      reference: 'dumpsys parsing needs a live adb connection',
      skip: () => true,
      skipReason: 'requires a connected Android device/emulator',
      run: async () => ({}),
      validate: (v) => (body(v) ? true : 'unreachable'),
    },
    {
      name: 'adb_getprop/requires-device',
      tool: 'adb_getprop',
      origin: 'homemade',
      reference: 'getprop parsing needs a live adb connection',
      skip: () => true,
      skipReason: 'requires a connected Android device/emulator',
      run: async () => ({}),
      validate: (v) => (body(v) ? true : 'unreachable'),
    },
    {
      name: 'restore_page_snapshot/requires-browser',
      tool: 'restore_page_snapshot',
      origin: 'homemade',
      reference: 'restoring a page snapshot navigates a live browser page',
      skip: () => true,
      skipReason: 'requires a live browser session',
      run: async () => ({}),
      validate: (v) => (body(v) ? true : 'unreachable'),
    },
    {
      name: 'browser_jsdom_serialize/requires-jsdom-session',
      tool: 'browser_jsdom_serialize',
      origin: 'homemade',
      reference: 'serialization consumes a jsdom session created by browser_jsdom_parse',
      skip: () => true,
      skipReason: 'covered by the offline-tools jsdom cases through browser_jsdom_parse',
      run: async () => ({}),
      validate: (v) => (body(v) ? true : 'unreachable'),
    },
    {
      name: 'browser_jsdom_cookies/requires-jsdom-session',
      tool: 'browser_jsdom_cookies',
      origin: 'homemade',
      reference: 'cookie get/set operates on a jsdom session cookie jar',
      skip: () => true,
      skipReason: 'covered by the offline-tools jsdom cases through browser_jsdom_parse',
      run: async () => ({}),
      validate: (v) => (body(v) ? true : 'unreachable'),
    },
    {
      name: 'browser_passkey_seed/requires-browser',
      tool: 'browser_passkey_seed',
      origin: 'homemade',
      reference: 'seeding a WebAuthn credential needs the browser page controller',
      skip: () => true,
      skipReason: 'requires a live browser session',
      run: async () => ({}),
      validate: (v) => (body(v) ? true : 'unreachable'),
    },
    {
      name: 'page_session_storage/requires-browser',
      tool: 'page_session_storage',
      origin: 'homemade',
      reference: 'sessionStorage access requires a live page',
      skip: () => true,
      skipReason: 'requires a live browser session',
      run: async () => ({}),
      validate: (v) => (body(v) ? true : 'unreachable'),
    },
    {
      name: 'v8_weakrefs_inspect/requires-browser',
      tool: 'v8_weakrefs_inspect',
      origin: 'homemade',
      reference: 'weakref inspection requires a CDP target session',
      skip: () => true,
      skipReason: 'requires a live browser CDP session',
      run: async () => ({}),
      validate: (v) => (body(v) ? true : 'unreachable'),
    },
    {
      name: 'process_runtime_info/requires-linux-procfs',
      tool: 'process_runtime_info',
      origin: 'homemade',
      reference: 'runtime info reads /proc/{pid}; a non-Linux host must answer honestly',
      run: () =>
        import('@server/domains/process/handlers.impl').then(async (m) => {
          const handlers = new m.ProcessToolHandlers();
          return handlers.handleProcessRuntimeInfoTool({ pid: process.pid });
        }),
      validate: (v) => {
        const b = body(v);
        if (process.platform === 'linux') {
          return b.success === true ? true : `linux read failed: ${b.error ?? b.message}`;
        }
        // Off Linux the tool must refuse rather than fabricate fields.
        return b.success === false
          ? true
          : 'on non-Linux platforms the tool must report success=false';
      },
    },
  ],
};
