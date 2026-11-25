/**
 * Domain-level activation TTL management.
 *
 * Provides per-domain expiry timers that automatically deactivate tools
 * when a domain has not been used for a configurable duration.
 *
 * Key functions:
 *  - startDomainTtl(ctx, domain, ttlMinutes) - starts expiry timer
 *  - refreshDomainTtl(ctx, domain) - resets timer on tool usage
 *  - refreshDomainTtlForTool(ctx, toolName) - refreshes TTL for the domain owning a tool
 *  - clearDomainTtl(ctx, domain) - manual clear without deactivation
 *  - deactivateDomainOnExpiry(ctx, domain) - on expiry: remove tools + sendToolListChanged
 */
import { logger } from '@utils/logger';
import { getToolDomain } from '@server/registry/views';
import type { MCPServerContext } from '@server/MCPServer.context';
import { getRuntimeState } from '@server/runtime/ServerRuntimeState';
import { deactivateToolCore } from '@server/tool-lifecycle';
import { MS_PER_MINUTE } from '@src/constants';

export interface DomainTtlEntry {
  timer: ReturnType<typeof setTimeout>;
  ttlMs: number;
  toolNames: Set<string>;
  /**
   * Monotonic generation, bumped on every start/refresh of the entry.
   *
   * A TTL callback that is replaced (startDomainTtl for the same domain) or
   * reset (refreshDomainTtl) may already be queued in the macrotask queue —
   * clearTimeout() cannot retract it. The callback compares its captured
   * generation against the entry currently in the map and bails out when it is
   * stale, so an old expiry can never deactivate the tools of a newer activation.
   */
  generation: number;
}

let domainTtlGeneration = 0;

/**
 * Start a TTL timer for a domain activation.
 * If ttlMinutes is 0 or negative, no timer is set (permanent activation).
 */
export function startDomainTtl(
  ctx: MCPServerContext,
  domain: string,
  ttlMinutes: number,
  toolNames: Iterable<string>,
): void {
  // Clear any existing timer for this domain
  clearDomainTtl(ctx, domain);

  if (ttlMinutes <= 0) return;

  const ttlMs = ttlMinutes * MS_PER_MINUTE;
  const names = new Set(toolNames);
  const entry: DomainTtlEntry = {
    timer: 0 as unknown as ReturnType<typeof setTimeout>,
    ttlMs,
    toolNames: names,
    generation: ++domainTtlGeneration,
  };

  const timer = setTimeout(() => {
    // Stale-callback guard: the entry was replaced or refreshed after this
    // timer was scheduled — do not deactivate the newer activation's tools.
    if (ctx.domainTtlEntries.get(domain)?.generation !== entry.generation) {
      return;
    }
    logger.info(
      `Domain "${domain}" TTL expired (${ttlMinutes}min) — auto-deactivating ${names.size} tools`,
    );
    void deactivateDomainOnExpiry(ctx, domain).catch((err) => {
      logger.error(`Failed to deactivate domain "${domain}" on TTL expiry:`, err);
    });
  }, ttlMs);
  entry.timer = timer;

  ctx.domainTtlEntries.set(domain, entry);
}

/**
 * Refresh (reset) the TTL timer for a domain, keeping it alive.
 * No-op if the domain has no active TTL entry.
 */
export function refreshDomainTtl(ctx: MCPServerContext, domain: string): void {
  const existing = ctx.domainTtlEntries.get(domain);
  if (!existing) return;

  clearTimeout(existing.timer);
  const ttlMinutes = existing.ttlMs / MS_PER_MINUTE;

  // Replace the entry with a fresh object carrying a bumped generation. A
  // pre-refresh expiry callback that is already queued captured the OLD entry
  // object, whose generation is now stale — it will bail out instead of
  // deactivating the refreshed activation's tools (see DomainTtlEntry.generation).
  const entry: DomainTtlEntry = {
    timer: 0 as unknown as ReturnType<typeof setTimeout>,
    ttlMs: existing.ttlMs,
    toolNames: existing.toolNames,
    generation: ++domainTtlGeneration,
  };

  const timer = setTimeout(() => {
    if (ctx.domainTtlEntries.get(domain)?.generation !== entry.generation) {
      return;
    }
    logger.info(`Domain "${domain}" TTL expired (${ttlMinutes}min) — auto-deactivating`);
    void deactivateDomainOnExpiry(ctx, domain).catch((err) => {
      logger.error(`Failed to deactivate domain "${domain}" on TTL expiry:`, err);
    });
  }, entry.ttlMs);
  entry.timer = timer;

  ctx.domainTtlEntries.set(domain, entry);
}

/**
 * Refresh TTL for the domain that owns a given tool name.
 * Used in executeToolWithTracking to keep domains alive on usage.
 */
export function refreshDomainTtlForTool(ctx: MCPServerContext, toolName: string): void {
  // Check built-in domain
  let domain = getToolDomain(toolName);
  if (!domain) {
    // Check extension tools
    const extRecord = ctx.extensionToolsByName.get(toolName);
    if (extRecord) domain = extRecord.domain;
  }
  if (domain && ctx.domainTtlEntries.has(domain)) {
    refreshDomainTtl(ctx, domain);
  }
}

/**
 * Clear a domain's TTL timer without deactivating its tools.
 */
export function clearDomainTtl(ctx: MCPServerContext, domain: string): void {
  const entry = ctx.domainTtlEntries.get(domain);
  if (entry) {
    clearTimeout(entry.timer);
    ctx.domainTtlEntries.delete(domain);
  }
  getRuntimeState(ctx)?.clearPendingDomainActivation(domain);
}

/**
 * Deactivate all tools belonging to a domain on TTL expiry.
 * Removes tools from activated sets, SDK registrations, and router handlers.
 */
export async function deactivateDomainOnExpiry(
  ctx: MCPServerContext,
  domain: string,
): Promise<void> {
  const entry = ctx.domainTtlEntries.get(domain);
  if (!entry) return;

  const toolNames = entry.toolNames;
  ctx.domainTtlEntries.delete(domain);
  getRuntimeState(ctx)?.clearPendingDomainActivation(domain);

  let removedCount = 0;
  for (const name of toolNames) {
    // Only remove if still in activated set (may have been manually deactivated)
    if (!ctx.activatedToolNames.has(name)) continue;

    // Per-tool error isolation: the TTL entry (and its timer) is already gone,
    // so a throw here would leave the remaining tools activated forever with
    // no retry path. Keep going and let the re-evaluation below re-report any
    // domain whose tools are still active.
    try {
      deactivateToolCore(name, {
        activatedToolNames: ctx.activatedToolNames,
        activatedRegisteredTools: ctx.activatedRegisteredTools,
        router: ctx.router,
        extensionToolsByName: ctx.extensionToolsByName,
      });
    } catch (error) {
      logger.warn(`Failed to deactivate tool "${name}" on domain TTL expiry:`, error);
      continue;
    }

    removedCount++;
  }

  if (removedCount > 0) {
    // Re-evaluate enabled domains
    ctx.enabledDomains.delete(domain);
    // Re-add domain if any tool from it is still active (base profile or other
    // activation). Extension tools are not in the built-in ToolCatalog, so
    // resolve them through the extension registry before concluding the
    // domain is empty.
    const resolveDomain = (toolName: string): string | null =>
      getToolDomain(toolName) ?? ctx.extensionToolsByName.get(toolName)?.domain ?? null;
    for (const activeName of ctx.activatedToolNames) {
      if (resolveDomain(activeName) === domain) {
        ctx.enabledDomains.add(domain);
        break;
      }
    }
    for (const selectedTool of ctx.selectedTools) {
      const d = getToolDomain(selectedTool.name);
      if (d === domain) {
        ctx.enabledDomains.add(domain);
        break;
      }
    }

    try {
      await ctx.server.sendToolListChanged();
    } catch (e) {
      logger.warn('sendToolListChanged failed after domain TTL expiry:', e);
    }

    logger.info(`Domain "${domain}" deactivated: removed ${removedCount} tools`);
  }
}
