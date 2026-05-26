import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { apkPackerTools } from '@server/domains/apk-packer/definitions';
import type { ApkPackerHandlers } from '@server/domains/apk-packer/index';

const DOMAIN = 'apk-packer' as const;
const DEP_KEY = 'apkPackerHandlers' as const;
type H = ApkPackerHandlers;
const t = toolLookup(apkPackerTools);
const registrations = defineMethodRegistrations<H, (typeof apkPackerTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'apk_packer_detect', method: 'handleApkPackerDetect' },
    { tool: 'apk_packer_list_signatures', method: 'handleApkPackerListSignatures' },
    { tool: 'apk_signing_block_parse', method: 'handleApkSigningBlockParse' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { ApkPackerHandlers } = await import('@server/domains/apk-packer/index');
  if (!ctx.apkPackerHandlers) {
    ctx.apkPackerHandlers = new ApkPackerHandlers();
  }
  return ctx.apkPackerHandlers;
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
