import type { E2EContext } from './helpers/types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function applyContextCapture(
  toolName: string,
  parsed: unknown,
  ctx: E2EContext,
  overrides: Record<string, Record<string, unknown>>,
): void {
  if (toolName === 'get_all_scripts' && isRecord(parsed) && Array.isArray(parsed.scripts) && parsed.scripts.length > 0) {
    const firstScript = parsed.scripts[0] as Record<string, unknown>;
    if (firstScript.scriptId !== undefined) {
      ctx.scriptId = String(firstScript.scriptId);
    }
  }

  if (toolName === 'breakpoint_set' && isRecord(parsed)) {
    const breakpoint = isRecord(parsed.breakpoint) ? parsed.breakpoint : undefined;
    const breakpointId = parsed.breakpointId ?? breakpoint?.breakpointId;
    if (breakpointId != null) {
      ctx.breakpointId = String(breakpointId);
      overrides.breakpoint_remove = { breakpointId: ctx.breakpointId };
    }
  }

  if (toolName === 'network_get_requests' && isRecord(parsed) && Array.isArray(parsed.requests) && parsed.requests.length > 0) {
    const first = parsed.requests[0] as Record<string, unknown>;
    if (first.requestId != null) {
      ctx.requestId = String(first.requestId);
      overrides.network_get_response_body = { requestId: ctx.requestId };
      overrides.network_replay_request = { requestId: ctx.requestId };
    }
  }

  if (toolName === 'ai_hook_generate' && isRecord(parsed)) {
    const hookId = parsed.hookId ?? parsed.id;
    if (hookId != null) {
      ctx.hookId = String(hookId);
      overrides.ai_hook_inject = { hookId: ctx.hookId };
      overrides.ai_hook_toggle = { hookId: ctx.hookId, enabled: true };
      overrides.ai_hook_get_data = { hookId: ctx.hookId };
    }
  }

  if (toolName === 'get_scope_variables_enhanced' && isRecord(parsed) && Array.isArray(parsed.variables)) {
    const objVar = (parsed.variables as Record<string, unknown>[]).find((v) => v.objectId != null);
    if (objVar) {
      ctx.objectId = String(objVar.objectId);
      overrides.get_object_properties = { objectId: ctx.objectId };
    }
  }

  if (toolName === 'watch_add' && isRecord(parsed)) {
    overrides.watch_remove = { id: String(parsed.id ?? parsed.watchId ?? '0') };
  }

  if (toolName === 'xhr_breakpoint_set' && isRecord(parsed)) {
    overrides.xhr_breakpoint_remove = { id: String(parsed.id ?? parsed.breakpointId ?? '0') };
  }

  if (toolName === 'event_breakpoint_set' && isRecord(parsed)) {
    overrides.event_breakpoint_remove = { id: String(parsed.id ?? parsed.breakpointId ?? '0') };
  }

  if (toolName === 'blackbox_add_common' && isRecord(parsed) && Array.isArray(parsed.added) && parsed.added.length > 0) {
    overrides.blackbox_add = { pattern: parsed.added[0] as string };
  }
}
