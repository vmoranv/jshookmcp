import type { DomainManifest } from '../../registry/contracts.js';
import { toolLookup } from '../../registry/types.js';
import { bindByDepKey } from '../../registry/bind-helpers.js';
import { antidebugTools } from './definitions.js';
import { AntiDebugToolHandlers } from './index.js';
import type { MCPServerContext } from '../../MCPServer.context.js';
import { CodeCollector } from '../../../modules/collector/CodeCollector.js';

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

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest', version: 1,
  domain: DOMAIN, depKey: DEP_KEY,
  profiles: ['full', 'reverse'],
  ensure,
  registrations: [
    { tool: t('antidebug_bypass_all'), domain: DOMAIN, bind: b((h, a) => h.handleAntiDebugBypassAll(a)) },
    { tool: t('antidebug_bypass_debugger_statement'), domain: DOMAIN, bind: b((h, a) => h.handleAntiDebugBypassDebuggerStatement(a)) },
    { tool: t('antidebug_bypass_timing'), domain: DOMAIN, bind: b((h, a) => h.handleAntiDebugBypassTiming(a)) },
    { tool: t('antidebug_bypass_stack_trace'), domain: DOMAIN, bind: b((h, a) => h.handleAntiDebugBypassStackTrace(a)) },
    { tool: t('antidebug_bypass_console_detect'), domain: DOMAIN, bind: b((h, a) => h.handleAntiDebugBypassConsoleDetect(a)) },
    { tool: t('antidebug_detect_protections'), domain: DOMAIN, bind: b((h, a) => h.handleAntiDebugDetectProtections(a)) },
  ],
};

export default manifest;
