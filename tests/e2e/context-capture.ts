import type { E2EContext } from '@tests/e2e/helpers/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const PREFERRED_WORKFLOW_IDS = [
  'workflow.batch-register.v1',
  'workflow.web-api-capture-session.v1',
  'workflow.demo.v1',
];

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
  // ── browser PID from browser_launch ──
  if (toolName === 'browser_launch' && isRecord(parsed)) {
    // browser_launch may return pid directly or in nested browser object
    const pid = parsed.pid ?? (isRecord(parsed.browser) ? parsed.browser.pid : undefined);
    if (typeof pid === 'number' && pid > 0) {
      ctx.browserPid = pid;
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
  if (toolName === 'breakpoint_set' && isRecord(parsed)) {
    const breakpoint = isRecord(parsed.breakpoint) ? parsed.breakpoint : undefined;
    const breakpointId = parsed.breakpointId ?? breakpoint?.breakpointId;
    if (breakpointId !== undefined && breakpointId !== null) {
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

  // Also capture requestId from web_api_capture_session
  if (
    toolName === 'web_api_capture_session' &&
    isRecord(parsed) &&
    isRecord(parsed.networkSummary)
  ) {
    const ns = parsed.networkSummary as Record<string, unknown>;
    if (Array.isArray(ns.requests) && ns.requests.length > 0) {
      const first = ns.requests[0] as Record<string, unknown>;
      if (first.requestId !== undefined && first.requestId !== null && !ctx.requestId) {
        ctx.requestId = String(first.requestId);
        overrides.network_get_response_body = { requestId: ctx.requestId };
        overrides.network_replay_request = { requestId: ctx.requestId, dryRun: true };
      }
    }
  }

  // ── AI Hooks ──
  if (toolName === 'ai_hook_inject' && isRecord(parsed)) {
    const hookId = parsed.hookId ?? parsed.id;
    if (hookId !== undefined && hookId !== null) {
      ctx.hookId = String(hookId);
      overrides.ai_hook_inject = { hookId: ctx.hookId };
      overrides.ai_hook_toggle = { hookId: ctx.hookId, enabled: true };
      overrides.ai_hook_get_data = { hookId: ctx.hookId };
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
  if (toolName === 'watch_add' && isRecord(parsed)) {
    const watchId = parsed.id ?? parsed.watchId;
    if (watchId !== undefined && watchId !== null) {
      ctx.watchId = String(watchId);
      overrides.watch_remove = { watchId: ctx.watchId };
    }
  }

  // ── XHR breakpoint: capture ID for xhr_breakpoint_remove ──
  if (toolName === 'xhr_breakpoint_set' && isRecord(parsed)) {
    const breakpointId = parsed.id ?? parsed.breakpointId;
    if (breakpointId !== undefined && breakpointId !== null) {
      ctx.xhrBreakpointId = String(breakpointId);
      overrides.xhr_breakpoint_remove = { breakpointId: ctx.xhrBreakpointId };
    }
  }

  // ── Event breakpoint: capture ID for event_breakpoint_remove ──
  if (toolName === 'event_breakpoint_set' && isRecord(parsed)) {
    const breakpointId = parsed.id ?? parsed.breakpointId;
    if (breakpointId !== undefined && breakpointId !== null) {
      ctx.eventBreakpointId = String(breakpointId);
      overrides.event_breakpoint_remove = { breakpointId: ctx.eventBreakpointId };
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

  if (
    (toolName === 'process_find' || toolName === 'process_find_chromium') &&
    isRecord(parsed) &&
    Array.isArray(parsed.processes) &&
    parsed.processes.length > 0
  ) {
    const browserProc = (parsed.processes as Record<string, unknown>[]).find((p) => {
      const name = String(p.name ?? p.processName ?? '').toLowerCase();
      return (
        (name.includes('chrom') ||
          name.includes('browser') ||
          name.includes('puppeteer') ||
          name.includes('camoufox') ||
          name.includes('node')) &&
        typeof p.pid === 'number' &&
        p.pid > 0
      );
    });
    const anyProc = (parsed.processes as Record<string, unknown>[]).find(
      (p) => typeof p.pid === 'number' && p.pid > 0,
    );
    const proc = browserProc ?? anyProc;
    if (proc && typeof proc.pid === 'number' && proc.pid > 0) {
      ctx.browserPid = proc.pid;
    }
  }

  // ── Debugger session: capture session file path for load ──
  if (toolName === 'debugger_save_session' && isRecord(parsed)) {
    const path = parsed.filePath ?? parsed.path ?? parsed.sessionPath;
    if (typeof path === 'string' && path.length > 0) {
      ctx.sessionPath = path;
      overrides.debugger_load_session = { filePath: ctx.sessionPath };
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
  if (toolName === 'sourcemap_discover' && isRecord(parsed)) {
    const maps = parsed.sourceMaps ?? parsed.maps ?? parsed.discovered;
    if (Array.isArray(maps) && maps.length > 0) {
      const first = maps[0] as Record<string, unknown>;
      const url = first.sourceMapUrl ?? first.url ?? first.mapUrl;
      if (typeof url === 'string' && url.endsWith('.map')) {
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
