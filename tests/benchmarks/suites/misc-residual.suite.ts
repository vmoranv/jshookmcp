/**
 * Misc-domain residual suite — tools that no domain-themed suite covers.
 *
 * Two kinds of case live here, and only the first kind carries weight:
 *
 *  - LIVE (7): the first and only vector case for their tool, so they raise that
 *    tool's correctness row off "no vector case". All run without a browser,
 *    device, or bridge: mojo_verify_live emits a script, exploit-dev's
 *    heap-spray / pwntools builders are offline, cross-domain health + synonym
 *    resolution are pure, sourcemap_diff reads two inline `data:` maps, and
 *    process_runtime_info is /proc or an honest refusal.
 *
 *  - PLACEHOLDER (9): tools that need a live browser, an Android device, or a
 *    bound analysis context. They are skipped with an explicit reason and are
 *    NOT the tool's vector case: marking one as such would print
 *    "0/1 vectors", indistinguishable from a single vector that genuinely
 *    failed. Turning it into a real measurement instead would dilute an
 *    already-covered tool's ratio (a failing extra case reads 1/2). The list
 *    exists so the count is auditable and the reason each tool is unmeasured
 *    is recorded in one place.
 *
 * Tools already covered by a domain suite (http2_frame_parse,
 * exploit_build_format_string, exploit_build_ret2dlresolve,
 * exploit_discover_one_gadget) are deliberately not listed here at all.
 */
import { ProcessToolHandlers } from '@server/domains/process/handlers.impl';
import { ExploitDevHandlers } from '@server/domains/exploit-dev/handlers';
import { MojoIPCHandlers } from '@server/domains/mojo-ipc/handlers.impl';
import {
  CrossDomainHandlers,
  CrossDomainWorkflowClassifier,
} from '@server/domains/cross-domain/handlers.impl';
import { CrossDomainEvidenceBridge } from '@server/domains/cross-domain/handlers/evidence-graph-bridge.impl';
import { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';
import { SourcemapToolHandlers } from '@server/domains/sourcemap/handlers';
import type { MCPServerContext } from '@server/MCPServer.context';
import { body, type BenchCase, type BenchSuite } from '../harness';

const exploitHandlers = new ExploitDevHandlers({} as unknown as MCPServerContext);
const mojoHandlers = new MojoIPCHandlers();

/**
 * Fields a placeholder must spell out itself; `placeholder()` only fills the
 * no-op runner/validator. `skip: () => true` MUST stay a literal property of
 * each object: existing-tests-coverage's skipped-only scanner attributes tools
 * by reading the case blocks statically, and a skip injected by this wrapper
 * is invisible to it (the tool would read as exercised without ever running).
 */
type PlaceholderSpec = Omit<BenchCase, 'run' | 'validate'>;

/** A skipped case that records why the tool is unmeasured in this suite. */
function placeholder(spec: PlaceholderSpec): BenchCase {
  return {
    ...spec,
    run: async () => ({}),
    validate: () => true,
  };
}

/** Encode a v3 source map as an inline `data:` URI (same convention as sourcemap.suite). */
function inlineMap(map: Record<string, unknown>): string {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`;
}

function v3Map(sourceNames: string[]): Record<string, unknown> {
  return {
    version: 3,
    file: 'bundle.js',
    sources: sourceNames,
    names: [],
    // "AAAA" per line = [0,0,0,0]: gen col 0 -> first source, line 0, col 0
    mappings: sourceNames.map(() => 'AAAA').join(';'),
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
    'Residual tools with no domain-themed suite: mojo live script, spray/pwntools contracts, sourcemap diff, cross-domain health + synonym resolution, honest process-runtime reporting',
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
      name: 'sourcemap_diff/source-count-delta',
      tool: 'sourcemap_diff',
      origin: 'external-vector',
      reference:
        "ECMA-426 VLQ: two inline v3 maps with 2 vs 3 sources must report each map's source count",
      run: () =>
        new SourcemapToolHandlers({} as never).handleSourcemapDiff({
          sourceMapUrl: inlineMap(v3Map(['src/a.ts', 'src/b.ts'])),
          sourceMapUrlB: inlineMap(v3Map(['src/a.ts', 'src/b.ts', 'src/c.ts'])),
        }),
      validate: (v) => {
        const b = body(v);
        const mapA = b.mapA as Record<string, unknown> | undefined;
        const mapB = b.mapB as Record<string, unknown> | undefined;
        if (!mapA || !mapB) {
          return `both map summaries required: ${JSON.stringify(b).slice(0, 200)}`;
        }
        if (Number(mapA.sources) !== 2) return `mapA.sources expected 2, got ${mapA.sources}`;
        if (Number(mapB.sources) !== 3) return `mapB.sources expected 3, got ${mapB.sources}`;
        // The delta is the whole point of the tool: an all-zero diff means the
        // second map was never actually compared.
        const diff = (b.diff ?? {}) as Record<string, unknown>;
        return JSON.stringify(diff) !== '{}' ? true : 'diff must report the 2 -> 3 source change';
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
          name: 'restore_page_snapshot/requires-browser',
          tool: 'restore_page_snapshot',
          origin: 'homemade',
          reference: 'restoring a page snapshot navigates a live browser page',
          skip: () => true,
          skipReason: 'requires a live browser session',
        },
        {
          name: 'browser_jsdom_serialize/requires-jsdom-session',
          tool: 'browser_jsdom_serialize',
          origin: 'homemade',
          reference: 'serialization consumes a jsdom session created by browser_jsdom_parse',
          skip: () => true,
          skipReason: 'covered by the offline-tools jsdom cases through browser_jsdom_parse',
        },
        {
          name: 'browser_jsdom_cookies/requires-jsdom-session',
          tool: 'browser_jsdom_cookies',
          origin: 'homemade',
          reference: 'cookie get/set operates on a jsdom session cookie jar',
          skip: () => true,
          skipReason: 'covered by the offline-tools jsdom cases through browser_jsdom_parse',
        },
        {
          name: 'browser_passkey_seed/requires-browser',
          tool: 'browser_passkey_seed',
          origin: 'homemade',
          reference: 'seeding a WebAuthn credential needs the browser page controller',
          skip: () => true,
          skipReason: 'requires a live browser session',
        },
        {
          name: 'page_session_storage/requires-browser',
          tool: 'page_session_storage',
          origin: 'homemade',
          reference: 'sessionStorage access requires a live page',
          skip: () => true,
          skipReason: 'requires a live browser session',
        },
        {
          name: 'v8_weakrefs_inspect/requires-browser',
          tool: 'v8_weakrefs_inspect',
          origin: 'homemade',
          reference: 'weakref inspection requires a CDP target session',
          skip: () => true,
          skipReason: 'requires a live browser CDP session',
        },
        {
          name: 'adb_dumpsys/requires-device',
          tool: 'adb_dumpsys',
          origin: 'homemade',
          reference: 'dumpsys parsing needs a live adb connection',
          skip: () => true,
          skipReason: 'requires a connected Android device/emulator',
        },
        {
          name: 'adb_getprop/requires-device',
          tool: 'adb_getprop',
          origin: 'homemade',
          reference: 'getprop parsing needs a live adb connection',
          skip: () => true,
          skipReason: 'requires a connected Android device/emulator',
        },
        {
          name: 'llm_suggest_names/honest-no-context',
          tool: 'llm_suggest_names',
          origin: 'homemade',
          reference:
            'with no analysis context bound, the tool must say so rather than invent names',
          skip: () => true,
          skipReason:
            'requires a bind() deps bag without __runtimeCore (isolated harness only; MCPServer always injects it)',
        },
      ] satisfies PlaceholderSpec[]
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
