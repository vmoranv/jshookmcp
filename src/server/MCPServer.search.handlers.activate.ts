/**
 * Handlers for activate_tools and deactivate_tools meta-tools.
 */
import { logger } from '@utils/logger';
import { emitBusEvent } from '@server/EventBus';
import {
  registerExtensionToolRecord,
  unregisterExtensionToolRecord,
} from '@server/extensions/ExtensionManager.tools';
import { asTextResponse } from '@server/domains/shared/response';
import { createToolHandlerMap } from '@server/ToolHandlerMap';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolResponse } from '@server/types';
import { normalizeToolName, validateToolNameArray } from '@server/MCPServer.search.validation';
import {
  createActivationBudgetTracker,
  estimateToolTokens,
  getActiveToolNames,
  getToolLastUsedAt,
  summarizeActivationBudget,
  type ActivationBudgetSummary,
  type ActivationBudgetTracker,
} from '@server/MCPServer.search.helpers';
import { loadSearchCatalog } from '@server/registry/SearchCatalog';
import { ensureDomainLoaded, getRegistrationByName } from '@server/registry/index';
import { deactivateToolCore } from '@server/tool-lifecycle';

interface ActivationSummary {
  activated: string[];
  alreadyActive: string[];
  notFound: string[];
  /** Tools skipped because they did not fit the activation budget. */
  budgetExceeded: string[];
  /** Least-recently-used tools deactivated automatically to make room (LRU eviction). */
  evicted: string[];
  totalActive: number;
  budget: ActivationBudgetSummary;
}

/**
 * LRU eviction helper (kimi-cu report P2-4): when an incoming tool does not
 * fit the activation budget, deactivate the least recently used dynamic
 * tools until it does, instead of hard-failing the activation. Tools in the
 * current request are never evicted; meta-tools live outside
 * `activatedToolNames` and are never candidates.
 *
 * Returns the evicted names. Nothing is deactivated when eviction cannot
 * free enough room — the caller falls back to the budgetExceeded path.
 */
export async function evictForBudget(
  ctx: MCPServerContext,
  budget: ActivationBudgetTracker,
  protectedNames: ReadonlySet<string>,
  incoming: { tools: number; tokens: number },
): Promise<string[]> {
  if (!budget.enforced) return [];
  const fits = () =>
    budget.activeTools + incoming.tools <= budget.maxTools &&
    budget.usedTokens + incoming.tokens <= budget.maxTokens;
  if (fits()) return [];

  const catalog = await loadSearchCatalog();
  const lastUsed = getToolLastUsedAt(ctx);
  // Never-used tools sort oldest (0) and go first; recency keeps hot tools armed.
  const candidates = [...ctx.activatedToolNames]
    .filter((name) => !protectedNames.has(name))
    .toSorted((a, b) => (lastUsed.get(a) ?? 0) - (lastUsed.get(b) ?? 0));

  // Atomicity pre-check: only start evicting when the FULL candidate pool can
  // free enough room. Evicting is irreversible (deactivateToolCore mutates
  // ctx), so a hopeless request must leave every tool armed and fall through
  // to the budgetExceeded path instead of deactivating tools for nothing.
  let potentialTools = 0;
  let potentialTokens = 0;
  for (const name of candidates) {
    const def = ctx.extensionToolsByName.get(name)?.tool ?? catalog.toolByName.get(name);
    if (!def) continue;
    potentialTools += 1;
    potentialTokens += estimateToolTokens(def);
  }
  if (
    budget.activeTools - potentialTools + incoming.tools > budget.maxTools ||
    budget.usedTokens - potentialTokens + incoming.tokens > budget.maxTokens
  ) {
    return [];
  }

  const evicted: string[] = [];
  for (const name of candidates) {
    if (fits()) break;
    const def = ctx.extensionToolsByName.get(name)?.tool ?? catalog.toolByName.get(name);
    if (!def) continue;
    deactivateToolCore(name, {
      activatedToolNames: ctx.activatedToolNames,
      activatedRegisteredTools: ctx.activatedRegisteredTools,
      router: ctx.router,
      extensionToolsByName: ctx.extensionToolsByName,
    });
    budget.release(def);
    evicted.push(name);
  }

  if (evicted.length > 0) {
    const timestamp = new Date().toISOString();
    emitBusEvent(ctx.eventBus, 'tool.activation.changed', {
      action: 'lru-evicted',
      toolNames: evicted,
      timestamp,
    });
    for (const name of evicted) {
      const domain =
        ctx.extensionToolsByName.get(name)?.domain ?? catalog.entryByName.get(name)?.domain;
      if (domain) {
        emitBusEvent(ctx.eventBus, 'tool:deactivated', { toolName: name, domain, timestamp });
      }
    }
    logger.info(`activate_tools: LRU-evicted ${evicted.length} tool(s) to make budget room`);
  }
  return evicted;
}

async function notifyToolListChanged(ctx: MCPServerContext, changed: boolean): Promise<void> {
  if (!changed) {
    return;
  }

  try {
    await ctx.server.sendToolListChanged();
  } catch (e) {
    logger.warn('sendToolListChanged failed:', e);
  }
}

export async function activateToolNames(
  ctx: MCPServerContext,
  names: string[],
): Promise<ActivationSummary> {
  // Dynamic import keeps the module graph acyclic: search.ts registers the
  // handlers defined in this module, so a static import would form a cycle.
  const { META_TOOL_NAMES } = await import('@server/MCPServer.search');
  const activeNames = getActiveToolNames(ctx);
  const activated: string[] = [];
  const alreadyActive: string[] = [];
  const notFound: string[] = [];
  const budgetExceeded: string[] = [];
  const evicted: string[] = [];
  /**
   * Owning domain of each newly activated tool, keyed by name. Filled at the
   * same point as `activated` (see below), so its keys are exactly that list,
   * in order — never the whole request, only the tools that transitioned.
   */
  const activatedDomains = new Map<string, string>();
  const budget = await createActivationBudgetTracker(ctx);
  // Tools named in this request must survive LRU eviction — they are the
  // reason we are activating in the first place.
  const protectedNames = new Set(names.map((n) => normalizeToolName(n)));

  for (const rawName of names) {
    const name = normalizeToolName(rawName);
    // Meta-tools are always registered as top-level tools and never appear in
    // the domain search catalog, so report them as already active instead of
    // notFound.
    if (META_TOOL_NAMES.has(name)) {
      alreadyActive.push(name);
      continue;
    }

    if (activeNames.has(name)) {
      alreadyActive.push(name);
      continue;
    }

    /**
     * Owning domain of this tool, resolved on whichever branch registers it.
     * Both branches assign it before falling through to the push below; every
     * path that skips registration `continue`s out first.
     */
    let domain: string;
    const extensionRecord = ctx.extensionToolsByName.get(name);
    if (extensionRecord) {
      if (!budget.admit(extensionRecord.tool)) {
        // LRU eviction before the hard fail (kimi-cu report P2-4): free the
        // least recently used tools instead of bouncing the activation.
        evicted.push(
          ...(await evictForBudget(ctx, budget, protectedNames, {
            tools: 1,
            tokens: estimateToolTokens(extensionRecord.tool),
          })),
        );
        if (!budget.admit(extensionRecord.tool)) {
          budgetExceeded.push(name);
          continue;
        }
      }
      registerExtensionToolRecord(ctx, extensionRecord, 'activate_tools');
      domain = extensionRecord.domain;
    } else {
      const catalog = await loadSearchCatalog();
      const catalogEntry = catalog.entryByName.get(name);
      if (!catalogEntry) {
        notFound.push(name);
        continue;
      }
      // Budget is checked against the catalog definition before loading the
      // domain, so rejected tools never trigger a domain load.
      if (!budget.admit(catalogEntry.tool)) {
        evicted.push(
          ...(await evictForBudget(ctx, budget, protectedNames, {
            tools: 1,
            tokens: estimateToolTokens(catalogEntry.tool),
          })),
        );
        if (!budget.admit(catalogEntry.tool)) {
          budgetExceeded.push(name);
          continue;
        }
      }
      await ensureDomainLoaded(catalogEntry.domain, ctx.eventBus);
      const toolDef = getRegistrationByName(name)?.tool;
      if (!toolDef) {
        notFound.push(name);
        continue;
      }
      const registeredTool = ctx.registerSingleTool(toolDef);
      ctx.activatedToolNames.add(name);
      ctx.activatedRegisteredTools.set(name, registeredTool);
      ctx.enabledDomains.add(catalogEntry.domain);
      domain = catalogEntry.domain;
      const newToolNames = new Set([name]);
      const newHandlers = createToolHandlerMap(ctx.handlerDeps, newToolNames);
      ctx.router.addHandlers(newHandlers);
    }

    activated.push(name);
    activatedDomains.set(name, domain);
    activeNames.add(name);
  }

  await notifyToolListChanged(ctx, activated.length > 0);

  logger.info(
    `activate_tools: activated ${activated.length}, already_active ${alreadyActive.length}, not_found ` +
      `${notFound.length}, budget_exceeded ${budgetExceeded.length}`,
  );

  if (activated.length > 0) {
    const timestamp = new Date().toISOString();
    emitBusEvent(ctx.eventBus, 'tool.activation.changed', {
      action: 'activated',
      toolNames: activated,
      timestamp,
    });
    // Per-tool companion to the batch event above. `tool.activation.changed`
    // reports the whole batch and carries no domain; `tool:activated` reports
    // each tool that actually transitioned, with the domain it belongs to.
    // `activatedDomains` is filled at the same point as `activated`, so the two
    // cannot drift — one event per transition, never one per request.
    for (const [toolName, domain] of activatedDomains) {
      emitBusEvent(ctx.eventBus, 'tool:activated', { toolName, domain, timestamp });
    }
  }
  if (budgetExceeded.length > 0) {
    emitBusEvent(ctx.eventBus, 'tool.activation.changed', {
      action: 'budget-rejected',
      toolNames: budgetExceeded,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    activated,
    alreadyActive,
    notFound,
    budgetExceeded,
    evicted,
    totalActive: activeNames.size,
    budget: summarizeActivationBudget(budget),
  };
}

/**
 * Human-readable explanation for tools skipped over the activation budget.
 * Shared with the call_tool auto-activation path so a budget-blocked proxy
 * call reports WHY it failed instead of a misleading "Unknown tool".
 */
export function formatActivationBudgetHint(summary: ActivationSummary): string {
  return (
    `Skipped ${summary.budgetExceeded.length} tool(s) over the activation budget ` +
    `(used ${summary.budget.usedTokens}/${summary.budget.maxTokens} tokens, ` +
    `${summary.budget.activeTools}/${summary.budget.maxTools} tools): ` +
    `${summary.budgetExceeded.join(', ')}. Deactivate unused tools first or raise ` +
    `MCP_TOOL_ACTIVATION_BUDGET_TOKENS / MCP_TOOL_MAX_ACTIVE_TOOLS.`
  );
}

// ── activation precheck (kimi-cu report P2-4: budget visibility) ──

export interface ActivationPrecheckResult {
  precheck: true;
  /** Tools that would transition to active if activated now. */
  wouldActivate: string[];
  alreadyActive: string[];
  notFound: string[];
  /** LRU candidates that must be evicted for `wouldActivate` to fit. */
  wouldEvict: string[];
  /** Whether the full request fits after applying `wouldEvict`. */
  fits: boolean;
  /** Projected budget state after eviction + activation (or after eviction only when it does not fit). */
  afterEvict: ActivationBudgetSummary;
}

/**
 * Dry-run the activation budget: report what would activate, what would be
 * LRU-evicted to make room, and whether the request fits at all. No state
 * is mutated — deactivations are only simulated.
 */
export async function precheckActivation(
  ctx: MCPServerContext,
  names: string[],
): Promise<ActivationPrecheckResult> {
  const catalog = await loadSearchCatalog();
  const budget = await createActivationBudgetTracker(ctx);
  const activeNames = getActiveToolNames(ctx);
  const lastUsed = getToolLastUsedAt(ctx);
  const requestedNames = new Set(names.map((n) => normalizeToolName(n)));

  const wouldActivate: string[] = [];
  const alreadyActive: string[] = [];
  const notFound: string[] = [];
  let needTokens = 0;

  for (const rawName of names) {
    const name = normalizeToolName(rawName);
    if (activeNames.has(name)) {
      alreadyActive.push(name);
      continue;
    }
    const def = ctx.extensionToolsByName.get(name)?.tool ?? catalog.entryByName.get(name)?.tool;
    if (!def) {
      notFound.push(name);
      continue;
    }
    wouldActivate.push(name);
    needTokens += estimateToolTokens(def);
  }

  // Simulate eviction over a copy of the current footprint.
  let simTools = budget.activeTools;
  let simTokens = budget.usedTokens;
  const needTools = wouldActivate.length;
  const fits = () =>
    simTools + needTools <= budget.maxTools && simTokens + needTokens <= budget.maxTokens;
  const wouldEvict: string[] = [];
  if (budget.enforced && !fits() && needTools > 0) {
    const pool = [...ctx.activatedToolNames]
      .filter((name) => !requestedNames.has(name))
      .toSorted((a, b) => (lastUsed.get(a) ?? 0) - (lastUsed.get(b) ?? 0));
    for (const name of pool) {
      if (fits()) break;
      const def = ctx.extensionToolsByName.get(name)?.tool ?? catalog.toolByName.get(name);
      if (!def) continue;
      simTools -= 1;
      simTokens -= estimateToolTokens(def);
      wouldEvict.push(name);
    }
  }

  const fitsAll = fits();
  return {
    precheck: true,
    wouldActivate,
    alreadyActive,
    notFound,
    wouldEvict,
    fits: fitsAll,
    afterEvict: {
      usedTokens: Math.max(0, fitsAll ? simTokens + needTokens : simTokens),
      maxTokens: budget.maxTokens,
      activeTools: fitsAll ? simTools + needTools : simTools,
      maxTools: budget.maxTools,
    },
  };
}

// ── activate_tools handler ──

export async function handleActivateTools(
  ctx: MCPServerContext,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  // Handle both array and JSON-string formats (anyOf schema may pass either)
  let namesArg = args.names;
  if (typeof namesArg === 'string' && namesArg.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(namesArg);
      if (Array.isArray(parsed)) namesArg = parsed;
    } catch {
      /* malformed — fall through */
    }
  }

  const { names, error } = validateToolNameArray({ names: namesArg });
  if (error) {
    return asTextResponse(JSON.stringify({ success: false, error }));
  }

  // Budget precheck: report wouldActivate/wouldEvict without touching state.
  if (args.precheck === true) {
    const pre = await precheckActivation(ctx, names);
    return asTextResponse(JSON.stringify({ success: true, ...pre }));
  }

  const result = await activateToolNames(ctx, names);

  const hint =
    result.budgetExceeded.length > 0
      ? formatActivationBudgetHint(result)
      : result.activated.length > 0
        ? 'Tools activated. If they do not appear in your tool list, use call_tool({ name: "<tool>", args: {...} ' +
          '}) to invoke them.'
        : undefined;

  return asTextResponse(
    JSON.stringify({
      success: true,
      ...result,
      hint,
    }),
  );
}

// ── deactivate_tools handler ──

export async function handleDeactivateTools(
  ctx: MCPServerContext,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const { names, error } = validateToolNameArray(args);
  if (error) {
    return asTextResponse(JSON.stringify({ success: false, error }));
  }

  const deactivated: string[] = [];
  const notActivated: string[] = [];
  /**
   * Owning domain of each newly deactivated tool. Filled only for tools that
   * actually transitioned, so `tool:deactivated` is per-transition, never per
   * request.
   */
  const deactivatedDomains = new Map<string, string>();
  const catalog = await loadSearchCatalog();

  for (const rawName of names) {
    const name = normalizeToolName(rawName);
    if (!ctx.activatedToolNames.has(name)) {
      notActivated.push(name);
      continue;
    }

    // Resolve the domain before any removal mutates the extension registry, so
    // the event reports the domain the tool actually belonged to.
    const domain =
      ctx.extensionToolsByName.get(name)?.domain ?? catalog.entryByName.get(name)?.domain;
    if (domain) {
      deactivatedDomains.set(name, domain);
    } else {
      logger.warn(
        `deactivate_tools: could not resolve a domain for active tool "${name}"; ` +
          'no tool:deactivated event will be emitted for it',
      );
    }

    const registeredTool = ctx.activatedRegisteredTools.get(name);
    if (registeredTool && !ctx.extensionToolsByName.has(name)) {
      try {
        registeredTool.remove();
      } catch (e) {
        logger.warn(`Failed to remove activated tool "${name}":`, e);
      }
    }

    const extensionRecord = ctx.extensionToolsByName.get(name);
    if (extensionRecord) {
      unregisterExtensionToolRecord(ctx, extensionRecord, {
        onRemoveError: (removeError) => {
          logger.warn(`Failed to remove activated tool "${name}":`, removeError);
        },
      });
    } else {
      deactivateToolCore(name, {
        activatedToolNames: ctx.activatedToolNames,
        activatedRegisteredTools: ctx.activatedRegisteredTools,
        router: ctx.router,
        extensionToolsByName: ctx.extensionToolsByName,
      });
    }
    deactivated.push(name);
  }

  await notifyToolListChanged(ctx, deactivated.length > 0);

  logger.info(
    `deactivate_tools: deactivated ${deactivated.length}, not_activated ${notActivated.length}`,
  );

  if (deactivated.length > 0) {
    const timestamp = new Date().toISOString();
    emitBusEvent(ctx.eventBus, 'tool.activation.changed', {
      action: 'deactivated',
      toolNames: deactivated,
      timestamp,
    });
    // Per-tool companion to the batch event above — see the activation site.
    for (const name of deactivated) {
      const domain = deactivatedDomains.get(name);
      if (domain === undefined) continue;
      emitBusEvent(ctx.eventBus, 'tool:deactivated', { toolName: name, domain, timestamp });
    }
  }

  return asTextResponse(
    JSON.stringify({
      success: true,
      deactivated,
      notActivated,
      hint: 'Deactivated tools are no longer available. Search again to find alternatives.',
    }),
  );
}
