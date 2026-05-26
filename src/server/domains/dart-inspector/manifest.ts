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
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { DartInspectorHandlers } = await import('@server/domains/dart-inspector/index');
  if (!ctx.dartInspectorHandlers) {
    ctx.dartInspectorHandlers = new DartInspectorHandlers();
  }
  return ctx.dartInspectorHandlers;
}

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,
  registrations,
};

export default manifest;
