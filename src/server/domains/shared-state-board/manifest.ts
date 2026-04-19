import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { sharedStateBoardTools } from '@server/domains/shared-state-board/definitions';
import { SharedStateBoardHandlers } from '@server/domains/shared-state-board/index';
import type { RuntimeSnapshotScheduler } from '@server/persistence/RuntimeSnapshotScheduler';
import { resolve } from 'node:path';

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
      bind: b((h, a) => h.handleWatchDispatch(a)),
    },
    {
      tool: t('state_board_history'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleHistory(a)),
    },
    {
      tool: t('state_board_io'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleIODispatch(a)),
    },
    {
      tool: t('state_board_clear'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleClear(a)),
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
