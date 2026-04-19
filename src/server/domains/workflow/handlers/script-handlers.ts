/**
 * Script management and extension workflow sub-handler.
 */

import { logger } from '@utils/logger';
import { argNumber, argObject } from '@server/domains/shared/parse-args';
import type { WorkflowSharedState } from './shared';
import {
  WORKFLOW_CONSTANTS,
  getOptionalString,
  getOptionalRecord,
  escapeInlineScriptLiteral,
  jsonTextResult,
} from './shared';

export class ScriptHandlers {
  private state: WorkflowSharedState;

  constructor(state: WorkflowSharedState) {
    this.state = state;
  }

  async handlePageScriptRegister(args: Record<string, unknown>) {
    const name = getOptionalString(args.name);
    const code = getOptionalString(args.code);
    const description = getOptionalString(args.description) ?? '';

    if (!name || !code) {
      return jsonTextResult({ success: false, error: 'name and code are required' });
    }

    const isUpdate = this.state.scriptRegistry.has(name);
    if (!isUpdate && this.state.scriptRegistry.size >= WORKFLOW_CONSTANTS.MAX_SCRIPTS) {
      for (const [scriptName, entry] of this.state.scriptRegistry) {
        if (!entry.protectedFromEviction) {
          this.state.scriptRegistry.delete(scriptName);
          break;
        }
      }
    }
    const existingEntry = this.state.scriptRegistry.get(name);
    this.state.scriptRegistry.set(name, {
      code,
      description,
      source: existingEntry?.source ?? 'user',
      protectedFromEviction: existingEntry?.protectedFromEviction ?? false,
    });

    return jsonTextResult({
      success: true,
      action: isUpdate ? 'updated' : 'registered',
      name,
      description,
      totalScripts: this.state.scriptRegistry.size,
      available: Array.from(this.state.scriptRegistry.keys()),
    });
  }

  async handlePageScriptRun(args: Record<string, unknown>) {
    const name = getOptionalString(args.name);
    const params = getOptionalRecord(args.params);

    const entry = name ? this.state.scriptRegistry.get(name) : undefined;
    if (!entry) {
      const available = Array.from(this.state.scriptRegistry.keys());
      return jsonTextResult({ success: false, error: `Script "${name}" not found`, available });
    }

    let codeToRun: string;
    if (params !== undefined) {
      const paramsPayloadLiteral = escapeInlineScriptLiteral(
        JSON.stringify(JSON.stringify(params)),
      );
      codeToRun = `(function(){const __params__=JSON.parse(${paramsPayloadLiteral});return(${entry.code});})()`;
    } else {
      codeToRun = entry.code;
    }

    try {
      return await this.state.deps.browserHandlers.handlePageEvaluate({ code: codeToRun });
    } catch (error) {
      logger.error(`[page_script_run] Script "${name}" failed:`, error);
      return jsonTextResult({
        success: false,
        script: name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleListExtensionWorkflows() {
    const ctx = this.state.deps.serverContext;
    if (!ctx) {
      return jsonTextResult({
        success: false,
        error: 'Extension workflow runtime is unavailable in this handler context',
      });
    }

    const { ensureWorkflowsLoaded } = await import('@server/extensions/ExtensionManager');
    await ensureWorkflowsLoaded(ctx);
    const workflows = [...ctx.extensionWorkflowsById.values()].filter(
      (record) => record.route?.kind !== 'preset',
    );
    workflows.sort((a, b) => a.id.localeCompare(b.id));
    const serializedWorkflows = workflows.map((record) => ({
      id: record.id,
      displayName: record.displayName,
      description: record.description,
      tags: record.tags,
      timeoutMs: record.timeoutMs,
      defaultMaxConcurrency: record.defaultMaxConcurrency,
      source: record.source,
      route: record.route
        ? {
            kind: record.route.kind,
            priority: record.route.priority,
            requiredDomains: record.route.requiredDomains,
            triggerPatterns: record.route.triggerPatterns.map((pattern) => pattern.source),
            steps: record.route.steps,
          }
        : undefined,
    }));

    return jsonTextResult({
      success: true,
      count: serializedWorkflows.length,
      workflows: serializedWorkflows,
    });
  }

  async handleRunExtensionWorkflow(args: Record<string, unknown>) {
    const ctx = this.state.deps.serverContext;
    if (!ctx) {
      return jsonTextResult({
        success: false,
        error: 'Extension workflow runtime is unavailable in this handler context',
      });
    }

    const workflowId = getOptionalString(args.workflowId) ?? getOptionalString(args.id);
    if (!workflowId) {
      return jsonTextResult({ success: false, error: 'workflowId is required' });
    }

    const { ensureWorkflowsLoaded } = await import('@server/extensions/ExtensionManager');
    await ensureWorkflowsLoaded(ctx);
    const runtimeRecord = ctx.extensionWorkflowRuntimeById.get(workflowId);
    if (!runtimeRecord) {
      const available = [...ctx.extensionWorkflowsById.values()]
        .filter((record) => record.route?.kind !== 'preset')
        .map((record) => record.id);
      available.sort((a, b) => a.localeCompare(b));
      return jsonTextResult({
        success: false,
        error: `Extension workflow "${workflowId}" not found`,
        available,
      });
    }

    if (runtimeRecord.route?.kind === 'preset') {
      return jsonTextResult({
        success: false,
        workflowId,
        error:
          `Extension workflow "${workflowId}" is a routing preset and cannot be executed directly. ` +
          'Use route_tool or the suggested preset steps instead.',
      });
    }

    const profile = getOptionalString(args.profile);
    const config = getOptionalRecord(args.config);
    const nodeInputOverrides = argObject(args, 'nodeInputOverrides') as
      | Record<string, Record<string, unknown>>
      | undefined;
    const timeoutMs = argNumber(args, 'timeoutMs');

    try {
      const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
      const result = await executeExtensionWorkflow(ctx, runtimeRecord.workflow, {
        profile,
        config,
        nodeInputOverrides,
        timeoutMs,
      });
      return jsonTextResult({ success: true, ...result });
    } catch (error) {
      logger.error(`[run_extension_workflow] Workflow "${workflowId}" failed:`, error);
      return jsonTextResult({
        success: false,
        workflowId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
