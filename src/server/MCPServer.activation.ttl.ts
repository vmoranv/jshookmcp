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
import { getToolDomain } from '@server/ToolCatalog';
import type { MCPServerContext } from '@server/MCPServer.context';

export interface DomainTtlEntry {
  timer: ReturnType<typeof setTimeout>;
  ttlMs: number;
  toolNames: Set<string>;
}

/**
 * Start a TTL timer for a domain activation.
 * If ttlMinutes is 0 or negative, no timer is set (permanent activation).
 */
export function startDomainTtl(
  ctx: MCPServerContext,
  domain: string,
  ttlMinutes: number,
  toolNames: Iterable<string>
): void {
  // Clear any existing timer for this domain
  clearDomainTtl(ctx, domain);

  if (ttlMinutes <= 0) return;

  const ttlMs = ttlMinutes * 60 * 1000;
  const names = new Set(toolNames);

  const timer = setTimeout(() => {
    logger.info(
      `Domain "${domain}" TTL expired (${ttlMinutes}min) — auto-deactivating ${names.size} tools`
    );
    void deactivateDomainOnExpiry(ctx, domain).catch((err) => {
      logger.error(`Failed to deactivate domain "${domain}" on TTL expiry:`, err);
    });
  }, ttlMs);

  ctx.domainTtlEntries.set(domain, { timer, ttlMs, toolNames: names });
}

/**
 * Refresh (reset) the TTL timer for a domain, keeping it alive.
 * No-op if the domain has no active TTL entry.
 */
export function refreshDomainTtl(ctx: MCPServerContext, domain: string): void {
  const entry = ctx.domainTtlEntries.get(domain);
  if (!entry) return;

  clearTimeout(entry.timer);
  const ttlMinutes = entry.ttlMs / 60_000;

  entry.timer = setTimeout(() => {
    logger.info(`Domain "${domain}" TTL expired (${ttlMinutes}min) — auto-deactivating`);
    void deactivateDomainOnExpiry(ctx, domain).catch((err) => {
      logger.error(`Failed to deactivate domain "${domain}" on TTL expiry:`, err);
    });
  }, entry.ttlMs);
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
}

/**
 * Deactivate all tools belonging to a domain on TTL expiry.
 * Removes tools from activated sets, SDK registrations, and router handlers.
 */
export async function deactivateDomainOnExpiry(
  ctx: MCPServerContext,
  domain: string
): Promise<void> {
  const entry = ctx.domainTtlEntries.get(domain);
  if (!entry) return;

  const toolNames = entry.toolNames;
  ctx.domainTtlEntries.delete(domain);

  let removedCount = 0;
  for (const name of toolNames) {
    // Only remove if still in activated set (may have been manually deactivated)
    if (!ctx.activatedToolNames.has(name)) continue;

    const registeredTool = ctx.activatedRegisteredTools.get(name);
    if (registeredTool) {
      try {
        registeredTool.remove();
      } catch (e) {
        logger.warn(`Failed to remove tool "${name}" on domain TTL expiry:`, e);
      }
    }
    ctx.router.removeHandler(name);
    ctx.activatedToolNames.delete(name);
    ctx.activatedRegisteredTools.delete(name);

    // Clear extension tool registration state
    const extRecord = ctx.extensionToolsByName.get(name);
    if (extRecord) {
      extRecord.registeredTool = undefined;
    }

    removedCount++;
  }

  if (removedCount > 0) {
    // Re-evaluate enabled domains
    ctx.enabledDomains.delete(domain);
    // Re-add domain if any tool from it is still active (base profile or other activation)
    for (const activeName of ctx.activatedToolNames) {
      const d = getToolDomain(activeName);
      if (d === domain) {
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
