import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { coordinationTools } from '@server/domains/coordination/definitions';
import { sharedStateBoardTools } from '@server/domains/coordination/state-board/definitions';
import type { CoordinationHandlers } from '@server/domains/coordination/index';
import type { SharedStateBoardHandlers } from '@server/domains/coordination/state-board';
import type { RuntimeSnapshotScheduler } from '@server/persistence/RuntimeSnapshotScheduler';
import { resolve } from 'node:path';

const DOMAIN = 'coordination' as const;
const DEP_KEY = 'coordinationHandlers' as const;
const SSB_DEP_KEY = 'sharedStateBoardHandlers' as const;
type H = CoordinationHandlers;
type SSB = SharedStateBoardHandlers;
const t = toolLookup([...coordinationTools, ...sharedStateBoardTools]);
const registrations = defineMethodRegistrations<H, (typeof coordinationTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'create_task_handoff', method: 'handleCreateTaskHandoffTool', profiles: ['full'] },
    { tool: 'complete_task_handoff', method: 'handleCompleteTaskHandoffTool', profiles: ['full'] },
    { tool: 'get_task_context', method: 'handleGetTaskContextTool', profiles: ['full'] },
    {
      tool: 'append_session_insight',
      method: 'handleAppendSessionInsightTool',
      profiles: ['full'],
    },
    { tool: 'save_page_snapshot', method: 'handleSavePageSnapshotTool', profiles: ['full'] },
    { tool: 'restore_page_snapshot', method: 'handleRestorePageSnapshotTool', profiles: ['full'] },
    { tool: 'list_page_snapshots', method: 'handleListPageSnapshotsTool', profiles: ['full'] },
  ],
});
const stateBoardRegistrations = defineMethodRegistrations<
  SSB,
  (typeof sharedStateBoardTools)[number]['name']
>({
  domain: DOMAIN,
  depKey: SSB_DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'state_board', method: 'handleDispatchTool' },
    { tool: 'state_board_watch', method: 'handleWatchDispatchTool' },
    { tool: 'state_board_io', method: 'handleIODispatchTool' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { CoordinationHandlers, SharedStateBoardHandlers } =
    await import('@server/domains/coordination/index');
  if (!ctx.coordinationHandlers) {
    ctx.coordinationHandlers = new CoordinationHandlers(ctx);
  }

  // Shared state board (merged from the former shared-state-board domain)
  if (!ctx.sharedStateBoardHandlers) {
    ctx.sharedStateBoardHandlers = new SharedStateBoardHandlers();
  }
  const scheduler = ctx.getDomainInstance<RuntimeSnapshotScheduler>('snapshotScheduler');
  const stateDir = ctx.getDomainInstance<string>('snapshotStateDir');
  ctx.sharedStateBoardHandlers.setPersistNotifier(
    scheduler ? () => scheduler.notifyDirty() : undefined,
  );
  if (
    scheduler &&
    stateDir &&
    !ctx.getDomainInstance<boolean>('sharedStateBoardSnapshotRegistered')
  ) {
    scheduler.register(
      resolve(stateDir, 'state-board', 'current.json'),
      ctx.sharedStateBoardHandlers.getStore(),
    );
    ctx.setDomainInstance('sharedStateBoardSnapshotRegistered', true);
  }

  return ctx.coordinationHandlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  secondaryDepKeys: ['sharedStateBoardHandlers'],
  profiles: ['workflow', 'full'],
  ensure,
  registrations: [...registrations, ...stateBoardRegistrations],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
