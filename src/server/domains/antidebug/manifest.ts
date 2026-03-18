import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { antidebugTools } from '@server/domains/antidebug/definitions';
import { AntiDebugToolHandlers } from '@server/domains/antidebug/index';
import { CodeCollector } from '@server/domains/shared/modules';

const DOMAIN = 'antidebug' as const;
const DEP_KEY = 'antidebugHandlers' as const;
type H = AntiDebugToolHandlers;
const t = toolLookup(antidebugTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  if (!ctx.collector) {
    ctx.collector = new CodeCollector(ctx.config.puppeteer);
    void ctx.registerCaches();
  }
  if (!ctx.antidebugHandlers) ctx.antidebugHandlers = new AntiDebugToolHandlers(ctx.collector);
  return ctx.antidebugHandlers;
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
      tool: t('antidebug_bypass_all'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleAntiDebugBypassAll(a)),
    },
    {
      tool: t('antidebug_bypass_debugger_statement'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleAntiDebugBypassDebuggerStatement(a)),
    },
    {
      tool: t('antidebug_bypass_timing'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleAntiDebugBypassTiming(a)),
    },
    {
      tool: t('antidebug_bypass_stack_trace'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleAntiDebugBypassStackTrace(a)),
    },
    {
      tool: t('antidebug_bypass_console_detect'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleAntiDebugBypassConsoleDetect(a)),
    },
    {
      tool: t('antidebug_detect_protections'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleAntiDebugDetectProtections(a)),
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
