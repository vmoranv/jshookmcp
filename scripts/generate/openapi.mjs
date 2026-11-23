#!/usr/bin/env node

/**
 * Generates the machine-readable OpenAPI 3.1 tool specification (openapi.json)
 * from the runtime tool surface: the 35-domain generated tool catalog plus the
 * 8 search/activation meta-tools. Guards against tool description drift: any
 * change to tool names/descriptions/schemas that is not re-reflected in
 * openapi.json fails `--check` (same contract as scripts/generate/metadata.mjs).
 *
 * Modes:
 *   node scripts/generate/openapi.mjs          # regenerate openapi.json
 *   node scripts/generate/openapi.mjs --check  # exit 1 when openapi.json is stale
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildOpenApiDocument,
  findFirstDifference,
  serializeDocument,
} from '../lib/openapi-lib.mjs';

const scriptDirUrl = new URL('.', import.meta.url);
const projectRootUrl = new URL('../../', scriptDirUrl);
const projectRoot = fileURLToPath(projectRootUrl);
const require = createRequire(import.meta.url);

const packageJsonPath = join(projectRoot, 'package.json');
const openapiJsonPath = join(projectRoot, 'openapi.json');

const registryMetadataPlatform = 'win32';

/**
 * Probe the runtime tool surface through tsx (same mechanism as
 * scripts/generate/metadata.mjs). The catalog exposes plain JSON Schema
 * inputSchemas; the meta-tools in src/server/MCPServer.search.ts also hold
 * plain JSON Schema definitions (zod conversion happens only at registration),
 * so registerSearchMetaTools is driven against a mock context to capture their
 * resolved descriptions and schemas without booting a server.
 */
const toolSurfaceProbe = `
import { initRegistry } from './src/server/registry/index.ts';
import { GENERATED_TOOL_CATALOG } from './src/server/registry/generated-tool-catalog.ts';
import { registerSearchMetaTools } from './src/server/MCPServer.search.ts';

(async () => {
  await initRegistry();

  const catalog = GENERATED_TOOL_CATALOG.map((entry) => ({
    name: entry.tool.name,
    description: entry.tool.description,
    inputSchema: entry.tool.inputSchema,
    annotations: entry.tool.annotations ?? null,
    domain: entry.domain,
    profiles: entry.profiles ?? null,
  }));

  const metaTools = [];
  const mockContext = {
    server: {
      registerTool: (name, spec) => {
        metaTools.push({ name, description: spec.description, inputSchema: spec.inputSchema });
      },
    },
    metaToolsByName: new Map(),
    extensionToolsByName: new Map(),
  };
  registerSearchMetaTools(mockContext);

  console.log(JSON.stringify({ catalog, metaTools }));
})();
`;

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function loadToolSurface() {
  const tsxPackagePath = require.resolve('tsx/package.json');
  const tsxCliPath = join(dirname(tsxPackagePath), 'dist', 'cli.mjs');
  const result = spawnSync(process.execPath, [tsxCliPath, '--eval', toolSurfaceProbe], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      JSHOOK_REGISTRY_PLATFORM: registryMetadataPlatform,
      LOG_LEVEL: 'error',
    },
  });

  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`Failed to load tool surface via tsx.${details ? `\n${details}` : ''}`);
  }

  const stdout = result.stdout.trim();
  if (!stdout) {
    throw new Error('Tool surface probe returned empty stdout.');
  }

  const surface = JSON.parse(stdout);
  if (!Array.isArray(surface.catalog) || !Array.isArray(surface.metaTools)) {
    throw new Error('Tool surface probe returned an unexpected payload shape.');
  }
  return surface;
}

export async function computeOpenApiState() {
  const [packageJson, surface] = await Promise.all([readJson(packageJsonPath), loadToolSurface()]);

  const document = buildOpenApiDocument({
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,
    catalogEntries: surface.catalog,
    metaTools: surface.metaTools,
  });
  const expected = formatDocumentText(serializeDocument(document));

  let actual = null;
  try {
    actual = await readFile(openapiJsonPath, 'utf8');
  } catch {
    actual = null;
  }

  return {
    packageVersion: packageJson.version,
    catalogCount: surface.catalog.length,
    metaCount: surface.metaTools.length,
    pathCount: Object.keys(document.paths).length,
    schemaCount: Object.keys(document.components.schemas).length,
    expected,
    actual,
  };
}

/**
 * serializeDocument() emits raw JSON.stringify output, which is not
 * oxfmt-style: oxfmt collapses arrays that fit the line width (`"tags": ["x"]`
 * rather than one element per line). Lefthook's pre-commit hook runs
 * `oxfmt {staged_files} --write` over any staged `*.json`, so a raw-generator
 * openapi.json would be rewritten the moment it is committed and every
 * subsequent `--check` would fail on formatting alone.
 *
 * Formatting here — rather than excluding openapi.json from the hook — keeps
 * the committed artifact and the check's expectation identical, and matches
 * what scripts/generate/domains-index.mjs already does for its three
 * generated .ts files. Verified byte-identical to the file-based
 * `oxfmt --write` path, so the hook becomes a no-op on this file.
 */
function formatDocumentText(text) {
  const bin = resolve(
    projectRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'oxfmt.cmd' : 'oxfmt',
  );
  if (!existsSync(bin)) {
    console.warn(
      '[openapi] oxfmt not found; openapi.json left unformatted. Lefthook will reformat it on commit and `--check` will then report a formatting-only difference.',
    );
    return text;
  }
  const result = spawnSync(bin, ['--stdin-filepath=openapi.json'], {
    cwd: projectRoot,
    input: text,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || typeof result.stdout !== 'string' || !result.stdout) {
    const details = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    console.warn(
      `[openapi] oxfmt failed (status=${result.status}); openapi.json left unformatted.${details ? `\n${details}` : ''}`,
    );
    return text;
  }
  return result.stdout;
}

function describeDifference(actual, expected) {
  if (actual === null) {
    return 'openapi.json is missing (run `pnpm run openapi:generate`).';
  }
  try {
    const difference = findFirstDifference(JSON.parse(actual), JSON.parse(expected));
    return difference
      ? `First difference at ${difference}.`
      : 'openapi.json text differs from the generated document (formatting only).';
  } catch {
    return 'openapi.json is not valid JSON.';
  }
}

export async function checkOpenApi(options = {}) {
  const { quiet = false } = options;
  const state = await computeOpenApiState();
  const inSync = state.actual === state.expected;

  if (!quiet) {
    console.log(
      `[openapi] tool surface: version=${state.packageVersion}, catalog=${state.catalogCount}, meta=${state.metaCount}, paths=${state.pathCount}, schemas=${state.schemaCount}`,
    );
    if (inSync) {
      console.log('[openapi] OK: openapi.json is in sync with the tool surface.');
    } else {
      console.error(`[openapi] STALE: ${describeDifference(state.actual, state.expected)}`);
      console.error('[openapi] Run `pnpm run openapi:generate` to refresh openapi.json.');
    }
  }

  return {
    summary: state,
    inSync,
  };
}

export async function writeOpenApi() {
  const state = await computeOpenApiState();
  const changed = state.actual !== state.expected;

  await writeFile(openapiJsonPath, state.expected, 'utf8');

  return {
    summary: state,
    changed,
  };
}

async function main() {
  const mode = process.argv.includes('--check') ? 'check' : 'write';

  if (mode === 'check') {
    const result = await checkOpenApi();
    process.exit(result.inSync ? 0 : 1);
  }

  const result = await writeOpenApi();
  console.log(
    `[openapi] wrote openapi.json: version=${result.summary.packageVersion}, catalog=${result.summary.catalogCount}, meta=${result.summary.metaCount}, paths=${result.summary.pathCount}, schemas=${result.summary.schemaCount}`,
  );
}

const isCliEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isCliEntry) {
  main().catch((error) => {
    console.error(
      `[openapi] Fatal error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
