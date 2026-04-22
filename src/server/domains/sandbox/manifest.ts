import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { sandboxTools } from '@server/domains/sandbox/definitions';
import type { SandboxToolHandlers } from '@server/domains/sandbox/handlers';

const DOMAIN = 'sandbox' as const;
const DEP_KEY = 'sandboxHandlers' as const;
type H = SandboxToolHandlers;
const t = toolLookup(sandboxTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { SandboxToolHandlers } = await import('@server/domains/sandbox/handlers');
  const existing = ctx.getDomainInstance<H>(DEP_KEY);
  if (existing) return existing;
  const handlers = new SandboxToolHandlers(ctx);
  ctx.setDomainInstance(DEP_KEY, handlers);
  return handlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,
  registrations: [
    {
      tool: t('execute_sandbox_script'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleExecuteSandboxScript(a)),
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
