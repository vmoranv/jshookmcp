/**
 * Hooks domain manifest — special case with TWO handler types:
 * - aiHookHandlers (AIHookToolHandlers)
 * - hookPresetHandlers (HookPresetToolHandlers)
 *
 * We use the primary depKey 'aiHookHandlers' for the manifest identity,
 * and directly bind hookPresetHandlers via getDep.
 */
import type {
  DomainManifest,
  MCPServerContext,
  ToolHandlerDeps,
} from '@server/domains/shared/registry';
import {
  bindByDepKey,
  ensureBrowserCore,
  getDep,
  toolLookup,
} from '@server/domains/shared/registry';
import { aiHookTools, hookPresetTools } from '@server/domains/hooks/definitions';
import { AIHookToolHandlers, HookPresetToolHandlers } from '@server/domains/hooks/index';
import type { ToolArgs } from '@server/types';

const DOMAIN = 'hooks' as const;
const DEP_KEY = 'aiHookHandlers' as const;
const DEP_KEY_PRESET = 'hookPresetHandlers';
type H = AIHookToolHandlers;
type HP = HookPresetToolHandlers;
const t = toolLookup([...aiHookTools, ...hookPresetTools]);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  ensureBrowserCore(ctx);
  if (!ctx.aiHookHandlers) {
    ctx.aiHookHandlers = new AIHookToolHandlers(ctx.pageController!);
  }
  // Also ensure the preset handlers are available
  if (!ctx.hookPresetHandlers) {
    ctx.hookPresetHandlers = new HookPresetToolHandlers(ctx.pageController!);
  }
  return ctx.aiHookHandlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  secondaryDepKeys: ['hookPresetHandlers'],
  profiles: ['full'],
  ensure,
  registrations: [
    { tool: t('ai_hook_inject'), domain: DOMAIN, bind: b((h, a) => h.handleAIHookInject(a)) },
    { tool: t('ai_hook_get_data'), domain: DOMAIN, bind: b((h, a) => h.handleAIHookGetData(a)) },
    { tool: t('ai_hook_list'), domain: DOMAIN, bind: b((h, a) => h.handleAIHookList(a)) },
    { tool: t('ai_hook_clear'), domain: DOMAIN, bind: b((h, a) => h.handleAIHookClear(a)) },
    { tool: t('ai_hook_toggle'), domain: DOMAIN, bind: b((h, a) => h.handleAIHookToggle(a)) },
    { tool: t('ai_hook_export'), domain: DOMAIN, bind: b((h, a) => h.handleAIHookExport(a)) },
    // hook_preset uses the secondary handler
    {
      tool: t('hook_preset'),
      domain: DOMAIN,
      bind: (deps: ToolHandlerDeps) => (args: ToolArgs) =>
        getDep<HP>(deps, DEP_KEY_PRESET).handleHookPreset(args),
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
