import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { dartInspectorTools } from '@server/domains/dart-inspector/definitions';
import type { DartInspectorHandlers } from '@server/domains/dart-inspector/index';

const DOMAIN = 'dart-inspector' as const;
const DEP_KEY = 'dartInspectorHandlers' as const;
type H = DartInspectorHandlers;
const t = toolLookup(dartInspectorTools);
const registrations = defineMethodRegistrations<H, (typeof dartInspectorTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'dart_strings_extract', method: 'handleDartStringsExtract' },
    { tool: 'dart_smi_scan', method: 'handleDartSmiScan' },
    { tool: 'dart_symbolize', method: 'handleDartSymbolize' },
    { tool: 'flutter_packages_detect', method: 'handleDartPackagesDetect' },
    { tool: 'dart_snapshot_header_parse', method: 'handleDartSnapshotHeaderParse' },
    { tool: 'dart_version_fingerprint', method: 'handleDartVersionFingerprint' },
    { tool: 'dart_object_pool_dump', method: 'handleDartObjectPoolDump' },
    { tool: 'dart_load_snapshot', method: 'handleDartLoadSnapshot' },
    { tool: 'dart_list_functions', method: 'handleDartListFunctions' },
    { tool: 'dart_call_function', method: 'handleDartCallFunction' },
    { tool: 'dart_inspect_object_pool', method: 'handleDartInspectObjectPool' },
    { tool: 'dart_trace_execution', method: 'handleDartTraceExecution' },
    { tool: 'dart_call_graph', method: 'handleDartCallGraph' },
    { tool: 'dart_pc_descriptors', method: 'handleDartPcDescriptors' },
    { tool: 'dart_create_session', method: 'handleDartCreateSession' },
    { tool: 'dart_destroy_session', method: 'handleDartDestroySession' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { DartInspectorHandlers } = await import('@server/domains/dart-inspector/index');
  if (!ctx.dartInspectorHandlers) {
    ctx.dartInspectorHandlers = new DartInspectorHandlers();
  }
  return ctx.dartInspectorHandlers;
}

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  dart_call_function: ['call a dart function', 'invoke the dart method'],
  dart_call_graph: ['dart function call graph', 'who calls whom in dart'],
  dart_create_session: ['open a dart snapshot session', 'start dart analysis'],
  dart_destroy_session: ['close the dart session', 'release dart analysis'],
  dart_inspect_object_pool: ['look at the object pool', 'dart pool entries'],
  dart_list_functions: ['list dart functions', 'enumerate dart methods'],
  dart_load_snapshot: ['load the dart snapshot', 'open the aot snapshot'],
  dart_object_pool_dump: ['dump the dart object pool', 'export pool contents'],
  dart_pc_descriptors: ['read pc descriptors table', 'offset mapping for dart code'],
  dart_smi_scan: ['scan for smi values', 'find small integers in snapshot'],
  dart_snapshot_header_parse: ['parse the snapshot header', 'read dart version info'],
  dart_strings_extract: ['extract dart strings', 'pull text from snapshot'],
  dart_symbolize: ['symbolize dart offsets', 'map addresses to dart names'],
  dart_trace_execution: ['trace dart execution', 'record dart calls at runtime'],
  dart_version_fingerprint: ['which dart version wrote this', 'fingerprint the snapshot'],
  flutter_packages_detect: ['which flutter packages are used', 'detect the pub packages'],
};

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,
  registrations,

  // Document-expansion keywords (SCENE_KEYWORDS above).
  sceneKeywords: SCENE_KEYWORDS,
};

export default manifest;
