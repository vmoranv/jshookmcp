import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  collectCentralConfigDefaults,
  collectProcessEnvironmentAccesses,
  collectTypedEnvironmentReaders,
} from './env-example-contract';

// Every test in this file Babel-parses the whole src/ corpus; under coverage
// instrumentation the scan roughly doubles and exceeds the 30s default on
// slower runners.
vi.setConfig({ testTimeout: 180_000 });

interface EnvExampleEntry {
  key: string;
  rawValue: string;
  line: number;
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const examplePath = join(projectRoot, '.env.example');
const configPath = join(projectRoot, 'src/utils/config.ts');
const exampleSource = readFileSync(examplePath, 'utf8');
const configSource = readFileSync(configPath, 'utf8');
const sourcePaths = collectTypeScriptFiles(join(projectRoot, 'src'));
const srcCorpus = sourcePaths.map((path) => readFileSync(path, 'utf8')).join('\n');

const dynamicReaderContracts = new Map<string, readonly string[]>([
  [
    'src/utils/browserExecutable.ts:readEnvNullableString:key',
    ['CHROME_PATH', 'PUPPETEER_EXECUTABLE_PATH', 'BROWSER_EXECUTABLE_PATH'],
  ],
  // Historical lowercase names remain compatibility-only and are superseded
  // by the documented JSHOOK_* forms at the outer read site.
  ["src/utils/concurrency.ts:readEnvInteger:'jshook_CDP_CONCURRENCY'", []],
  ["src/utils/concurrency.ts:readEnvInteger:'jshook_CPU_CONCURRENCY'", []],
  ["src/utils/concurrency.ts:readEnvInteger:'jshook_IO_CONCURRENCY'", []],
  [
    'src/modules/binary-instrument/GhidraAnalyzer.ts:readEnvNullableString:key',
    ['GHIDRA_HEADLESS_PATH', 'GHIDRA_ANALYZE_HEADLESS', 'GHIDRA_HOME', 'GHIDRA_INSTALL_DIR'],
  ],
  [
    'src/modules/binary-secrets/constants.ts:readEnvIntegerList:key',
    ['BINARY_SECRETS_DEFAULT_KEY_LENGTHS'],
  ],
  ['src/native/ManualMapInjector.ts:readEnvString:INJECTION_ENV_GATE', ['JSHOOK_INJECTION_ENABLE']],
  [
    'src/native/syscall/AntiAnalysis.ts:readEnvBoolean:name',
    ['JSHOOK_SKIP_ANTI_ANALYSIS', 'JSHOOK_ANTI_ANALYSIS_STRICT'],
  ],
  [
    'src/native/syscall/ProcessMasquerade.ts:readEnvBoolean:name',
    ['JSHOOK_BYOVD_ENABLE', 'JSHOOK_MASQUERADE'],
  ],
  [
    'src/native/syscall/SelfDefense.ts:readEnvBoolean:name',
    ['JSHOOK_SELFDEFENSE', 'JSHOOK_SELFDEFENSE_EXTREME', 'JSHOOK_WATCHDOG_ENABLE'],
  ],
  [
    'src/server/domains/maintenance/handlers/extension-registry-utils.ts:readEnvNullableString:envKey',
    ['MCP_PLUGIN_ROOTS', 'MCP_WORKFLOW_ROOTS'],
  ],
  [
    'src/server/domains/memory/handlers/antidetection-check.ts:readEnvBoolean:v',
    ['JSHOOK_INJECTION_ENABLE', 'JSHOOK_BYOVD_ENABLE', 'JSHOOK_SELFDEFENSE'],
  ],
  [
    'src/server/domains/memory/handlers/auto-assembler.ts:readEnvString:INJECTION_ENV_GATE',
    ['JSHOOK_INJECTION_ENABLE'],
  ],
  [
    'src/server/domains/memory/handlers/hooks.ts:readEnvString:INJECTION_ENV_GATE',
    ['JSHOOK_INJECTION_ENABLE'],
  ],
  // Plugin-owned settings intentionally form an open namespace rather than a
  // finite .env.example inventory: PLUGIN_<ID>_* and PLUGINS_<ID>_*.
  ['src/server/extensions/plugin-config.ts:readEnvNullableString:candidate', []],
]);

const contextualTypedDefaults = new Map<string, string>([
  ['JSHOOK_CHAOS_CHUNK_VARIANCE', '0.25'],
  ['JSHOOK_CHAOS_INTER_CHUNK_DELAY_MIN', '1'],
  ['JSHOOK_CHAOS_INTER_CHUNK_DELAY_MAX', '50'],
  ['JSHOOK_IO_CONCURRENCY', '4'],
  ['JSHOOK_CPU_CONCURRENCY', '2'],
  ['JSHOOK_CDP_CONCURRENCY', '2'],
  ['SEARCH_VECTOR_WORKER_IDLE_MS', '15000'],
]);

const allowedRawProcessEnvironment = new Set([
  'src/modules/binary-instrument/GhidraAnalyzer.ts:HOME',
  'src/modules/binary-instrument/GhidraAnalyzer.ts:ProgramFiles',
  'src/modules/binary-instrument/GhidraAnalyzer.ts:ProgramFiles(x86)',
  'src/modules/binary-instrument/GhidraAnalyzer.ts:USERPROFILE',
  'src/modules/binary-instrument/UnidbgRunner.ts:JAVA_HOME',
  'src/modules/boringssl-inspector/TLSKeyLogExtractor.ts:SSLKEYLOGFILE',
  'src/modules/collector/CodeCollectorConnectionInternal.ts:LOCALAPPDATA',
  'src/modules/collector/CodeCollectorConnectionInternal.ts:XDG_CONFIG_HOME',
  'src/modules/external/ExternalToolRunner.ts:<dynamic>',
  'src/modules/external/ExternalToolRunner.ts:PATH',
  'src/modules/external/ExternalToolRunner.ts:SYSTEMROOT',
  'src/modules/external/ExternalToolRunner.ts:SystemRoot',
  'src/modules/external/ExternalToolRunner.ts:TEMP',
  'src/modules/external/ExternalToolRunner.ts:TMP',
  'src/modules/external/ExternalToolRunner.ts:WINDIR',
  'src/modules/process/memory/AuditTrail.ts:USER',
  'src/modules/process/memory/AuditTrail.ts:USERNAME',
  'src/native/syscall/AntiAnalysis.ts:ELECTRON_RUN_AS_NODE',
  'src/native/syscall/AntiAnalysis.ts:NODE_OPTIONS',
  'src/native/syscall/AntiAnalysis.ts:VSCODE_INSPECTOR_OPTIONS',
  'src/native/syscall/ProcessMasquerade.ts:<dynamic>',
  'src/native/syscall/SelfDefense.ts:<all>',
  'src/native/syscall/SyscallResolver.ts:SystemRoot',
  'src/native/syscall/SyscallResolver.ts:WINDIR',
  'src/server/MCPServer.metrics.ts:E2E_COLLECT_PERFORMANCE',
  'src/server/domains/maintenance/handlers/extension-registry-utils.ts:<all>',
  'src/server/domains/platform/handlers/electron-dual-cdp.ts:<all>',
  'src/server/domains/platform/handlers/platform-utils.ts:APPDATA',
  'src/server/domains/platform/handlers/platform-utils.ts:USERPROFILE',
  'src/server/domains/proxy/handlers.impl.ts:HOME',
  'src/server/domains/proxy/handlers.impl.ts:USERPROFILE',
  'src/server/domains/syscall-hook/handlers.impl.ts:NODE_ENV',
  'src/server/domains/syscall-hook/handlers.impl.ts:VITEST',
  'src/server/domains/syscall-hook/handlers/ebpf-attach.ts:<all>',
  'src/utils/outputPaths.ts:TEMP',
  'src/utils/outputPaths.ts:TMP',
  'src/utils/packageVersion.ts:npm_package_version',
]);

function parseExample(source: string): EnvExampleEntry[] {
  return source.split(/\r?\n/u).flatMap((line, index) => {
    const match = line.match(/^\s*(?:#\s*)?([A-Z][A-Z0-9_]*)=(.*)$/u);
    return match ? [{ key: match[1]!, rawValue: match[2]!.trim(), line: index + 1 }] : [];
  });
}

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

function configEnvironmentKeys(source: string): Set<string> {
  const schemaMatch = source.match(/const ConfigSchema = z\.object\(\{([\s\S]*?)^\}\);/mu);
  expect(schemaMatch, 'ConfigSchema must remain statically discoverable').not.toBeNull();

  const keys = new Set<string>();
  for (const match of schemaMatch![1]!.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gmu)) {
    keys.add(match[1]!);
  }
  for (const match of source.matchAll(/(?:process\.)?env\.([A-Z][A-Z0-9_]*)/gu)) {
    keys.add(match[1]!);
  }
  for (const match of source.matchAll(/parseJsonArrayEnv\('([A-Z][A-Z0-9_]*)'\)/gu)) {
    keys.add(match[1]!);
  }

  // Process/package-manager markers are not application settings.
  keys.delete('NPX_CACHE');
  keys.delete('NODE_ENV');
  return keys;
}

function staticReaderEnvironmentKeys(source: string): Set<string> {
  const keys = new Set<string>();
  const readerCall =
    /(?<![\w.])(?:autoInt|bool|csv|float|int|list|str|readEnv(?:AutoInteger|Boolean|Csv|Float|Integer(?:List)?|NullableString|String))\(\s*(['"])([A-Z][A-Z0-9_]*)\1/gu;

  for (const match of source.matchAll(readerCall)) keys.add(match[2]!);

  // NODE_ENV controls platform/runtime behavior and is supplied by Node or the
  // process manager. It must not be advertised as an application override.
  keys.delete('NODE_ENV');
  return keys;
}

function withoutInlineComment(rawValue: string): string {
  return rawValue.replace(/\s+#.*$/u, '').trim();
}

function expectedPrimitive(rawValue: string, actual: string | number | boolean): typeof actual {
  const value = withoutInlineComment(rawValue).replace(/^(?:"(.*)"|'(.*)')$/u, '$1$2');
  if (typeof actual === 'number') return Number(value);
  if (typeof actual === 'boolean') return (value === 'true') as typeof actual;
  return value;
}

function normalizedExampleValue(rawValue: string): string {
  return withoutInlineComment(rawValue).replace(/^(?:"(.*)"|'(.*)')$/u, '$1$2');
}

const entries = parseExample(exampleSource);
const entryKeys = new Set(entries.map((entry) => entry.key));

describe('.env.example runtime contract', () => {
  it('contains each key exactly once', () => {
    const firstLineByKey = new Map<string, number>();
    const duplicates: string[] = [];

    for (const entry of entries) {
      const firstLine = firstLineByKey.get(entry.key);
      if (firstLine === undefined) {
        firstLineByKey.set(entry.key, entry.line);
      } else {
        duplicates.push(`${entry.key} (lines ${firstLine}, ${entry.line})`);
      }
    }

    expect(duplicates).toEqual([]);
  });

  it('covers central config and every statically named typed environment reader', () => {
    const typedReaders = collectTypedEnvironmentReaders(sourcePaths, projectRoot);
    const dynamicKeys = [...dynamicReaderContracts.values()].flat();
    const supportedKeys = new Set([
      ...configEnvironmentKeys(configSource),
      ...staticReaderEnvironmentKeys(srcCorpus),
      ...dynamicKeys,
    ]);
    const missing = [...supportedKeys].filter((key) => !entryKeys.has(key)).toSorted();

    expect(missing).toEqual([]);

    const dynamicReaders = new Set(
      typedReaders.dynamic.map(({ argument, file, reader }) => `${file}:${reader}:${argument}`),
    );
    expect([...dynamicReaders].toSorted()).toEqual([...dynamicReaderContracts.keys()].toSorted());
  });

  it('keeps statically evaluable runtime defaults aligned with the template', () => {
    const { defaults } = collectTypedEnvironmentReaders(sourcePaths, projectRoot);
    const centralDefaults = collectCentralConfigDefaults(configPath, projectRoot);
    const grouped = new Map<string, (typeof defaults)[number][]>();
    for (const row of [...defaults, ...centralDefaults]) {
      const rows = grouped.get(row.key) ?? [];
      rows.push(row);
      grouped.set(row.key, rows);
    }
    const templateValues = new Map(
      entries.map(({ key, rawValue }) => [key, normalizedExampleValue(rawValue)]),
    );
    const mismatches: string[] = [];
    const conflicts: string[] = [];
    let compared = 0;

    for (const [key, rows] of grouped) {
      if (key === 'NODE_ENV') continue;
      const central = rows.filter(({ reader }) => reader === 'ConfigSchema');
      const candidates = central.length > 0 ? central : rows.filter(({ nullable }) => !nullable);
      const resolved = new Set(
        candidates.flatMap(({ value }) => (value === undefined ? [] : [value])),
      );
      const contextualDefault = contextualTypedDefaults.get(key);
      if (resolved.size === 0 && contextualDefault !== undefined) resolved.add(contextualDefault);
      if (resolved.size === 0) continue;

      compared += 1;
      if (resolved.size > 1) {
        conflicts.push(`${key}: ${[...resolved].join(' | ')}`);
        continue;
      }
      const expected = [...resolved][0]!;
      const actual = templateValues.get(key);
      if (actual !== expected)
        mismatches.push(`${key}: template=${actual ?? '<missing>'} runtime=${expected}`);
    }

    expect(conflicts).toEqual([]);
    expect(mismatches).toEqual([]);
    expect(compared).toBeGreaterThan(600);
  });

  it('contains only runtime-consumed application keys', () => {
    const unused = [...entryKeys].filter((key) => !srcCorpus.includes(key)).toSorted();

    expect(unused).toEqual([]);
  });

  it('does not advertise obsolete, test-runner, CI, or operating-system keys', () => {
    const obsolete = new Set([
      'BURP_MCP_AUTH_TOKEN',
      'WASM_HANDLER_DEFAULT_TIMEOUT_MS',
      'WASM_OPTIMIZE_DEFAULT_TIMEOUT_MS',
      'ZAP_API_KEY',
      'ZAP_API_URL',
    ]);
    const processOwned = new Set(['HOME', 'NODE_ENV', 'PATH', 'TEMP', 'TMP', 'USERPROFILE']);
    const forbidden = [...entryKeys]
      .filter(
        (key) =>
          obsolete.has(key) || processOwned.has(key) || /^(?:CI|E2E_|GITHUB_|VITEST_)/u.test(key),
      )
      .toSorted();

    expect(forbidden).toEqual([]);
  });

  it('keeps documented search and rerank defaults aligned with runtime defaults', async () => {
    const candidates = entries.filter(
      ({ key, rawValue }) =>
        /^(?:SEARCH_|RERANK_)/u.test(key) && withoutInlineComment(rawValue).length > 0,
    );
    const controlledKeys = new Set([...candidates.map(({ key }) => key), 'MCP_TRANSPORT']);
    const originals = new Map([...controlledKeys].map((key) => [key, process.env[key]]));

    try {
      for (const key of controlledKeys) process.env[key] = '';
      process.env.MCP_TRANSPORT = 'stdio';
      vi.resetModules();

      const runtime = (await import('@src/constants/search')) as unknown as Record<string, unknown>;
      let compared = 0;

      for (const { key, rawValue } of candidates) {
        const actual = runtime[key];
        if (
          typeof actual !== 'string' &&
          typeof actual !== 'number' &&
          typeof actual !== 'boolean'
        ) {
          continue;
        }
        compared += 1;
        expect(actual, key).toBe(expectedPrimitive(rawValue, actual));
      }

      expect(compared).toBeGreaterThan(35);
    } finally {
      for (const [key, value] of originals) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      vi.resetModules();
    }
  });

  it('routes constant-layer environment access through the config layer', () => {
    const directReaders = collectTypeScriptFiles(join(projectRoot, 'src/constants'))
      .filter((path) => readFileSync(path, 'utf8').includes('process.env'))
      .map((path) => path.slice(projectRoot.length + 1).replaceAll('\\', '/'));

    expect(directReaders).toEqual([]);
  });

  it('keeps raw process.env access at configuration and explicit runtime boundaries', () => {
    const accesses = new Set(
      collectProcessEnvironmentAccesses(sourcePaths, projectRoot).map(
        ({ file, key }) => `${file}:${key}`,
      ),
    );
    const unexpected = [...accesses]
      .filter(
        (access) =>
          !access.startsWith('src/config/') &&
          !access.startsWith('src/utils/config.ts:') &&
          !allowedRawProcessEnvironment.has(access),
      )
      .toSorted();
    const staleExceptions = [...allowedRawProcessEnvironment]
      .filter((access) => !accesses.has(access))
      .toSorted();

    expect(unexpected).toEqual([]);
    expect(staleExceptions).toEqual([]);
  });
});
