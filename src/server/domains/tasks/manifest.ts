import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { taskTools } from './definitions';
import type { TaskToolsHandlers } from './handlers';

const DOMAIN = 'tasks';
const DEP_KEY = 'tasksHandlers';
type H = TaskToolsHandlers;
const t = toolLookup(taskTools);

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { TaskToolsHandlers } = await import('./handlers');
  let handlers = ctx.getDomainInstance<H>(DEP_KEY);
  if (!handlers) {
    handlers = new TaskToolsHandlers(ctx.taskManager);
    ctx.setDomainInstance(DEP_KEY, handlers);
  }
  return handlers;
}

const registrations = defineMethodRegistrations<H, (typeof taskTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'tasks_get', method: 'handleTasksGet' },
    { tool: 'tasks_result', method: 'handleTasksResult' },
    { tool: 'tasks_cancel', method: 'handleTasksCancel' },
    { tool: 'tasks_list', method: 'handleTasksList' },
  ],
});

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
  ensure,

  workflowRule: {
    patterns: [
      /(task|background|long.?running|async).*(status|result|cancel)/i,
      /(poll|check).*(task)/i,
    ],
    priority: 40,
    tools: ['tasks_get', 'tasks_result'],
    hint: 'Poll or cancel background tasks created by long-running tools (frida_memory_scan, pcapng_read, ...)',
  },

  registrations,
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
