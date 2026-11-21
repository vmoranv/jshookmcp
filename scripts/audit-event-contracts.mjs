#!/usr/bin/env node
// Event contract audit.
//
// WHY THIS EXISTS
// ---------------
// `ServerEventMap` (src/server/EventBus.ts) used to declare an index signature
// alongside its named events:
//
//   export interface ServerEventMap {
//     [key: string]: unknown;   // ← deleted; check 1 keeps it deleted
//     'tool:activated': { ... };
//     ...
//   }
//
// That index signature widened `keyof ServerEventMap` to `string | number`, so
// every nominally-typed event API in the repo — `EventBus.emit`,
// `EventBus.on`, `emitBusEvent`, `emitEvent`, `emitWebSocketEvent` — accepted
// ANY string. Event names were effectively untyped: nothing in the compiler and
// nothing in the test suite noticed a wrong name, and nothing noticed when the
// code that was supposed to emit a name disappeared.
//
// It has since been deleted. That cost 12 call-site fixes and surfaced five
// events that were being emitted undeclared. Check 1 exists so it cannot come
// back — re-adding it silently reverts all of the above.
//
// Three instances were found by hand:
//
//   1. `adb:device_connected` — subscribed by an ActivationController boost
//      rule, emitted by nothing. The emitter was deleted in b428982b; e36194d9
//      restored the tool but not the emit. The rule could not fire, and
//      `ActivationController.test.ts` (`listenerCount(...) === 1`) stayed green
//      the whole time — a subscription-only assertion cannot detect a missing
//      producer.
//   2. `task:update` — subscribed by SseStream, emitted only by SseStream's own
//      test. (SseStream was additionally never constructed anywhere in src/ at
//      the time; it now is, and TaskManager is its producer.)
//   3. Five emitted-but-undeclared names: `frida:spawned`,
//      `network:http2_probed`, `network:http2_frame_build_completed`,
//      `network:rtt_measured`, `task:update`.
//
// A subscription with no producer is the silent half of this defect class: the
// handler registers successfully, and the feature simply never runs. So this
// audit asks one question per contract entry:
//
//   does any code in src/ actually emit this event name?
//
// FAILS THE BUILD
//   1. `ServerEventMap` must not declare a string index signature.
//   2. no event may be emitted on the bus in src/ without being declared in
//      ServerEventMap. Only emissions that resolve to the bus count — see
//      "ONE CHANNEL, NOT THREE" below.
//   3. every default boost rule's `eventPattern` must have a literal producer.
//   4. every `SSE_EVENT_ALLOWLIST` entry must have a literal producer.
//   5. every file under src/ must parse — an unparsed file is invisible here.
//   6. no contract entry may have a name shape the scanner cannot recognise.
//      Without this an unsupported name would be reported dead, blaming the
//      event for a limitation of the scanner.
//   7. no `*Contract.ts` module under src/ may be imported by nothing. See
//      "CONTRACT MODULES WITH NO CONSUMER" below.
//   8. every name declared in a well-known-name object — `SpanNames` /
//      `MetricNames` (instrumentation) and `WorkflowSpanNames` (workflow engine
//      spans) — must be emitted from a real call site in src/, as a
//      `SpanNames.x` / `MetricNames.y` / `WorkflowSpanNames.z` argument. A
//      declared-but-unemitted name is a promise with no producer — the shape
//      that kept the whole instrumentation module dead for six months while its
//      header claimed it was "used by default". The declaring modules are listed
//      in NAME_CONST_SOURCES; each must contribute, or the check passes
//      vacuously for it.
//   9. every event declared in `ServerEventMap` must have at least one literal
//      producer in src/, outside the declaration file (`EventBus.ts`) and the
//      SSE consumer (`EventsEndpoint.ts`). This is the direction check 2 does
//      NOT cover: check 2 asks "is every emitted name declared?", check 9 asks
//      "is every declared name emitted?". A declaration with no producer is a
//      subscription target that can never fire. Eleven names are a REASONED
//      baseline — see "DECLARED-BUT-UNEMITTED BASELINE" below.
//
// ONE CHANNEL, NOT THREE
// ----------------------
// The repo has three unrelated things that are all called "emitting an event":
//
//   1. the server EventBus (`ServerEventMap`) — `bus.emit`, `emitBusEvent`, ...
//   2. the webhook channel — `ExtensionRegistryHandlers.emitEvent` forwards to
//      `WebhookBridge.sendEvent`, filtered by each webhook's `events` list
//   3. the span/metric collectors — `WorkflowEngine`'s `emitSpan`/`emitMetric`
//      push onto local arrays that are returned as part of the run result
//
// A first version of check 2 matched any callee whose name contains "emit",
// which conflated all three. It reported 11 names — `extension.*`, `macro.*`,
// `workflow.*` — as "emitted but undeclared". Every one was a false positive.
//
// Declaring them in `ServerEventMap` would have been worse than the bug. The
// map is a statement about what the bus can carry; a name declared there but
// only ever sent over a webhook or pushed onto a span array is a subscription
// target that can never fire — precisely the "silent half" defect class this
// audit was written to catch. A guard that manufactures the bug it hunts is
// worse than no guard.
//
// So the scan is scoped by structural facts read off the source, rather than
// by a hand-kept list. A call counts as a bus emission when EITHER holds:
//
//   a. the file references the bus contract (`ServerEventMap` / `EventBus`) —
//      or declares a class that inherits, transitively within src/, from a
//      class in such a file. Most bus emissions are calls to an INHERITED
//      typed helper, so the inheritance hop is not optional;
//   b. the call's own receiver names the bus — `this.ctx.eventBus.emit(...)`,
//      which occurs in files that never name the bus type.
//
// Both signals were found the hard way, by a check failing:
//
//   - Without (b), the file test dropped four live bus emissions
//     (`frida:attached`, `frida:spawned`, `v8:heap_captured`, `tool:progress`),
//     and the BOOST-RULE check caught the loss by reporting their rules dead.
//   - Without the inheritance hop in (a), two of the five canaries vanished and
//     the scan aborted.
//
// Emissions matching neither signal are reported as a non-fatal DIAGNOSTIC, not
// a failure: they are the webhook and span channels, whose names must NOT be
// declared in `ServerEventMap`.
//
// Known limit, stated rather than hidden: an emission on a receiver typed
// `any`, in a file that never names the bus, is neither checked by `tsc` nor
// failed here. It still appears in the diagnostic listing.
//
// DECLARED-BUT-UNEMITTED BASELINE
// -------------------------------
// Check 9 is the reverse of check 2, and the two are not symmetric. Check 2
// asks "is every emitted name declared?"; check 9 asks "is every declared name
// emitted?". A name declared in `ServerEventMap` is a promise that some code
// will emit it; a subscription to a name nothing emits is the "silent half"
// defect this audit exists to catch, and check 2 structurally cannot see it
// because there is no producer to scan.
//
// Eleven names were declared without a producer when this audit was written. Ten
// of them have since been WIRED and now have real producers — see the history
// block further down and the `UNEMITTED_EVENT_BASELINE` array, which is ratcheted
// in both directions so a baseline entry cannot outlive the gap it records.
// `task:update` is one of the ten: `TaskManager` emits it on six transitions and
// `SseStream` IS constructed (it is what turns those into SSE frames).
//
// Exactly one declared-but-unemitted name remains: `domain:unloaded`. It is kept
// because deleting it would remove the typed subscription it exists to serve,
// and baselined so the ratchet above will fail the build the moment it gains a
// producer or stops being declared.
//
// The reason this paragraph exists at all: it is the claim most likely to rot in
// a file that exists to catch rot. The baseline array and the history block are
// the source of truth; if they disagree with this comment, they are right.
//
// Producers are matched by EXACT literal, not by EVENT_NAME_RE. Check 9 already
// knows the precise set of names it is looking for, so it does not need the
// event-shape heuristic the emitted->declared direction relies on. That matters
// concretely: `evidence-evicted` is a declared name that IS emitted —
// `ReverseEvidenceGraph.ts` calls `.emit('evidence-evicted', ...)` — but its
// hyphen-only shape is deliberately outside EVENT_NAME_RE. Reusing the filtered
// producer set would report a live event as dead, blaming the event for a
// limitation of the scanner; matching the exact declared name reads it right.
//
// CONTRACT MODULES WITH NO CONSUMER
// ---------------------------------
// Check 7 is not about events. It lives here because it is the same question
// one level up: a module whose whole job is to declare a contract, that nothing
// imports, is a promise nothing keeps.
//
// `src/server/observability/InstrumentationContract.ts` was exactly that. It
// shipped in 0e05f885 ("add B-skeleton contracts (Plugin, Workflow,
// Instrumentation)") alongside PluginContract and WorkflowContract. Those two
// were wired up — 7 and 15 importing files. This one never was: zero importers
// for six months, while its own header claimed "NoopInstrumentation is used by
// default until a real exporter is configured" and nothing constructed it. Its
// sibling `config/config.schema.json` from the same commit was deleted long
// ago; the whole `config/` directory is gone.
//
// What kept it alive was its tests. Both suites asserted the constants equal
// the literals they were defined as —
// `expect(SpanNames.toolExecute).toBe('tool.execute')` — which cannot fail when
// reality drifts, because reality is never consulted. A test that only reads
// the thing under test is not coverage; it is a copy.
//
// So it was deleted, and this check makes the next one fail loudly. The rule
// asks about importers rather than "is this useful": a contract module with no
// importer has no implementation to be right or wrong about.
//
// SCANNER MECHANICS — AND ITS HONEST LIMITS
// -----------------------------------------
// Producers are found by parsing every file in src/ with @babel/parser and
// inspecting call expressions whose callee name contains "emit"; a
// string-literal argument that looks like an event name is a
// producer. Consequences, all deliberate:
//
//   - Argument POSITION is never assumed. The repo has at least five shapes —
//     `bus.emit(name, payload)`, `this.emitEvent(name, payload)`,
//     `emitEvent(bus, name, payload)`, `emitBusEvent(bus, name, payload)`,
//     `emitWebSocketEvent(name, payload)` — and the name is argument 1 in some
//     and argument 2 in others. An earlier position-based scan reported a live
//     event as dead for exactly this reason.
//   - Parsing (not text matching) is used on purpose. Sources are parsed with
//     @babel/parser — already a direct dependency — because a hand-rolled lexer
//     that blanked comments before scanning silently failed on this file set: a
//     quote inside a regex literal put it into an unterminated string state,
//     after which every comment was treated as code and a commented-out emit
//     still counted as a producer. Comments are simply not AST nodes, so
//     parsing cannot make that mistake.
//   - The scan OVER-APPROXIMATES: any event-shaped literal inside any emit-ish
//     call counts, even if it is not really an event name. This can hide a
//     dead entry; it can never invent one. That direction is chosen on purpose
//     — a guard that cries wolf gets deleted, and then protects nothing.
//   - Which files may contribute producers is decided by ONE structural test:
//     does the file reference `ServerEventMap` or `EventBus`? This is derived
//     from source, not from a hand-maintained list of "files allowed to emit",
//     because a hand-kept copy of the truth is what rots in the first place.
//     It is applied as a plain regex over the file text, so a file that merely
//     mentions the bus in a comment counts as bus-capable — over-inclusive,
//     which errs toward checking more rather than fewer emissions.
//   - Dynamic event names (a variable or a substituted template literal) are
//     counted and reported, never treated as producers.
//
// A scanner that can only report "dead" cannot distinguish a dead event from a
// scanner that stopped matching. So the scan is gated on CANARIES: a fixed set
// of known-live names, one per call shape, each independent of the contract
// tables wherever such a name exists. If a canary stops being found the audit
// ABORTS instead of reporting, because its output would be meaningless.
//
// Usage:
//   node scripts/audit-event-contracts.mjs
//   node scripts/audit-event-contracts.mjs --quiet

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirUrl = new URL('.', import.meta.url);
const projectRoot = fileURLToPath(new URL('../', scriptDirUrl));
const require = createRequire(import.meta.url);
// Sources are parsed with @babel/parser (already a direct dependency, alongside
// @babel/traverse and @babel/types). TypeScript 7 ships a native compiler with
// no JS compiler API — `require('typescript')` exposes only the version — so
// parsing is delegated to Babel. See the "SCANNER MECHANICS" note above for why
// text matching is not enough.
const babelParser = require('@babel/parser');
const QUIET = process.argv.includes('--quiet');
const SRC_DIR = join(projectRoot, 'src');

/**
 * Positive control. Each entry must be discovered by the scanner, and each one
 * exercises a different emit call shape. Prefer names that are NOT contract
 * entries: if a contract entry is also a canary, its death trips the abort path
 * (which cannot say which entry died) instead of the precise failure report.
 *
 * `source` is the emit SITE — the file and line that performs the call — not
 * the file where the helper is defined. Those are usually different files (an
 * inherited helper, a shared free function), and pointing at the definition
 * sends whoever debugs an ABORT to a file that contains no emission at all.
 */
const SCANNER_CANARIES = [
  {
    event: 'tool:called',
    shape: 'ctx.eventBus.emit(name, payload)',
    source: 'src/server/MCPServer.execution.ts:379',
  },
  {
    event: 'protocol:payload_built',
    shape: 'this.emitEvent(name, payload)  [helper inherited from the domain base]',
    source: 'src/server/domains/protocol-analysis/handlers/payload-handlers.ts:34',
  },
  {
    event: 'network:http_request_built',
    shape: 'emitEvent(this.eventBus, name, payload)',
    source: 'src/server/domains/network/handlers/raw-dns-http-handlers.ts:309',
  },
  {
    event: 'tool.execution.started',
    shape: 'emitBusEvent(ctx.eventBus, name, payload)',
    source: 'src/server/MCPServer.execution.ts:245 (also an allowlist entry)',
  },
  {
    event: 'websocket:session_opened',
    shape: 'this.emitWebSocketEvent(name, payload)  [helper inherited from the domain base]',
    source: 'src/server/domains/tls-inspector/handlers/websocket-handlers.ts:431',
  },
];

/**
 * Positive control for the well-known-name scan (check 8).
 *
 * Same discipline as SCANNER_CANARIES: if the scanner cannot find a site that is
 * known to exist, its silence is not evidence, so the audit ABORTs rather than
 * reporting every declared name as unproduced.
 *
 * One canary per emission shape: server layer, workflow engine, a module below
 * the server layer, and a class method.
 */
const INSTRUMENTATION_CANARIES = [
  { site: 'SpanNames.toolExecute', source: 'src/server/MCPServer.execution.ts' },
  { site: 'MetricNames.toolDurationMs', source: 'src/server/MCPServer.execution.ts' },
  { site: 'SpanNames.workflowRun', source: 'src/server/workflows/WorkflowEngine.ts' },
  { site: 'SpanNames.bridgeRequest', source: 'src/server/domains/native-bridge/index.ts' },
  { site: 'SpanNames.captchaDetect', source: 'src/modules/captcha/CaptchaDetector.ts' },
  // A second name family, so a regression that breaks the scanner for only one
  // declaring module still trips the gate.
  {
    site: 'WorkflowSpanNames.nodeStart',
    source: 'src/server/workflows/WorkflowEngine.ts (also matched by MacroRunner)',
  },
];

/**
 * Literal shape treated as an event name: a lowercase segment followed by at
 * least one `:` or `.` segment — `debugger:breakpoint_hit`,
 * `tool.execution.started`.
 *
 * Hyphen-only names are deliberately NOT matched. `ServerEventMap` does declare
 * one (`evidence-evicted`), but the same shape is used by every Node
 * EventEmitter in the repo (`this.emit('started')`, `this.emit('message')`,
 * `logger.emit('info')`), so accepting it would let an unrelated emitter
 * masquerade as a producer. Instead, a contract entry whose name this pattern
 * cannot match is reported as UNSUPPORTED (see below) rather than silently
 * judged dead.
 */
const EVENT_NAME_RE = /^[a-z][a-z0-9-]*([:.][a-z0-9_-]+)+$/;

/**
 * Text of the file that counts as naming the bus contract.
 *
 * This is one of the TWO signals that separate the three "emit" channels — see
 * "ONE CHANNEL, NOT THREE" in the header. It is deliberately a plain text test
 * over the file source rather than a curated list of blessed files: the list
 * would be a hand-maintained copy of the truth, and this audit exists because
 * such copies rot. Over-inclusive on purpose (a mention in a comment counts),
 * which errs toward scanning more emissions rather than fewer.
 */
const BUS_CONTRACT_RE = /\b(?:ServerEventMap|EventBus)\b/;

/**
 * Second signal: the call site's own receiver names the bus.
 *
 * `this.ctx.eventBus.emit('tool:progress', ...)` is a bus emission even though
 * the file never names the bus TYPE — the receiver is the evidence. Four live
 * bus emissions in the repo look exactly like this (`frida:attached`,
 * `frida:spawned`, `v8:heap_captured`, `tool:progress`), and the file-level
 * signal alone wrongly dropped them; the boost-rule check caught the loss.
 */
const BUS_RECEIVER_RE = /\beventBus\b/;

/**
 * Files that are part of the event CONTRACT, not the event PRODUCER set.
 *
 * `EventBus.ts` declares the map and `EventsEndpoint.ts` is its SSE
 * consumer/allowlist. An emit-shaped literal inside either is contract text, not
 * evidence that production code emits the event, so neither may satisfy check 9.
 * Compared after normalising separators, because `path.relative` is
 * backslash-separated on Windows.
 */
const PRODUCER_EXCLUDED_FILES = new Set([
  'src/server/EventBus.ts',
  'src/server/http/EventsEndpoint.ts',
]);

/** `src\server\EventBus.ts` -> `src/server/EventBus.ts`, so the compare above holds on Windows. */
const normalizeLocation = (location) => location.replaceAll('\\', '/');

// ── source scanning ──────────────────────────────────────────────────────────

function listTypeScriptFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTypeScriptFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Strip the wrappers Babel inserts around an expression without changing it. */
function unwrap(node) {
  let current = node;
  while (
    current &&
    (current.type === 'TSNonNullExpression' ||
      current.type === 'ParenthesizedExpression' ||
      current.type === 'TSAsExpression')
  ) {
    current = current.expression;
  }
  return current;
}

/** Name of the callee for `emit(...)`, `bus.emit(...)`, `ctx?.eventBus!.emit(...)`. */
function calleeName(callee) {
  const node = unwrap(callee);
  if (!node) return undefined;
  if (node.type === 'Identifier') return node.name;
  if (
    (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') &&
    !node.computed &&
    node.property?.type === 'Identifier'
  ) {
    return node.property.name;
  }
  return undefined;
}

/**
 * Source text of the receiver in `recv.method(...)` — used to spot a call site
 * whose receiver names the bus (`this.ctx.eventBus.emit(...)`). See
 * BUS_RECEIVER_RE.
 */
function receiverText(callee, source) {
  const node = unwrap(callee);
  if (!node || (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression')) {
    return undefined;
  }
  const object = unwrap(node.object);
  if (!object || typeof object.start !== 'number' || typeof object.end !== 'number') {
    return undefined;
  }
  return source.slice(object.start, object.end);
}

/** Static string value of an argument, or undefined when it is computed. */
function staticString(argument) {
  let node = argument;
  while (
    node &&
    (node.type === 'TSAsExpression' ||
      node.type === 'TSSatisfiesExpression' ||
      node.type === 'TSNonNullExpression' ||
      node.type === 'ParenthesizedExpression')
  ) {
    node = node.expression;
  }
  if (!node) return undefined;
  if (node.type === 'StringLiteral') return node.value;
  if (
    node.type === 'TemplateLiteral' &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0].value.cooked;
  }
  return undefined;
}

/**
 * Modules that declare "well-known name" constant objects, and the objects in
 * them. Every name declared in one must be emitted from a real call site
 * (check 8), and none may be deleted (each source must contribute).
 *
 * A source LIST rather than one hardcoded file, because the workflow span names
 * are a producer/consumer contract of exactly the same kind — `WorkflowEngine`
 * emits them, `MacroRunner.buildProgress` matches them to derive per-step
 * durations — and as bare literals on both sides they rot in exactly the same
 * way. Adding a source here is how a new name family inherits the protection.
 */
const NAME_CONST_SOURCES = [
  {
    file: 'src/utils/instrumentation.ts',
    consts: ['SpanNames', 'MetricNames'],
  },
  {
    file: 'src/server/workflows/WorkflowContract.ts',
    consts: ['WorkflowSpanNames'],
  },
];

const NAME_CONSTS = new Set(NAME_CONST_SOURCES.flatMap((source) => source.consts));

/**
 * `SpanNames.x` / `MetricNames.y` / `WorkflowSpanNames.z` as a call argument —
 * the shape every well-known-name emission takes.
 *
 * Matched on the ARGUMENT rather than on the callee name, on purpose: this repo
 * has a second `emitMetric` (WorkflowContract, which writes to a local array),
 * so matching callee names would credit the wrong sink. The constant objects are
 * exported by the declaring contract and nowhere else, which is what makes a
 * member access on them unambiguous evidence.
 *
 * A bare string literal is deliberately NOT accepted: the repo has two `emit`
 * sinks, so a literal alone cannot say which one it reached. The constants exist
 * to be used. Note that this also means a CONSUMER comparison
 * (`s.name === WorkflowSpanNames.nodeStart`) does not count as a producer — only
 * the emitting side does, which is the right question.
 */
function instrumentationMember(argument) {
  const node = unwrap(argument);
  if (
    !node ||
    (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') ||
    node.computed
  ) {
    return undefined;
  }
  const object = unwrap(node.object);
  if (object?.type !== 'Identifier' || !NAME_CONSTS.has(object.name)) return undefined;
  if (node.property?.type !== 'Identifier') return undefined;
  return `${object.name}.${node.property.name}`;
}

/** Depth-first walk over the AST. Comments are not AST nodes, so they never appear. */
function walkAst(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walkAst(item, visit);
    return;
  }
  if (typeof node.type === 'string') visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key.endsWith('Comments')) continue;
    walkAst(node[key], visit);
  }
}

function scanProducers() {
  // ── pass 1: parse, and work out which files are bus-capable ────────────────
  //
  // A file is bus-capable when it references the bus contract, OR when a class
  // it declares inherits (transitively, within src/) from a class in such a
  // file. The inheritance hop is not optional: most bus emissions are calls to
  // an INHERITED typed helper — `payload-handlers.ts` emits
  // `protocol:payload_built` via `this.emitEvent(...)` and references the
  // contract zero times itself; the contract-typed helper lives in its base
  // class. A file-level test without the hop silently dropped two of the five
  // canaries, which is how the hop was found.
  const files = listTypeScriptFiles(SRC_DIR).map((file) => {
    const location = relative(projectRoot, file);
    const source = readFileSync(file, 'utf8');
    try {
      return {
        location,
        source,
        ast: babelParser.parse(source, {
          sourceType: 'module',
          plugins: ['typescript'],
          errorRecovery: false,
        }),
      };
    } catch (error) {
      // A file the audit cannot parse is a file the audit cannot see. Say so
      // instead of quietly reporting a smaller producer set.
      return { location, source, ast: null, error };
    }
  });

  const parseErrors = files
    .filter((file) => file.ast === null)
    .map((file) => `${file.location}: ${file.error.message}`);
  const parsed = files.filter((file) => file.ast !== null);

  const contractFiles = new Set(
    parsed.filter((file) => BUS_CONTRACT_RE.test(file.source)).map((file) => file.location),
  );

  /** class name -> the files that declare it and the parent name they extend. */
  const classDecls = new Map();
  /** file -> class names it declares. */
  const classesByFile = new Map();
  for (const file of parsed) {
    walkAst(file.ast, (node) => {
      if (node.type !== 'ClassDeclaration' && node.type !== 'ClassExpression') return;
      const name = node.id?.name;
      if (!name) return;
      const parentName = node.superClass?.type === 'Identifier' ? node.superClass.name : undefined;
      if (!classDecls.has(name)) classDecls.set(name, []);
      classDecls.get(name).push({ location: file.location, parentName });
      if (!classesByFile.has(file.location)) classesByFile.set(file.location, []);
      classesByFile.get(file.location).push(name);
    });
  }

  const busCapableClasses = new Map();
  function classIsBusCapable(name, seen = new Set()) {
    if (busCapableClasses.has(name)) return busCapableClasses.get(name);
    if (seen.has(name)) return false; // cyclic `extends` — treat as not capable
    seen.add(name);
    let capable = false;
    for (const decl of classDecls.get(name) ?? []) {
      if (contractFiles.has(decl.location)) {
        capable = true;
        break;
      }
      if (decl.parentName && classIsBusCapable(decl.parentName, seen)) {
        capable = true;
        break;
      }
    }
    busCapableClasses.set(name, capable);
    return capable;
  }

  const isBusCapable = (location) =>
    contractFiles.has(location) ||
    (classesByFile.get(location) ?? []).some((name) => classIsBusCapable(name));

  // ── pass 2: classify every emit-ish call site ─────────────────────────────
  //
  // Bus producers are the only ones check 2 may judge. Off-channel producers
  // (webhook, span, metric) are reported as a diagnostic: their names are not
  // bus contract entries and must not be declared in `ServerEventMap`.
  const producers = new Map();
  const offChannel = new Map();
  const dynamicSites = [];
  /**
   * Every string literal passed to an emit-ish call in a bus-capable file that
   * is allowed to produce, keyed by the EXACT literal. Check 9 reads this rather
   * than `producers` because it matches declared names verbatim and so must not
   * inherit `EVENT_NAME_RE`'s shape filter — see "DECLARED-BUT-UNEMITTED
   * BASELINE" in the header.
   */
  const busEmittedLiterals = new Map();
  /**
   * Well-known-name emission sites, keyed `SpanNames.x` / `MetricNames.y` /
   * `WorkflowSpanNames.z`. Collected from EVERY call argument in every file, not
   * just emit-ish callees: the question check 8 asks is "is this declared name
   * emitted anywhere", and a name passed to an unfamiliar helper is still
   * emitted.
   */
  const instrumentationSites = new Set();

  for (const file of parsed) {
    const fileIsBusCapable = isBusCapable(file.location);
    // A literal in the declaring file or the SSE consumer is contract text, not
    // a producer — see PRODUCER_EXCLUDED_FILES.
    const fileMayProduce = !PRODUCER_EXCLUDED_FILES.has(normalizeLocation(file.location));
    walkAst(file.ast, (node) => {
      if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') return;
      for (const argument of node.arguments) {
        const member = instrumentationMember(argument);
        if (member !== undefined) instrumentationSites.add(member);
      }
      const name = calleeName(node.callee);
      if (name === undefined || !/emit/i.test(name)) return;
      const line = `${file.location}:${node.loc?.start.line ?? 0}`;
      const literals = node.arguments.map(staticString).filter((value) => value !== undefined);
      const names = literals.filter((value) => EVENT_NAME_RE.test(value));
      if (names.length === 0) {
        dynamicSites.push({ method: name, location: line });
      }
      // Either signal is enough: the file — or a class it declares, through its
      // inheritance chain — names the bus contract, or the call's receiver does.
      const receiver = receiverText(node.callee, file.source) ?? '';
      const busCapable = fileIsBusCapable || BUS_RECEIVER_RE.test(receiver);
      const bucket = busCapable ? producers : offChannel;
      for (const eventName of names) {
        if (!bucket.has(eventName)) bucket.set(eventName, []);
        bucket.get(eventName).push(`${name} @ ${line}`);
      }
      // Check 9 matches declared names by EXACT literal, so it needs every
      // string literal an emit-ish call passes — not just the event-shaped ones
      // EVENT_NAME_RE accepts (see "DECLARED-BUT-UNEMITTED BASELINE").
      if (busCapable && fileMayProduce) {
        for (const literal of literals) {
          if (!busEmittedLiterals.has(literal)) busEmittedLiterals.set(literal, []);
          busEmittedLiterals.get(literal).push(`${name} @ ${line}`);
        }
      }
    });
  }

  return {
    producers,
    offChannel,
    dynamicSites,
    parseErrors,
    instrumentationSites,
    busEmittedLiterals,
  };
}

/**
 * Read `ServerEventMap` itself: the declared event names, and whether it
 * declares a string index signature.
 *
 * The index signature is the single line that made every other check in this
 * file necessary — see the header. It is cheap to re-add by accident and
 * catastrophic when re-added, so it is a build failure here.
 */
function readServerEventMap() {
  const file = join(SRC_DIR, 'server/EventBus.ts');
  const ast = babelParser.parse(readFileSync(file, 'utf8'), {
    sourceType: 'module',
    plugins: ['typescript'],
  });

  let indexSignature = false;
  const eventNames = [];
  walkAst(ast, (node) => {
    if (node.type !== 'TSInterfaceDeclaration' || node.id?.name !== 'ServerEventMap') return;
    for (const member of node.body.body) {
      if (member.type === 'TSIndexSignature') {
        indexSignature = true;
        continue;
      }
      if (member.key?.type === 'StringLiteral') eventNames.push(member.key.value);
    }
  });
  return { indexSignature, eventNames };
}

/**
 * Read every declared well-known name from every NAME_CONST_SOURCES module.
 *
 * Returns `{ obj, key, value, source }` per entry. The KEY matters as much as
 * the value: emissions reference the constant (`SpanNames.registryDiscovery`),
 * so the declared value string never appears at a call site — a text search for
 * `'registry.discovery'` would report every live name as dead. That is why this
 * check matches member accesses instead.
 *
 * `source` is carried through so the check can require each source module to
 * contribute: emptying one object would otherwise pass vacuously.
 */
function readDeclaredNames() {
  const declared = [];
  const missing = [];

  for (const source of NAME_CONST_SOURCES) {
    const file = join(projectRoot, source.file);
    if (!existsSync(file)) {
      missing.push(source.file);
      continue;
    }
    const ast = babelParser.parse(readFileSync(file, 'utf8'), {
      sourceType: 'module',
      plugins: ['typescript'],
    });

    walkAst(ast, (node) => {
      if (node.type !== 'VariableDeclarator') return;
      const obj = node.id?.type === 'Identifier' ? node.id.name : undefined;
      if (obj === undefined || !NAME_CONSTS.has(obj)) return;
      const init = unwrap(node.init);
      if (init?.type !== 'ObjectExpression') return;
      for (const property of init.properties) {
        if (property.type !== 'ObjectProperty' || property.computed) continue;
        const key = property.key?.type === 'Identifier' ? property.key.name : undefined;
        const value = staticString(property.value);
        if (key !== undefined && value !== undefined) {
          declared.push({ obj, key, value, source: source.file });
        }
      }
    });
  }

  return { missing, declared };
}

/**
 * `*Contract.ts` modules under src/ that no other file under src/ imports.
 *
 * Import specifiers are matched by suffix so that every spelling in this repo
 * resolves — `@server/observability/InstrumentationContract`,
 * `./InstrumentationContract`, `../workflows/WorkflowContract` — with a
 * trailing `.js`/`.ts` tolerated, since the build rewrites extensions.
 *
 * Only `src/` counts as a consumer. A contract imported solely by its own test
 * is still an orphan: that is precisely the shape that hid
 * InstrumentationContract for six months — see the header.
 */
const CONTRACT_MODULE_RE = /Contract\.ts$/;
const IMPORT_SPECIFIER_RE = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

function findOrphanContractModules() {
  const sources = new Map();
  const contractModules = [];
  for (const file of listTypeScriptFiles(SRC_DIR)) {
    const location = relative(projectRoot, file);
    sources.set(location, readFileSync(file, 'utf8'));
    if (CONTRACT_MODULE_RE.test(file)) {
      contractModules.push({ location, name: basename(file, '.ts') });
    }
  }

  const specifiersByFile = new Map();
  for (const [location, source] of sources) {
    const found = [];
    for (const match of source.matchAll(IMPORT_SPECIFIER_RE)) found.push(match[1]);
    specifiersByFile.set(location, found);
  }

  return contractModules
    .filter((module) => {
      const suffix = `/${module.name}`;
      return ![...specifiersByFile].some(
        ([location, specifiers]) =>
          location !== module.location &&
          specifiers.some((specifier) => specifier.replace(/\.(?:js|ts)$/, '').endsWith(suffix)),
      );
    })
    .map((module) => ({ location: module.location }));
}

// ── contract tables ──────────────────────────────────────────────────────────

/**
 * Declared-but-unemitted baseline for check 9.
 *
 * Each entry is a name `ServerEventMap` declares with no literal producer in
 * src/, paired with the reason it is kept rather than deleted. A bare string
 * list would rot into "names someone muted"; the reason is what lets a later
 * reader decide whether the entry is still justified.
 *
 * Removing an entry is not the goal — wiring its emitter is. The check fails
 * when an entry gains a producer, so the baseline cannot outlive the gap it
 * records, and fails when a name NOT listed here is declared without a producer,
 * so the list cannot grow silently.
 *
 * History (2026-09-24): this list started with ELEVEN entries, which is what the
 * check was built to expose. Ten of them were then actually WIRED rather than
 * documented away — the check went red naming each one as it landed, which is
 * exactly the signal it was designed to give:
 *
 *   tool:activated / tool:deactivated   MCPServer.search.handlers.activate.ts:150 / :301
 *   domain:loaded                       registry/discovery.ts:124 + registry/index.ts:150
 *   extension:loaded / extension:unloaded  extension-registry/PluginRegistry.ts:289 / :329
 *   session:browser_launched            browser/handlers/browser-control.ts:145 (+camoufox-flow.ts:80,99)
 *   session:browser_closed              browser/handlers/browser-control.ts:531
 *   network:dns_resolved / dns_reversed network/handlers/raw-dns-http-handlers.ts:89,:297 / :112
 *   task:update                         tasks/TaskManager.ts:109 (emitTaskUpdate, all 6 transitions)
 *
 * `domain:unloaded` is the one that could NOT be wired honestly, because the
 * thing it would report does not exist — see its entry below.
 */
const UNEMITTED_EVENT_BASELINE = [
  {
    name: 'domain:unloaded',
    reason:
      'declared for symmetry with domain:loaded, but the registry has NO unload path to report: ' +
      'manifestsCache/registrationsCache are append-only and never shrink, and there is no ' +
      'unregister/remove/dispose API for a domain. AutoPruner (activation/AutoPruner.ts) and the ' +
      'domain TTL only drop a domain from the VISIBLE set while its manifest stays registered, so ' +
      'those are activation events, not unloads. Kept as groundwork — wire it only once a real ' +
      'teardown exists, and if you find yourself emitting it from a prune/TTL path, that is a ' +
      'semantic bug, not a fix.',
  },
];

function loadContractTables() {
  const probe = `
import { getDefaultBoostRules } from './src/server/activation/ActivationController.ts';
import { SSE_EVENT_ALLOWLIST } from './src/server/http/EventsEndpoint.ts';

console.log(
  '__JSON__' +
    JSON.stringify({
      boostRules: getDefaultBoostRules().map((rule) => ({
        eventPattern: rule.eventPattern,
        targetDomains: [...rule.targetDomains],
      })),
      sseAllowlist: [...SSE_EVENT_ALLOWLIST],
    }),
);
`;
  const tsxCliPath = join(dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs');
  const result = spawnSync(process.execPath, [tsxCliPath, '--eval', probe], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, LOG_LEVEL: 'error' },
  });

  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`Contract probe failed.${details ? `\n${details}` : ''}`);
  }
  const marker = result.stdout.indexOf('__JSON__');
  if (marker === -1) {
    throw new Error(`Contract probe produced no payload.\nstdout:\n${result.stdout}`);
  }
  return JSON.parse(result.stdout.slice(marker + '__JSON__'.length).trim());
}

const { boostRules, sseAllowlist } = loadContractTables();
const {
  producers,
  offChannel,
  dynamicSites,
  parseErrors,
  instrumentationSites,
  busEmittedLiterals,
} = scanProducers();
const { indexSignature, eventNames: declaredEvents } = readServerEventMap();
const { missing: nameConstSourcesMissing, declared: declaredNames } = readDeclaredNames();

// ── positive control: abort rather than report from a blind scanner ───────────

const missingCanaries = SCANNER_CANARIES.filter((canary) => !producers.has(canary.event));
const missingInstrumentationCanaries = INSTRUMENTATION_CANARIES.filter(
  (canary) => !instrumentationSites.has(canary.site),
);
if (missingCanaries.length > 0 || missingInstrumentationCanaries.length > 0) {
  console.error('[event-contracts] ABORT: the scanner failed its positive control.');
  for (const canary of missingCanaries) {
    console.error(`  canary not found: "${canary.event}"`);
    console.error(`    expected from shape: ${canary.shape}`);
    console.error(`    known emit site:     ${canary.source}`);
  }
  for (const canary of missingInstrumentationCanaries) {
    console.error(`  instrumentation canary not found: "${canary.site}"`);
    console.error(`    known emit site: ${canary.source}`);
  }
  console.error(
    '\n  Either the scanner can no longer see that call shape (its output is\n' +
      '  meaningless — fix the scanner), or the producer was genuinely removed\n' +
      '  (which is itself a finding this audit exists to catch — check whether\n' +
      '  the event is still referenced as a subscription or a contract entry).',
  );
  process.exit(2);
}

// ── checks ───────────────────────────────────────────────────────────────────

const failures = [];

if (parseErrors.length > 0) {
  failures.push({
    check: 'src/ contains files this audit cannot parse',
    hint: 'an unparsed file is invisible to the scan, so the producer set may be incomplete',
    parseErrors,
  });
}

// The one line that disables event typing for the entire repo. It is easy to
// re-add while "fixing" a map that no longer satisfies a generic constraint,
// and nothing else in the toolchain notices.
if (indexSignature) {
  failures.push({
    check: 'ServerEventMap declares a string index signature',
    hint:
      'it widens `keyof ServerEventMap` to `string | number`, which makes every ' +
      'emit/on call site unchecked and every payload check vacuous — delete it, ' +
      'and keep the EventBus generic constraint as `object`',
  });
}

const undeclaredProducers = [...producers.keys()]
  .filter((name) => !declaredEvents.includes(name))
  .toSorted();
if (undeclaredProducers.length > 0) {
  failures.push({
    check: 'events are emitted on the bus in src/ but not declared in ServerEventMap',
    hint:
      'undeclared emissions are untyped; declare them so payloads are checked. ' +
      'If the name is not a bus event at all (a webhook or span name), it should ' +
      'not have been scanned — check whether its file references the bus contract',
    undeclaredProducers,
  });
}

// Refuse to judge a contract entry whose name the scanner cannot recognise.
// Without this, such an entry would be reported as dead — a false positive that
// blames the event for a limitation of the scanner.
const unsupportedEntries = [
  ...boostRules.map((rule) => ({ source: 'boost rule', name: rule.eventPattern })),
  ...sseAllowlist.map((name) => ({ source: 'SSE allowlist', name })),
].filter((entry) => !EVENT_NAME_RE.test(entry.name));
if (unsupportedEntries.length > 0) {
  failures.push({
    check: 'contract entries have a name shape this audit cannot scan for',
    hint: 'widen EVENT_NAME_RE, or the entry will be reported dead by construction',
    unsupportedEntries,
  });
}

const orphanContracts = findOrphanContractModules();
if (orphanContracts.length > 0) {
  failures.push({
    check: 'contract modules under src/ that nothing imports',
    hint:
      'a module whose whole job is to declare a contract, with no consumer, is a ' +
      'promise nothing keeps — wire it up, or delete it and its self-referential tests',
    orphanContracts,
  });
}

// The instrumentation contract's own header claims this audit fails the build
// when a declared name loses its producer. This is the check that makes that
// claim true; without it the header would be another instance of the defect the
// file exists to remove.
if (nameConstSourcesMissing.length > 0) {
  failures.push({
    check: 'a well-known-name contract module is missing',
    hint: 'check 8 cannot run against it, so nothing verifies its declared names are emitted',
    missingContracts: nameConstSourcesMissing,
  });
} else {
  // Per-source, not just in total: emptying ONE object would otherwise pass
  // silently as long as another source still declared something.
  const emptySources = NAME_CONST_SOURCES.filter(
    (source) => !declaredNames.some((entry) => entry.source === source.file),
  ).map((source) => `${source.file} (${source.consts.join(', ')})`);
  if (emptySources.length > 0) {
    failures.push({
      check: 'a well-known-name object declares no names',
      hint: 'the object was renamed or emptied — check 8 would pass vacuously for it',
      emptySources,
    });
  }

  const unproduced = declaredNames
    .filter((entry) => !instrumentationSites.has(`${entry.obj}.${entry.key}`))
    .map((entry) => `${entry.obj}.${entry.key} = '${entry.value}'  (${entry.source})`);
  if (unproduced.length > 0) {
    failures.push({
      check: 'well-known names are declared but never emitted',
      hint:
        'the name is a promise with no producer: wire it to a real call site, or ' +
        'delete it from the contract — a declared-but-unemitted name is how the ' +
        'instrumentation module sat dead for six months',
      unproduced,
    });
  }
}

// ── check 9: declared -> emitted ─────────────────────────────────────────────
//
// Check 2 asks whether every emitted name is declared; this is the other
// direction — whether every declared name is emitted. A declaration with no
// producer is a subscription target that can never fire, the "silent half"
// defect check 2 structurally cannot see. See "DECLARED-BUT-UNEMITTED BASELINE"
// in the header for why the baseline exists and why the match is by exact
// literal rather than EVENT_NAME_RE.
const hasExternalProducer = (name) => busEmittedLiterals.has(name);
const baselineNames = new Set(UNEMITTED_EVENT_BASELINE.map((entry) => entry.name));

const newlyUnemitted = declaredEvents
  .filter((name) => !hasExternalProducer(name) && !baselineNames.has(name))
  .toSorted();
if (newlyUnemitted.length > 0) {
  failures.push({
    check: 'ServerEventMap declares events that nothing in src/ emits',
    hint:
      'a declared-but-unemitted name is a subscription that can never fire. Wire ' +
      'the emitter, or — only if it is deliberate groundwork — add a baseline entry ' +
      'in UNEMITTED_EVENT_BASELINE naming the call site that will emit it',
    unemittedEvents: newlyUnemitted,
  });
}

const baselineNotDeclared = UNEMITTED_EVENT_BASELINE.filter(
  (entry) => !declaredEvents.includes(entry.name),
);
if (baselineNotDeclared.length > 0) {
  failures.push({
    check: 'the unemitted-event baseline names events ServerEventMap no longer declares',
    hint:
      'the declaration was removed or renamed — drop the stale baseline entry, or ' +
      'restore the declaration it was recording',
    baselineNotDeclared,
  });
}

const baselineNowProduced = UNEMITTED_EVENT_BASELINE.filter(
  (entry) => declaredEvents.includes(entry.name) && hasExternalProducer(entry.name),
).map((entry) => ({
  name: entry.name,
  sites: (busEmittedLiterals.get(entry.name) ?? []).join(', '),
}));
if (baselineNowProduced.length > 0) {
  failures.push({
    check: 'the unemitted-event baseline has entries that now have a producer',
    hint:
      'the emitter was wired up — remove the entry from UNEMITTED_EVENT_BASELINE so ' +
      'the guard keeps its teeth instead of silently exempting a live event',
    baselineNowProduced,
  });
}

const deadRules = boostRules
  .filter((rule) => !producers.has(rule.eventPattern))
  .map((rule) => ({
    eventPattern: rule.eventPattern,
    targetDomains: rule.targetDomains.join(', '),
  }));
if (deadRules.length > 0) {
  failures.push({
    check: 'boost rules subscribe to events that nothing emits',
    hint: 'the rule is inert configuration: it loads, subscribes, and can never fire',
    deadRules,
  });
}

const deadAllowlist = sseAllowlist
  .filter((event) => !producers.has(event))
  .map((event) => ({ event }));
if (deadAllowlist.length > 0) {
  failures.push({
    check: 'SSE allowlist entries are never emitted',
    hint: 'these events are advertised to /events subscribers but never reach the stream',
    deadAllowlist,
  });
}

// ── report ───────────────────────────────────────────────────────────────────

/**
 * Per-key renderers for failure payloads whose items are objects.
 *
 * Anything not listed here still prints — as its own string form. That fallback
 * is the point: this used to be a closed list of keys, so a check whose payload
 * key was missing printed a heading, a hint, and NOTHING ELSE. T8 hit exactly
 * that (check 8 fired correctly and named no offending entry), which is the same
 * "the message promises detail it does not deliver" defect this audit exists to
 * catch — one level up, in the audit's own output.
 */
const FAILURE_DETAIL_FORMATTERS = {
  deadRules: (rule) => `${rule.eventPattern} (targets: ${rule.targetDomains})`,
  deadAllowlist: (entry) => entry.event,
  unsupportedEntries: (entry) => `${entry.name} (from ${entry.source})`,
  orphanContracts: (entry) => entry.location,
  baselineNotDeclared: (entry) => `${entry.name} — ${entry.reason}`,
  baselineNowProduced: (entry) => `${entry.name} — produced at ${entry.sites}`,
};

// Sites on the dedicated bus helpers, where the event name is always a literal
// in this codebase. A non-zero count means an event may be emitted dynamically
// and this audit could therefore report it as dead — the one blind spot worth
// tracking over time. Plain `emit` is excluded on purpose: `this.emit('started')`
// on a Node EventEmitter is not a bus emission.
const BUS_HELPER_METHODS = new Set(['emitEvent', 'emitBusEvent', 'emitWebSocketEvent']);
const helperHoles = dynamicSites.filter((site) => BUS_HELPER_METHODS.has(site.method));

console.log(
  `[event-contracts] boost rules: ${boostRules.length}; SSE allowlist: ${sseAllowlist.length}; ` +
    `declared events: ${declaredEvents.length}; bus producer event names: ${producers.size}; ` +
    `declared-but-unemitted (baselined): ${UNEMITTED_EVENT_BASELINE.length}; ` +
    `off-channel emit names: ${offChannel.size}; ` +
    `orphan contract modules (${CONTRACT_MODULE_RE.source}): ${orphanContracts.length}; ` +
    `declared well-known names: ${declaredNames.length}; ` +
    // Always reads N/N: the abort above fires when any control is missing, so a
    // report at all implies all controls matched. It is printed to keep the
    // positive control visible, not as a measurement — and it says the scanner
    // still matches every emit SHAPE, NOT that the matched sites are reachable
    // at runtime (one instrumentation canary is known to sit in dead code).
    `scanner controls matched: ${SCANNER_CANARIES.length + INSTRUMENTATION_CANARIES.length}/` +
    `${SCANNER_CANARIES.length + INSTRUMENTATION_CANARIES.length} (reachability NOT asserted); ` +
    `unattributable bus-helper emits: ${helperHoles.length}`,
);

if (failures.length === 0) {
  console.log(
    '[event-contracts] OK: every boost rule and SSE allowlist entry has at least one ' +
      'literal producer in src/.',
  );
} else {
  for (const failure of failures) {
    console.error(`\n[event-contracts] FAIL: ${failure.check}`);
    if (failure.hint) console.error(`  hint: ${failure.hint}`);
    for (const [key, value] of Object.entries(failure)) {
      if (key === 'check' || key === 'hint' || value === undefined || value === null) continue;
      if (!Array.isArray(value)) {
        console.error(`  ${key}: ${String(value)}`);
        continue;
      }
      const format = FAILURE_DETAIL_FORMATTERS[key] ?? ((item) => String(item));
      for (const item of value) console.error(`  ${format(item)}`);
    }
  }
}

if (!QUIET && helperHoles.length > 0) {
  console.error(
    `\n[event-contracts] warning: ${helperHoles.length} call(s) to a bus helper pass no ` +
      'event-shaped literal, so their event name cannot be read statically. Any contract ' +
      'entry emitted only through these sites would be reported dead:',
  );
  for (const site of helperHoles.slice(0, 10)) {
    console.error(`  ${site.method} @ ${site.location}`);
  }
  const hidden = helperHoles.length - 10;
  if (hidden > 0) console.error(`  (+${hidden} more)`);
}

// Off-channel emit-ish names are a note, never a failure — see "ONE CHANNEL,
// NOT THREE" in the header. Printed by default so a NEW channel appearing here
// is noticed, while the existing ones do not cry wolf on every run.
if (!QUIET && offChannel.size > 0) {
  const names = [...offChannel.keys()].toSorted();
  console.log(
    `\n[event-contracts] note: ${names.length} emit-shaped name(s) in src/ come from files that ` +
      'never reference the bus contract. These are other channels (webhooks, spans, metrics) ' +
      'and are NOT judged against ServerEventMap:',
  );
  for (const name of names) {
    const sites = offChannel.get(name);
    const extra = sites.length > 1 ? ` (+${sites.length - 1} more)` : '';
    console.log(`  ${name}  ← ${sites[0]}${extra}`);
  }
  console.log(
    '  If one of these is really a bus emission, its file is missing the bus contract ' +
      'reference and is being skipped unchecked — route it through a typed bus helper.',
  );
}

process.exit(failures.length === 0 ? 0 : 1);
