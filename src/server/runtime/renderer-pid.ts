import type { MCPServerContext } from '@server/MCPServer.context';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import { getRuntimeState } from '@server/runtime/ServerRuntimeState';

function normalizeUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') {
    return null;
  }
  const trimmed = url.trim();
  return trimmed.length > 0 && trimmed !== 'about:blank' ? trimmed : null;
}

export async function resolveAttachedRendererPid(
  processManager: UnifiedProcessManager,
  ctx?: MCPServerContext | null,
): Promise<number | null> {
  if (!ctx) {
    return null;
  }

  const runtimeState = getRuntimeState(ctx);
  const browserAttach = runtimeState?.getBrowserAttach();
  const cachedRendererPid = browserAttach?.rendererPid ?? null;
  if (cachedRendererPid && Number.isInteger(cachedRendererPid) && cachedRendererPid > 0) {
    return cachedRendererPid;
  }

  const browserPid = browserAttach?.browserPid ?? null;
  const selectedUrl = normalizeUrl(browserAttach?.selectedUrl);
  const selectedTitle = browserAttach?.selectedTitle?.trim() || null;
  if (!browserPid) {
    return null;
  }

  const browserProcesses = await processManager.findBrowserProcesses();
  if (!browserProcesses?.rendererProcesses?.length) {
    return null;
  }

  const rendererCandidates = browserProcesses.rendererProcesses.filter(
    (process) => process.parentPid === browserPid || !process.parentPid,
  );
  const candidates =
    rendererCandidates.length > 0 ? rendererCandidates : browserProcesses.rendererProcesses;

  let resolvedPid: number | null = null;
  if (selectedUrl || selectedTitle) {
    for (const process of candidates) {
      const commandLine = process.commandLine?.toLowerCase() ?? '';
      const processUrlMatch = selectedUrl ? commandLine.includes(selectedUrl.toLowerCase()) : false;
      const processTitleMatch =
        selectedTitle && process.windowTitle
          ? process.windowTitle.toLowerCase().includes(selectedTitle.toLowerCase())
          : false;
      if (processUrlMatch || processTitleMatch) {
        resolvedPid = process.pid;
        break;
      }
    }
  }

  if (!resolvedPid) {
    resolvedPid = candidates[0]?.pid ?? null;
  }

  if (resolvedPid) {
    runtimeState?.setBrowserAttach({ rendererPid: resolvedPid, browserPid });
  }

  return resolvedPid;
}

export async function resolvePidOrAttachedRenderer(
  value: unknown,
  processManager: UnifiedProcessManager,
  ctx?: MCPServerContext | null,
): Promise<number> {
  // Only numbers and digit-only strings are PIDs. Loose `Number()` coercion
  // would accept `true`/`[42]`/`new Number(7)` and act on an unrelated process.
  const numericText = typeof value === 'string' ? value.trim() : '';
  let isDigits = typeof value === 'string' && numericText.length > 0;
  for (let i = 0; isDigits && i < numericText.length; i++) {
    const code = numericText.charCodeAt(i);
    if (code < 48 || code > 57) isDigits = false;
  }
  const isNumericInput = typeof value === 'number' || isDigits;
  const numeric = isNumericInput ? Number(value) : Number.NaN;
  if (Number.isInteger(numeric) && numeric > 0) {
    return numeric;
  }
  if (value !== undefined && value !== null) {
    throw new Error(`Invalid PID: ${JSON.stringify(value)}`);
  }

  const attachedRendererPid = await resolveAttachedRendererPid(processManager, ctx);
  if (attachedRendererPid) {
    return attachedRendererPid;
  }

  throw new Error(
    'Invalid PID. Attach a browser first to auto-discover the current renderer PID, or provide pid explicitly.',
  );
}
