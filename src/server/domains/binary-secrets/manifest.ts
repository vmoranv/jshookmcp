import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { binarySecretsTools } from '@server/domains/binary-secrets/definitions';
import type { BinarySecretsHandlers } from '@server/domains/binary-secrets/index';

const DOMAIN = 'binary-secrets' as const;
const DEP_KEY = 'binarySecretsHandlers' as const;
type H = BinarySecretsHandlers;
const t = toolLookup(binarySecretsTools);
const registrations = defineMethodRegistrations<H, (typeof binarySecretsTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [{ tool: 'binary_key_extract', method: 'handleBinaryKeyExtract' }],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { BinarySecretsHandlers } = await import('@server/domains/binary-secrets/index');
  if (!ctx.binarySecretsHandlers) {
    ctx.binarySecretsHandlers = new BinarySecretsHandlers();
  }
  return ctx.binarySecretsHandlers;
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
