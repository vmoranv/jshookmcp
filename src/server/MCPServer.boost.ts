import { logger } from '../utils/logger.js';
import {
  TIER_DEFAULT_TTL,
  TIER_ORDER,
  getProfileDomains,
  getTierIndex,
  getToolsForProfile,
  type ToolProfile,
} from './ToolCatalog.js';
import { createToolHandlerMap } from './ToolHandlerMap.js';
import type { MCPServerContext } from './MCPServer.context.js';

export async function boostProfile(
  ctx: MCPServerContext,
  target?: string,
  ttlMinutes?: number
): Promise<Record<string, unknown>> {
  const prev = ctx.boostLock;
  let resolve!: () => void;
  ctx.boostLock = new Promise<void>((r) => {
    resolve = r;
  });
  await prev;
  try {
    return await boostProfileInner(ctx, target, ttlMinutes);
  } finally {
    resolve();
  }
}

export async function boostProfileInner(
  ctx: MCPServerContext,
  target?: string,
  ttlMinutesOverride?: number
): Promise<Record<string, unknown>> {
  const currentIdx = getTierIndex(ctx.currentTier);
  let resolvedTarget: ToolProfile;

  if (target) {
    const normalized = target === 'min' ? 'minimal' : target;
    resolvedTarget = normalized as ToolProfile;
    const targetIdx = getTierIndex(resolvedTarget);
    if (targetIdx < 0) {
      resolvedTarget = target as ToolProfile;
    } else if (targetIdx <= currentIdx) {
      return {
        success: false,
        error: `Already at tier "${ctx.currentTier}" (index ${currentIdx}). Target "${resolvedTarget}" is not higher. Use unboost_profile to downgrade.`,
        currentTier: ctx.currentTier,
        availableTiers: [...TIER_ORDER],
      };
    }
  } else {
    if (currentIdx < 0 || currentIdx >= TIER_ORDER.length - 1) {
      return {
        success: false,
        error: `Already at highest tier "${ctx.currentTier}". Nothing to boost to.`,
        currentTier: ctx.currentTier,
        availableTiers: [...TIER_ORDER],
      };
    }
    resolvedTarget = TIER_ORDER[currentIdx + 1] as ToolProfile;
  }

  if (ctx.boostTtlTimer) {
    clearTimeout(ctx.boostTtlTimer);
    ctx.boostTtlTimer = null;
  }

  await switchToTier(ctx, resolvedTarget);

  ctx.boostHistory.push(ctx.currentTier);
  ctx.currentTier = resolvedTarget;

  const ttlMinutes = ttlMinutesOverride ?? TIER_DEFAULT_TTL[resolvedTarget] ?? 30;
  if (ttlMinutes > 0) {
    ctx.boostTtlTimer = setTimeout(async () => {
      logger.info(
        `boost_profile TTL expired (${ttlMinutes}min) — auto-downgrading from "${ctx.currentTier}"`
      );
      await unboostProfile(ctx);
    }, ttlMinutes * 60 * 1000);
  }

  try {
    await ctx.server.sendToolListChanged();
  } catch (e) {
    logger.warn('sendToolListChanged failed:', e);
  }

  const addedNames = [...ctx.boostedToolNames];
  logger.info(`Boosted to "${resolvedTarget}": added ${addedNames.length} tools`);

  return {
    success: true,
    previousTier: ctx.boostHistory[ctx.boostHistory.length - 1],
    currentTier: resolvedTarget,
    addedTools: addedNames.length,
    ttlMinutes: ttlMinutes > 0 ? ttlMinutes : 'disabled',
    addedToolNames: addedNames,
    availableTiers: [...TIER_ORDER],
    hint: 'Call unboost_profile to downgrade, or tools auto-expire after TTL.',
  };
}

export async function unboostProfile(
  ctx: MCPServerContext,
  target?: string
): Promise<Record<string, unknown>> {
  const prev = ctx.boostLock;
  let resolve!: () => void;
  ctx.boostLock = new Promise<void>((r) => {
    resolve = r;
  });
  await prev;
  try {
    return await unboostProfileInner(ctx, target);
  } finally {
    resolve();
  }
}

export async function unboostProfileInner(
  ctx: MCPServerContext,
  target?: string
): Promise<Record<string, unknown>> {
  if (ctx.currentTier === ctx.baseTier && ctx.boostHistory.length === 0) {
    return {
      success: true,
      currentTier: ctx.currentTier,
      removedTools: 0,
      message: 'Already at base tier; nothing to downgrade.',
    };
  }

  if (ctx.boostTtlTimer) {
    clearTimeout(ctx.boostTtlTimer);
    ctx.boostTtlTimer = null;
  }

  const previousTier = ctx.currentTier;
  let resolvedTarget: ToolProfile;

  if (target) {
    const normalized = target === 'min' ? 'minimal' : target;
    resolvedTarget = normalized as ToolProfile;
  } else {
    resolvedTarget = ctx.boostHistory.length > 0 ? ctx.boostHistory.pop()! : ctx.baseTier;
  }

  if (target) {
    while (
      ctx.boostHistory.length > 0 &&
      ctx.boostHistory[ctx.boostHistory.length - 1] !== resolvedTarget
    ) {
      ctx.boostHistory.pop();
    }
    if (
      ctx.boostHistory.length > 0 &&
      ctx.boostHistory[ctx.boostHistory.length - 1] === resolvedTarget
    ) {
      ctx.boostHistory.pop();
    }
  }

  const removedCount = ctx.boostedToolNames.size;
  await switchToTier(ctx, resolvedTarget);
  ctx.currentTier = resolvedTarget;

  try {
    await ctx.server.sendToolListChanged();
  } catch (e) {
    logger.warn('sendToolListChanged failed:', e);
  }

  logger.info(
    `Downgraded from "${previousTier}" to "${resolvedTarget}": removed ${removedCount} tools`
  );

  return {
    success: true,
    previousTier,
    currentTier: resolvedTarget,
    removedTools: removedCount,
    message: `Downgraded from "${previousTier}" to "${resolvedTarget}".`,
    availableTiers: [...TIER_ORDER],
  };
}

export async function switchToTier(ctx: MCPServerContext, targetTier: ToolProfile): Promise<void> {
  // Step 1: Remove previously boosted tools
  for (const name of ctx.boostedToolNames) {
    const registeredTool = ctx.boostedRegisteredTools.get(name);
    if (registeredTool) {
      try {
        registeredTool.remove();
      } catch (e) {
        logger.warn(`Failed to remove boosted tool "${name}":`, e);
      }
    }
    ctx.router.removeHandler(name);
  }
  ctx.boostedRegisteredTools.clear();
  ctx.boostedToolNames.clear();

  if (targetTier === ctx.baseTier) {
    ctx.enabledDomains = ctx.resolveEnabledDomains(ctx.selectedTools);
    return;
  }

  const targetTools = getToolsForProfile(targetTier);

  // Step 2: Exclude both base tools AND individually activated tools to avoid
  // "Tool X is already registered" collisions with the MCP SDK.
  const excludeNames = new Set(ctx.selectedTools.map((t) => t.name));
  for (const name of ctx.activatedToolNames) {
    excludeNames.add(name);
  }
  const newTools = targetTools.filter((t) => !excludeNames.has(t.name));

  // Step 3: Absorb activated tools into the boost set so they are managed
  // consistently (removed on unboost, covered by the tier's domain set).
  const absorbedFromActivated: string[] = [];
  const targetNameSet = new Set(targetTools.map((t) => t.name));
  for (const name of ctx.activatedToolNames) {
    if (targetNameSet.has(name)) {
      const registeredTool = ctx.activatedRegisteredTools.get(name);
      if (registeredTool) {
        ctx.boostedToolNames.add(name);
        ctx.boostedRegisteredTools.set(name, registeredTool);
      }
      ctx.activatedToolNames.delete(name);
      ctx.activatedRegisteredTools.delete(name);
      absorbedFromActivated.push(name);
    }
  }
  if (absorbedFromActivated.length > 0) {
    logger.info(
      `switchToTier: absorbed ${absorbedFromActivated.length} activated tools into boost set`
    );
  }

  ctx.enabledDomains = ctx.resolveEnabledDomains(ctx.selectedTools);
  for (const domain of getProfileDomains(targetTier)) {
    ctx.enabledDomains.add(domain);
  }

  // Step 4: Register new tools with rollback on failure.
  // Track successfully registered tools so we can undo on error.
  const registered: Array<{ name: string; registeredTool: import('@modelcontextprotocol/sdk/server/mcp.js').RegisteredTool }> = [];
  try {
    for (const toolDef of newTools) {
      const registeredTool = ctx.registerSingleTool(toolDef);
      ctx.boostedToolNames.add(toolDef.name);
      ctx.boostedRegisteredTools.set(toolDef.name, registeredTool);
      registered.push({ name: toolDef.name, registeredTool });
    }
  } catch (error) {
    // Rollback: remove all tools registered in this attempt
    for (const { name, registeredTool } of registered) {
      try {
        registeredTool.remove();
      } catch (e) {
        logger.warn(`Rollback: failed to remove tool "${name}":`, e);
      }
      ctx.boostedToolNames.delete(name);
      ctx.boostedRegisteredTools.delete(name);
    }
    // Restore absorbed activated tools back to their original set
    for (const name of absorbedFromActivated) {
      const rt = ctx.boostedRegisteredTools.get(name);
      if (rt) {
        ctx.activatedToolNames.add(name);
        ctx.activatedRegisteredTools.set(name, rt);
        ctx.boostedToolNames.delete(name);
        ctx.boostedRegisteredTools.delete(name);
      }
    }
    throw error;
  }

  // Step 5: Add handlers for all new tools (only reached on full success)
  const newToolNames = new Set(newTools.map((t) => t.name));
  const newHandlers = createToolHandlerMap(ctx.handlerDeps, newToolNames);
  ctx.router.addHandlers(newHandlers);
}
