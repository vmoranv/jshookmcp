import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';
import { DEFAULT_SEARCH_CONFIG } from '@src/config/search-defaults';
import { getPackageVersion } from './packageVersion';
import type {
  Config,
  ReverseEngineeringConfig,
  SearchCjkQueryAliasConfig,
  SearchConfig,
  SearchIntentToolBoostRuleConfig,
  SearchQueryCategoryProfileConfig,
} from '@internal-types/index';

export const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * True when the package is loaded from a global npm prefix (npx / npm install -g)
 * rather than a local node_modules. We use this to redirect writable paths (screenshots,
 * artifacts, etc.) to the user's cwd instead of the immutable install cache.
 */
export function isNpxContext(): boolean {
  // Common npm-prefix markers:
  if (process.env.NPX_CACHE || process.env.npm_config_prefix) return true;
  const cwd = process.cwd();
  // If projectRoot is not under cwd, we're almost certainly running via npx/global install
  // (local node_modules/ would put the package inside cwd or a parent of cwd).
  const rel = normalize(relative(cwd, projectRoot));
  return rel === '' || rel.startsWith('..') || isAbsolute(rel);
}

function getWritableBaseDir(): string {
  return isNpxContext() ? process.cwd() : projectRoot;
}

// Resolve .env relative to the package root — works in both dev (tsx src/utils/config.ts)
// and production (bundled dist/*.mjs). Env vars always take precedence.
function resolvePackageEnv(): string {
  const candidates = [
    fileURLToPath(new URL('../../.env', import.meta.url)), // dev: src/utils/ → root
    fileURLToPath(new URL('../.env', import.meta.url)), // prod: dist/ → root
    fileURLToPath(new URL('.env', import.meta.url)), // same dir fallback
    join(process.cwd(), '.env'), // cwd
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalize(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (existsSync(normalized)) return normalized;
  }
  // Default to the dev-mode path even if it doesn't exist (dotenv will handle ENOENT)
  return candidates[0] ?? fileURLToPath(new URL('../../.env', import.meta.url));
}

const envPath = resolvePackageEnv();
let envLoaded = false;

const CONFIG_DEFAULTS = {
  puppeteer: {
    headless: false,
    timeout: 30000,
  },
  mcp: {
    name: 'jshookmcp',
    version: getPackageVersion(import.meta.url),
  },
  cache: {
    enabled: false,
    dir: '.cache',
    ttl: 3600,
  },
  paths: {
    screenshotDir: 'screenshots',
    captchaScreenshotDir: 'screenshots/captcha',
    debuggerSessionsDir: 'debugger-sessions',
    extensionRegistryDir: 'artifacts/extension-registry',
    tlsKeyLogDir: 'artifacts/tmp',
    registryCacheDir: '.jshookmcp/cache',
  },
  performance: {
    maxConcurrentAnalysis: 3,
    maxCodeSizeMB: 10,
  },
  reverseEngineering: {
    transformWorkbench: {
      defaultPreviewBytes: 128,
      maxPreviewBytes: 4096,
      textSampleBytes: 4096,
      maxInputBytes: 16 * 1024 * 1024,
      maxOutputBytes: 32 * 1024 * 1024,
      maxSteps: 32,
    },
    reverseSession: {
      maxInlineTransformInputBytes: 16 * 1024 * 1024,
      promotedTransformPreviewBytes: 256,
      runMaxSteps: 50,
      evidenceRefSegmentMaxChars: 96,
    },
    binaryMagic: {
      hintPrefixMaxBytes: 64,
      dexMagicAscii: 'dex\n',
      compactDexMagicAscii: 'cdex',
    },
    nativeEmulator: {
      cstringDefaultLimitBytes: 1 << 20,
      cstringReadChunkBytes: 4096,
      guestPageSizeBytes: 4096,
      syscallCStringLimitBytes: 4096,
      rawMemoryMaxBytes: 16 * 1024 * 1024,
      rawMemoryPreviewBytes: 4096,
    },
    apk: {
      staticTriageMinEntries: 100,
      staticTriageDefaultEntries: 2_000,
      staticTriageMaxEntries: 20_000,
      staticTriageAssetHintLimit: 200,
      staticTriageNativeLibLimit: 300,
      dexIntakeDefaultDexFiles: 100,
      dexIntakeMaxDexFiles: 500,
      dexIntakeManifestTextSampleBytes: 1024,
      dexIntakeManifestControlByteRatio: 0.1,
      dexIntakeComponentLimit: 500,
      dexIntakeFeatureLimit: 200,
      dexIntakeUniqueLimitDefault: 200,
    },
    dex: {
      scanDefaultMaxHits: 50,
      scanMaxHits: 500,
      scanMaxExtractBytes: 512 * 1024 * 1024,
      artifactDefaultLimit: 500,
      artifactMaxLimit: 5000,
      artifactMinReadBytes: 128,
      artifactDefaultMaxFileBytes: 16 * 1024 * 1024,
      artifactDefaultMaxTotalBytes: 64 * 1024 * 1024,
      artifactMaxReadBytes: 256 * 1024 * 1024,
      stringScanMaxBytes: 4096,
    },
    frida: {
      dexDumpTimeoutMs: 180_000,
      dexDumpMaxBufferBytes: 16 * 1024 * 1024,
      dexDumpFileLimit: 500,
    },
    androidRuntime: {
      mapsMaxBytes: 4 * 1024 * 1024,
      mapsModuleLimit: 1000,
    },
  } satisfies ReverseEngineeringConfig,
} as const;

function loadEnvIfNeeded(): void {
  if (envLoaded) {
    return;
  }
  envLoaded = true;

  const result = dotenvConfig({ path: envPath, quiet: true });
  const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;

  if (result.error) {
    if (errorCode !== 'ENOENT') {
      console.error(`[Config] Warning: Failed to load .env from "${envPath}"`);
      console.error(`[Config] Error: ${result.error.message}`);
      console.error('[Config] Will use environment variables or defaults');
    }
  } else if (process.env.DEBUG === 'true') {
    console.info(`[Config] .env file loaded from "${envPath}" (debug mode)`);
  }
}

// ── Zod schemas for environment-based config ──

const envInt = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : fallback))
    .pipe(z.number().int().finite());

const envBool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true'));

const envFloat = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? Number.parseFloat(v) : fallback))
    .pipe(z.number().finite());

function resolveConfigPath(inputPath: string, baseDir: string): string {
  return normalize(isAbsolute(inputPath) ? inputPath : resolve(baseDir, inputPath));
}

const ConfigSchema = z.object({
  // Puppeteer
  PUPPETEER_HEADLESS: envBool(CONFIG_DEFAULTS.puppeteer.headless),
  PUPPETEER_TIMEOUT: envInt(CONFIG_DEFAULTS.puppeteer.timeout).pipe(
    z.number().min(1000).max(300000),
  ),
  PUPPETEER_EXECUTABLE_PATH: z.string().optional(),
  CHROME_PATH: z.string().optional(),
  BROWSER_EXECUTABLE_PATH: z.string().optional(),

  // MCP
  MCP_SERVER_NAME: z.string().optional().default(CONFIG_DEFAULTS.mcp.name),
  MCP_SERVER_VERSION: z.string().optional().default(CONFIG_DEFAULTS.mcp.version),

  // Cache
  ENABLE_CACHE: envBool(CONFIG_DEFAULTS.cache.enabled),
  CACHE_DIR: z.string().optional().default(CONFIG_DEFAULTS.cache.dir),
  CACHE_TTL: envInt(CONFIG_DEFAULTS.cache.ttl).pipe(z.number().min(0)),

  // Paths
  MCP_SCREENSHOT_DIR: z.string().optional().default(CONFIG_DEFAULTS.paths.screenshotDir),
  CAPTCHA_SCREENSHOT_DIR: z.string().optional().default(CONFIG_DEFAULTS.paths.captchaScreenshotDir),
  MCP_DEBUGGER_SESSIONS_DIR: z
    .string()
    .optional()
    .default(CONFIG_DEFAULTS.paths.debuggerSessionsDir),
  MCP_EXTENSION_REGISTRY_DIR: z
    .string()
    .optional()
    .default(CONFIG_DEFAULTS.paths.extensionRegistryDir),
  MCP_TLS_KEYLOG_DIR: z.string().optional().default(CONFIG_DEFAULTS.paths.tlsKeyLogDir),
  MCP_REGISTRY_CACHE_DIR: z.string().optional().default(CONFIG_DEFAULTS.paths.registryCacheDir),

  // Performance
  MAX_CONCURRENT_ANALYSIS: envInt(CONFIG_DEFAULTS.performance.maxConcurrentAnalysis).pipe(
    z.number().min(1).max(32),
  ),
  MAX_CODE_SIZE_MB: envInt(CONFIG_DEFAULTS.performance.maxCodeSizeMB).pipe(
    z.number().min(1).max(500),
  ),

  // Reverse engineering runtime limits
  TRANSFORM_WORKBENCH_DEFAULT_PREVIEW_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.transformWorkbench.defaultPreviewBytes,
  ).pipe(z.number().min(1)),
  TRANSFORM_WORKBENCH_MAX_PREVIEW_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.transformWorkbench.maxPreviewBytes,
  ).pipe(z.number().min(1)),
  TRANSFORM_WORKBENCH_TEXT_SAMPLE_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.transformWorkbench.textSampleBytes,
  ).pipe(z.number().min(1)),
  TRANSFORM_WORKBENCH_MAX_INPUT_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.transformWorkbench.maxInputBytes,
  ).pipe(z.number().min(1)),
  TRANSFORM_WORKBENCH_MAX_OUTPUT_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.transformWorkbench.maxOutputBytes,
  ).pipe(z.number().min(1)),
  TRANSFORM_WORKBENCH_MAX_STEPS: envInt(
    CONFIG_DEFAULTS.reverseEngineering.transformWorkbench.maxSteps,
  ).pipe(z.number().min(1)),
  REVERSE_SESSION_MAX_INLINE_TRANSFORM_INPUT_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.reverseSession.maxInlineTransformInputBytes,
  ).pipe(z.number().min(1)),
  REVERSE_SESSION_PROMOTED_TRANSFORM_PREVIEW_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.reverseSession.promotedTransformPreviewBytes,
  ).pipe(z.number().min(1)),
  REVERSE_SESSION_RUN_MAX_STEPS: envInt(
    CONFIG_DEFAULTS.reverseEngineering.reverseSession.runMaxSteps,
  ).pipe(z.number().min(1)),
  REVERSE_SESSION_EVIDENCE_REF_SEGMENT_MAX_CHARS: envInt(
    CONFIG_DEFAULTS.reverseEngineering.reverseSession.evidenceRefSegmentMaxChars,
  ).pipe(z.number().min(1)),
  BINARY_MAGIC_HINT_PREFIX_MAX_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.binaryMagic.hintPrefixMaxBytes,
  ).pipe(z.number().min(1)),
  DEX_MAGIC_ASCII: z
    .string()
    .optional()
    .default(CONFIG_DEFAULTS.reverseEngineering.binaryMagic.dexMagicAscii),
  CDEX_MAGIC_ASCII: z
    .string()
    .optional()
    .default(CONFIG_DEFAULTS.reverseEngineering.binaryMagic.compactDexMagicAscii),
  NEMU_CSTRING_DEFAULT_LIMIT_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.nativeEmulator.cstringDefaultLimitBytes,
  ).pipe(z.number().min(1)),
  NEMU_CSTRING_READ_CHUNK_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.nativeEmulator.cstringReadChunkBytes,
  ).pipe(z.number().min(1)),
  NEMU_GUEST_PAGE_SIZE_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.nativeEmulator.guestPageSizeBytes,
  ).pipe(z.number().min(1)),
  NEMU_SYSCALL_CSTRING_LIMIT_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.nativeEmulator.syscallCStringLimitBytes,
  ).pipe(z.number().min(1)),
  NEMU_RAW_MEMORY_MAX_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.nativeEmulator.rawMemoryMaxBytes,
  ).pipe(z.number().min(1)),
  NEMU_RAW_MEMORY_PREVIEW_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.nativeEmulator.rawMemoryPreviewBytes,
  ).pipe(z.number().min(1)),
  APK_STATIC_TRIAGE_MIN_ENTRIES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.staticTriageMinEntries,
  ).pipe(z.number().min(1)),
  APK_STATIC_TRIAGE_DEFAULT_ENTRIES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.staticTriageDefaultEntries,
  ).pipe(z.number().min(1)),
  APK_STATIC_TRIAGE_MAX_ENTRIES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.staticTriageMaxEntries,
  ).pipe(z.number().min(1)),
  APK_STATIC_TRIAGE_ASSET_HINT_LIMIT: envInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.staticTriageAssetHintLimit,
  ).pipe(z.number().min(1)),
  APK_STATIC_TRIAGE_NATIVE_LIB_LIMIT: envInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.staticTriageNativeLibLimit,
  ).pipe(z.number().min(1)),
  APK_DEX_INTAKE_DEFAULT_DEX_FILES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.dexIntakeDefaultDexFiles,
  ).pipe(z.number().min(1)),
  APK_DEX_INTAKE_MAX_DEX_FILES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.dexIntakeMaxDexFiles,
  ).pipe(z.number().min(1)),
  APK_DEX_INTAKE_MANIFEST_TEXT_SAMPLE_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.dexIntakeManifestTextSampleBytes,
  ).pipe(z.number().min(1)),
  APK_DEX_INTAKE_MANIFEST_CONTROL_BYTE_RATIO: envFloat(
    CONFIG_DEFAULTS.reverseEngineering.apk.dexIntakeManifestControlByteRatio,
  ).pipe(z.number().min(0).max(1)),
  APK_DEX_INTAKE_COMPONENT_LIMIT: envInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.dexIntakeComponentLimit,
  ).pipe(z.number().min(1)),
  APK_DEX_INTAKE_FEATURE_LIMIT: envInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.dexIntakeFeatureLimit,
  ).pipe(z.number().min(1)),
  APK_DEX_INTAKE_UNIQUE_LIMIT_DEFAULT: envInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.dexIntakeUniqueLimitDefault,
  ).pipe(z.number().min(1)),
  DEX_SCAN_DEFAULT_MAX_HITS: envInt(CONFIG_DEFAULTS.reverseEngineering.dex.scanDefaultMaxHits).pipe(
    z.number().min(1),
  ),
  DEX_SCAN_MAX_HITS: envInt(CONFIG_DEFAULTS.reverseEngineering.dex.scanMaxHits).pipe(
    z.number().min(1),
  ),
  DEX_SCAN_MAX_EXTRACT_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.dex.scanMaxExtractBytes,
  ).pipe(z.number().min(1)),
  DEX_ARTIFACT_DEFAULT_LIMIT: envInt(
    CONFIG_DEFAULTS.reverseEngineering.dex.artifactDefaultLimit,
  ).pipe(z.number().min(1)),
  DEX_ARTIFACT_MAX_LIMIT: envInt(CONFIG_DEFAULTS.reverseEngineering.dex.artifactMaxLimit).pipe(
    z.number().min(1),
  ),
  DEX_ARTIFACT_MIN_READ_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.dex.artifactMinReadBytes,
  ).pipe(z.number().min(1)),
  DEX_ARTIFACT_DEFAULT_MAX_FILE_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.dex.artifactDefaultMaxFileBytes,
  ).pipe(z.number().min(1)),
  DEX_ARTIFACT_DEFAULT_MAX_TOTAL_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.dex.artifactDefaultMaxTotalBytes,
  ).pipe(z.number().min(1)),
  DEX_ARTIFACT_MAX_READ_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.dex.artifactMaxReadBytes,
  ).pipe(z.number().min(1)),
  DEX_STRING_SCAN_MAX_BYTES: envInt(CONFIG_DEFAULTS.reverseEngineering.dex.stringScanMaxBytes).pipe(
    z.number().min(1),
  ),
  FRIDA_DEX_DUMP_TIMEOUT_MS: envInt(CONFIG_DEFAULTS.reverseEngineering.frida.dexDumpTimeoutMs).pipe(
    z.number().min(1),
  ),
  FRIDA_DEX_DUMP_MAX_BUFFER_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.frida.dexDumpMaxBufferBytes,
  ).pipe(z.number().min(1)),
  FRIDA_DEX_DUMP_FILE_LIMIT: envInt(CONFIG_DEFAULTS.reverseEngineering.frida.dexDumpFileLimit).pipe(
    z.number().min(1),
  ),
  ANDROID_RUNTIME_MAPS_MAX_BYTES: envInt(
    CONFIG_DEFAULTS.reverseEngineering.androidRuntime.mapsMaxBytes,
  ).pipe(z.number().min(1)),
  ANDROID_RUNTIME_MAPS_MODULE_LIMIT: envInt(
    CONFIG_DEFAULTS.reverseEngineering.androidRuntime.mapsModuleLimit,
  ).pipe(z.number().min(1)),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonArrayEnv(key: string): unknown[] | undefined {
  const raw = process.env[key];
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseSearchQueryCategoryProfiles(): SearchQueryCategoryProfileConfig[] | undefined {
  const parsed = parseJsonArrayEnv('SEARCH_QUERY_CATEGORY_PROFILES_JSON');
  if (parsed === undefined) {
    return undefined;
  }

  return parsed.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.pattern !== 'string' ||
      !Array.isArray(entry.domainBoosts)
    ) {
      return [];
    }

    const domainBoosts = entry.domainBoosts.flatMap((boost) => {
      if (
        !isRecord(boost) ||
        typeof boost.domain !== 'string' ||
        typeof boost.weight !== 'number'
      ) {
        return [];
      }
      return [{ domain: boost.domain, weight: boost.weight }];
    });

    return [
      {
        pattern: entry.pattern,
        flags: typeof entry.flags === 'string' ? entry.flags : undefined,
        domainBoosts,
      },
    ];
  });
}

function parseCjkQueryAliases(): SearchCjkQueryAliasConfig[] | undefined {
  const parsed = parseJsonArrayEnv('SEARCH_CJK_QUERY_ALIASES_JSON');
  if (parsed === undefined) {
    return undefined;
  }

  return parsed.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.pattern !== 'string' || !Array.isArray(entry.tokens)) {
      return [];
    }

    const tokens = entry.tokens.filter((token): token is string => typeof token === 'string');
    return [
      {
        pattern: entry.pattern,
        flags: typeof entry.flags === 'string' ? entry.flags : undefined,
        tokens,
      },
    ];
  });
}

function parseIntentToolBoostRules(): SearchIntentToolBoostRuleConfig[] | undefined {
  const parsed = parseJsonArrayEnv('SEARCH_INTENT_TOOL_BOOST_RULES_JSON');
  if (parsed === undefined) {
    return undefined;
  }

  return parsed.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.pattern !== 'string' || !Array.isArray(entry.boosts)) {
      return [];
    }

    const boosts = entry.boosts.flatMap((boost) => {
      if (!isRecord(boost) || typeof boost.tool !== 'string' || typeof boost.bonus !== 'number') {
        return [];
      }
      return [{ tool: boost.tool, bonus: boost.bonus }];
    });

    return [
      {
        pattern: entry.pattern,
        flags: typeof entry.flags === 'string' ? entry.flags : undefined,
        boosts,
      },
    ];
  });
}

function cloneSearchConfig(search: SearchConfig): SearchConfig {
  return {
    queryCategoryProfiles: search.queryCategoryProfiles.map((profile) => ({
      pattern: profile.pattern,
      flags: profile.flags,
      domainBoosts: profile.domainBoosts.map((boost) => ({
        domain: boost.domain,
        weight: boost.weight,
      })),
    })),
    cjkQueryAliases: search.cjkQueryAliases.map((alias) => ({
      pattern: alias.pattern,
      flags: alias.flags,
      tokens: [...alias.tokens],
    })),
    intentToolBoostRules: search.intentToolBoostRules.map((rule) => ({
      pattern: rule.pattern,
      flags: rule.flags,
      boosts: rule.boosts.map((boost) => ({
        tool: boost.tool,
        bonus: boost.bonus,
      })),
    })),
    vectorEnabled: search.vectorEnabled,
    vectorModelId: search.vectorModelId,
    vectorCosineWeight: search.vectorCosineWeight,
    vectorDynamicWeight: search.vectorDynamicWeight,
  };
}

function buildSearchConfig(): SearchConfig {
  const defaults = cloneSearchConfig(DEFAULT_SEARCH_CONFIG);
  const httpTransport = process.env.MCP_TRANSPORT?.trim().toLowerCase() === 'http';

  return {
    queryCategoryProfiles: parseSearchQueryCategoryProfiles() ?? defaults.queryCategoryProfiles,
    cjkQueryAliases: parseCjkQueryAliases() ?? defaults.cjkQueryAliases,
    intentToolBoostRules: parseIntentToolBoostRules() ?? defaults.intentToolBoostRules,
    vectorEnabled: coerceBooleanEnv(process.env.SEARCH_VECTOR_ENABLED, httpTransport),
    vectorModelId: stringEnv(
      process.env.SEARCH_VECTOR_MODEL_ID,
      defaults.vectorModelId ?? 'Xenova/bge-micro-v2',
    ),
    vectorCosineWeight: coerceFloatEnv(
      process.env.SEARCH_VECTOR_COSINE_WEIGHT,
      defaults.vectorCosineWeight ?? 0.53,
    ),
    vectorDynamicWeight: coerceBooleanEnv(
      process.env.SEARCH_VECTOR_DYNAMIC_WEIGHT,
      defaults.vectorDynamicWeight ?? true,
    ),
  };
}

function positiveIntegerEnv(value: unknown, fallback: number): number {
  return Math.max(1, coerceIntegerEnv(value, fallback));
}

function ratioEnv(value: unknown, fallback: number): number {
  return Math.max(0, Math.min(coerceFloatEnv(value, fallback), 1));
}

function stringEnv(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function coerceBooleanEnv(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value === 'true';
  }
  return fallback;
}

function coerceIntegerEnv(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function coerceFloatEnv(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function buildReverseEngineeringConfig(env: Record<string, unknown>): ReverseEngineeringConfig {
  const defaults = CONFIG_DEFAULTS.reverseEngineering;
  return {
    transformWorkbench: {
      defaultPreviewBytes: positiveIntegerEnv(
        env.TRANSFORM_WORKBENCH_DEFAULT_PREVIEW_BYTES,
        defaults.transformWorkbench.defaultPreviewBytes,
      ),
      maxPreviewBytes: positiveIntegerEnv(
        env.TRANSFORM_WORKBENCH_MAX_PREVIEW_BYTES,
        defaults.transformWorkbench.maxPreviewBytes,
      ),
      textSampleBytes: positiveIntegerEnv(
        env.TRANSFORM_WORKBENCH_TEXT_SAMPLE_BYTES,
        defaults.transformWorkbench.textSampleBytes,
      ),
      maxInputBytes: positiveIntegerEnv(
        env.TRANSFORM_WORKBENCH_MAX_INPUT_BYTES,
        defaults.transformWorkbench.maxInputBytes,
      ),
      maxOutputBytes: positiveIntegerEnv(
        env.TRANSFORM_WORKBENCH_MAX_OUTPUT_BYTES,
        defaults.transformWorkbench.maxOutputBytes,
      ),
      maxSteps: positiveIntegerEnv(
        env.TRANSFORM_WORKBENCH_MAX_STEPS,
        defaults.transformWorkbench.maxSteps,
      ),
    },
    reverseSession: {
      maxInlineTransformInputBytes: positiveIntegerEnv(
        env.REVERSE_SESSION_MAX_INLINE_TRANSFORM_INPUT_BYTES,
        defaults.reverseSession.maxInlineTransformInputBytes,
      ),
      promotedTransformPreviewBytes: positiveIntegerEnv(
        env.REVERSE_SESSION_PROMOTED_TRANSFORM_PREVIEW_BYTES,
        defaults.reverseSession.promotedTransformPreviewBytes,
      ),
      runMaxSteps: positiveIntegerEnv(
        env.REVERSE_SESSION_RUN_MAX_STEPS,
        defaults.reverseSession.runMaxSteps,
      ),
      evidenceRefSegmentMaxChars: positiveIntegerEnv(
        env.REVERSE_SESSION_EVIDENCE_REF_SEGMENT_MAX_CHARS,
        defaults.reverseSession.evidenceRefSegmentMaxChars,
      ),
    },
    binaryMagic: {
      hintPrefixMaxBytes: positiveIntegerEnv(
        env.BINARY_MAGIC_HINT_PREFIX_MAX_BYTES,
        defaults.binaryMagic.hintPrefixMaxBytes,
      ),
      dexMagicAscii: stringEnv(env.DEX_MAGIC_ASCII, defaults.binaryMagic.dexMagicAscii),
      compactDexMagicAscii: stringEnv(
        env.CDEX_MAGIC_ASCII,
        defaults.binaryMagic.compactDexMagicAscii,
      ),
    },
    nativeEmulator: {
      cstringDefaultLimitBytes: positiveIntegerEnv(
        env.NEMU_CSTRING_DEFAULT_LIMIT_BYTES,
        defaults.nativeEmulator.cstringDefaultLimitBytes,
      ),
      cstringReadChunkBytes: positiveIntegerEnv(
        env.NEMU_CSTRING_READ_CHUNK_BYTES,
        defaults.nativeEmulator.cstringReadChunkBytes,
      ),
      guestPageSizeBytes: positiveIntegerEnv(
        env.NEMU_GUEST_PAGE_SIZE_BYTES,
        defaults.nativeEmulator.guestPageSizeBytes,
      ),
      syscallCStringLimitBytes: positiveIntegerEnv(
        env.NEMU_SYSCALL_CSTRING_LIMIT_BYTES,
        defaults.nativeEmulator.syscallCStringLimitBytes,
      ),
      rawMemoryMaxBytes: positiveIntegerEnv(
        env.NEMU_RAW_MEMORY_MAX_BYTES,
        defaults.nativeEmulator.rawMemoryMaxBytes,
      ),
      rawMemoryPreviewBytes: positiveIntegerEnv(
        env.NEMU_RAW_MEMORY_PREVIEW_BYTES,
        defaults.nativeEmulator.rawMemoryPreviewBytes,
      ),
    },
    apk: {
      staticTriageMinEntries: positiveIntegerEnv(
        env.APK_STATIC_TRIAGE_MIN_ENTRIES,
        defaults.apk.staticTriageMinEntries,
      ),
      staticTriageDefaultEntries: positiveIntegerEnv(
        env.APK_STATIC_TRIAGE_DEFAULT_ENTRIES,
        defaults.apk.staticTriageDefaultEntries,
      ),
      staticTriageMaxEntries: positiveIntegerEnv(
        env.APK_STATIC_TRIAGE_MAX_ENTRIES,
        defaults.apk.staticTriageMaxEntries,
      ),
      staticTriageAssetHintLimit: positiveIntegerEnv(
        env.APK_STATIC_TRIAGE_ASSET_HINT_LIMIT,
        defaults.apk.staticTriageAssetHintLimit,
      ),
      staticTriageNativeLibLimit: positiveIntegerEnv(
        env.APK_STATIC_TRIAGE_NATIVE_LIB_LIMIT,
        defaults.apk.staticTriageNativeLibLimit,
      ),
      dexIntakeDefaultDexFiles: positiveIntegerEnv(
        env.APK_DEX_INTAKE_DEFAULT_DEX_FILES,
        defaults.apk.dexIntakeDefaultDexFiles,
      ),
      dexIntakeMaxDexFiles: positiveIntegerEnv(
        env.APK_DEX_INTAKE_MAX_DEX_FILES,
        defaults.apk.dexIntakeMaxDexFiles,
      ),
      dexIntakeManifestTextSampleBytes: positiveIntegerEnv(
        env.APK_DEX_INTAKE_MANIFEST_TEXT_SAMPLE_BYTES,
        defaults.apk.dexIntakeManifestTextSampleBytes,
      ),
      dexIntakeManifestControlByteRatio: ratioEnv(
        env.APK_DEX_INTAKE_MANIFEST_CONTROL_BYTE_RATIO,
        defaults.apk.dexIntakeManifestControlByteRatio,
      ),
      dexIntakeComponentLimit: positiveIntegerEnv(
        env.APK_DEX_INTAKE_COMPONENT_LIMIT,
        defaults.apk.dexIntakeComponentLimit,
      ),
      dexIntakeFeatureLimit: positiveIntegerEnv(
        env.APK_DEX_INTAKE_FEATURE_LIMIT,
        defaults.apk.dexIntakeFeatureLimit,
      ),
      dexIntakeUniqueLimitDefault: positiveIntegerEnv(
        env.APK_DEX_INTAKE_UNIQUE_LIMIT_DEFAULT,
        defaults.apk.dexIntakeUniqueLimitDefault,
      ),
    },
    dex: {
      scanDefaultMaxHits: positiveIntegerEnv(
        env.DEX_SCAN_DEFAULT_MAX_HITS,
        defaults.dex.scanDefaultMaxHits,
      ),
      scanMaxHits: positiveIntegerEnv(env.DEX_SCAN_MAX_HITS, defaults.dex.scanMaxHits),
      scanMaxExtractBytes: positiveIntegerEnv(
        env.DEX_SCAN_MAX_EXTRACT_BYTES,
        defaults.dex.scanMaxExtractBytes,
      ),
      artifactDefaultLimit: positiveIntegerEnv(
        env.DEX_ARTIFACT_DEFAULT_LIMIT,
        defaults.dex.artifactDefaultLimit,
      ),
      artifactMaxLimit: positiveIntegerEnv(
        env.DEX_ARTIFACT_MAX_LIMIT,
        defaults.dex.artifactMaxLimit,
      ),
      artifactMinReadBytes: positiveIntegerEnv(
        env.DEX_ARTIFACT_MIN_READ_BYTES,
        defaults.dex.artifactMinReadBytes,
      ),
      artifactDefaultMaxFileBytes: positiveIntegerEnv(
        env.DEX_ARTIFACT_DEFAULT_MAX_FILE_BYTES,
        defaults.dex.artifactDefaultMaxFileBytes,
      ),
      artifactDefaultMaxTotalBytes: positiveIntegerEnv(
        env.DEX_ARTIFACT_DEFAULT_MAX_TOTAL_BYTES,
        defaults.dex.artifactDefaultMaxTotalBytes,
      ),
      artifactMaxReadBytes: positiveIntegerEnv(
        env.DEX_ARTIFACT_MAX_READ_BYTES,
        defaults.dex.artifactMaxReadBytes,
      ),
      stringScanMaxBytes: positiveIntegerEnv(
        env.DEX_STRING_SCAN_MAX_BYTES,
        defaults.dex.stringScanMaxBytes,
      ),
    },
    frida: {
      dexDumpTimeoutMs: positiveIntegerEnv(
        env.FRIDA_DEX_DUMP_TIMEOUT_MS,
        defaults.frida.dexDumpTimeoutMs,
      ),
      dexDumpMaxBufferBytes: positiveIntegerEnv(
        env.FRIDA_DEX_DUMP_MAX_BUFFER_BYTES,
        defaults.frida.dexDumpMaxBufferBytes,
      ),
      dexDumpFileLimit: positiveIntegerEnv(
        env.FRIDA_DEX_DUMP_FILE_LIMIT,
        defaults.frida.dexDumpFileLimit,
      ),
    },
    androidRuntime: {
      mapsMaxBytes: positiveIntegerEnv(
        env.ANDROID_RUNTIME_MAPS_MAX_BYTES,
        defaults.androidRuntime.mapsMaxBytes,
      ),
      mapsModuleLimit: positiveIntegerEnv(
        env.ANDROID_RUNTIME_MAPS_MODULE_LIMIT,
        defaults.androidRuntime.mapsModuleLimit,
      ),
    },
  };
}

export function getConfig(): Config {
  loadEnvIfNeeded();

  const parsed = ConfigSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    console.error(`[Config] Validation errors:\n${issues.join('\n')}`);
    console.error('[Config] Falling back to safe defaults for invalid fields');
  }

  // Use parsed data if valid, otherwise fall back to process.env with defaults
  const env = parsed.success ? parsed.data : process.env;

  const cacheDir = (env.CACHE_DIR as string) || CONFIG_DEFAULTS.cache.dir;
  const configuredExecutablePath =
    (env.PUPPETEER_EXECUTABLE_PATH as string) ||
    (env.CHROME_PATH as string) ||
    (env.BROWSER_EXECUTABLE_PATH as string);
  const absoluteCacheDir =
    cacheDir.startsWith('/') || cacheDir.match(/^[A-Za-z]:/)
      ? cacheDir
      : join(projectRoot, cacheDir);
  const search = buildSearchConfig();
  const writableBase = getWritableBaseDir();
  const paths = {
    screenshotDir: resolveConfigPath(
      (env.MCP_SCREENSHOT_DIR as string) || CONFIG_DEFAULTS.paths.screenshotDir,
      writableBase,
    ),
    captchaScreenshotDir: resolveConfigPath(
      (env.CAPTCHA_SCREENSHOT_DIR as string) || CONFIG_DEFAULTS.paths.captchaScreenshotDir,
      writableBase,
    ),
    debuggerSessionsDir: resolveConfigPath(
      (env.MCP_DEBUGGER_SESSIONS_DIR as string) || CONFIG_DEFAULTS.paths.debuggerSessionsDir,
      process.cwd(),
    ),
    extensionRegistryDir: resolveConfigPath(
      (env.MCP_EXTENSION_REGISTRY_DIR as string) || CONFIG_DEFAULTS.paths.extensionRegistryDir,
      writableBase,
    ),
    tlsKeyLogDir: resolveConfigPath(
      (env.MCP_TLS_KEYLOG_DIR as string) || CONFIG_DEFAULTS.paths.tlsKeyLogDir,
      writableBase,
    ),
    registryCacheDir: resolveConfigPath(
      (env.MCP_REGISTRY_CACHE_DIR as string) || CONFIG_DEFAULTS.paths.registryCacheDir,
      homedir(),
    ),
  };

  return {
    puppeteer: {
      headless: coerceBooleanEnv(env.PUPPETEER_HEADLESS, CONFIG_DEFAULTS.puppeteer.headless),
      timeout: coerceIntegerEnv(env.PUPPETEER_TIMEOUT, CONFIG_DEFAULTS.puppeteer.timeout),
      executablePath: configuredExecutablePath?.trim() || undefined,
    },
    mcp: {
      name: (env.MCP_SERVER_NAME as string) || CONFIG_DEFAULTS.mcp.name,
      version: (env.MCP_SERVER_VERSION as string) || CONFIG_DEFAULTS.mcp.version,
    },
    cache: {
      enabled: coerceBooleanEnv(env.ENABLE_CACHE, CONFIG_DEFAULTS.cache.enabled),
      dir: absoluteCacheDir,
      ttl: coerceIntegerEnv(env.CACHE_TTL, CONFIG_DEFAULTS.cache.ttl),
    },
    paths,
    performance: {
      maxConcurrentAnalysis: coerceIntegerEnv(
        env.MAX_CONCURRENT_ANALYSIS,
        CONFIG_DEFAULTS.performance.maxConcurrentAnalysis,
      ),
      maxCodeSizeMB: coerceIntegerEnv(
        env.MAX_CODE_SIZE_MB,
        CONFIG_DEFAULTS.performance.maxCodeSizeMB,
      ),
    },
    reverseEngineering: buildReverseEngineeringConfig(env),
    search,
  };
}

export function validateConfig(config: Config): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.performance.maxConcurrentAnalysis < 1) {
    errors.push('maxConcurrentAnalysis must be at least 1');
  }

  if (config.performance.maxCodeSizeMB < 1) {
    errors.push('maxCodeSizeMB must be at least 1');
  }

  if (config.puppeteer.timeout < 1000) {
    errors.push('puppeteer.timeout must be at least 1000ms');
  }

  if (config.cache.ttl < 0) {
    errors.push('cache.ttl must be non-negative');
  }

  for (const profile of config.search.queryCategoryProfiles) {
    try {
      void new RegExp(profile.pattern, profile.flags);
    } catch {
      errors.push(`search.queryCategoryProfiles contains invalid regex: ${profile.pattern}`);
    }
  }

  for (const alias of config.search.cjkQueryAliases) {
    try {
      void new RegExp(alias.pattern, alias.flags);
    } catch {
      errors.push(`search.cjkQueryAliases contains invalid regex: ${alias.pattern}`);
    }
  }

  for (const rule of config.search.intentToolBoostRules) {
    try {
      void new RegExp(rule.pattern, rule.flags);
    } catch {
      errors.push(`search.intentToolBoostRules contains invalid regex: ${rule.pattern}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
