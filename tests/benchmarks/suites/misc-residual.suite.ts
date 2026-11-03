/**
 * Misc-domain residual suite — tools outside the domain-themed suites that are
 * still answerable with no browser, device, or bridge attached.
 *
 * Ground truth per case:
 *  - mojo_verify_live: the emitted script is bound to the requested platform and
 *    an unknown platform is rejected (B-class symbol DB, verified: false)
 *  - exploit-dev: heap-spray geometry and pwntools template contracts
 *  - cross-domain: health reports the evidence bridge + enabled domains; the
 *    synonym engine resolves a natural-language query to ranked tools
 *  - process_runtime_info: reads /proc on Linux, refuses honestly elsewhere
 *
 * Cases that need a live browser, an Android device, or a bound analysis
 * context stay listed with `skip` so the scorecard records them as unmeasured
 * rather than silently absent.
 *
 * Tools already covered by a domain suite (http2_frame_parse,
 * exploit_build_format_string, exploit_build_ret2dlresolve,
 * exploit_discover_one_gadget) are deliberately not duplicated here.
 */
/**
 * Misc-domain residual suite — tools that no domain-themed suite covers.
 *
 * Two kinds of case live here, and only the first kind carries weight:
 *
 *  - LIVE (6): the first and only vector case for their tool, so they raise that
 *    tool's correctness row off "no vector case". All run without a browser,
 *    device, or bridge: mojo_verify_live emits a script, exploit-dev's
 *    heap-spray / pwntools builders are offline, cross-domain health + synonym
 *    resolution are pure, and process_runtime_info is /proc or an honest refusal.
 *
 *  - PLACEHOLDER (~10): tools that need a live browser, an Android device, or a
 *    bound analysis context. They are NOT marked as the tool's vector case,
 *    because the scorecard would then print "0/1 vectors" — indistinguishable
 *    from a tool whose single vector genuinely failed. Making them live vectors
 *    would equally poison the ratio of an already-covered tool (sourcemap_diff
 *    would read 0/2). They exist so the suite's count is auditable and the
 *    reason each tool is unmeasured is recorded in one place.
 *
 * Tools already covered by a domain suite (http2_frame_parse,
 * exploit_build_format_string, exploit_build_ret2dlresolve,
 * exploit_discover_one_gadget) are deliberately not listed here at all.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ProcessToolHandlers } from '@server/domains/process/handlers.impl';
import { ExploitDevHandlers } from '@server/domains/exploit-dev/handlers';
import { MojoIPCHandlers } from '@server/domains/mojo-ipc/handlers.impl';
import {
  CrossDomainHandlers,
  CrossDomainWorkflowClassifier,
} from '@server/domains/cross-domain/handlers.impl';
import { CrossDomainEvidenceBridge } from '@server/domains/cross-domain/handlers/evidence-graph-bridge.impl';
import { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';
import type { MCPServerContext } from '@server/MCPServer.context';
import { body, type BenchCase, type BenchSuite } from '../harness';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const exploitHandlers = new ExploitDevHandlers({} as unknown as MCPServerContext);
const mojoHandlers = new MojoIPCHandlers();

/**
 * The tool is already the subject of a case in a domain suite, so its scorecard
 * correctness row is already sourced. A placeholder here is therefore invisible
 * to `measureVectorBenches` (it counts every case for a tool), which keeps the
 * domain suite's verdict as the tool's only one.
 */
function coveredByDomainSuite(tool: string): boolean {
  const suitesDir = join(ROOT, 'tests/benchmarks/suites');
  const files = readdirSync(suitesDir).filter(
    (f) => f.endsWith('.suite.ts') && f !== 'misc-residual.suite.ts',
  );
  const re = new RegExp(`tool:\\s*'${tool}'`);
  return files.some((f) => re.test(readFileSync(join(suitesDir, f), 'utf8')));
}

/**
 * A placeholder case. Kept out of `measureVectorBenches` while its tool is still
 * covered elsewhere; the moment the domain case disappears it becomes a real
 * "unmeasured" vector, which is the honest state.
 */
function placeholder(c: BenchCase): BenchCase {
  const covered = coveredByDomainSuite(c.tool);
  return {
    ...c,
    skip: () => true,
    skipReason: covered
      ? `${c.skipReason} (covered by its domain suite; not the tool's vector case)`
      : c.skipReason,
  };
}

function crossDomainFixture() {
  const bridge = new CrossDomainEvidenceBridge(new ReverseEvidenceGraph());
  const ctx = {
    enabledDomains: new Set(['network', 'browser']),
    selectedTools: new Set(),
    resolveEnabledDomains: () => new Set(['network', 'browser']),
  } as unknown as MCPServerContext;
  return new CrossDomainHandlers(bridge, new CrossDomainWorkflowClassifier(ctx, true), ctx);
}

export const miscResidualSuite: BenchSuite = {
  name: 'misc-residual',
  domain: '*multi*',
  description:
    'Residual tools with no domain-themed suite: mojo live script, spray/pwntools contracts, cross-domain health + synonym resolution, honest process-runtime reporting',
  cases: [
    {
      name: 'mojo_verify_live/generates-platform-script',
      tool: 'mojo_verify_live',
      origin: 'homemade',
      reference:
        'verify-live emits a Frida script bound to the requested platform/channel, reports it as unverified, and rejects an unknown platform',
      run: async () => {
        const linux = body(await mojoHandlers.handleMojoVerifyLiveTool({ platform: 'linux' }));
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
        const linuxScript = String(linux.fridaScript ?? '');
        const winScript = String(win.fridaScript ?? '');
        if (!linuxScript.includes('Frida') && !linuxScript.includes('Module.')) {
          return `linux script is not a Frida probe: ${linuxScript.slice(0, 120)}`;
        }
        if (linux.verified !== false || win.verified !== false) {
          return 'verify-live must report verified=false (it probes, it does not confirm)';
        }
        if (linuxScript === winScript) {
          return 'platform/channel must change the generated script';
        }
        return bad.success === false
          ? true
          : `an unknown platform must be rejected, got success=${bad.success}`;
      },
    },
    {
      name: 'exploit_build_heap_spray/block-geometry',
      tool: 'exploit_build_heap_spray',
      origin: 'homemade',
      reference:
        'a 64KB spray in 4KB pages must report 16 allocations covering exactly the requested total',
      run: async () =>
        body(
          await exploitHandlers.handleBuildHeapSpray({
            target: 'v8',
            arch: 'x64',
            totalSize: 0x10000,
            blockSize: 0x1000,
            nopByte: 0x90,
          }),
        ),
      validate: (v) => {
        const b = body(v);
        if (Number(b.allocationCount) !== 16) {
          return `allocationCount expected 16 (0x10000/0x1000), got ${b.allocationCount}`;
        }
        if (Number(b.totalMemory) !== 0x10000) {
          return `totalMemory expected 0x10000, got ${b.totalMemory}`;
        }
        const code = String(b.code ?? '');
        return code.includes('const sprayCount = 16')
          ? true
          : `generated code must allocate 16 blocks: ${code.slice(0, 120)}`;
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
        if (b.evidenceBridgeReady !== true) return 'evidenceBridgeReady must be true';
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
    // ── Placeholders: tools that need an external substrate. See the header
    //    comment for why these are not marked as their tool's vector case. ──
    ...(
      [
        {
          name: 'sourcemap_diff/needs-two-maps',
          tool: 'sourcemap_diff',
          origin: 'homemade',
          reference: 'ECMA-426 VLQ diff across two maps',
          skipReason:
            'the diff path resolves both map URLs through the collector; parsing is measured',
          run: async () => ({}),
          validate: (v: unknown) => (body(v) ? true : 'unreachable'),
        },
        {
          name: 'restore_page_snapshot/requires-browser',
          tool: 'restore_page_snapshot',
          origin: 'homemade',
          reference: 'restoring a page snapshot navigates a live browser page',
          skipReason: 'requires a live browser session',
          run: async () => ({}),
          validate: (v: unknown) => (body(v) ? true : 'unreachable'),
        },
        {
          name: 'browser_jsdom_serialize/requires-jsdom-session',
          tool: 'browser_jsdom_serialize',
          origin: 'homemade',
          reference: 'serialization consumes a jsdom session created by browser_jsdom_parse',
          skipReason: 'covered by the offline-tools jsdom cases through browser_jsdom_parse',
          run: async () => ({}),
          validate: (v: unknown) => (body(v) ? true : 'unreachable'),
        },
        {
          name: 'browser_jsdom_cookies/requires-jsdom-session',
          tool: 'browser_jsdom_cookies',
          origin: 'homemade',
          reference: 'cookie get/set operates on a jsdom session cookie jar',
          skipReason: 'covered by the offline-tools jsdom cases through browser_jsdom_parse',
          run: async () => ({}),
          validate: (v: unknown) => (body(v) ? true : 'unreachable'),
        },
        {
          name: 'browser_passkey_seed/requires-browser',
          tool: 'browser_passkey_seed',
          origin: 'homemade',
          reference: 'seeding a WebAuthn credential needs the browser page controller',
          skipReason: 'requires a live browser session',
          run: async () => ({}),
          validate: (v: unknown) => (body(v) ? true : 'unreachable'),
        },
        {
          name: 'page_session_storage/requires-browser',
          tool: 'page_session_storage',
          origin: 'homemade',
          reference: 'sessionStorage access requires a live page',
          skipReason: 'requires a live browser session',
          run: async () => ({}),
          validate: (v: unknown) => (body(v) ? true : 'unreachable'),
        },
        {
          name: 'v8_weakrefs_inspect/requires-browser',
          tool: 'v8_weakrefs_inspect',
          origin: 'homemade',
          reference: 'weakref inspection requires a CDP target session',
          skipReason: 'requires a live browser CDP session',
          run: async () => ({}),
          validate: (v: unknown) => (body(v) ? true : 'unreachable'),
        },
        {
          name: 'adb_dumpsys/requires-device',
          tool: 'adb_dumpsys',
          origin: 'homemade',
          reference: 'dumpsys parsing needs a live adb connection',
          skipReason: 'requires a connected Android device/emulator',
          run: async () => ({}),
          validate: (v: unknown) => (body(v) ? true : 'unreachable'),
        },
        {
          name: 'adb_getprop/requires-device',
          tool: 'adb_getprop',
          origin: 'homemade',
          reference: 'getprop parsing needs a live adb connection',
          skipReason: 'requires a connected Android device/emulator',
          run: async () => ({}),
          validate: (v: unknown) => (body(v) ? true : 'unreachable'),
        },
        {
          name: 'llm_suggest_names/honest-no-context',
          tool: 'llm_suggest_names',
          origin: 'homemade',
          reference:
            'with no analysis context bound, the tool must say so rather than invent names',
          skipReason: 'requires a live globalContext bound by the analysis domain ensure()',
          run: async () => ({}),
          validate: (v: unknown) => (body(v) ? true : 'unreachable'),
        },
      ] satisfies BenchCase[]
    ).map(placeholder),
    {
      name: 'process_runtime_info/requires-linux-procfs',
      tool: 'process_runtime_info',
      origin: 'homemade',
      reference: 'runtime info reads /proc/{pid}; a non-Linux host must answer honestly',
      run: () => new ProcessToolHandlers().handleProcessRuntimeInfoTool({ pid: process.pid }),
      validate: (v) => {
        const b = body(v);
        if (process.platform === 'linux') {
          return b.success === true ? true : `linux read failed: ${b.error ?? b.message}`;
        }
        return b.success === false
          ? true
          : 'on non-Linux platforms the tool must report success=false';
      },
    },
  ],
};
