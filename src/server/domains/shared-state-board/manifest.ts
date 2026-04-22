import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { sharedStateBoardTools } from '@server/domains/shared-state-board/definitions';
import type { SharedStateBoardHandlers } from '@server/domains/shared-state-board/index';
import type { RuntimeSnapshotScheduler } from '@server/persistence/RuntimeSnapshotScheduler';
import { resolve } from 'node:path';

const DOMAIN = 'shared-state-board' as const;
const DEP_KEY = 'sharedStateBoardHandlers' as const;
type H = SharedStateBoardHandlers;
const t = toolLookup(sharedStateBoardTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { SharedStateBoardHandlers } = await import('@server/domains/shared-state-board/index');
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
  profiles: ['workflow', 'full'],
  ensure,
  registrations: [
    {
      tool: t('state_board'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleDispatch(a)),
    },
    {
      tool: t('state_board_watch'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleWatchDispatch(a)),
    },
    {
      tool: t('state_board_io'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleIODispatch(a)),
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
