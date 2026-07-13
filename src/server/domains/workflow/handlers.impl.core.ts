/**
 * Workflow domain — composition facade.
 *
 * All utility functions extracted to ./handlers/shared.ts and ./handlers/network-policy.ts.
 * Handler methods delegated to sub-handler instances.
 */

import type { WorkflowHandlersDeps } from './handlers/shared';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { createWorkflowSharedState, getOptionalString, jsonTextResult } from './handlers/shared';
import { ScriptHandlers } from './handlers/script-handlers';
import { ApiHandlers } from './handlers/api-handlers';
import { AccountHandlers } from './handlers/account-handlers';
import { ReverseSessionHandlers } from '@server/reverse-session/ReverseSessionHandlers';
import { getWorkflowRunStore } from '@server/workflows/WorkflowEngine';

export type { WorkflowHandlersDeps } from './handlers/shared';

export class WorkflowHandlers {
  private scripts: ScriptHandlers;
  private api: ApiHandlers;
  private account: AccountHandlers;
  private reverseSession: ReverseSessionHandlers;

  constructor(deps: WorkflowHandlersDeps) {
    const state = createWorkflowSharedState(deps);
    this.scripts = new ScriptHandlers(state);
    this.api = new ApiHandlers(state);
    this.account = new AccountHandlers(state);
    this.reverseSession = new ReverseSessionHandlers(
      deps.serverContext
        ? (toolName, args) => deps.serverContext!.executeToolWithTracking(toolName, args)
        : undefined,
    );
  }

  async handlePageScriptRegisterTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handlePageScriptRegister(args));
  }

  async handlePageScriptRunTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handlePageScriptRun(args));
  }

  async handleListExtensionWorkflowsTool(): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleListExtensionWorkflows());
  }

  async handleRunExtensionWorkflowTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleRunExtensionWorkflow(args));
  }

  async handleApiProbeBatchTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleApiProbeBatch(args));
  }

  async handleJsBundleSearchTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleJsBundleSearch(args));
  }

  async handleReverseSessionTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleReverseSession(args));
  }

  async handleWorkflowRunInspectTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWorkflowRunInspect(args));
  }

  handlePageScriptRegister(args: Record<string, unknown>) {
    return this.scripts.handlePageScriptRegister(args);
  }
  handlePageScriptRun(args: Record<string, unknown>) {
    return this.scripts.handlePageScriptRun(args);
  }
  handleListExtensionWorkflows() {
    return this.scripts.handleListExtensionWorkflows();
  }
  handleRunExtensionWorkflow(args: Record<string, unknown>) {
    return this.scripts.handleRunExtensionWorkflow(args);
  }
  handleApiProbeBatch(args: Record<string, unknown>) {
    return this.api.handleApiProbeBatch(args);
  }
  handleJsBundleSearch(args: Record<string, unknown>) {
    return this.account.handleJsBundleSearch(args);
  }
  handleReverseSession(args: Record<string, unknown>) {
    return this.reverseSession.handleReverseSession(args);
  }

  /**
   * Inspect the global workflow run store. Every executeExtensionWorkflow call
   * (extension workflows + macros, which MacroRunner routes through the engine)
   * is recorded here; reverse_session runs go through executeToolWithTracking
   * directly and are not captured.
   */
  async handleWorkflowRunInspect(args: Record<string, unknown>): Promise<ToolResponse> {
    const action = (getOptionalString(args.action) ?? 'list') as 'list' | 'get' | 'lastSuccess';
    const store = getWorkflowRunStore();

    if (action === 'get') {
      const runId = getOptionalString(args.runId);
      if (!runId) {
        return jsonTextResult({
          success: false,
          error: 'runId is required for action=get',
        });
      }
      const run = store.getRun(runId);
      if (!run) {
        return jsonTextResult({ success: false, error: `Run "${runId}" not found` });
      }
      return jsonTextResult({ success: true, run });
    }

    if (action === 'lastSuccess') {
      const workflowId = getOptionalString(args.workflowId);
      if (!workflowId) {
        return jsonTextResult({
          success: false,
          error: 'workflowId is required for action=lastSuccess',
        });
      }
      const result = store.getLastSuccess(workflowId);
      if (!result) {
        return jsonTextResult({
          success: false,
          error: `No successful run recorded for workflow "${workflowId}"`,
        });
      }
      return jsonTextResult({ success: true, result });
    }

    // action === 'list'
    const workflowId = getOptionalString(args.workflowId);
    const runs = store.listRuns(workflowId);
    return jsonTextResult({ success: true, count: runs.length, runs });
  }
}
