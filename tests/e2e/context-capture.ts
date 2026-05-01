import type { E2EContext } from '@tests/e2e/helpers/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
  // ── browser PID from browser launch flows ──
  if ((toolName === 'browser_launch' || toolName === 'process_launch_debug') && isRecord(parsed)) {
    // launch flows may return pid directly, in nested browser, or nested process
    const pid = parsed.pid ?? (isRecord(parsed.browser) ? parsed.browser.pid : undefined);
    const processPid = isRecord(parsed.process) ? parsed.process.pid : undefined;
    const candidatePid = pid ?? processPid;
    if (typeof candidatePid === 'number' && candidatePid > 0) {
      ctx.browserPid = candidatePid;
    }
  }

  // ── Scripts ──
  if (toolName === 'get_all_scripts' && isRecord(parsed)) {
    // Handle multiple response formats: { scripts: [...] }, direct array, etc.
    const scripts = Array.isArray(parsed.scripts)
      ? parsed.scripts
      : Array.isArray(parsed)
        ? parsed
        : [];
    if (scripts.length > 0) {
      const firstScript = scripts[0] as Record<string, unknown>;
      const id = firstScript.scriptId ?? firstScript.id;
      if (id !== undefined) {
        ctx.scriptId = String(id);
        overrides.get_script_source = { scriptId: ctx.scriptId };
        overrides.extract_function_tree = { scriptId: ctx.scriptId, functionName: 'fetch' };
      }
    }
  }

  if (toolName === 'get_detailed_data' && isRecord(parsed)) {
    const detailId = parsed.detailId ?? parsed.id;
    if (detailId !== undefined && detailId !== null) {
      ctx.detailId = String(detailId);
    }
  }

  // ── Breakpoints ──
  if (isRecord(parsed)) {
    const breakpoint = isRecord(parsed.breakpoint) ? parsed.breakpoint : undefined;
    const breakpointId = parsed.breakpointId ?? breakpoint?.breakpointId;
    if (
      toolName === 'breakpoint_set' ||
      (toolName === 'breakpoint' && typeof breakpointId === 'string' && breakpointId.length > 0)
    ) {
      ctx.breakpointId = String(breakpointId);
      overrides.breakpoint_remove = { breakpointId: ctx.breakpointId };
    }
  }

  // ── Network requests capture ──
  if (
    toolName === 'network_get_requests' &&
    isRecord(parsed) &&
    Array.isArray(parsed.requests) &&
    parsed.requests.length > 0
  ) {
    const first = parsed.requests[0] as Record<string, unknown>;
    if (first.requestId !== undefined && first.requestId !== null) {
      ctx.requestId = String(first.requestId);
      overrides.network_get_response_body = { requestId: ctx.requestId };
      overrides.network_replay_request = { requestId: ctx.requestId, dryRun: true };
    }
  }

  if (toolName === 'instrumentation_session' && isRecord(parsed)) {
    const session =
      parsed.success === true && isRecord(parsed.session)
        ? parsed.session
        : isRecord(parsed.result) && isRecord(parsed.result.session)
          ? parsed.result.session
          : undefined;
    const sessionId = session?.id;
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      ctx.instrumentationSessionId = sessionId;
      overrides.instrumentation_operation = {
        action: 'list',
        sessionId: ctx.instrumentationSessionId,
      };
      overrides.instrumentation_artifact = {
        action: 'query',
        sessionId: ctx.instrumentationSessionId,
      };
    }
  }

  if (toolName === 'memory_first_scan' && isRecord(parsed)) {
    const sessionId = parsed.sessionId;
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      ctx.memoryScanSessionId = sessionId;
      overrides.memory_scan_delete = { action: 'delete', sessionId: ctx.memoryScanSessionId };
      overrides.memory_scan_export = { action: 'export', sessionId: ctx.memoryScanSessionId };
    }
  }

  if (toolName === 'memory_freeze' && isRecord(parsed)) {
    const freezeId = parsed.id ?? parsed.freezeId;
    if (typeof freezeId === 'string' && freezeId.length > 0) {
      ctx.freezeId = freezeId;
      overrides.memory_unfreeze = { action: 'unfreeze', freezeId: ctx.freezeId };
    }
  }

  // ── AI Hooks ──
  if (toolName === 'ai_hook' && isRecord(parsed) && parsed['action'] === 'inject') {
    const hookId = parsed.hookId ?? parsed.id;
    if (hookId !== undefined && hookId !== null) {
      ctx.hookId = String(hookId);
      overrides.ai_hook = { action: 'inject', hookId: ctx.hookId };
    }
  }

  // ── Scope variables → objectId ──
  if (
    toolName === 'get_scope_variables_enhanced' &&
    isRecord(parsed) &&
    Array.isArray(parsed.variables)
  ) {
    const objVar = (parsed.variables as Record<string, unknown>[]).find(
      (v) => v.objectId !== undefined && v.objectId !== null,
    );
    if (objVar) {
      ctx.objectId = String(objVar.objectId);
      overrides.get_object_properties = { objectId: ctx.objectId };
    }
  }

  // ── Extension workflows → workflowId ──
  if (toolName === 'list_extension_workflows') {
    const workflowId = selectWorkflowId(parsed);
    if (workflowId) {
      ctx.workflowId = workflowId;
      overrides.run_extension_workflow = { workflowId: ctx.workflowId };
    }
  }

  // ── Page snapshots → snapshotId ──
  if (toolName === 'save_page_snapshot' && isRecord(parsed)) {
    const snapshotId = parsed.snapshotId ?? parsed.id;
    if (typeof snapshotId === 'string' && snapshotId.length > 0) {
      ctx.snapshotId = snapshotId;
      overrides.restore_page_snapshot = { snapshotId: ctx.snapshotId };
    }
  }

  // ── V8 snapshots → snapshotId / diff inputs ──
  if (toolName === 'v8_heap_snapshot_capture' && isRecord(parsed)) {
    const snapshotId = parsed.snapshotId ?? parsed.id;
    if (typeof snapshotId === 'string' && snapshotId.length > 0) {
      if (ctx.v8SnapshotId && ctx.v8SnapshotId !== snapshotId && !ctx.v8ComparisonSnapshotId) {
        ctx.v8ComparisonSnapshotId = snapshotId;
      } else if (!ctx.v8SnapshotId) {
        ctx.v8SnapshotId = snapshotId;
      } else {
        ctx.v8SnapshotId = snapshotId;
      }

      overrides.v8_heap_snapshot_analyze = { snapshotId: ctx.v8SnapshotId };

      if (ctx.v8SnapshotId && ctx.v8ComparisonSnapshotId) {
        overrides.v8_heap_diff = {
          snapshotId1: ctx.v8SnapshotId,
          snapshotId2: ctx.v8ComparisonSnapshotId,
        };
      } else if (ctx.v8SnapshotId) {
        overrides.v8_heap_diff = {
          snapshotId1: ctx.v8SnapshotId,
          snapshotId2: ctx.v8SnapshotId,
        };
      }
    }
  }

  // ── Extensions → pluginId ──
  if (toolName === 'list_extensions' && isRecord(parsed) && Array.isArray(parsed.plugins)) {
    const plugin = parsed.plugins.find(
      (value): value is Record<string, unknown> =>
        isRecord(value) && typeof value.id === 'string' && value.id.length > 0,
    );
    if (plugin) {
      ctx.pluginId = plugin.id as string;
      overrides.extension_reload = { pluginId: ctx.pluginId };
      overrides.extension_uninstall = { pluginId: ctx.pluginId };
      overrides.extension_execute_in_context = {
        pluginId: ctx.pluginId,
        contextName: 'default',
        args: {},
      };
    }
  }

  // ── Watch: capture ID for watch_remove ──
  if (
    (toolName === 'watch_add' || toolName === 'watch') &&
    isRecord(parsed) &&
    parsed.success === true
  ) {
    const watchId = parsed.id ?? parsed.watchId;
    if (watchId !== undefined && watchId !== null) {
      ctx.watchId = String(watchId);
      overrides.watch_remove = { watchId: ctx.watchId };
    }
  }

  // ── XHR breakpoint: capture ID for xhr_breakpoint_remove ──
  if (
    isRecord(parsed) &&
    (toolName === 'xhr_breakpoint_set' ||
      (toolName === 'breakpoint' && parsed.success === true && parsed.urlPattern !== undefined))
  ) {
    const breakpointId = parsed.id ?? parsed.breakpointId;
    if (breakpointId !== undefined && breakpointId !== null) {
      ctx.xhrBreakpointId = String(breakpointId);
      overrides.xhr_breakpoint_remove = { breakpointId: ctx.xhrBreakpointId };
    }
  }

  // ── Event breakpoint: capture ID for event_breakpoint_remove ──
  if (isRecord(parsed)) {
    const breakpointId = parsed.id ?? parsed.breakpointId;
    const isSingleEventBreakpoint =
      toolName === 'event_breakpoint_set' ||
      (toolName === 'breakpoint' && parsed.success === true && parsed.eventName !== undefined);
    const isCategoryBreakpoint =
      toolName === 'event_breakpoint_set_category' ||
      (toolName === 'breakpoint' && parsed.success === true && Array.isArray(parsed.breakpointIds));

    if (isSingleEventBreakpoint && breakpointId !== undefined && breakpointId !== null) {
      ctx.eventBreakpointId = String(breakpointId);
      overrides.event_breakpoint_remove = { breakpointId: ctx.eventBreakpointId };
    }

    if (
      isCategoryBreakpoint &&
      Array.isArray(parsed.breakpointIds) &&
      parsed.breakpointIds.length > 0
    ) {
      const firstId = parsed.breakpointIds[0];
      if (typeof firstId === 'string' && firstId.length > 0) {
        ctx.eventBreakpointId = firstId;
        overrides.event_breakpoint_remove = { breakpointId: ctx.eventBreakpointId };
      }
    }
  }

  // ── Blackbox ──
  if (
    toolName === 'blackbox_add_common' &&
    isRecord(parsed) &&
    Array.isArray(parsed.added) &&
    parsed.added.length > 0
  ) {
    overrides.blackbox_add = { pattern: parsed.added[0] as string };
  }

  // ── Debugger session: capture session file path for load ──
  if (toolName === 'debugger_session' && isRecord(parsed) && parsed['action'] === 'save') {
    const path = parsed.filePath ?? parsed.path ?? parsed.sessionPath;
    if (typeof path === 'string' && path.length > 0) {
      ctx.sessionPath = path;
      overrides.debugger_session = { action: 'load', filePath: ctx.sessionPath };
    }
  }

  if (isRecord(parsed) && Array.isArray(parsed.modules) && parsed.modules.length > 0) {
    // Pick a small, safe DLL (prefer ntdll or kernel32 or any real path)
    const mod =
      (parsed.modules as Record<string, unknown>[]).find((m) => {
        const name = String(m.name ?? m.moduleName ?? '').toLowerCase();
        return name.includes('ntdll') || name.includes('kernel32');
      }) ?? (parsed.modules[0] as Record<string, unknown>);
    const dllPath = mod?.path ?? mod?.modulePath ?? mod?.name ?? mod?.moduleName;
    if (typeof dllPath === 'string' && dllPath.length > 0) {
      ctx.dllPath = dllPath;
      if (typeof ctx.browserPid === 'number' && ctx.browserPid > 0) {
        overrides.inject_dll = { pid: ctx.browserPid, dllPath: ctx.dllPath };
      }
    }
  }

  // ── Sourcemap URL from sourcemap_discover ──
  if (toolName === 'sourcemap_discover') {
    const maps = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed)
        ? (parsed.sourceMaps ?? parsed.maps ?? parsed.discovered)
        : null;
    if (Array.isArray(maps) && maps.length > 0) {
      const first = maps.find((item) => {
        if (!isRecord(item)) return false;
        const candidate = item.sourceMapUrl ?? item.url ?? item.mapUrl;
        return typeof candidate === 'string' && candidate.length > 0;
      }) as Record<string, unknown> | undefined;
      const url = first?.sourceMapUrl ?? first?.url ?? first?.mapUrl;
      if (typeof url === 'string' && url.length > 0) {
        ctx.sourceMapUrl = url;
        overrides.sourcemap_fetch_and_parse = { sourceMapUrl: ctx.sourceMapUrl };
        overrides.sourcemap_reconstruct_tree = { sourceMapUrl: ctx.sourceMapUrl };
      }
    }
  }

  // ── Coordination Domain: task handoff ──
  if (toolName === 'create_task_handoff' && isRecord(parsed)) {
    const taskId = parsed.taskId;
    if (typeof taskId === 'string') {
      ctx.taskId = taskId;
      overrides.complete_task_handoff = {
        taskId: ctx.taskId,
        summary: 'E2E testing complete',
        artifacts: ['test.txt'],
      };
      overrides.get_task_context = { taskId: ctx.taskId };
      overrides.append_session_insight = {
        category: 'other',
        content: 'E2E test executed handoff creation.',
      };
    }
  }
}
