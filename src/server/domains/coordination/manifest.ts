import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { coordinationTools } from '@server/domains/coordination/definitions';
import { CoordinationHandlers } from '@server/domains/coordination/index';

const DOMAIN = 'coordination' as const;
const DEP_KEY = 'coordinationHandlers' as const;
type H = CoordinationHandlers;
const t = toolLookup(coordinationTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  if (!ctx.coordinationHandlers) {
    ctx.coordinationHandlers = new CoordinationHandlers(ctx);
  }
  return ctx.coordinationHandlers;
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
      tool: t('create_task_handoff'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleCreateTaskHandoff(a)),
    },
    {
      tool: t('complete_task_handoff'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleCompleteTaskHandoff(a)),
    },
    {
      tool: t('get_task_context'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleGetTaskContext(a)),
    },
    {
      tool: t('append_session_insight'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleAppendSessionInsight(a)),
    },
    {
      tool: t('save_page_snapshot'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleSavePageSnapshot(a)),
    },
    {
      tool: t('restore_page_snapshot'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleRestorePageSnapshot(a)),
    },
    {
      tool: t('list_page_snapshots'),
      domain: DOMAIN,
      bind: b((h) => h.handleListPageSnapshots()),
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
