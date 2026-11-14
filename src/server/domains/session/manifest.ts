import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { sessionToolDefinitions } from '@server/domains/session/definitions';
import type { SessionProgressHandlers } from '@server/domains/session/handlers';

const DOMAIN = 'session' as const;
const DEP_KEY = 'sessionProgressHandlers' as const;
type H = SessionProgressHandlers;

const registrations = defineMethodRegistrations<H, (typeof sessionToolDefinitions)[number]['name']>(
  {
    domain: DOMAIN,
    depKey: DEP_KEY,
    lookup: toolLookup(sessionToolDefinitions),
    entries: [
      { tool: 'session_progress_record', method: 'handleRecordProgressTool' },
      { tool: 'session_progress_coverage', method: 'handleGetCoverageTool' },
      { tool: 'session_progress_clear', method: 'handleClearProgressTool' },
    ],
  },
);

/**
 * Lazy factory: the ledger state lives on the SessionProgressHandlers
 * instance, which is cached on the server context via the shared domain
 * instance map — i.e. per-server-lifetime in-memory state. Mock contexts in
 * transport tests only need getDomainInstance/setDomainInstance; nothing else
 * on ctx is required.
 */
async function ensure(ctx: MCPServerContext): Promise<H> {
  const existing = ctx.getDomainInstance<H>(DEP_KEY);
  if (existing) {
    return existing;
  }
  const { SessionProgressHandlers } = await import('@server/domains/session/handlers');
  const handlers = new SessionProgressHandlers();
  ctx.setDomainInstance(DEP_KEY, handlers);
  return handlers;
}

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  session_progress_clear: ['wipe progress entries', 'reset session ledger', 'clear the progress'],
  session_progress_coverage: [
    'what has been covered so far',
    'progress checklist',
    'overwrite the progress',
  ],
  session_progress_record: ['note down completed step', 'log milestone', 'record the progress'],
};

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
  ensure,
  registrations,

  // Document-expansion keywords for the retrieval layer (SCENE_KEYWORDS above).
  sceneKeywords: SCENE_KEYWORDS,
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
