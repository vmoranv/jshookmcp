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

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  tasks_cancel: ['abort background job', 'stop a running task', '取消任务'],
  tasks_get: ['fetch task status', 'check background job', '查任务状态'],
  tasks_list: ['enumerate running jobs', 'show all tasks', '列出任务'],
  tasks_result: ['fetch task output', 'get job payload', '取任务结果'],
};

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

  // Document-expansion keywords for the retrieval layer (SCENE_KEYWORDS above).
  sceneKeywords: SCENE_KEYWORDS,
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
