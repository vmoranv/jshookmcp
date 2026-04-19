/**
 * Workflow domain — composition facade.
 *
 * All utility functions extracted to ./handlers/shared.ts and ./handlers/network-policy.ts.
 * Handler methods delegated to sub-handler instances.
 */

import type { WorkflowHandlersDeps } from './handlers/shared';
import { createWorkflowSharedState } from './handlers/shared';
import { ScriptHandlers } from './handlers/script-handlers';
import { ApiHandlers } from './handlers/api-handlers';
import { AccountHandlers } from './handlers/account-handlers';

export type { WorkflowHandlersDeps } from './handlers/shared';

export class WorkflowHandlers {
  private scripts: ScriptHandlers;
  private api: ApiHandlers;
  private account: AccountHandlers;

  constructor(deps: WorkflowHandlersDeps) {
    const state = createWorkflowSharedState(deps);
    this.scripts = new ScriptHandlers(state);
    this.api = new ApiHandlers(state);
    this.account = new AccountHandlers(state);
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
}
