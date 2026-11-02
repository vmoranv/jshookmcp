/**
 * Data-driven HTTP action tables for the native bridge backends.
 *
 * The four `handle*Bridge` HTTP dispatchers were 4 near-identical switch
 * statements (~433 duplicated lines per fallow clone audit). Each backend's
 * actions are now declared here as a request recipe; the shared
 * `dispatchHttpBridgeAction` in handlers.impl.ts turns a recipe into a
 * bridgeFetch + asJsonResponse pair.
 *
 * Recipe fields:
 * - `path`: URL path (function-name interpolations are expressed via `kind`)
 * - `kind`: request/response shape discriminator consumed by the dispatcher
 * - `body`: literal JSON body for POST actions
 * - `extra`: additional response fields beyond `{ success, action }`
 */
import type { BridgeBackend } from './handlers.impl';

export type HttpActionKind =
  | 'plain' // GET path, echo whole payload under `data`'s natural key
  | 'open' // POST body {binaryPath}, response under `result`
  | 'open_project' // POST body {binaryPath} on /project/open
  | 'decompile' // GET /functions/{name}/decompile, response under `decompiled`
  | 'disassemble' // GET /functions/{name}/disassemble, response under `disassembly`
  | 'xrefs' // GET /xrefs/{name}, response under `xrefs` + `symbol`
  | 'run_script' // POST body {scriptPath, args}, response under `result`
  | 'run_command' // POST body {command}, response under `result`
  | 'analyze' // POST body {level}, response under `result`
  | 'strings_post' // POST body {pattern}, response under `strings`
  | 'strings_get'; // GET /strings (IDA/BinaryNinja), response under `strings`

export interface HttpActionRecipe {
  path: string;
  kind: HttpActionKind;
  body?: Record<string, unknown>;
  /** Extra keys merged into the success response (e.g. functionName). */
  extra?: Record<string, unknown>;
}

const GHIDRA_HTTP_ACTIONS: Record<string, HttpActionRecipe> = {
  open_project: {
    path: '/project/open',
    kind: 'open_project',
    body: { binaryPath: null },
  },
  list_functions: { path: '/functions', kind: 'plain', extra: { functions: null } },
  decompile_function: { path: '/functions/{name}/decompile', kind: 'decompile' },
  run_script: {
    path: '/script/run',
    kind: 'run_script',
    body: { scriptPath: null, args: null },
  },
  get_xrefs: { path: '/xrefs/{name}', kind: 'xrefs' },
  search_strings: {
    path: '/strings',
    kind: 'strings_post',
    body: { pattern: null },
  },
  get_segments: { path: '/segments', kind: 'plain', extra: { segments: null } },
};

const IDA_HTTP_ACTIONS: Record<string, HttpActionRecipe> = {
  open_binary: { path: '/binary/open', kind: 'open', body: { binaryPath: null } },
  list_functions: { path: '/functions', kind: 'plain', extra: { functions: null } },
  decompile_function: { path: '/functions/{name}/decompile', kind: 'decompile' },
  run_script: {
    path: '/script/run',
    kind: 'run_script',
    body: { scriptPath: null, args: null },
  },
  get_xrefs: { path: '/xrefs/{name}', kind: 'xrefs' },
  search_strings: {
    path: '/strings',
    kind: 'strings_post',
    body: { pattern: null },
  },
  get_strings: { path: '/strings', kind: 'strings_get', extra: { strings: null } },
  get_segments: { path: '/segments', kind: 'plain', extra: { segments: null } },
};

const RIZIN_HTTP_ACTIONS: Record<string, HttpActionRecipe> = {
  open_binary: { path: '/binary/open', kind: 'open', body: { binaryPath: null } },
  analyze: {
    path: '/analysis/run',
    kind: 'analyze',
    body: { level: null },
  },
  list_functions: { path: '/functions', kind: 'plain', extra: { functions: null } },
  disassemble_function: { path: '/functions/{name}/disassemble', kind: 'disassemble' },
  run_command: {
    path: '/commands/run',
    kind: 'run_command',
    body: { command: null },
  },
  get_xrefs: { path: '/xrefs/{name}', kind: 'xrefs' },
  search_strings: {
    path: '/strings',
    kind: 'strings_post',
    body: { pattern: null },
  },
  get_segments: { path: '/segments', kind: 'plain', extra: { segments: null } },
};

const BINARY_NINJA_HTTP_ACTIONS: Record<string, HttpActionRecipe> = {
  open_binary: { path: '/binary/open', kind: 'open', body: { binaryPath: null } },
  list_functions: { path: '/functions', kind: 'plain', extra: { functions: null } },
  decompile_function: { path: '/functions/{name}/decompile', kind: 'decompile' },
  disassemble_function: { path: '/functions/{name}/disassemble', kind: 'disassemble' },
  run_script: {
    path: '/script/run',
    kind: 'run_script',
    body: { scriptPath: null, args: null },
  },
  get_xrefs: { path: '/xrefs/{name}', kind: 'xrefs' },
  get_strings: { path: '/strings', kind: 'strings_get', extra: { strings: null } },
  search_strings: {
    path: '/strings',
    kind: 'strings_post',
    body: { pattern: null },
  },
  get_segments: { path: '/segments', kind: 'plain', extra: { segments: null } },
  get_types: { path: '/types', kind: 'plain', extra: { types: null } },
};

export const HTTP_ACTIONS_BY_BACKEND: Record<BridgeBackend, Record<string, HttpActionRecipe>> = {
  ghidra: GHIDRA_HTTP_ACTIONS,
  ida: IDA_HTTP_ACTIONS,
  rizin: RIZIN_HTTP_ACTIONS,
  binaryninja: BINARY_NINJA_HTTP_ACTIONS,
};

/**
 * Required argument name per recipe kind — the dispatcher turns a missing
 * value into the same "X is required for Y" error the switch cases threw.
 */
export const REQUIRED_ARG_BY_KIND: Partial<Record<HttpActionKind, string>> = {
  open: 'binaryPath',
  open_project: 'binaryPath',
  decompile: 'functionName',
  disassemble: 'functionName',
  xrefs: 'functionName',
  run_script: 'scriptPath',
  run_command: 'command',
};

/** Build the literal JSON body for a POST recipe (placeholders replaced). */
export function buildActionBody(
  recipe: HttpActionRecipe,
  args: Record<string, unknown>,
): string | undefined {
  if (!recipe.body) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(recipe.body)) {
    if (key === 'binaryPath') out[key] = args.binaryPath;
    else if (key === 'scriptPath') {
      out[key] = args.scriptPath;
      out.args = args.scriptArgs ?? [];
    } else if (key === 'command') out[key] = args.command;
    else if (key === 'pattern') out[key] = args.searchPattern ?? '';
    else if (key === 'level') out[key] = args.analysisLevel ?? 'default';
  }
  return JSON.stringify(out);
}

/** Fill `{name}` placeholders in a recipe path from args. */
export function resolveActionPath(recipe: HttpActionRecipe, args: Record<string, unknown>): string {
  if (!recipe.path.includes('{name}')) return recipe.path;
  return recipe.path.replace('{name}', encodeURIComponent(args.functionName as string));
}

/**
 * Response key a recipe kind stores its payload under, when not derivable
 * from the recipe's `extra` table alone.
 */
export const RESPONSE_KEY_BY_KIND: Partial<Record<HttpActionKind, string>> = {
  decompile: 'decompiled',
  disassemble: 'disassembly',
  xrefs: 'xrefs',
};

/** Static action lists — also the capability fallback advertising surface. */
export const STATIC_ACTIONS_BY_BACKEND: Record<BridgeBackend, string[]> = {
  ghidra: ['status', ...Object.keys(GHIDRA_HTTP_ACTIONS)],
  ida: ['status', ...Object.keys(IDA_HTTP_ACTIONS)],
  rizin: ['status', ...Object.keys(RIZIN_HTTP_ACTIONS)],
  binaryninja: ['status', ...Object.keys(BINARY_NINJA_HTTP_ACTIONS)],
};
