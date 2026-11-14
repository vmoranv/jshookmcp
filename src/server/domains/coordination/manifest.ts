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
    { tool: 'update_task_handoff', method: 'handleUpdateTaskHandoffTool', profiles: ['full'] },
    { tool: 'get_task_context', method: 'handleGetTaskContextTool', profiles: ['full'] },
    {
      tool: 'append_session_insight',
      method: 'handleAppendSessionInsightTool',
      profiles: ['full'],
    },
    { tool: 'save_page_snapshot', method: 'handleSavePageSnapshotTool', profiles: ['full'] },
    { tool: 'restore_page_snapshot', method: 'handleRestorePageSnapshotTool', profiles: ['full'] },
    { tool: 'list_page_snapshots', method: 'handleListPageSnapshotsTool', profiles: ['full'] },
    {
      tool: 'coordination_restore_snapshot',
      method: 'handleCoordinationRestoreSnapshotTool',
      profiles: ['full'],
    },
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
  const scheduler = ctx.getDomainInstance<RuntimeSnapshotScheduler>('snapshotScheduler');
  const stateDir = ctx.getDomainInstance<string>('snapshotStateDir');
  ctx.coordinationHandlers.setPersistNotifier(
    scheduler ? () => scheduler.notifyDirty() : undefined,
  );
  if (scheduler && stateDir && !ctx.getDomainInstance<boolean>('coordinationSnapshotRegistered')) {
    scheduler.register(resolve(stateDir, 'coordination', 'current.json'), ctx.coordinationHandlers);
    ctx.setDomainInstance('coordinationSnapshotRegistered', true);
  }

  // Shared state board (merged from the former shared-state-board domain)
  if (!ctx.sharedStateBoardHandlers) {
    ctx.sharedStateBoardHandlers = new SharedStateBoardHandlers();
  }
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

  // Document-expansion keywords for the retrieval layer (search sceneKeywords).
  sceneKeywords: {
    append_session_insight: [
      'add finding to session log',
      'record a discovery',
      'discover more about the session',
    ],
    complete_task_handoff: [
      'finalize handoff to next agent',
      'close out the handoff',
      'complete the handoff',
    ],
    coordination_restore_snapshot: [
      'bring back saved browser state',
      'reload coordination snapshot',
      'restore the snapshot',
    ],
    create_task_handoff: [
      'prepare handoff for another agent',
      'start a task transfer',
      'create a handoff',
    ],
    get_task_context: [
      'read handoff context',
      'what did the previous agent leave',
      'get the handoff context',
    ],
    list_page_snapshots: [
      'show saved page states',
      'enumerate snapshots',
      'list the page snapshots',
    ],
    restore_page_snapshot: [
      'go back to a saved page state',
      'load snapshot again',
      'restore a page snapshot',
    ],
    save_page_snapshot: [
      'capture current page state for later',
      'store page snapshot',
      'save a page snapshot',
    ],
    state_board: ['shared key value board', 'read coordination state', 'shared state board'],
    state_board_io: ['write to shared board', 'put state entries', 'write to the state board'],
    state_board_watch: [
      'subscribe to state changes',
      'notify on board updates',
      'watch the state board',
    ],
    update_task_handoff: [
      'amend the handoff notes',
      'revise handoff content',
      'update the handoff',
    ],
  },
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
