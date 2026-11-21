import { getTypedDomain, type MCPServerContext } from '@server/MCPServer.context';

export interface BrowserAttachRuntimeSnapshot {
  endpoint: string | null;
  selectedIndex: number | null;
  selectedUrl: string | null;
  selectedTitle: string | null;
  selectedTargetId: string | null;
  browserPid: number | null;
  rendererPid: number | null;
  attachedAt: string | null;
}

export interface ToolCoverageEntry {
  count: number;
  lastCalledAt: string | null;
  lastArgsKeys: string[];
}

type PersistedDomainTtl = {
  ttlMinutes: number;
  toolNames: string[];
};

type RuntimeStateSnapshot = {
  schemaVersion: 1;
  savedAt: string;
  activatedDomains: string[];
  domainTtls: Record<string, PersistedDomainTtl>;
  browserAttach: BrowserAttachRuntimeSnapshot;
  toolCoverage: Record<string, ToolCoverageEntry>;
};

const EMPTY_BROWSER_ATTACH: BrowserAttachRuntimeSnapshot = {
  endpoint: null,
  selectedIndex: null,
  selectedUrl: null,
  selectedTitle: null,
  selectedTargetId: null,
  browserPid: null,
  rendererPid: null,
  attachedAt: null,
};

function restoreBrowserAttach(
  browserAttach: Record<string, unknown> | undefined | null,
): BrowserAttachRuntimeSnapshot {
  return browserAttach && typeof browserAttach === 'object'
    ? {
        endpoint: typeof browserAttach.endpoint === 'string' ? browserAttach.endpoint : null,
        selectedIndex:
          typeof browserAttach.selectedIndex === 'number' &&
          Number.isInteger(browserAttach.selectedIndex)
            ? browserAttach.selectedIndex
            : null,
        selectedUrl:
          typeof browserAttach.selectedUrl === 'string' ? browserAttach.selectedUrl : null,
        selectedTitle:
          typeof browserAttach.selectedTitle === 'string' ? browserAttach.selectedTitle : null,
        selectedTargetId:
          typeof browserAttach.selectedTargetId === 'string'
            ? browserAttach.selectedTargetId
            : null,
        browserPid:
          typeof browserAttach.browserPid === 'number' && Number.isInteger(browserAttach.browserPid)
            ? browserAttach.browserPid
            : null,
        rendererPid:
          typeof browserAttach.rendererPid === 'number' &&
          Number.isInteger(browserAttach.rendererPid)
            ? browserAttach.rendererPid
            : null,
        attachedAt: typeof browserAttach.attachedAt === 'string' ? browserAttach.attachedAt : null,
      }
    : { ...EMPTY_BROWSER_ATTACH };
}

export class ServerRuntimeState {
  private dirty = false;
  private persistedRevision = 0;
  private revision = 0;
  private pendingActivatedDomains = new Set<string>();
  private pendingDomainTtls = new Map<string, PersistedDomainTtl>();
  private browserAttach: BrowserAttachRuntimeSnapshot = { ...EMPTY_BROWSER_ATTACH };
  private readonly toolCoverage = new Map<string, ToolCoverageEntry>();

  markPersisted(): void {
    this.persistedRevision = this.revision;
    this.dirty = false;
  }

  isPersistDirty(): boolean {
    return this.dirty || this.revision !== this.persistedRevision;
  }

  exportSnapshot(): RuntimeStateSnapshot {
    return {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      activatedDomains: [...this.pendingActivatedDomains].toSorted(),
      domainTtls: Object.fromEntries(
        [...this.pendingDomainTtls.entries()]
          .toSorted(([a], [b]) => a.localeCompare(b))
          .map(([domain, entry]) => [
            domain,
            {
              ttlMinutes: entry.ttlMinutes,
              toolNames: [...entry.toolNames],
            },
          ]),
      ),
      browserAttach: { ...this.browserAttach },
      toolCoverage: Object.fromEntries(
        [...this.toolCoverage.entries()]
          .toSorted(([a], [b]) => a.localeCompare(b))
          .map(([name, entry]) => [name, { ...entry, lastArgsKeys: [...entry.lastArgsKeys] }]),
      ),
    };
  }

  restoreSnapshot(data: unknown): void {
    if (!data || typeof data !== 'object') {
      return;
    }
    const snapshot = data as Partial<RuntimeStateSnapshot>;
    if (snapshot.schemaVersion !== 1) {
      return;
    }

    this.pendingActivatedDomains = new Set(
      Array.isArray(snapshot.activatedDomains)
        ? snapshot.activatedDomains.filter((value): value is string => typeof value === 'string')
        : [],
    );

    this.restorePendingDomainTtls(snapshot);
    this.browserAttach = restoreBrowserAttach(
      snapshot.browserAttach as Record<string, unknown> | undefined | null,
    );
    this.restorePendingToolCoverage(snapshot);

    this.revision += 1;
    this.persistedRevision = this.revision;
    this.dirty = false;
  }

  /** TTL map from snapshot — skips malformed entries. */
  private restorePendingDomainTtls(snapshot: Partial<RuntimeStateSnapshot>): void {
    this.pendingDomainTtls = new Map<string, PersistedDomainTtl>();
    if (snapshot.domainTtls && typeof snapshot.domainTtls === 'object') {
      for (const [domain, rawEntry] of Object.entries(snapshot.domainTtls)) {
        if (!rawEntry || typeof rawEntry !== 'object') {
          continue;
        }
        const entry = rawEntry as Partial<PersistedDomainTtl>;
        const ttlMinutes = Number(entry.ttlMinutes);
        const toolNames = Array.isArray(entry.toolNames)
          ? entry.toolNames.filter((value): value is string => typeof value === 'string')
          : [];
        if (!Number.isFinite(ttlMinutes)) {
          continue;
        }
        this.pendingDomainTtls.set(domain, { ttlMinutes, toolNames });
      }
    }
  }

  /** Tool coverage counts from snapshot — clamps malformed values to defaults. */
  private restorePendingToolCoverage(snapshot: Partial<RuntimeStateSnapshot>): void {
    this.toolCoverage.clear();
    if (snapshot.toolCoverage && typeof snapshot.toolCoverage === 'object') {
      for (const [name, rawEntry] of Object.entries(snapshot.toolCoverage)) {
        if (!rawEntry || typeof rawEntry !== 'object') {
          continue;
        }
        const entry = rawEntry as Partial<ToolCoverageEntry>;
        this.toolCoverage.set(name, {
          count:
            typeof entry.count === 'number' && Number.isFinite(entry.count) && entry.count >= 0
              ? Math.trunc(entry.count)
              : 0,
          lastCalledAt: typeof entry.lastCalledAt === 'string' ? entry.lastCalledAt : null,
          lastArgsKeys: Array.isArray(entry.lastArgsKeys)
            ? entry.lastArgsKeys.filter((value): value is string => typeof value === 'string')
            : [],
        });
      }
    }
  }

  noteDirty(): void {
    this.revision += 1;
    this.dirty = true;
  }

  setPendingDomainActivation(
    domain: string,
    ttlMinutes: number,
    toolNames: Iterable<string>,
  ): void {
    this.pendingActivatedDomains.add(domain);
    this.pendingDomainTtls.set(domain, {
      ttlMinutes,
      toolNames: [...toolNames],
    });
    this.noteDirty();
  }

  clearPendingDomainActivation(domain: string): void {
    const deletedDomain = this.pendingActivatedDomains.delete(domain);
    const deletedTtl = this.pendingDomainTtls.delete(domain);
    if (deletedDomain || deletedTtl) {
      this.noteDirty();
    }
  }

  getPendingActivatedDomains(): string[] {
    return [...this.pendingActivatedDomains];
  }

  getPendingDomainTtl(domain: string): PersistedDomainTtl | null {
    return this.pendingDomainTtls.get(domain) ?? null;
  }

  setBrowserAttach(snapshot: Partial<BrowserAttachRuntimeSnapshot>): void {
    this.browserAttach = {
      ...this.browserAttach,
      ...snapshot,
    };
    this.noteDirty();
  }

  clearBrowserAttach(): void {
    this.browserAttach = { ...EMPTY_BROWSER_ATTACH };
    this.noteDirty();
  }

  getBrowserAttach(): BrowserAttachRuntimeSnapshot {
    return { ...this.browserAttach };
  }

  recordToolCall(name: string, args: Record<string, unknown>): void {
    const prev = this.toolCoverage.get(name);
    const entry: ToolCoverageEntry = {
      count: (prev?.count ?? 0) + 1,
      lastCalledAt: new Date().toISOString(),
      lastArgsKeys: Object.keys(args)
        .filter((key) => key !== '_meta')
        .toSorted(),
    };
    this.toolCoverage.set(name, entry);
    this.noteDirty();
  }

  getCoverageSummary(
    ctx: MCPServerContext,
    catalogToolNames: Iterable<string>,
  ): {
    called: Record<string, ToolCoverageEntry>;
    calledCount: number;
    uncataloguedCalls: string[];
    uncataloguedCallCount: number;
    totalKnownTools: number;
    uncalled: string[];
    uncalledCount: number;
  } {
    const called = Object.fromEntries(
      [...this.toolCoverage.entries()]
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([name, entry]) => [name, { ...entry, lastArgsKeys: [...entry.lastArgsKeys] }]),
    );

    const knownTools = new Set<string>([
      ...catalogToolNames,
      ...ctx.selectedTools.map((tool) => tool.name),
      ...ctx.activatedToolNames,
      ...ctx.extensionToolsByName.keys(),
      ...ctx.metaToolsByName.keys(),
    ]);

    const uncataloguedCalls = [...this.toolCoverage.keys()]
      .filter((name) => !knownTools.has(name))
      .toSorted((a, b) => a.localeCompare(b));
    const uncalled = [...knownTools]
      .filter((name) => !this.toolCoverage.has(name))
      .toSorted((a, b) => a.localeCompare(b));

    return {
      called,
      calledCount: this.toolCoverage.size,
      uncataloguedCalls,
      uncataloguedCallCount: uncataloguedCalls.length,
      totalKnownTools: knownTools.size,
      uncalled,
      uncalledCount: uncalled.length,
    };
  }
}

export function getRuntimeState(ctx: MCPServerContext): ServerRuntimeState | null {
  if (!ctx || typeof ctx.getDomainInstance !== 'function') {
    return null;
  }
  return getTypedDomain(ctx, 'serverRuntimeState') ?? null;
}
