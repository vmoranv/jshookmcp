/**
 * instrumentation domain benchmark — offline-pure handlers only.
 *
 * All nine tools here are genuinely offline-pure: their handlers only touch
 * in-memory session/graph state (plus, for session_export, one atomic JSON
 * file write into an OS-temp directory). No browser, no network, no native
 * FFI, no subprocess, no env gating, no random data feeds the assertions.
 *
 * Each case seeds its OWN fresh state inside run() so the suite is idempotent
 * no matter how many times the gate invokes it. All ground truth is homemade
 * (deterministic fixtures) and every validate() asserts a concrete, structural
 * invariant — not merely "success !== false".
 */
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { InstrumentationSessionManager } from '@server/instrumentation/InstrumentationSession';
import { InstrumentationType } from '@server/instrumentation/types';
import { InstrumentationHandlers } from '@server/domains/instrumentation/handlers';
import { EvidenceHandlers } from '@server/domains/instrumentation/evidence/handlers';
import { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';
import { body, type BenchSuite } from '../harness';

// ── shared helpers ───────────────────────────────────────────────────────────

/** Pull a typed field out of a parsed MCP/text response body. */
function field<T = unknown>(b: Record<string, unknown>, key: string): T | undefined {
  return b[key] as T | undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function failed(b: Record<string, unknown>): boolean {
  return b.success === false || b.ok === false;
}

/**
 * Build a fresh instrumentation manager + handlers with two fully seeded
 * sessions. Deterministic content; only the generated ids/timestamps vary.
 *
 *   session A ("alpha"): 1 RUNTIME_HOOK op  -> 1 artifact {returnValue:'alpha'}
 *   session B ("bravo"): 2 ops (RUNTIME_HOOK + FUNCTION_TRACE, the latter
 *                          carrying a second, distinct artifact)
 *
 * Used by the export/diff/merge cases, which each need a known delta.
 */
function seedSessions() {
  const manager = new InstrumentationSessionManager();
  const handlers = new InstrumentationHandlers(manager);

  const sA = manager.createSession('alpha');
  const opA = manager.registerOperation(sA.id, InstrumentationType.RUNTIME_HOOK, 'signPayload', {
    captureArgs: true,
  });
  manager.recordArtifact(opA.id, { returnValue: 'alpha' });

  const sB = manager.createSession('bravo');
  const opB1 = manager.registerOperation(sB.id, InstrumentationType.RUNTIME_HOOK, 'signPayload', {
    captureArgs: true,
  });
  const opB2 = manager.registerOperation(sB.id, InstrumentationType.FUNCTION_TRACE, 'traceMe', {});
  manager.recordArtifact(opB1.id, { returnValue: 'alpha' }); // same fingerprint as A
  manager.recordArtifact(opB2.id, { functionName: 'traceMe', executionTimeMs: 7 });

  return { manager, handlers, sA, sB, opA, opB1, opB2 };
}

/** Build a fresh evidence graph shaped as a linear provenance chain. */
function seedGraph() {
  const graph = new ReverseEvidenceGraph();
  const request = graph.addNode('request', 'GET /checkout', {
    url: 'https://shop.test/checkout',
  });
  const script = graph.addNode('script', 'app.js', { scriptId: 'script-42' });
  const fn = graph.addNode('function', 'signPayload', { functionName: 'signPayload' });
  const hook = graph.addNode('breakpoint-hook', 'bp @ app.js:10', {});
  const captured = graph.addNode('captured-data', 'captured args', {});
  const replay = graph.addNode('replay-artifact', 'replayed request', {});

  graph.addEdge(request.id, script.id, 'loads');
  graph.addEdge(script.id, fn.id, 'contains');
  graph.addEdge(fn.id, hook.id, 'triggers');
  graph.addEdge(hook.id, captured.id, 'captures');
  graph.addEdge(captured.id, replay.id, 'replays');

  const handlers = new EvidenceHandlers(graph);
  return { graph, handlers, request, script, fn, hook, captured, replay };
}

// ── cases ────────────────────────────────────────────────────────────────────

export const instrumentationSuite: BenchSuite = {
  name: 'instrumentation',
  domain: 'instrumentation',
  description:
    'Offline-pure instrumentation + evidence handlers: session create/status/list/destroy, snapshot export roundtrip, pure snapshot diff, id-remapping merge, operation register/stop, artifact record/query, evidence url/function/script query, JSON export, and BFS provenance chain',
  cases: [
    // 1 ── instrumentation_session ────────────────────────────────────────────
    {
      name: 'instrumentation_session/create-status-list-destroy',
      tool: 'instrumentation_session',
      origin: 'homemade',
      reference:
        'Session lifecycle invariant: create(name="lifecycle") yields a distinct id; status reports operationCount/artifactCount 0; list contains exactly the one active session; destroy removes it from the active list',
      run: async () => {
        const handlers = new InstrumentationHandlers(new InstrumentationSessionManager());
        const created = body(
          await handlers.handleSessionDispatch({ action: 'create', name: 'lifecycle' }),
        );
        const session = field<Record<string, unknown>>(created, 'session');
        const id = session?.id as string;
        const status = body(
          await handlers.handleSessionDispatch({ action: 'status', sessionId: id }),
        );
        const list = body(await handlers.handleSessionDispatch({ action: 'list' }));
        const destroyed = body(
          await handlers.handleSessionDispatch({ action: 'destroy', sessionId: id }),
        );
        const afterList = body(await handlers.handleSessionDispatch({ action: 'list' }));
        return { created, status, list, destroyed, afterList };
      },
      validate: (v) => {
        const b = isRecord(v) ? v : {};
        const created = isRecord(b.created) ? b.created : {};
        const status = isRecord(b.status) ? b.status : {};
        const list = isRecord(b.list) ? b.list : {};
        const destroyed = isRecord(b.destroyed) ? b.destroyed : {};
        const afterList = isRecord(b.afterList) ? b.afterList : {};
        if (failed(created) || failed(status) || failed(list) || failed(destroyed)) {
          return `a lifecycle step reported failure: ${JSON.stringify(b).slice(0, 240)}`;
        }
        const session = field<Record<string, unknown>>(created, 'session');
        const id = session?.id;
        if (typeof id !== 'string' || id.length === 0) return 'create did not return a session id';
        if (session?.name !== 'lifecycle') return `session name lost: ${JSON.stringify(session)}`;
        const stats = field<Record<string, unknown>>(status, 'stats');
        if (stats?.operationCount !== 0 || stats?.artifactCount !== 0) {
          return `fresh session stats should be 0/0, got ${JSON.stringify(stats)}`;
        }
        const sessions = field<unknown[]>(list, 'sessions');
        if (!Array.isArray(sessions) || sessions.length !== 1 || list.totalSessions !== 1) {
          return `expected exactly 1 active session, got ${JSON.stringify(list).slice(0, 200)}`;
        }
        if (destroyed.message !== 'Session destroyed' || destroyed.sessionId !== id) {
          return `destroy response wrong: ${JSON.stringify(destroyed).slice(0, 200)}`;
        }
        const remaining = field<unknown[]>(afterList, 'sessions');
        if (!Array.isArray(remaining) || remaining.length !== 0 || afterList.totalSessions !== 0) {
          return `destroyed session still active: ${JSON.stringify(afterList).slice(0, 200)}`;
        }
        return true;
      },
    },

    // 2 ── instrumentation_session_export ────────────────────────────────────
    {
      name: 'instrumentation_session_export/snapshot-roundtrip',
      tool: 'instrumentation_session_export',
      origin: 'homemade',
      reference:
        'Export writes {schemaVersion:1, snapshot} JSON; roundtrip identity: the file re-parses to the exact seeded snapshot (session.name="alpha", 1 operation target="signPayload", 1 artifact returnValue="alpha"), and reported operationCount/artifactCount/bytesWritten match the file',
      run: async () => {
        // customDir lives under the PROJECT root (resolveArtifactPath enforces
        // containment); we use a fixed temp-ish subdir and clean it up here.
        const dir = join('artifacts', 'tmp', 'bench-instrumentation-export');
        await mkdir(join(process.cwd(), dir), { recursive: true }).catch(() => undefined);
        const { handlers, sA } = seedSessions();
        const raw = await handlers.handleSessionExport({ sessionId: sA.id, outputDir: dir });
        const response = body(raw);
        let written: Record<string, unknown> = {};
        const exportedPath = field<string>(response, 'exportedPath');
        if (typeof exportedPath === 'string') {
          try {
            written = JSON.parse(await readFile(exportedPath, 'utf8')) as Record<string, unknown>;
          } catch {
            written = { readError: true };
          }
        }
        // Clean up the reserved file + dir. Ignore errors: the assertion below
        // already captured whatever the handler wrote.
        if (typeof exportedPath === 'string')
          await rm(exportedPath, { force: true }).catch(() => undefined);
        await rm(join(process.cwd(), dir), { recursive: true, force: true }).catch(() => undefined);
        return { response, written, bytesWritten: field<number>(response, 'bytesWritten') };
      },
      validate: (v) => {
        const b = isRecord(v) ? v : {};
        const response = isRecord(b.response) ? b.response : {};
        const written = isRecord(b.written) ? b.written : {};
        if (failed(response)) return `export failed: ${JSON.stringify(response).slice(0, 240)}`;
        if (written.readError === true) return 'could not read back the exported artifact file';
        if (response.operationCount !== 1 || response.artifactCount !== 1) {
          return `reported counts should be 1/1, got ${String(response.operationCount)}/${String(response.artifactCount)}`;
        }
        if (written.schemaVersion !== 1) {
          return `schemaVersion should be 1, got ${String(written.schemaVersion)}`;
        }
        const snapshot = isRecord(written.snapshot) ? written.snapshot : {};
        const session = isRecord(snapshot.session) ? snapshot.session : {};
        const operations = Array.isArray(snapshot.operations) ? snapshot.operations : [];
        const artifacts = Array.isArray(snapshot.artifacts) ? snapshot.artifacts : [];
        if (session.name !== 'alpha')
          return `exported session.name lost: ${JSON.stringify(session)}`;
        if (
          operations.length !== 1 ||
          (isRecord(operations[0]) && operations[0].target !== 'signPayload')
        ) {
          return `exported operation wrong: ${JSON.stringify(operations).slice(0, 200)}`;
        }
        if (
          artifacts.length !== 1 ||
          (isRecord(artifacts[0]) &&
            isRecord(artifacts[0].data) &&
            artifacts[0].data.returnValue !== 'alpha')
        ) {
          return `exported artifact wrong: ${JSON.stringify(artifacts).slice(0, 200)}`;
        }
        // bytesWritten must equal the exact byte length of the serialized file
        // body the handler built (re-serialize the parsed object is not stable
        // because exportedAt is regenerated), so just assert it is positive and
        // consistent with the file content length reconstructed from `written`.
        const content = JSON.stringify(
          { schemaVersion: 1, exportedAt: written.exportedAt, snapshot },
          null,
          2,
        );
        if (b.bytesWritten !== Buffer.byteLength(content, 'utf8')) {
          return `bytesWritten ${String(b.bytesWritten)} != ${Buffer.byteLength(content, 'utf8')}`;
        }
        return true;
      },
    },

    // 3 ── instrumentation_session_diff ──────────────────────────────────────
    {
      name: 'instrumentation_session_diff/seeded-delta',
      tool: 'instrumentation_session_diff',
      origin: 'homemade',
      reference:
        'Pure diff of snapshot A (1 op, 1 artifact) vs B (2 ops, 2 artifacts): operation ids are globally unique so all B ops are addedInB=2, all A ops are removedFromA=1, common=0; operationCountDelta=+1, artifactCountDelta=+1, artifact fingerprints onlyInB=1 / common=1 / onlyInA=0, per-type runtime-hook delta 0 and function-trace delta +1',
      run: async () => {
        const { handlers, sA, sB } = seedSessions();
        return handlers.handleSessionDiff({ sessionIdA: sA.id, sessionIdB: sB.id });
      },
      validate: (v) => {
        const b = body(v);
        if (failed(b)) return `diff failed: ${JSON.stringify(b).slice(0, 240)}`;
        const diff = isRecord(b.diff) ? b.diff : {};
        const stats = isRecord(diff.stats) ? diff.stats : {};
        const operations = isRecord(diff.operations) ? diff.operations : {};
        const artifacts = isRecord(diff.artifacts) ? diff.artifacts : {};
        if (stats.operationCountDelta !== 1 || stats.artifactCountDelta !== 1) {
          return `count deltas should be +1/+1, got ${JSON.stringify(stats)}`;
        }
        const addedInB = Array.isArray(operations.addedInB) ? operations.addedInB : [];
        const removedFromA = Array.isArray(operations.removedFromA) ? operations.removedFromA : [];
        const commonOps = Array.isArray(operations.common) ? operations.common : [];
        if (addedInB.length !== 2 || removedFromA.length !== 1 || commonOps.length !== 0) {
          return `expected addedInB=2 / removedFromA=1 / common=0 (disjoint ids), got ${addedInB.length}/${removedFromA.length}/${commonOps.length}`;
        }
        const addedTargets = (addedInB as Array<Record<string, unknown>>)
          .map((op) => op.target)
          .toSorted();
        if (
          JSON.stringify(addedTargets) !== JSON.stringify(['signPayload', 'traceMe'].toSorted())
        ) {
          return `addedInB targets wrong: ${JSON.stringify(addedTargets)}`;
        }
        if (artifacts.onlyInA !== 0 || artifacts.onlyInB !== 1 || artifacts.common !== 1) {
          return `artifact fingerprints should be 0/1/1, got ${JSON.stringify(artifacts).slice(0, 200)}`;
        }
        const byType = Array.isArray(artifacts.byType)
          ? (artifacts.byType as Array<Record<string, unknown>>)
          : [];
        const runtime = byType.find((t) => t.type === 'runtime-hook');
        const trace = byType.find((t) => t.type === 'function-trace');
        if (!runtime || runtime.countA !== 1 || runtime.countB !== 1 || runtime.delta !== 0) {
          return `runtime-hook byType row wrong: ${JSON.stringify(runtime)}`;
        }
        if (!trace || trace.countA !== 0 || trace.countB !== 1 || trace.delta !== 1) {
          return `function-trace byType row wrong: ${JSON.stringify(trace)}`;
        }
        return true;
      },
    },

    // 4 ── instrumentation_session_merge ─────────────────────────────────────
    {
      name: 'instrumentation_session_merge/preserves-both',
      tool: 'instrumentation_session_merge',
      origin: 'homemade',
      reference:
        'Merge of A (1 op/1 artifact) + B (2 ops/2 artifacts) creates a NEW session preserving both: operationsMerged=3, artifactsMerged=3, snapshot carries 3 operations and 3 artifacts, source session ids are exactly [A,B], and every merged operation id is fresh (none equals a source id)',
      run: async () => {
        const { handlers, sA, sB, opA, opB1, opB2 } = seedSessions();
        const raw = await handlers.handleSessionMerge({
          sessionIdA: sA.id,
          sessionIdB: sB.id,
          name: 'merged',
        });
        return { response: body(raw), sourceOpIds: [opA.id, opB1.id, opB2.id] };
      },
      validate: (v) => {
        const b = isRecord(v) ? v : {};
        const response = isRecord(b.response) ? b.response : {};
        const sourceOpIds = Array.isArray(b.sourceOpIds) ? (b.sourceOpIds as string[]) : [];
        if (failed(response)) return `merge failed: ${JSON.stringify(response).slice(0, 240)}`;
        if (response.operationsMerged !== 3 || response.artifactsMerged !== 3) {
          return `expected 3/3 merged, got ${String(response.operationsMerged)}/${String(response.artifactsMerged)}`;
        }
        const sources = Array.isArray(response.sourceSessions) ? response.sourceSessions : [];
        if (sources.length !== 2)
          return `sourceSessions should have 2 ids, got ${JSON.stringify(sources)}`;
        const snapshot = isRecord(response.snapshot) ? response.snapshot : {};
        const operations = Array.isArray(snapshot.operations)
          ? (snapshot.operations as Array<Record<string, unknown>>)
          : [];
        const artifacts = Array.isArray(snapshot.artifacts) ? snapshot.artifacts : [];
        if (operations.length !== 3 || artifacts.length !== 3) {
          return `merged snapshot should hold 3 ops / 3 artifacts, got ${operations.length}/${artifacts.length}`;
        }
        // id remap: no merged operation reuses a source id
        const sourceSet = new Set(sourceOpIds);
        if (operations.some((op) => typeof op.id === 'string' && sourceSet.has(op.id))) {
          return 'merge reused a source operation id instead of remapping';
        }
        // targets preserved from both sessions
        const targets = operations.map((op) => op.target).toSorted();
        const expected = ['signPayload', 'signPayload', 'traceMe'].toSorted();
        if (JSON.stringify(targets) !== JSON.stringify(expected)) {
          return `merged targets wrong: ${JSON.stringify(targets)}`;
        }
        return true;
      },
    },

    // 5 ── instrumentation_operation ─────────────────────────────────────────
    {
      name: 'instrumentation_operation/register-list-status-stop',
      tool: 'instrumentation_operation',
      origin: 'homemade',
      reference:
        'Operation lifecycle: register(type=runtime-hook,target=hookMe) returns status="active" and the exact config; list returns exactly 1 with that target; status returns the same id; stop flips that operation to status="cancelled"',
      run: async () => {
        const manager = new InstrumentationSessionManager();
        const handlers = new InstrumentationHandlers(manager);
        const s = manager.createSession('ops');
        const registered = body(
          await handlers.handleOperationDispatch({
            action: 'register',
            sessionId: s.id,
            type: InstrumentationType.RUNTIME_HOOK,
            target: 'hookMe',
            config: { captureArgs: true },
          }),
        );
        const operation = field<Record<string, unknown>>(registered, 'operation');
        const opId = operation?.id as string;
        const list = body(
          await handlers.handleOperationDispatch({ action: 'list', sessionId: s.id }),
        );
        const status = body(
          await handlers.handleOperationDispatch({
            action: 'status',
            sessionId: s.id,
            operationId: opId,
          }),
        );
        const stopped = body(
          await handlers.handleOperationDispatch({
            action: 'stop',
            sessionId: s.id,
            operationId: opId,
          }),
        );
        return { registered, list, status, stopped };
      },
      validate: (v) => {
        const b = isRecord(v) ? v : {};
        const registered = isRecord(b.registered) ? b.registered : {};
        const list = isRecord(b.list) ? b.list : {};
        const status = isRecord(b.status) ? b.status : {};
        const stopped = isRecord(b.stopped) ? b.stopped : {};
        if (failed(registered) || failed(list) || failed(status) || failed(stopped)) {
          return `an operation step reported failure: ${JSON.stringify(b).slice(0, 240)}`;
        }
        const operation = field<Record<string, unknown>>(registered, 'operation');
        const opId = operation?.id;
        if (operation?.status !== 'active' || operation?.target !== 'hookMe') {
          return `registered operation wrong: ${JSON.stringify(operation).slice(0, 200)}`;
        }
        const config = isRecord(operation?.config) ? operation.config : {};
        if (config.captureArgs !== true) return `config lost: ${JSON.stringify(config)}`;
        const ops = Array.isArray(list.operations) ? list.operations : [];
        if (ops.length !== 1 || list.totalOperations !== 1) {
          return `expected 1 listed operation, got ${JSON.stringify(list).slice(0, 200)}`;
        }
        const statusOp = isRecord(status.operation) ? status.operation : {};
        if (statusOp.id !== opId) return `status returned a different operation id`;
        const stoppedOp = isRecord(stopped.operation) ? stopped.operation : {};
        if (stoppedOp.id !== opId || stoppedOp.status !== 'cancelled') {
          return `stop did not cancel the operation: ${JSON.stringify(stoppedOp).slice(0, 200)}`;
        }
        return true;
      },
    },

    // 6 ── instrumentation_artifact ──────────────────────────────────────────
    {
      name: 'instrumentation_artifact/record-query-type-filter',
      tool: 'instrumentation_artifact',
      origin: 'homemade',
      reference:
        'Record two artifacts (a runtime-hook returnValue and a function-trace functionName) on two operations; query(sessionId) returns both; query(sessionId,type=function-trace) returns exactly 1 whose data.functionName="traceMe"',
      run: async () => {
        const manager = new InstrumentationSessionManager();
        const handlers = new InstrumentationHandlers(manager);
        const s = manager.createSession('arts');
        const opHook = manager.registerOperation(
          s.id,
          InstrumentationType.RUNTIME_HOOK,
          'hookMe',
          {},
        );
        const opTrace = manager.registerOperation(
          s.id,
          InstrumentationType.FUNCTION_TRACE,
          'traceMe',
          {},
        );
        const recordedHook = body(
          await handlers.handleArtifactDispatch({
            action: 'record',
            operationId: opHook.id,
            data: { returnValue: 'signed' },
          }),
        );
        await handlers.handleArtifactDispatch({
          action: 'record',
          operationId: opTrace.id,
          data: { functionName: 'traceMe', executionTimeMs: 9 },
        });
        const all = body(
          await handlers.handleArtifactDispatch({ action: 'query', sessionId: s.id }),
        );
        const filtered = body(
          await handlers.handleArtifactDispatch({
            action: 'query',
            sessionId: s.id,
            type: InstrumentationType.FUNCTION_TRACE,
          }),
        );
        return { recordedHook, all, filtered };
      },
      validate: (v) => {
        const b = isRecord(v) ? v : {};
        const recordedHook = isRecord(b.recordedHook) ? b.recordedHook : {};
        const all = isRecord(b.all) ? b.all : {};
        const filtered = isRecord(b.filtered) ? b.filtered : {};
        if (failed(recordedHook) || failed(all) || failed(filtered)) {
          return `an artifact step reported failure: ${JSON.stringify(b).slice(0, 240)}`;
        }
        const recHook = isRecord(recordedHook.artifact) ? recordedHook.artifact : {};
        const recData = isRecord(recHook.data) ? recHook.data : {};
        if (recHook.type !== 'runtime-hook' || recData.returnValue !== 'signed') {
          return `recorded hook artifact wrong: ${JSON.stringify(recHook).slice(0, 200)}`;
        }
        const allArts = Array.isArray(all.artifacts) ? all.artifacts : [];
        if (allArts.length !== 2 || all.totalArtifacts !== 2) {
          return `expected 2 artifacts, got ${JSON.stringify(all).slice(0, 200)}`;
        }
        const filteredArts = Array.isArray(filtered.artifacts)
          ? (filtered.artifacts as Array<Record<string, unknown>>)
          : [];
        if (filteredArts.length !== 1 || filtered.totalArtifacts !== 1) {
          return `type filter should return 1, got ${filteredArts.length}`;
        }
        const data = isRecord(filteredArts[0]?.data) ? filteredArts[0].data : {};
        if (filteredArts[0]?.type !== 'function-trace' || data.functionName !== 'traceMe') {
          return `filtered artifact wrong: ${JSON.stringify(filteredArts[0]).slice(0, 200)}`;
        }
        return true;
      },
    },

    // 7 ── evidence_query ─────────────────────────────────────────────────────
    {
      name: 'evidence_query/url-function-script-subgraphs',
      tool: 'evidence_query',
      origin: 'homemade',
      reference:
        'Seed a 6-node linear chain. Query by url "/checkout", by function "signPayload", and by script "script-42": each connected-component expansion returns all 6 nodes (the whole chain is one connected component), with resultCount=6 and the request/script/function ids present',
      run: async () => {
        const { handlers } = seedGraph();
        const byUrl = body(await handlers.handleQueryDispatch({ by: 'url', value: '/checkout' }));
        const byFunction = body(
          await handlers.handleQueryDispatch({ by: 'function', value: 'signPayload' }),
        );
        const byScript = body(
          await handlers.handleQueryDispatch({ by: 'script', value: 'script-42' }),
        );
        return { byUrl, byFunction, byScript };
      },
      validate: (v) => {
        const b = isRecord(v) ? v : {};
        const results = [b.byUrl, b.byFunction, b.byScript];
        for (const r of results) {
          const q = isRecord(r) ? r : {};
          if (q.resultCount !== 6) {
            return `a query should reach all 6 connected nodes, got ${String(q.resultCount)}`;
          }
          const nodes = Array.isArray(q.nodes) ? (q.nodes as Array<Record<string, unknown>>) : [];
          if (nodes.length !== 6) return `nodes array should hold 6, got ${nodes.length}`;
          const ids = new Set(nodes.map((n) => n.id));
          if (ids.size !== 6) return `query returned duplicate node ids: ${ids.size} unique`;
          const types = new Set(nodes.map((n) => n.type));
          for (const t of [
            'request',
            'script',
            'function',
            'breakpoint-hook',
            'captured-data',
            'replay-artifact',
          ]) {
            if (!types.has(t)) return `query subgraph missing node type ${t}`;
          }
        }
        // dispatch mapped the "value" arg into the right query field
        const urlQ = isRecord(b.byUrl) && isRecord(b.byUrl.query) ? b.byUrl.query : {};
        const fnQ =
          isRecord(b.byFunction) && isRecord(b.byFunction.query) ? b.byFunction.query : {};
        const scQ = isRecord(b.byScript) && isRecord(b.byScript.query) ? b.byScript.query : {};
        if (urlQ.type !== 'url' || urlQ.value !== '/checkout')
          return `url query echo wrong: ${JSON.stringify(urlQ)}`;
        if (fnQ.type !== 'function' || fnQ.value !== 'signPayload')
          return `function query echo wrong: ${JSON.stringify(fnQ)}`;
        if (scQ.type !== 'scriptId' || scQ.value !== 'script-42')
          return `script query echo wrong: ${JSON.stringify(scQ)}`;
        return true;
      },
    },

    // 8 ── evidence_export ────────────────────────────────────────────────────
    {
      name: 'evidence_export/json-snapshot-and-markdown',
      tool: 'evidence_export',
      origin: 'homemade',
      reference:
        'Seed a 6-node/5-edge chain. JSON export returns {version:1, nodes:6, edges:5} preserving every node id and edge (source,target,type); markdown export contains the "## Evidence Gaps" section and the fully-connected status line (every node has an inbound+outbound edge except the two chain endpoints which still satisfy at least one) — we assert the deterministic JSON shape',
      run: async () => {
        const { handlers, request, script, fn, hook, captured, replay } = seedGraph();
        const json = body(await handlers.handleExportDispatch({ format: 'json' }));
        const markdown = await handlers.handleExportDispatch({ format: 'markdown' });
        const mdText =
          isRecord(markdown) && Array.isArray(markdown.content)
            ? ((markdown.content as Array<{ text?: string }>)[0]?.text ?? '')
            : '';
        return {
          json,
          mdText,
          expectedNodeIds: [request.id, script.id, fn.id, hook.id, captured.id, replay.id],
        };
      },
      validate: (v) => {
        const b = isRecord(v) ? v : {};
        const json = isRecord(b.json) ? b.json : {};
        if (json.version !== 1) return `export version should be 1, got ${String(json.version)}`;
        const nodes = Array.isArray(json.nodes)
          ? (json.nodes as Array<Record<string, unknown>>)
          : [];
        const edges = Array.isArray(json.edges)
          ? (json.edges as Array<Record<string, unknown>>)
          : [];
        if (nodes.length !== 6 || edges.length !== 5) {
          return `expected 6 nodes / 5 edges, got ${nodes.length}/${edges.length}`;
        }
        const expectedIds = Array.isArray(b.expectedNodeIds) ? (b.expectedNodeIds as string[]) : [];
        const ids = new Set(nodes.map((n) => n.id));
        if (expectedIds.some((id) => !ids.has(id))) {
          return `export is missing a seeded node id: ${JSON.stringify([...ids])}`;
        }
        const expectedTypes = ['loads', 'contains', 'triggers', 'captures', 'replays'];
        const edgeTypes = edges.map((e) => e.type);
        if (JSON.stringify(edgeTypes.toSorted()) !== JSON.stringify(expectedTypes.toSorted())) {
          return `exported edge types wrong: ${JSON.stringify(edgeTypes)}`;
        }
        const mdText = typeof b.mdText === 'string' ? b.mdText : '';
        if (
          !mdText.includes('# Reverse Evidence Graph Report') ||
          !mdText.includes('## Evidence Gaps')
        ) {
          return `markdown export missing report/gaps sections: ${mdText.slice(0, 160)}`;
        }
        return true;
      },
    },

    // 9 ── evidence_chain ─────────────────────────────────────────────────────
    {
      name: 'evidence_chain/forward-backward-paths',
      tool: 'evidence_chain',
      origin: 'homemade',
      reference:
        'Seed a 6-node linear chain request→script→function→hook→captured→replay. Forward chain from the request returns all 6 nodes in BFS order (starts with request, ends with replay); backward chain from the replay returns all 6 (starts with replay); forward chain from the leaf replay returns exactly 1 (the replay node itself)',
      run: async () => {
        const { handlers, request, replay } = seedGraph();
        const forward = body(
          await handlers.handleChain({ nodeId: request.id, direction: 'forward' }),
        );
        const backward = body(
          await handlers.handleChain({ nodeId: replay.id, direction: 'backward' }),
        );
        const leaf = body(await handlers.handleChain({ nodeId: replay.id, direction: 'forward' }));
        return { forward, backward, leaf, requestId: request.id, replayId: replay.id };
      },
      validate: (v) => {
        const b = isRecord(v) ? v : {};
        const forward = isRecord(b.forward) ? b.forward : {};
        const backward = isRecord(b.backward) ? b.backward : {};
        const leaf = isRecord(b.leaf) ? b.leaf : {};
        if (forward.chainLength !== 6 || forward.direction !== 'forward') {
          return `forward chain should be length 6, got ${JSON.stringify(forward).slice(0, 200)}`;
        }
        const fNodes = Array.isArray(forward.nodes)
          ? (forward.nodes as Array<Record<string, unknown>>)
          : [];
        if (fNodes[0]?.id !== b.requestId || fNodes[fNodes.length - 1]?.id !== b.replayId) {
          return `forward chain endpoints wrong: ${JSON.stringify(fNodes.map((n) => n.id))}`;
        }
        if (backward.chainLength !== 6 || backward.direction !== 'backward') {
          return `backward chain should be length 6, got ${JSON.stringify(backward).slice(0, 200)}`;
        }
        const bNodes = Array.isArray(backward.nodes)
          ? (backward.nodes as Array<Record<string, unknown>>)
          : [];
        if (bNodes[0]?.id !== b.replayId)
          return `backward chain should start at replay, got ${String(bNodes[0]?.id)}`;
        if (leaf.chainLength !== 1) {
          return `forward chain from leaf should be length 1, got ${String(leaf.chainLength)}`;
        }
        return true;
      },
    },
  ],
};
