/**
 * Coordination domain — task handoff, session insights, and shared state board (offline, in-memory).
 *
 * Ground truth: the coordination state machine:
 *  - create_task_handoff creates a pending handoff and returns active task count
 *  - complete_task_handoff marks status='completed' and reports duration
 *  - append_session_insight accumulates insights and groups by category
 *  - state_board (SharedStateBoard) supports set/get/delete/list/clear with LRU and TTL semantics
 */
import { CoordinationHandlers, SharedStateBoardHandlers } from '@server/domains/coordination/index';
import type { MCPServerContext } from '@server/MCPServer.context';
import { body, type BenchSuite } from '../harness';

const ctx = {} as unknown as MCPServerContext;
const coordination = new CoordinationHandlers(ctx);
const stateBoard = new SharedStateBoardHandlers();

export const coordinationSuite: BenchSuite = {
  name: 'coordination-lifecycle',
  domain: 'coordination',
  description:
    'Task handoff lifecycle, session insights aggregation, and shared state-board key-value operations',
  cases: [
    {
      name: 'create_task_handoff/lifecycle-create-and-complete',
      tool: 'create_task_handoff',
      origin: 'homemade',
      reference: 'create task handoff reports status=pending; complete reports status=completed',
      run: async () => {
        const created = body(
          await coordination.handleCreateTaskHandoffTool({
            description: 'bench audit network requests',
            targetDomain: 'network',
          }),
        );
        const taskId = String(created.taskId ?? '');
        const completed = body(
          await coordination.handleCompleteTaskHandoffTool({
            taskId,
            summary: 'all requests inspected',
            keyFindings: ['no suspicious token leak'],
          }),
        );
        return { created, completed };
      },
      validate: (v) => {
        const b = body(v);
        const created = b.created as Record<string, unknown>;
        const completed = b.completed as Record<string, unknown>;
        if (created.status !== 'pending')
          return `created status must be pending, got ${created.status}`;
        if (completed.status !== 'completed')
          return `completed status must be completed, got ${completed.status}`;
        if (!Array.isArray(completed.keyFindings) || completed.keyFindings.length !== 1) {
          return `keyFindings expected array of 1 item, got ${JSON.stringify(completed.keyFindings)}`;
        }
        return true;
      },
    },
    {
      name: 'append_session_insight/accumulate-and-categorize',
      tool: 'append_session_insight',
      origin: 'homemade',
      reference: 'insights append with category, confidence, and update totalByCategory',
      run: async () => {
        const ins1 = body(
          await coordination.handleAppendSessionInsightTool({
            category: 'vulnerability',
            content: 'potential prototype pollution candidate in query parser',
            confidence: 0.9,
            tags: ['parser', 'security'],
          }),
        );
        const ins2 = body(
          await coordination.handleAppendSessionInsightTool({
            category: 'architecture',
            content: 'service worker intercepts fetch calls',
            confidence: 0.85,
          }),
        );
        return { ins1, ins2 };
      },
      validate: (v) => {
        const b = body(v);
        const ins2 = b.ins2 as Record<string, unknown>;
        if (Number(ins2.totalInsights) < 2)
          return `totalInsights expected >= 2, got ${ins2.totalInsights}`;
        const byCat = ins2.totalByCategory as Record<string, number> | undefined;
        if (!byCat || (byCat.vulnerability ?? 0) < 1 || (byCat.architecture ?? 0) < 1) {
          return `totalByCategory missing expected categories: ${JSON.stringify(byCat)}`;
        }
        return true;
      },
    },
    {
      name: 'state_board/set-get-delete-roundtrip',
      tool: 'state_board',
      origin: 'homemade',
      reference: 'state_board set stores typed value; get retrieves it; delete removes it',
      run: async () => {
        const setRes = body(
          await stateBoard.handleDispatchTool({
            action: 'set',
            key: 'auth_token_candidate',
            value: 'eyJh...mock',
            tags: ['auth'],
          }),
        );
        const getRes = body(
          await stateBoard.handleDispatchTool({
            action: 'get',
            key: 'auth_token_candidate',
          }),
        );
        const delRes = body(
          await stateBoard.handleDispatchTool({
            action: 'delete',
            key: 'auth_token_candidate',
          }),
        );
        const getAfterDel = body(
          await stateBoard.handleDispatchTool({
            action: 'get',
            key: 'auth_token_candidate',
          }),
        );
        return { setRes, getRes, delRes, getAfterDel };
      },
      validate: (v) => {
        const b = body(v);
        const getRes = b.getRes as Record<string, unknown>;
        const delRes = b.delRes as Record<string, unknown>;
        const getAfterDel = b.getAfterDel as Record<string, unknown>;
        if (getRes.value !== 'eyJh...mock') return `get expected stored value, got ${getRes.value}`;
        if (delRes.deleted !== true) return `delete expected deleted=true, got ${delRes.deleted}`;
        if (getAfterDel.found !== false && getAfterDel.value !== undefined) {
          return `key must not be found after delete: ${JSON.stringify(getAfterDel)}`;
        }
        return true;
      },
    },
    {
      name: 'state_board/list-and-clear',
      tool: 'state_board',
      origin: 'homemade',
      reference: 'state_board list shows entries; clear removes all entries in state board',
      run: async () => {
        await stateBoard.handleDispatchTool({ action: 'set', key: 'k1', value: 101 });
        await stateBoard.handleDispatchTool({ action: 'set', key: 'k2', value: 202 });
        const listBefore = body(await stateBoard.handleDispatchTool({ action: 'list' }));
        const clearRes = body(await stateBoard.handleDispatchTool({ action: 'clear' }));
        const listAfter = body(await stateBoard.handleDispatchTool({ action: 'list' }));
        return { listBefore, clearRes, listAfter };
      },
      validate: (v) => {
        const b = body(v);
        const listBefore = b.listBefore as Record<string, unknown>;
        const clearRes = b.clearRes as Record<string, unknown>;
        const listAfter = b.listAfter as Record<string, unknown>;
        const entriesBefore = (listBefore.entries as Array<unknown>) ?? [];
        const entriesAfter = (listAfter.entries as Array<unknown>) ?? [];
        if (entriesBefore.length < 2)
          return `expected at least 2 entries before clear, got ${entriesBefore.length}`;
        if (clearRes.cleared === undefined)
          return `clearRes expected cleared count: ${JSON.stringify(clearRes)}`;
        if (entriesAfter.length !== 0)
          return `expected 0 entries after clear, got ${entriesAfter.length}`;
        return true;
      },
    },
  ],
};
