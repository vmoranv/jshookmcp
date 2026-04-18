import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { sharedStateBoardTools } from '@server/domains/shared-state-board/definitions';
import { SharedStateBoardHandlers } from '@server/domains/shared-state-board/index';

const DOMAIN = 'shared-state-board' as const;
const DEP_KEY = 'sharedStateBoardHandlers' as const;
type H = SharedStateBoardHandlers;
const t = toolLookup(sharedStateBoardTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  if (!ctx.sharedStateBoardHandlers) {
    ctx.sharedStateBoardHandlers = new SharedStateBoardHandlers();
  }
  return ctx.sharedStateBoardHandlers;
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
      tool: t('state_board_set'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleSet(a)),
    },
    {
      tool: t('state_board_get'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleGet(a)),
    },
    {
      tool: t('state_board_delete'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleDelete(a)),
    },
    {
      tool: t('state_board_list'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleList(a)),
    },
    {
      tool: t('state_board_watch'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleWatch(a)),
    },
    {
      tool: t('state_board_unwatch'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleUnwatch(a)),
    },
    {
      tool: t('state_board_history'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleHistory(a)),
    },
    {
      tool: t('state_board_export'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleExport(a)),
    },
    {
      tool: t('state_board_import'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleImport(a)),
    },
    {
      tool: t('state_board_clear'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleClear(a)),
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
