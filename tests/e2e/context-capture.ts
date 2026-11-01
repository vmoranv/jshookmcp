import type { E2EContext } from '@tests/e2e/helpers/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Everything a capture section needs from the calling test. */
interface CaptureInput {
  toolName: string;
  parsed: unknown;
  ctx: E2EContext;
  overrides: Record<string, Record<string, unknown>>;
}

const PREFERRED_WORKFLOW_IDS = ['workflow.batch-register.v1', 'workflow.demo.v1'];

function selectWorkflowId(parsed: unknown): string | null {
  const workflows =
    isRecord(parsed) && Array.isArray(parsed.workflows)
      ? parsed.workflows
      : Array.isArray(parsed)
        ? parsed
        : [];

  const workflowRecords = workflows.filter(isRecord);
  const selected =
    PREFERRED_WORKFLOW_IDS.map((id) =>
      workflowRecords.find((workflow) => workflow.id === id || workflow.workflowId === id),
    ).find((workflow): workflow is Record<string, unknown> => workflow !== undefined) ??
    workflowRecords[0];
  const workflowId = selected?.id ?? selected?.workflowId;
  return typeof workflowId === 'string' && workflowId.length > 0 ? workflowId : null;
}

export function applyContextCapture(
  toolName: string,
  parsed: unknown,
  ctx: E2EContext,
  overrides: Record<string, Record<string, unknown>>,
): void {
  captureBrowserPidFromBrowserLaunchFlows({ toolName, parsed, ctx, overrides });
  captureScripts({ toolName, parsed, ctx, overrides });
  captureBreakpoints({ toolName, parsed, ctx, overrides });
  captureNetworkRequestsCapture({ toolName, parsed, ctx, overrides });
  captureAiHooks({ toolName, parsed, ctx, overrides });
  captureScopeVariablesObjectid({ toolName, parsed, ctx, overrides });
  captureExtensionWorkflowsWorkflowid({ toolName, parsed, ctx, overrides });
  capturePageSnapshotsSnapshotid({ toolName, parsed, ctx, overrides });
  captureV8SnapshotsSnapshotidDiffInputs({ toolName, parsed, ctx, overrides });
  captureExtensionsPluginid({ toolName, parsed, ctx, overrides });
  captureWatchCaptureIdForWatchRemove({ toolName, parsed, ctx, overrides });
  captureXhrBreakpointCaptureIdForXhrBreakpointRemove({ toolName, parsed, ctx, overrides });
  captureEventBreakpointCaptureIdForEventBreakpointRemove({ toolName, parsed, ctx, overrides });
  captureBlackbox({ toolName, parsed, ctx, overrides });
  captureDebuggerSessionCaptureSessionFilePathForLoad({ toolName, parsed, ctx, overrides });
  captureSourcemapUrlFromSourcemapDiscover({ toolName, parsed, ctx, overrides });
  captureCoordinationDomainTaskHandoff({ toolName, parsed, ctx, overrides });
}

/** browser PID from browser launch flows */
function captureBrowserPidFromBrowserLaunchFlows(input: CaptureInput): void {
  if (
    (input.toolName === 'browser_launch' || input.toolName === 'process_launch_debug') &&
    isRecord(input.parsed)
  ) {
    // launch flows may return pid directly, in nested browser, or nested process
    const pid =
      input.parsed.pid ?? (isRecord(input.parsed.browser) ? input.parsed.browser.pid : undefined);
    const processPid = isRecord(input.parsed.process) ? input.parsed.process.pid : undefined;
    const candidatePid = pid ?? processPid;
    if (typeof candidatePid === 'number' && candidatePid > 0) {
      input.ctx.browserPid = candidatePid;
    }
  }
}

/** Scripts */
function captureScripts(input: CaptureInput): void {
  if (input.toolName === 'get_all_scripts' && isRecord(input.parsed)) {
    // Handle multiple response formats: { scripts: [...] }, direct array, etc.
    const scripts = Array.isArray(input.parsed.scripts)
      ? input.parsed.scripts
      : Array.isArray(input.parsed)
        ? input.parsed
        : [];
    if (scripts.length > 0) {
      const firstScript = scripts[0] as Record<string, unknown>;
      const id = firstScript.scriptId ?? firstScript.id;
      if (id !== undefined) {
        input.ctx.scriptId = String(id);
        input.overrides.get_script_source = { scriptId: input.ctx.scriptId };
        input.overrides.extract_function_tree = {
          scriptId: input.ctx.scriptId,
          functionName: 'fetch',
        };
      }
    }
  }

  if (input.toolName === 'get_detailed_data' && isRecord(input.parsed)) {
    const detailId = input.parsed.detailId ?? input.parsed.id;
    if (detailId !== undefined && detailId !== null) {
      input.ctx.detailId = String(detailId);
    }
  }
}

/** Breakpoints */
function captureBreakpoints(input: CaptureInput): void {
  if (isRecord(input.parsed)) {
    const breakpoint = isRecord(input.parsed.breakpoint) ? input.parsed.breakpoint : undefined;
    const breakpointId = input.parsed.breakpointId ?? breakpoint?.breakpointId;
    if (
      input.toolName === 'breakpoint_set' ||
      (input.toolName === 'breakpoint' &&
        typeof breakpointId === 'string' &&
        breakpointId.length > 0)
    ) {
      input.ctx.breakpointId = String(breakpointId);
      input.overrides.breakpoint_remove = { breakpointId: input.ctx.breakpointId };
    }
  }
}

/** Network requests capture */
function captureNetworkRequestsCapture(input: CaptureInput): void {
  if (
    input.toolName === 'network_get_requests' &&
    isRecord(input.parsed) &&
    Array.isArray(input.parsed.requests) &&
    input.parsed.requests.length > 0
  ) {
    const first = input.parsed.requests[0] as Record<string, unknown>;
    if (first.requestId !== undefined && first.requestId !== null) {
      input.ctx.requestId = String(first.requestId);
      input.overrides.network_get_response_body = { requestId: input.ctx.requestId };
      input.overrides.network_replay_request = { requestId: input.ctx.requestId, dryRun: true };
    }
  }

  if (input.toolName === 'instrumentation_session' && isRecord(input.parsed)) {
    const session =
      input.parsed.success === true && isRecord(input.parsed.session)
        ? input.parsed.session
        : isRecord(input.parsed.result) && isRecord(input.parsed.result.session)
          ? input.parsed.result.session
          : undefined;
    const sessionId = session?.id;
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      input.ctx.instrumentationSessionId = sessionId;
      input.overrides.instrumentation_operation = {
        action: 'list',
        sessionId: input.ctx.instrumentationSessionId,
      };
      input.overrides.instrumentation_artifact = {
        action: 'query',
        sessionId: input.ctx.instrumentationSessionId,
      };
    }
  }

  if (input.toolName === 'memory_first_scan' && isRecord(input.parsed)) {
    const sessionId = input.parsed.sessionId;
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      input.ctx.memoryScanSessionId = sessionId;
      input.overrides.memory_scan_delete = {
        action: 'delete',
        sessionId: input.ctx.memoryScanSessionId,
      };
      input.overrides.memory_scan_export = {
        action: 'export',
        sessionId: input.ctx.memoryScanSessionId,
      };
    }
  }

  if (input.toolName === 'memory_freeze' && isRecord(input.parsed)) {
    const freezeId = input.parsed.id ?? input.parsed.freezeId;
    if (typeof freezeId === 'string' && freezeId.length > 0) {
      input.ctx.freezeId = freezeId;
      input.overrides.memory_unfreeze = { action: 'unfreeze', freezeId: input.ctx.freezeId };
    }
  }
}

/** AI Hooks */
function captureAiHooks(input: CaptureInput): void {
  if (
    input.toolName === 'ai_hook' &&
    isRecord(input.parsed) &&
    input.parsed['action'] === 'inject'
  ) {
    const hookId = input.parsed.hookId ?? input.parsed.id;
    if (hookId !== undefined && hookId !== null) {
      input.ctx.hookId = String(hookId);
      input.overrides.ai_hook = { action: 'inject', hookId: input.ctx.hookId };
    }
  }
}

/** Scope variables → objectId */
function captureScopeVariablesObjectid(input: CaptureInput): void {
  if (
    input.toolName === 'get_scope_variables_enhanced' &&
    isRecord(input.parsed) &&
    Array.isArray(input.parsed.variables)
  ) {
    const objVar = (input.parsed.variables as Record<string, unknown>[]).find(
      (v) => v.objectId !== undefined && v.objectId !== null,
    );
    if (objVar) {
      input.ctx.objectId = String(objVar.objectId);
      input.overrides.get_object_properties = { objectId: input.ctx.objectId };
    }
  }
}

/** Extension workflows → workflowId */
function captureExtensionWorkflowsWorkflowid(input: CaptureInput): void {
  if (input.toolName === 'list_extension_workflows') {
    const workflowId = selectWorkflowId(input.parsed);
    if (workflowId) {
      input.ctx.workflowId = workflowId;
      input.overrides.run_extension_workflow = { workflowId: input.ctx.workflowId };
    }
  }
}

/** Page snapshots → snapshotId */
function capturePageSnapshotsSnapshotid(input: CaptureInput): void {
  if (input.toolName === 'save_page_snapshot' && isRecord(input.parsed)) {
    const snapshotId = input.parsed.snapshotId ?? input.parsed.id;
    if (typeof snapshotId === 'string' && snapshotId.length > 0) {
      input.ctx.snapshotId = snapshotId;
      input.overrides.restore_page_snapshot = { snapshotId: input.ctx.snapshotId };
    }
  }
}

/** V8 snapshots → snapshotId / diff inputs */
function captureV8SnapshotsSnapshotidDiffInputs(input: CaptureInput): void {
  if (input.toolName === 'v8_heap_snapshot_capture' && isRecord(input.parsed)) {
    const snapshotId = input.parsed.snapshotId ?? input.parsed.id;
    if (typeof snapshotId === 'string' && snapshotId.length > 0) {
      if (
        input.ctx.v8SnapshotId &&
        input.ctx.v8SnapshotId !== snapshotId &&
        !input.ctx.v8ComparisonSnapshotId
      ) {
        input.ctx.v8ComparisonSnapshotId = snapshotId;
      } else if (!input.ctx.v8SnapshotId) {
        input.ctx.v8SnapshotId = snapshotId;
      } else {
        input.ctx.v8SnapshotId = snapshotId;
      }

      input.overrides.v8_heap_snapshot_analyze = { snapshotId: input.ctx.v8SnapshotId };

      if (input.ctx.v8SnapshotId && input.ctx.v8ComparisonSnapshotId) {
        input.overrides.v8_heap_diff = {
          snapshotId1: input.ctx.v8SnapshotId,
          snapshotId2: input.ctx.v8ComparisonSnapshotId,
        };
      } else if (input.ctx.v8SnapshotId) {
        input.overrides.v8_heap_diff = {
          snapshotId1: input.ctx.v8SnapshotId,
          snapshotId2: input.ctx.v8SnapshotId,
        };
      }
    }
  }
}

/** Extensions → pluginId */
function captureExtensionsPluginid(input: CaptureInput): void {
  if (
    input.toolName === 'list_extensions' &&
    isRecord(input.parsed) &&
    Array.isArray(input.parsed.plugins)
  ) {
    const plugin = input.parsed.plugins.find(
      (value): value is Record<string, unknown> =>
        isRecord(value) && typeof value.id === 'string' && value.id.length > 0,
    );
    if (plugin) {
      input.ctx.pluginId = plugin.id as string;
      input.overrides.extension_reload = { pluginId: input.ctx.pluginId };
      input.overrides.extension_uninstall = { pluginId: input.ctx.pluginId };
      input.overrides.extension_execute_in_context = {
        pluginId: input.ctx.pluginId,
        contextName: 'default',
        args: {},
      };
    }
  }
}

/** Watch: capture ID for watch_remove */
function captureWatchCaptureIdForWatchRemove(input: CaptureInput): void {
  if (
    (input.toolName === 'watch_add' || input.toolName === 'watch') &&
    isRecord(input.parsed) &&
    input.parsed.success === true
  ) {
    const watchId = input.parsed.id ?? input.parsed.watchId;
    if (watchId !== undefined && watchId !== null) {
      input.ctx.watchId = String(watchId);
      input.overrides.watch_remove = { watchId: input.ctx.watchId };
    }
  }
}

/** XHR breakpoint: capture ID for xhr_breakpoint_remove */
function captureXhrBreakpointCaptureIdForXhrBreakpointRemove(input: CaptureInput): void {
  if (
    isRecord(input.parsed) &&
    (input.toolName === 'xhr_breakpoint_set' ||
      (input.toolName === 'breakpoint' &&
        input.parsed.success === true &&
        input.parsed.urlPattern !== undefined))
  ) {
    const breakpointId = input.parsed.id ?? input.parsed.breakpointId;
    if (breakpointId !== undefined && breakpointId !== null) {
      input.ctx.xhrBreakpointId = String(breakpointId);
      input.overrides.xhr_breakpoint_remove = { breakpointId: input.ctx.xhrBreakpointId };
    }
  }
}

/** Event breakpoint: capture ID for event_breakpoint_remove */
function captureEventBreakpointCaptureIdForEventBreakpointRemove(input: CaptureInput): void {
  if (isRecord(input.parsed)) {
    const breakpointId = input.parsed.id ?? input.parsed.breakpointId;
    const isSingleEventBreakpoint =
      input.toolName === 'event_breakpoint_set' ||
      (input.toolName === 'breakpoint' &&
        input.parsed.success === true &&
        input.parsed.eventName !== undefined);
    const isCategoryBreakpoint =
      input.toolName === 'event_breakpoint_set_category' ||
      (input.toolName === 'breakpoint' &&
        input.parsed.success === true &&
        Array.isArray(input.parsed.breakpointIds));

    if (isSingleEventBreakpoint && breakpointId !== undefined && breakpointId !== null) {
      input.ctx.eventBreakpointId = String(breakpointId);
      input.overrides.event_breakpoint_remove = { breakpointId: input.ctx.eventBreakpointId };
    }

    if (
      isCategoryBreakpoint &&
      Array.isArray(input.parsed.breakpointIds) &&
      input.parsed.breakpointIds.length > 0
    ) {
      const firstId = input.parsed.breakpointIds[0];
      if (typeof firstId === 'string' && firstId.length > 0) {
        input.ctx.eventBreakpointId = firstId;
        input.overrides.event_breakpoint_remove = { breakpointId: input.ctx.eventBreakpointId };
      }
    }
  }
}

/** Blackbox */
function captureBlackbox(input: CaptureInput): void {
  if (
    input.toolName === 'blackbox_add_common' &&
    isRecord(input.parsed) &&
    Array.isArray(input.parsed.added) &&
    input.parsed.added.length > 0
  ) {
    input.overrides.blackbox_add = { pattern: input.parsed.added[0] as string };
  }
}

/** Debugger session: capture session file path for load */
function captureDebuggerSessionCaptureSessionFilePathForLoad(input: CaptureInput): void {
  if (
    input.toolName === 'debugger_session' &&
    isRecord(input.parsed) &&
    input.parsed['action'] === 'save'
  ) {
    const path = input.parsed.filePath ?? input.parsed.path ?? input.parsed.sessionPath;
    if (typeof path === 'string' && path.length > 0) {
      input.ctx.sessionPath = path;
      input.overrides.debugger_session = { action: 'load', filePath: input.ctx.sessionPath };
    }
  }

  if (
    isRecord(input.parsed) &&
    Array.isArray(input.parsed.modules) &&
    input.parsed.modules.length > 0
  ) {
    // Pick a small, safe DLL (prefer ntdll or kernel32 or any real path)
    const mod =
      (input.parsed.modules as Record<string, unknown>[]).find((m) => {
        const name = String(m.name ?? m.moduleName ?? '').toLowerCase();
        return name.includes('ntdll') || name.includes('kernel32');
      }) ?? (input.parsed.modules[0] as Record<string, unknown>);
    const dllPath = mod?.path ?? mod?.modulePath ?? mod?.name ?? mod?.moduleName;
    if (typeof dllPath === 'string' && dllPath.length > 0) {
      input.ctx.dllPath = dllPath;
      if (typeof input.ctx.browserPid === 'number' && input.ctx.browserPid > 0) {
        input.overrides.inject_dll = { pid: input.ctx.browserPid, dllPath: input.ctx.dllPath };
      }
    }
  }
}

/** Sourcemap URL from sourcemap_discover */
function captureSourcemapUrlFromSourcemapDiscover(input: CaptureInput): void {
  if (input.toolName === 'sourcemap_discover') {
    const maps = Array.isArray(input.parsed)
      ? input.parsed
      : isRecord(input.parsed)
        ? (input.parsed.sourceMaps ?? input.parsed.maps ?? input.parsed.discovered)
        : null;
    if (Array.isArray(maps) && maps.length > 0) {
      const first = maps.find((item) => {
        if (!isRecord(item)) return false;
        const candidate = item.sourceMapUrl ?? item.url ?? item.mapUrl;
        return typeof candidate === 'string' && candidate.length > 0;
      }) as Record<string, unknown> | undefined;
      const url = first?.sourceMapUrl ?? first?.url ?? first?.mapUrl;
      if (typeof url === 'string' && url.length > 0) {
        input.ctx.sourceMapUrl = url;
        input.overrides.sourcemap_fetch_and_parse = { sourceMapUrl: input.ctx.sourceMapUrl };
        input.overrides.sourcemap_reconstruct_tree = { sourceMapUrl: input.ctx.sourceMapUrl };
      }
    }
  }
}

/** Coordination Domain: task handoff */
function captureCoordinationDomainTaskHandoff(input: CaptureInput): void {
  if (input.toolName === 'create_task_handoff' && isRecord(input.parsed)) {
    const taskId = input.parsed.taskId;
    if (typeof taskId === 'string') {
      input.ctx.taskId = taskId;
      input.overrides.complete_task_handoff = {
        taskId: input.ctx.taskId,
        summary: 'E2E testing complete',
        artifacts: ['test.txt'],
      };
      input.overrides.get_task_context = { taskId: input.ctx.taskId };
      input.overrides.append_session_insight = {
        category: 'other',
        content: 'E2E test executed handoff creation.',
      };
    }
  }
}
