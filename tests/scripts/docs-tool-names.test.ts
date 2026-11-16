/**
 * Guard: a tool name a doc tells the user to call must actually be registered.
 *
 * Two detectors, because the defect showed up in two shapes:
 *
 *  1. `"toolName": "..."` inside a fenced JSON block — `docs/custom-macros.md`
 *     (and its `docs/en/` twin) shipped a macro example whose second step called
 *     `ast_transform_beautify`. No such tool was ever registered, so the
 *     documented macro could never run.
 *  2. A bare `` `snake_case_name` `` in prose — a workflow doc listed
 *     `page_get_all_links` in its "safe parallel read pool" bullet while no such
 *     tool existed (the real family is `page_list_frames`, `page_cookies`, ...).
 *
 * Nothing compared doc tool names against the registry, which is why both lies
 * survived until they were found by hand. This test is that comparison.
 *
 * Source of truth is `GENERATED_TOOL_DOMAIN_MAP` (every registered built-in
 * tool) plus `META_TOOL_NAMES` (the meta-tools, registered outside the domain
 * catalog on purpose). The built-in macro definitions are checked too: they
 * invoke tools by the same name-based mechanism, so they go stale the same way.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { META_TOOL_NAMES } from '@server/MCPServer.search';
import { GENERATED_TOOL_DOMAIN_MAP } from '@server/registry/generated-tool-domains';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const registeredTools = new Set<string>([
  ...Object.keys(GENERATED_TOOL_DOMAIN_MAP),
  ...META_TOOL_NAMES,
]);

/** `"toolName": "deobfuscate"` — a macro step inside a fenced JSON block. */
const DOC_TOOL_NAME_PATTERN = /"toolName"\s*:\s*"([^"]+)"/g;

/** `toolName: 'deobfuscate'` — a built-in macro step definition. */
const BUILTIN_TOOL_NAME_PATTERN = /toolName:\s*'([^']+)'/g;

/**
 * `` `page_navigate` `` — a backtick-quoted snake_case token in prose.
 *
 * The `_` requirement is deliberate: it keeps precision high (1695 such tokens
 * resolve to a real tool, 10 do not) at the cost of missing single-word tool
 * names such as `watch`. Dropping the requirement would match ordinary prose
 * (`docs`, `error`, `true`) and drown the signal.
 */
const BACKTICK_SNAKE_CASE_PATTERN = /`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g;

/**
 * snake_case tokens that appear in the docs but are deliberately NOT tool
 * names. Every entry carries its reason. The list exists so that naming a
 * non-tool is a decision on record rather than an accident: if a doc starts
 * referring to a tool that was never registered, this guard fails and the
 * author must either register the tool, fix the name, or justify it here.
 */
const NON_TOOL_TOKENS: ReadonlyMap<string, string> = new Map<string, string>([
  [
    'anti_bot_diagnoser',
    'workflow id — installed via install_extension("workflow:<id>"), not a tool',
  ],
  ['bundle_recovery', 'workflow id — installed via install_extension("workflow:<id>"), not a tool'],
  ['evidence_pack', 'workflow id — installed via install_extension("workflow:<id>"), not a tool'],
  [
    'signature_hunter',
    'workflow id — installed via install_extension("workflow:<id>"), not a tool',
  ],
  [
    'ws_protocol_lifter',
    'workflow id — installed via install_extension("workflow:<id>"), not a tool',
  ],
  ['source_repo', 'sibling `meta.yaml` plugin metadata field, not a tool'],
  ['step_1', 'macro step id in the custom-macros example, not a tool'],
  ['jshook_plugin_template', 'GitHub repository name, not a tool'],
  ['node_modules', 'directory name, not a tool'],
  ['npm_config_omit', 'npm environment variable, not a tool'],
  [
    'search_feedback_used',
    'OTLP metric emitted on search→tool-call association (see docs/guide/telemetry), not a tool',
  ],
  // APK v4 signing-block spike (docs/operations/descope-spike-findings.md):
  // V4Signature / hashing_info field names, not tools. The v4 scenario was
  // deliberately descoped; apk_v4_idsig_parse is a FUTURE, unregistered tool.
  ['hashing_info', 'APK v4 V4Signature field name, not a tool'],
  ['signing_info', 'APK v4 V4Signature field name, not a tool'],
  ['merkle_tree', 'APK v4 V4Signature field name, not a tool'],
  ['raw_root_hash', 'APK v4 hashing_info field name, not a tool'],
  ['hash_algorithm', 'APK v4 hashing_info constant, not a tool'],
  ['log2_blocksize', 'APK v4 hashing_info constant, not a tool'],
  [
    'apk_v4_idsig_parse',
    'descoped future capability (docs/operations/descope-spike-findings.md), not a registered tool',
  ],
  // Synthetic trace fixtures (docs/operations/trace-capture-and-calibration.md).
  ['tool_alpha', 'placeholder fixture tool id in trace-calibration docs, not a tool'],
  ['tool_beta', 'placeholder fixture tool id in trace-calibration docs, not a tool'],
]);

interface ToolNameReference {
  line: number;
  toolName: string;
}

/** Pure detector, so the self-tests below can prove it actually fires. */
function findToolNameReferences(source: string, pattern: RegExp): ToolNameReference[] {
  const references: ToolNameReference[] = [];
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    references.push({
      line: source.slice(0, index).split('\n').length,
      toolName: match[1]!,
    });
  }
  return references;
}

function markdownFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...markdownFilesUnder(path));
    else if (entry.name.endsWith('.md')) found.push(path);
  }
  return found;
}

/** Every markdown file under the docs tree, walked once. */
const docsMarkdown = markdownFilesUnder(join(projectRoot, 'docs'));

/** Every markdown file a user can read: the docs tree plus the root guides. */
const documentedMarkdown = [
  ...docsMarkdown,
  ...['README.md', 'README.zh.md', 'CONTRIBUTING.md', 'AGENTS.md']
    .map((name) => join(projectRoot, name))
    .filter((path) => existsSync(path)),
];

interface SourceUnderGuard {
  file: string;
  path: string;
  pattern: RegExp;
}

const sourcesUnderGuard: SourceUnderGuard[] = [
  ...docsMarkdown.map((path) => ({
    file: relative(projectRoot, path),
    path,
    pattern: DOC_TOOL_NAME_PATTERN,
  })),
  ...documentedMarkdown.map((path) => ({
    file: relative(projectRoot, path),
    path,
    pattern: BACKTICK_SNAKE_CASE_PATTERN,
  })),
  {
    file: 'src/server/macros/builtins/index.ts',
    path: join(projectRoot, 'src/server/macros/builtins/index.ts'),
    pattern: BUILTIN_TOOL_NAME_PATTERN,
  },
];

interface LocatedReference extends ToolNameReference {
  file: string;
}

/** Collect references from every source file guarded by `pattern`. */
function collectReferences(pattern: RegExp): LocatedReference[] {
  const references: LocatedReference[] = [];
  for (const source of sourcesUnderGuard) {
    if (source.pattern !== pattern) continue;
    const text = readFileSync(source.path, 'utf8');
    for (const reference of findToolNameReferences(text, pattern)) {
      references.push({ file: source.file, ...reference });
    }
  }
  return references;
}

const macroReferences = collectReferences(DOC_TOOL_NAME_PATTERN);
const builtinReferences = collectReferences(BUILTIN_TOOL_NAME_PATTERN);
const backtickReferences = collectReferences(BACKTICK_SNAKE_CASE_PATTERN);

const allReferences = [...macroReferences, ...builtinReferences];

describe('documented tool names exist', () => {
  it('self-test: the macro detector flags an unregistered name', () => {
    const synthetic = [
      '```json',
      '{ "id": "s", "toolName": "definitely_not_a_registered_tool" }',
      '```',
    ].join('\n');
    const found = findToolNameReferences(synthetic, DOC_TOOL_NAME_PATTERN);
    expect(found.map((reference) => reference.toolName)).toEqual([
      'definitely_not_a_registered_tool',
    ]);
    expect(found.every((reference) => !registeredTools.has(reference.toolName))).toBe(true);
  });

  it('self-test: the backtick detector flags an unregistered name', () => {
    const synthetic = 'Call `definitely_not_a_registered_tool` to do the thing.';
    const found = findToolNameReferences(synthetic, BACKTICK_SNAKE_CASE_PATTERN);
    expect(found.map((reference) => reference.toolName)).toEqual([
      'definitely_not_a_registered_tool',
    ]);
    expect(found.every((reference) => !registeredTools.has(reference.toolName))).toBe(true);
  });

  it('finds references to check (a guard that checks nothing is not a guard)', () => {
    expect(allReferences.length).toBeGreaterThan(0);
    expect(backtickReferences.length).toBeGreaterThan(100);
  });

  it('every referenced tool name is registered', () => {
    const unknown = allReferences
      .filter((reference) => !registeredTools.has(reference.toolName))
      .map((reference) => `${reference.file}:${reference.line} -> ${reference.toolName}`);
    expect(unknown).toEqual([]);
  });

  it('every backtick-quoted snake_case token is a tool or a justified non-tool', () => {
    const unknown = backtickReferences
      .filter(
        (reference) =>
          !registeredTools.has(reference.toolName) && !NON_TOOL_TOKENS.has(reference.toolName),
      )
      .map((reference) => `${reference.file}:${reference.line} -> ${reference.toolName}`);
    expect(unknown).toEqual([]);
  });

  it('the non-tool allowlist has no stale entries', () => {
    const seen = new Set(backtickReferences.map((reference) => reference.toolName));
    const stale = [...NON_TOOL_TOKENS.keys()].filter((name) => !seen.has(name));
    expect(stale).toEqual([]);
  });
});
