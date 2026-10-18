import { bootstrapRuntimeEnv, runtimeProjectRoot } from '@src/config/env-bootstrap';
import { FLOAT_PATTERN, INTEGER_PATTERN } from '@src/config/environment';
import { homedir } from 'node:os';
import { isAbsolute, normalize, relative, resolve } from 'node:path';
import { z } from 'zod';
import { DEFAULT_SEARCH_CONFIG } from '@src/config/search-defaults';
import { DEFAULT_SEARCH_VECTOR_MODEL_ID } from '@src/constants/search-model';
import { logger } from './logger';
import { getPackageVersion } from './packageVersion';
import { isRecord } from './type-guards';
import type {
  BrowserFleetWorkerConfig,
  Config,
  ObservabilityConfig,
  ReverseEngineeringConfig,
  SearchCjkQueryAliasConfig,
  SearchConfig,
  SearchIntentToolBoostRuleConfig,
  SearchQueryCategoryProfileConfig,
  ToolExecutionRuleConfig,
} from '@internal-types/config';

export const projectRoot = runtimeProjectRoot;

function isContainedRelativePath(path: string): boolean {
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

/**
 * True when the package is loaded from a global npm prefix (npx / npm install -g)
 * rather than a local node_modules. We use this to redirect writable paths (screenshots,
 * artifacts, etc.) to the user's cwd instead of the immutable install cache.
 */
export function isNpxContext(): boolean {
  // Common npm-prefix markers:
  if (process.env.NPX_CACHE || process.env.npm_config_prefix) return true;
  const cwd = process.cwd();
  // A source checkout may run from either the package root or one of its
  // subdirectories; a local dependency lives below cwd. Only unrelated trees
  // indicate an npx/global installation.
  const cwdToRoot = normalize(relative(cwd, projectRoot));
  const rootToCwd = normalize(relative(projectRoot, cwd));
  return !isContainedRelativePath(cwdToRoot) && !isContainedRelativePath(rootToCwd);
}

function getWritableBaseDir(): string {
  return isNpxContext() ? process.cwd() : projectRoot;
}

const CONFIG_DEFAULTS = {
  puppeteer: {
    headless: false,
    timeout: 30000,
  },
  mcp: {
    name: 'jshookmcp',
    version: getPackageVersion(import.meta.url),
    browserSessionQueueMaxPending: 256,
    browserSessionQueueMaxPendingPerSession: 16,
    browserSessionQueueWaitTimeoutMs: 180_000,
    browserSessionSchedulerQuantumMs: 250,
    browserSessionSchedulerAgingMs: 15_000,
    browserSessionExpectedConcurrency: 10,
    browserSessionReservedPendingPerSession: 1,
    browserSessionCostEwmaAlpha: 0.2,
    browserFleetWorkerId: 'local',
    browserFleetVirtualNodes: 128,
    browserFleetLeaseTtlMs: 600_000,
    browserFleetMaxLocalLeases: 4096,
    toolActivationBudgetTokens: 30_000,
    toolActivationMaxTools: 50,
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
  offloader: {
    detailThreshold: 512 * 1024,
    fileThreshold: 4 * 1024 * 1024,
    outputDir: 'artifacts/offloaded',
    excludeTools: [],
  },
  toolExecution: {
    allowTools: [] as string[],
    rules: [] as ToolExecutionRuleConfig[],
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
    collector: {
      defaultTimeoutMs: 30_000,
      dynamicScriptWaitMs: 3_000,
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
      remoteTimeoutMs: 30_000,
      deviceProbeTimeoutMs: 15_000,
    },
    jadx: {
      decompileTimeoutMs: 1_800_000,
      searchTimeoutMs: 600_000,
      singleClassTimeoutMs: 120_000,
      threadsCount: 4,
    },
    androidRuntime: {
      mapsMaxBytes: 4 * 1024 * 1024,
      mapsModuleLimit: 1000,
    },
  } satisfies ReverseEngineeringConfig,
} as const;

// ── Zod schemas for environment-based config ──
// INTEGER_PATTERN / FLOAT_PATTERN are imported from @src/config/environment
// (single source of truth) rather than re-declared here.

const envInt = (fallback: number) =>
  z.preprocess((value) => {
    if (value === undefined || (typeof value === 'string' && value.trim() === '')) {
      return fallback;
    }
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value !== 'string' || !INTEGER_PATTERN.test(value.trim())) {
      return Number.NaN;
    }
    return Number(value.trim());
  }, z.number().int().finite());

const envBool = (fallback: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || (typeof value === 'string' && value.trim() === '')) {
      return fallback;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value !== 'string') {
      return value;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    return value;
  }, z.boolean());

const optionalEnvBool = z.preprocess((value) => {
  if (value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return undefined;
  }
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return value;
}, z.boolean().optional());

const envFloat = (fallback: number) =>
  z.preprocess((value) => {
    if (value === undefined || (typeof value === 'string' && value.trim() === '')) {
      return fallback;
    }
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value !== 'string' || !FLOAT_PATTERN.test(value.trim())) {
      return Number.NaN;
    }
    return Number(value.trim());
  }, z.number().finite());

const optionalTrimmedString = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim().length === 0
      ? undefined
      : typeof value === 'string'
        ? value.trim()
        : value,
  z.string().min(1).optional(),
);

const envString = (fallback: string) =>
  z.preprocess(
    (value) =>
      value === undefined || (typeof value === 'string' && value.trim().length === 0)
        ? fallback
        : typeof value === 'string'
          ? value.trim()
          : value,
    z.string().min(1),
  );

const positiveEnvInt = (fallback: number) => envInt(fallback).pipe(z.number().min(1));
const ratioEnvFloat = (fallback: number) => envFloat(fallback).pipe(z.number().min(0).max(1));

function resolveConfigPath(inputPath: string, baseDir: string): string {
  return normalize(isAbsolute(inputPath) ? inputPath : resolve(baseDir, inputPath));
}

const ConfigSchema = z.object({
  // Puppeteer
  PUPPETEER_HEADLESS: envBool(CONFIG_DEFAULTS.puppeteer.headless),
  PUPPETEER_TIMEOUT: envInt(CONFIG_DEFAULTS.puppeteer.timeout).pipe(
    z.number().min(1000).max(300000),
  ),
  PUPPETEER_EXECUTABLE_PATH: optionalTrimmedString,
  CHROME_PATH: optionalTrimmedString,
  BROWSER_EXECUTABLE_PATH: optionalTrimmedString,
  NODE_ENV: optionalTrimmedString,

  // Server transport, HTTP middleware, and structured logging
  MCP_TRANSPORT: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : 'stdio',
    z.enum(['stdio', 'http']),
  ),
  MCP_HOST: envString('127.0.0.1'),
  MCP_PORT: envInt(3000).pipe(z.number().min(1).max(65_535)),
  MCP_AUTH_TOKEN: optionalTrimmedString,
  MCP_ALLOW_INSECURE: envBool(false),
  MCP_HEALTH_VERBOSE: envBool(false),
  MCP_HTTP_REQUEST_TIMEOUT_MS: positiveEnvInt(30_000),
  MCP_HTTP_HEADERS_TIMEOUT_MS: positiveEnvInt(10_000),
  MCP_HTTP_KEEPALIVE_TIMEOUT_MS: positiveEnvInt(86_400_000),
  MCP_HTTP_FORCE_CLOSE_TIMEOUT_MS: positiveEnvInt(5_000),
  MCP_MAX_BODY_BYTES: positiveEnvInt(10 * 1024 * 1024),
  MCP_RATE_LIMIT_ENABLED: envBool(true),
  MCP_RATE_LIMIT_WINDOW_MS: positiveEnvInt(60_000),
  MCP_RATE_LIMIT_MAX: positiveEnvInt(60),
  MCP_TRUST_PROXY: envBool(false),
  MCP_HTTP_MAX_INFLIGHT: positiveEnvInt(64),
  MCP_HTTP_MAX_SSE_INFLIGHT: positiveEnvInt(8),
  MCP_LOG_ENABLED: envBool(false),
  MCP_LOG_LEVEL: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : 'info',
    z.enum(['debug', 'info', 'warning', 'error']),
  ),
  MCP_LOG_FILE_DIR: optionalTrimmedString,

  // MCP
  MCP_SERVER_NAME: envString(CONFIG_DEFAULTS.mcp.name),
  MCP_SERVER_VERSION: envString(CONFIG_DEFAULTS.mcp.version),
  MCP_TOOL_PROFILE: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : 'search',
    z.enum(['search', 'workflow', 'full']),
  ),
  MCP_TOOL_DOMAINS: z.string().optional().default(''),
  MCP_BROWSER_SESSION_QUEUE_MAX_PENDING: envInt(
    CONFIG_DEFAULTS.mcp.browserSessionQueueMaxPending,
  ).pipe(z.number().min(1).max(100_000)),
  MCP_BROWSER_SESSION_QUEUE_MAX_PENDING_PER_SESSION: envInt(
    CONFIG_DEFAULTS.mcp.browserSessionQueueMaxPendingPerSession,
  ).pipe(z.number().min(1).max(100_000)),
  MCP_BROWSER_SESSION_QUEUE_WAIT_TIMEOUT_MS: envInt(
    CONFIG_DEFAULTS.mcp.browserSessionQueueWaitTimeoutMs,
  ).pipe(z.number().min(1).max(3_600_000)),
  MCP_BROWSER_SESSION_SCHEDULER_QUANTUM_MS: envInt(
    CONFIG_DEFAULTS.mcp.browserSessionSchedulerQuantumMs,
  ).pipe(z.number().min(1).max(60_000)),
  MCP_BROWSER_SESSION_SCHEDULER_AGING_MS: envInt(
    CONFIG_DEFAULTS.mcp.browserSessionSchedulerAgingMs,
  ).pipe(z.number().min(1).max(3_600_000)),
  MCP_BROWSER_SESSION_EXPECTED_CONCURRENCY: envInt(
    CONFIG_DEFAULTS.mcp.browserSessionExpectedConcurrency,
  ).pipe(z.number().min(1).max(10_000)),
  MCP_BROWSER_SESSION_RESERVED_PENDING_PER_SESSION: envInt(
    CONFIG_DEFAULTS.mcp.browserSessionReservedPendingPerSession,
  ).pipe(z.number().min(0).max(10_000)),
  MCP_BROWSER_SESSION_COST_EWMA_ALPHA: envFloat(
    CONFIG_DEFAULTS.mcp.browserSessionCostEwmaAlpha,
  ).pipe(z.number().gt(0).max(1)),
  MCP_BROWSER_FLEET_WORKER_ID: envString(CONFIG_DEFAULTS.mcp.browserFleetWorkerId),
  MCP_BROWSER_FLEET_WORKERS_JSON: z.string().optional().default(''),
  MCP_BROWSER_FLEET_VIRTUAL_NODES: envInt(CONFIG_DEFAULTS.mcp.browserFleetVirtualNodes).pipe(
    z.number().min(1).max(4096),
  ),
  MCP_BROWSER_FLEET_LEASE_TTL_MS: envInt(CONFIG_DEFAULTS.mcp.browserFleetLeaseTtlMs).pipe(
    z.number().min(1000).max(86_400_000),
  ),
  MCP_BROWSER_FLEET_MAX_LOCAL_LEASES: envInt(CONFIG_DEFAULTS.mcp.browserFleetMaxLocalLeases).pipe(
    z.number().min(1).max(1_000_000),
  ),
  MCP_TOOL_ACTIVATION_BUDGET_TOKENS: positiveEnvInt(CONFIG_DEFAULTS.mcp.toolActivationBudgetTokens),
  MCP_TOOL_MAX_ACTIVE_TOOLS: positiveEnvInt(CONFIG_DEFAULTS.mcp.toolActivationMaxTools),

  // Cache
  ENABLE_CACHE: envBool(CONFIG_DEFAULTS.cache.enabled),
  CACHE_DIR: envString(CONFIG_DEFAULTS.cache.dir),
  CACHE_TTL: envInt(CONFIG_DEFAULTS.cache.ttl).pipe(z.number().min(0)),

  // Paths
  MCP_SCREENSHOT_DIR: envString(CONFIG_DEFAULTS.paths.screenshotDir),
  CAPTCHA_SCREENSHOT_DIR: envString(CONFIG_DEFAULTS.paths.captchaScreenshotDir),
  MCP_DEBUGGER_SESSIONS_DIR: envString(CONFIG_DEFAULTS.paths.debuggerSessionsDir),
  MCP_EXTENSION_REGISTRY_DIR: envString(CONFIG_DEFAULTS.paths.extensionRegistryDir),
  MCP_TLS_KEYLOG_DIR: envString(CONFIG_DEFAULTS.paths.tlsKeyLogDir),
  MCP_REGISTRY_CACHE_DIR: envString(CONFIG_DEFAULTS.paths.registryCacheDir),

  // Performance
  MAX_CONCURRENT_ANALYSIS: envInt(CONFIG_DEFAULTS.performance.maxConcurrentAnalysis).pipe(
    z.number().min(1).max(32),
  ),
  MAX_CODE_SIZE_MB: envInt(CONFIG_DEFAULTS.performance.maxCodeSizeMB).pipe(
    z.number().min(1).max(500),
  ),

  // Response offloading
  OFFLOADER_DETAIL_THRESHOLD: envInt(CONFIG_DEFAULTS.offloader.detailThreshold).pipe(
    z.number().min(1),
  ),
  OFFLOADER_FILE_THRESHOLD: envInt(CONFIG_DEFAULTS.offloader.fileThreshold).pipe(z.number().min(1)),
  OFFLOADER_OUTPUT_DIR: envString(CONFIG_DEFAULTS.offloader.outputDir),
  OFFLOADER_EXCLUDE_TOOLS: z.string().optional().default(''),

  // Tool-execution permission gate
  MCP_TOOL_ALLOW_TOOLS: z.string().optional().default(''),
  MCP_TOOL_RULES_JSON: optionalTrimmedString,

  // Search runtime overrides
  SEARCH_QUERY_CATEGORY_PROFILES_JSON: optionalTrimmedString,
  SEARCH_CJK_QUERY_ALIASES_JSON: optionalTrimmedString,
  SEARCH_INTENT_TOOL_BOOST_RULES_JSON: optionalTrimmedString,
  SEARCH_VECTOR_ENABLED: optionalEnvBool,
  SEARCH_VECTOR_MODEL_ID: optionalTrimmedString,
  SEARCH_VECTOR_COSINE_WEIGHT: envFloat(0.53).pipe(z.number().min(0).max(10)),
  SEARCH_VECTOR_DYNAMIC_WEIGHT: envBool(true),

  // Observability (src/server/observability/). The OTLP exporter additionally
  // honours the standard OTEL_EXPORTER_OTLP_* vars inside the exporters.
  JSHOOK_OBSERVABILITY_EXPORTER: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : 'otlp',
    z.enum(['none', 'memory', 'otlp']),
  ),
  JSHOOK_OBSERVABILITY_MAX_SPANS: envInt(500).pipe(z.number().min(1).max(100_000)),
  JSHOOK_OTLP_QUERY_TEXT: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim().length > 0
        ? value.trim().toLowerCase()
        : 'truncated',
    z.enum(['off', 'truncated', 'full']),
  ),
  JSHOOK_OTLP_TOOL_ARGS: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : 'shape',
    z.enum(['off', 'shape', 'truncated', 'full']),
  ),

  // Extension/plugin trust boundary
  EXTENSION_REGISTRY_BASE_URL: optionalTrimmedString,
  MCP_PLUGIN_ROOTS: z.string().optional().default(''),
  MCP_WORKFLOW_ROOTS: z.string().optional().default(''),
  MCP_PLUGIN_ALLOWED_DIGESTS: z.string().optional().default(''),
  MCP_PLUGIN_SIGNATURE_REQUIRED: optionalEnvBool,
  MCP_PLUGIN_STRICT_LOAD: optionalEnvBool,

  // CAPTCHA service credentials/endpoints
  CAPTCHA_PROVIDER: envString('manual'),
  CAPTCHA_API_KEY: optionalTrimmedString,
  CAPTCHA_SOLVER_BASE_URL: optionalTrimmedString,
  CAPTCHA_2CAPTCHA_BASE_URL: optionalTrimmedString,
  CAPTCHA_ANTICAPTCHA_BASE_URL: optionalTrimmedString,
  CAPTCHA_CAPSOLVER_BASE_URL: optionalTrimmedString,

  // Reverse-engineering runtime limits. Every deploy-time setting is parsed
  // once here so malformed values can fall back independently.
  TRANSFORM_WORKBENCH_DEFAULT_PREVIEW_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.transformWorkbench.defaultPreviewBytes,
  ),
  TRANSFORM_WORKBENCH_MAX_PREVIEW_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.transformWorkbench.maxPreviewBytes,
  ),
  TRANSFORM_WORKBENCH_TEXT_SAMPLE_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.transformWorkbench.textSampleBytes,
  ),
  TRANSFORM_WORKBENCH_MAX_INPUT_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.transformWorkbench.maxInputBytes,
  ),
  TRANSFORM_WORKBENCH_MAX_OUTPUT_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.transformWorkbench.maxOutputBytes,
  ),
  TRANSFORM_WORKBENCH_MAX_STEPS: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.transformWorkbench.maxSteps,
  ),
  REVERSE_SESSION_MAX_INLINE_TRANSFORM_INPUT_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.reverseSession.maxInlineTransformInputBytes,
  ),
  REVERSE_SESSION_PROMOTED_TRANSFORM_PREVIEW_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.reverseSession.promotedTransformPreviewBytes,
  ),
  REVERSE_SESSION_RUN_MAX_STEPS: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.reverseSession.runMaxSteps,
  ),
  REVERSE_SESSION_EVIDENCE_REF_SEGMENT_MAX_CHARS: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.reverseSession.evidenceRefSegmentMaxChars,
  ),
  BINARY_MAGIC_HINT_PREFIX_MAX_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.binaryMagic.hintPrefixMaxBytes,
  ),
  DEX_MAGIC_ASCII: z
    .string()
    .min(1)
    .optional()
    .default(CONFIG_DEFAULTS.reverseEngineering.binaryMagic.dexMagicAscii),
  CDEX_MAGIC_ASCII: z
    .string()
    .min(1)
    .optional()
    .default(CONFIG_DEFAULTS.reverseEngineering.binaryMagic.compactDexMagicAscii),
  NEMU_CSTRING_DEFAULT_LIMIT_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.nativeEmulator.cstringDefaultLimitBytes,
  ),
  NEMU_CSTRING_READ_CHUNK_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.nativeEmulator.cstringReadChunkBytes,
  ),
  NEMU_GUEST_PAGE_SIZE_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.nativeEmulator.guestPageSizeBytes,
  ),
  NEMU_SYSCALL_CSTRING_LIMIT_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.nativeEmulator.syscallCStringLimitBytes,
  ),
  NEMU_RAW_MEMORY_MAX_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.nativeEmulator.rawMemoryMaxBytes,
  ),
  NEMU_RAW_MEMORY_PREVIEW_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.nativeEmulator.rawMemoryPreviewBytes,
  ),
  APK_STATIC_TRIAGE_MIN_ENTRIES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.staticTriageMinEntries,
  ),
  APK_STATIC_TRIAGE_DEFAULT_ENTRIES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.staticTriageDefaultEntries,
  ),
  APK_STATIC_TRIAGE_MAX_ENTRIES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.staticTriageMaxEntries,
  ),
  APK_STATIC_TRIAGE_ASSET_HINT_LIMIT: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.staticTriageAssetHintLimit,
  ),
  APK_STATIC_TRIAGE_NATIVE_LIB_LIMIT: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.staticTriageNativeLibLimit,
  ),
  APK_DEX_INTAKE_DEFAULT_DEX_FILES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.dexIntakeDefaultDexFiles,
  ),
  APK_DEX_INTAKE_MAX_DEX_FILES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.dexIntakeMaxDexFiles,
  ),
  APK_DEX_INTAKE_MANIFEST_TEXT_SAMPLE_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.dexIntakeManifestTextSampleBytes,
  ),
  APK_DEX_INTAKE_MANIFEST_CONTROL_BYTE_RATIO: ratioEnvFloat(
    CONFIG_DEFAULTS.reverseEngineering.apk.dexIntakeManifestControlByteRatio,
  ),
  APK_DEX_INTAKE_COMPONENT_LIMIT: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.dexIntakeComponentLimit,
  ),
  APK_DEX_INTAKE_FEATURE_LIMIT: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.dexIntakeFeatureLimit,
  ),
  APK_DEX_INTAKE_UNIQUE_LIMIT_DEFAULT: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.apk.dexIntakeUniqueLimitDefault,
  ),
  DEX_SCAN_DEFAULT_MAX_HITS: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.dex.scanDefaultMaxHits,
  ),
  DEX_SCAN_MAX_HITS: positiveEnvInt(CONFIG_DEFAULTS.reverseEngineering.dex.scanMaxHits),
  DEX_SCAN_MAX_EXTRACT_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.dex.scanMaxExtractBytes,
  ),
  DEX_ARTIFACT_DEFAULT_LIMIT: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.dex.artifactDefaultLimit,
  ),
  DEX_ARTIFACT_MAX_LIMIT: positiveEnvInt(CONFIG_DEFAULTS.reverseEngineering.dex.artifactMaxLimit),
  DEX_ARTIFACT_MIN_READ_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.dex.artifactMinReadBytes,
  ),
  DEX_ARTIFACT_DEFAULT_MAX_FILE_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.dex.artifactDefaultMaxFileBytes,
  ),
  DEX_ARTIFACT_DEFAULT_MAX_TOTAL_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.dex.artifactDefaultMaxTotalBytes,
  ),
  DEX_ARTIFACT_MAX_READ_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.dex.artifactMaxReadBytes,
  ),
  DEX_STRING_SCAN_MAX_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.dex.stringScanMaxBytes,
  ),
  FRIDA_DEX_DUMP_TIMEOUT_MS: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.frida.dexDumpTimeoutMs,
  ),
  FRIDA_DEX_DUMP_MAX_BUFFER_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.frida.dexDumpMaxBufferBytes,
  ),
  FRIDA_DEX_DUMP_FILE_LIMIT: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.frida.dexDumpFileLimit,
  ),
  FRIDA_REMOTE_TIMEOUT_MS: positiveEnvInt(CONFIG_DEFAULTS.reverseEngineering.frida.remoteTimeoutMs),
  FRIDA_DEVICE_PROBE_TIMEOUT_MS: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.frida.deviceProbeTimeoutMs,
  ),
  JADX_DECOMPILE_TIMEOUT_MS: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.jadx.decompileTimeoutMs,
  ),
  JADX_SEARCH_TIMEOUT_MS: positiveEnvInt(CONFIG_DEFAULTS.reverseEngineering.jadx.searchTimeoutMs),
  JADX_SINGLE_CLASS_TIMEOUT_MS: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.jadx.singleClassTimeoutMs,
  ),
  JADX_THREADS_COUNT: positiveEnvInt(CONFIG_DEFAULTS.reverseEngineering.jadx.threadsCount),
  ANDROID_RUNTIME_MAPS_MAX_BYTES: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.androidRuntime.mapsMaxBytes,
  ),
  ANDROID_RUNTIME_MAPS_MODULE_LIMIT: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.androidRuntime.mapsModuleLimit,
  ),
  COLLECTOR_DEFAULT_TIMEOUT_MS: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.collector.defaultTimeoutMs,
  ),
  COLLECTOR_DYNAMIC_SCRIPT_WAIT_MS: positiveEnvInt(
    CONFIG_DEFAULTS.reverseEngineering.collector.dynamicScriptWaitMs,
  ),
});

type ParsedConfigEnvironment = z.output<typeof ConfigSchema>;

/**
 * Parse every environment field independently. A malformed value is removed
 * and reparsed so that field receives its declared default while all valid
 * sibling overrides remain intact. This avoids the previous all-or-nothing
 * fallback, which accidentally returned the original unvalidated strings.
 */
function parseConfigEnvironment(source: NodeJS.ProcessEnv): ParsedConfigEnvironment {
  const candidate: Record<string, unknown> = { ...source };
  const reportedIssues: string[] = [];
  const maxPasses = Object.keys(ConfigSchema.shape).length + 1;

  for (let pass = 0; pass < maxPasses; pass++) {
    const parsed = ConfigSchema.safeParse(candidate);
    if (parsed.success) {
      if (reportedIssues.length > 0) {
        console.error(
          `[Config] Invalid environment values; using defaults for those fields:\n` +
            reportedIssues.map((issue) => `  ${issue}`).join('\n'),
        );
      }
      return parsed.data;
    }

    const invalidKeys = new Set<string>();
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key !== 'string') continue;
      invalidKeys.add(key);
      reportedIssues.push(`${key}: ${issue.message}`);
    }

    if (invalidKeys.size === 0) {
      break;
    }
    for (const key of invalidKeys) {
      delete candidate[key];
    }
  }

  // Schema defaults are literals and must always parse. Keep this explicit so
  // a future invalid default fails loudly during development instead of
  // re-introducing unvalidated environment data.
  return ConfigSchema.parse({});
}

function parseJsonArrayEnv(raw: string | undefined): unknown[] | undefined {
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

function parseSearchQueryCategoryProfiles(
  raw: string | undefined,
): SearchQueryCategoryProfileConfig[] | undefined {
  const parsed = parseJsonArrayEnv(raw);
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

function parseCjkQueryAliases(raw: string | undefined): SearchCjkQueryAliasConfig[] | undefined {
  const parsed = parseJsonArrayEnv(raw);
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

function parseIntentToolBoostRules(
  raw: string | undefined,
): SearchIntentToolBoostRuleConfig[] | undefined {
  const parsed = parseJsonArrayEnv(raw);
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

function buildSearchConfig(env: ParsedConfigEnvironment): SearchConfig {
  const defaults = cloneSearchConfig(DEFAULT_SEARCH_CONFIG);

  return {
    queryCategoryProfiles:
      parseSearchQueryCategoryProfiles(env.SEARCH_QUERY_CATEGORY_PROFILES_JSON) ??
      defaults.queryCategoryProfiles,
    cjkQueryAliases:
      parseCjkQueryAliases(env.SEARCH_CJK_QUERY_ALIASES_JSON) ?? defaults.cjkQueryAliases,
    intentToolBoostRules:
      parseIntentToolBoostRules(env.SEARCH_INTENT_TOOL_BOOST_RULES_JSON) ??
      defaults.intentToolBoostRules,
    // Enabled by default on every transport, mirroring SEARCH_VECTOR_ENABLED in
    // src/constants/search.ts — the retrieval quality target is transport-
    // independent. Opt out with SEARCH_VECTOR_ENABLED=false.
    vectorEnabled: env.SEARCH_VECTOR_ENABLED ?? true,
    vectorModelId: env.SEARCH_VECTOR_MODEL_ID ?? DEFAULT_SEARCH_VECTOR_MODEL_ID,
    vectorCosineWeight: env.SEARCH_VECTOR_COSINE_WEIGHT,
    vectorDynamicWeight: env.SEARCH_VECTOR_DYNAMIC_WEIGHT,
  };
}

function buildObservabilityConfig(env: ParsedConfigEnvironment): ObservabilityConfig {
  return {
    exporter: env.JSHOOK_OBSERVABILITY_EXPORTER,
    maxSpans: env.JSHOOK_OBSERVABILITY_MAX_SPANS,
    queryText: env.JSHOOK_OTLP_QUERY_TEXT,
    toolArgs: env.JSHOOK_OTLP_TOOL_ARGS,
  };
}

function parseCsvList(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Parse `MCP_TOOL_RULES_JSON` into ordered tool-execution permission rules.
 * Invalid entries are dropped individually (with a warning) so one malformed
 * rule cannot silently disable the whole gate.
 */
function parseToolExecutionRules(raw: string | undefined): ToolExecutionRuleConfig[] | undefined {
  const parsed = parseJsonArrayEnv(raw);
  if (parsed === undefined) {
    return undefined;
  }

  const rules: ToolExecutionRuleConfig[] = [];
  for (const [index, entry] of parsed.entries()) {
    if (!isRecord(entry) || typeof entry.tool !== 'string' || entry.tool.trim().length === 0) {
      logger.warn(
        `[Config] Ignoring invalid toolExecution rule at index ${index}: ` +
          '"tool" must be a non-empty string',
      );
      continue;
    }
    const action = entry.action;
    if (action !== 'allow' && action !== 'deny') {
      logger.warn(
        `[Config] Ignoring invalid toolExecution rule at index ${index}: ` +
          `"action" must be "allow" or "deny" (got ${String(action)})`,
      );
      continue;
    }
    const rule: ToolExecutionRuleConfig = { tool: entry.tool.trim(), action };
    if (typeof entry.pattern === 'string' && entry.pattern.length > 0) {
      rule.pattern = entry.pattern;
    }
    rules.push(rule);
  }
  return rules;
}

function parseBrowserFleetWorkers(
  value: unknown,
  localWorkerId: string,
): BrowserFleetWorkerConfig[] {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [{ id: localWorkerId }];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new TypeError('expected a non-empty JSON array');
    }
    const seen = new Set<string>();
    const workers = parsed.map((item, index): BrowserFleetWorkerConfig => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new TypeError(`worker at index ${index} must be an object`);
      }
      const record = item as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id.trim() : '';
      if (!id) throw new TypeError(`worker at index ${index} requires a non-empty id`);
      if (seen.has(id)) throw new TypeError(`duplicate worker id: ${id}`);
      seen.add(id);
      const endpoint =
        typeof record.endpoint === 'string' && record.endpoint.trim().length > 0
          ? record.endpoint.trim()
          : undefined;
      const weight =
        typeof record.weight === 'number' &&
        Number.isInteger(record.weight) &&
        record.weight >= 1 &&
        record.weight <= 100
          ? record.weight
          : undefined;
      if (record.weight !== undefined && weight === undefined) {
        throw new TypeError(`worker ${id} weight must be an integer from 1 to 100`);
      }
      const accepting = typeof record.accepting === 'boolean' ? record.accepting : undefined;
      return {
        id,
        ...(endpoint ? { endpoint } : {}),
        ...(weight ? { weight } : {}),
        ...(accepting === undefined ? {} : { accepting }),
      };
    });
    if (!seen.has(localWorkerId)) {
      throw new TypeError(`topology does not contain local worker ${localWorkerId}`);
    }
    if (!workers.some((worker) => worker.accepting !== false)) {
      throw new TypeError('topology has no accepting worker');
    }
    return workers;
  } catch (error) {
    logger.warn(
      `[Config] Invalid MCP_BROWSER_FLEET_WORKERS_JSON; using local worker only: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return [{ id: localWorkerId }];
  }
}

function buildReverseEngineeringConfig(env: ParsedConfigEnvironment): ReverseEngineeringConfig {
  return {
    transformWorkbench: {
      defaultPreviewBytes: env.TRANSFORM_WORKBENCH_DEFAULT_PREVIEW_BYTES,
      maxPreviewBytes: env.TRANSFORM_WORKBENCH_MAX_PREVIEW_BYTES,
      textSampleBytes: env.TRANSFORM_WORKBENCH_TEXT_SAMPLE_BYTES,
      maxInputBytes: env.TRANSFORM_WORKBENCH_MAX_INPUT_BYTES,
      maxOutputBytes: env.TRANSFORM_WORKBENCH_MAX_OUTPUT_BYTES,
      maxSteps: env.TRANSFORM_WORKBENCH_MAX_STEPS,
    },
    reverseSession: {
      maxInlineTransformInputBytes: env.REVERSE_SESSION_MAX_INLINE_TRANSFORM_INPUT_BYTES,
      promotedTransformPreviewBytes: env.REVERSE_SESSION_PROMOTED_TRANSFORM_PREVIEW_BYTES,
      runMaxSteps: env.REVERSE_SESSION_RUN_MAX_STEPS,
      evidenceRefSegmentMaxChars: env.REVERSE_SESSION_EVIDENCE_REF_SEGMENT_MAX_CHARS,
    },
    binaryMagic: {
      hintPrefixMaxBytes: env.BINARY_MAGIC_HINT_PREFIX_MAX_BYTES,
      dexMagicAscii: env.DEX_MAGIC_ASCII,
      compactDexMagicAscii: env.CDEX_MAGIC_ASCII,
    },
    nativeEmulator: {
      cstringDefaultLimitBytes: env.NEMU_CSTRING_DEFAULT_LIMIT_BYTES,
      cstringReadChunkBytes: env.NEMU_CSTRING_READ_CHUNK_BYTES,
      guestPageSizeBytes: env.NEMU_GUEST_PAGE_SIZE_BYTES,
      syscallCStringLimitBytes: env.NEMU_SYSCALL_CSTRING_LIMIT_BYTES,
      rawMemoryMaxBytes: env.NEMU_RAW_MEMORY_MAX_BYTES,
      rawMemoryPreviewBytes: env.NEMU_RAW_MEMORY_PREVIEW_BYTES,
    },
    apk: {
      staticTriageMinEntries: env.APK_STATIC_TRIAGE_MIN_ENTRIES,
      staticTriageDefaultEntries: env.APK_STATIC_TRIAGE_DEFAULT_ENTRIES,
      staticTriageMaxEntries: env.APK_STATIC_TRIAGE_MAX_ENTRIES,
      staticTriageAssetHintLimit: env.APK_STATIC_TRIAGE_ASSET_HINT_LIMIT,
      staticTriageNativeLibLimit: env.APK_STATIC_TRIAGE_NATIVE_LIB_LIMIT,
      dexIntakeDefaultDexFiles: env.APK_DEX_INTAKE_DEFAULT_DEX_FILES,
      dexIntakeMaxDexFiles: env.APK_DEX_INTAKE_MAX_DEX_FILES,
      dexIntakeManifestTextSampleBytes: env.APK_DEX_INTAKE_MANIFEST_TEXT_SAMPLE_BYTES,
      dexIntakeManifestControlByteRatio: env.APK_DEX_INTAKE_MANIFEST_CONTROL_BYTE_RATIO,
      dexIntakeComponentLimit: env.APK_DEX_INTAKE_COMPONENT_LIMIT,
      dexIntakeFeatureLimit: env.APK_DEX_INTAKE_FEATURE_LIMIT,
      dexIntakeUniqueLimitDefault: env.APK_DEX_INTAKE_UNIQUE_LIMIT_DEFAULT,
    },
    dex: {
      scanDefaultMaxHits: env.DEX_SCAN_DEFAULT_MAX_HITS,
      scanMaxHits: env.DEX_SCAN_MAX_HITS,
      scanMaxExtractBytes: env.DEX_SCAN_MAX_EXTRACT_BYTES,
      artifactDefaultLimit: env.DEX_ARTIFACT_DEFAULT_LIMIT,
      artifactMaxLimit: env.DEX_ARTIFACT_MAX_LIMIT,
      artifactMinReadBytes: env.DEX_ARTIFACT_MIN_READ_BYTES,
      artifactDefaultMaxFileBytes: env.DEX_ARTIFACT_DEFAULT_MAX_FILE_BYTES,
      artifactDefaultMaxTotalBytes: env.DEX_ARTIFACT_DEFAULT_MAX_TOTAL_BYTES,
      artifactMaxReadBytes: env.DEX_ARTIFACT_MAX_READ_BYTES,
      stringScanMaxBytes: env.DEX_STRING_SCAN_MAX_BYTES,
    },
    frida: {
      dexDumpTimeoutMs: env.FRIDA_DEX_DUMP_TIMEOUT_MS,
      dexDumpMaxBufferBytes: env.FRIDA_DEX_DUMP_MAX_BUFFER_BYTES,
      dexDumpFileLimit: env.FRIDA_DEX_DUMP_FILE_LIMIT,
      remoteTimeoutMs: env.FRIDA_REMOTE_TIMEOUT_MS,
      deviceProbeTimeoutMs: env.FRIDA_DEVICE_PROBE_TIMEOUT_MS,
    },
    jadx: {
      decompileTimeoutMs: env.JADX_DECOMPILE_TIMEOUT_MS,
      searchTimeoutMs: env.JADX_SEARCH_TIMEOUT_MS,
      singleClassTimeoutMs: env.JADX_SINGLE_CLASS_TIMEOUT_MS,
      threadsCount: env.JADX_THREADS_COUNT,
    },
    androidRuntime: {
      mapsMaxBytes: env.ANDROID_RUNTIME_MAPS_MAX_BYTES,
      mapsModuleLimit: env.ANDROID_RUNTIME_MAPS_MODULE_LIMIT,
    },
    collector: {
      defaultTimeoutMs: env.COLLECTOR_DEFAULT_TIMEOUT_MS,
      dynamicScriptWaitMs: env.COLLECTOR_DYNAMIC_SCRIPT_WAIT_MS,
    },
  };
}

export function getConfig(): Config {
  bootstrapRuntimeEnv();

  const env = parseConfigEnvironment(process.env);

  const cacheDir = env.CACHE_DIR;
  const configuredExecutablePath =
    env.PUPPETEER_EXECUTABLE_PATH ?? env.CHROME_PATH ?? env.BROWSER_EXECUTABLE_PATH;
  const writableBase = getWritableBaseDir();
  // Cache is written at runtime, so a relative CACHE_DIR must resolve against the
  // writable base (user cwd in npx/global installs), not the immutable install
  // cache. Previously projectRoot was used, silently degrading cache to a no-op
  // whenever the package root was not writable.
  const absoluteCacheDir = resolveConfigPath(cacheDir, writableBase);
  const search = buildSearchConfig(env);
  const observability = buildObservabilityConfig(env);
  const paths = {
    screenshotDir: resolveConfigPath(env.MCP_SCREENSHOT_DIR, writableBase),
    captchaScreenshotDir: resolveConfigPath(env.CAPTCHA_SCREENSHOT_DIR, writableBase),
    debuggerSessionsDir: resolveConfigPath(env.MCP_DEBUGGER_SESSIONS_DIR, process.cwd()),
    extensionRegistryDir: resolveConfigPath(env.MCP_EXTENSION_REGISTRY_DIR, writableBase),
    tlsKeyLogDir: resolveConfigPath(env.MCP_TLS_KEYLOG_DIR, writableBase),
    registryCacheDir: resolveConfigPath(env.MCP_REGISTRY_CACHE_DIR, homedir()),
  };
  const browserFleetWorkerId = env.MCP_BROWSER_FLEET_WORKER_ID.trim();
  const browserFleetWorkers = parseBrowserFleetWorkers(
    env.MCP_BROWSER_FLEET_WORKERS_JSON,
    browserFleetWorkerId,
  );
  const pluginSignatureRequired =
    env.MCP_PLUGIN_SIGNATURE_REQUIRED ?? env.NODE_ENV === 'production';
  const pluginStrictLoad =
    (env.MCP_PLUGIN_STRICT_LOAD ?? pluginSignatureRequired) || pluginSignatureRequired;

  return {
    puppeteer: {
      headless: env.PUPPETEER_HEADLESS,
      timeout: env.PUPPETEER_TIMEOUT,
      executablePath: configuredExecutablePath,
    },
    server: {
      transport: env.MCP_TRANSPORT,
      host: env.MCP_HOST,
      port: env.MCP_PORT,
      authToken: env.MCP_AUTH_TOKEN,
      allowInsecure: env.MCP_ALLOW_INSECURE,
      healthVerbose: env.MCP_HEALTH_VERBOSE,
      logging: {
        enabled: env.MCP_LOG_ENABLED,
        level: env.MCP_LOG_LEVEL,
        fileDir: env.MCP_LOG_FILE_DIR,
      },
      http: {
        requestTimeoutMs: env.MCP_HTTP_REQUEST_TIMEOUT_MS,
        headersTimeoutMs: env.MCP_HTTP_HEADERS_TIMEOUT_MS,
        keepAliveTimeoutMs: env.MCP_HTTP_KEEPALIVE_TIMEOUT_MS,
        forceCloseTimeoutMs: env.MCP_HTTP_FORCE_CLOSE_TIMEOUT_MS,
        maxBodyBytes: env.MCP_MAX_BODY_BYTES,
        rateLimitEnabled: env.MCP_RATE_LIMIT_ENABLED,
        rateLimitWindowMs: env.MCP_RATE_LIMIT_WINDOW_MS,
        rateLimitMax: env.MCP_RATE_LIMIT_MAX,
        trustProxy: env.MCP_TRUST_PROXY,
        maxInFlight: env.MCP_HTTP_MAX_INFLIGHT,
        maxSseInFlight: env.MCP_HTTP_MAX_SSE_INFLIGHT,
      },
    },
    mcp: {
      name: env.MCP_SERVER_NAME,
      version: env.MCP_SERVER_VERSION,
      toolProfile: env.MCP_TOOL_PROFILE,
      toolDomains: parseCsvList(env.MCP_TOOL_DOMAINS).map((domain) => domain.toLowerCase()),
      browserSessionQueueMaxPending: env.MCP_BROWSER_SESSION_QUEUE_MAX_PENDING,
      browserSessionQueueMaxPendingPerSession:
        env.MCP_BROWSER_SESSION_QUEUE_MAX_PENDING_PER_SESSION,
      browserSessionQueueWaitTimeoutMs: env.MCP_BROWSER_SESSION_QUEUE_WAIT_TIMEOUT_MS,
      browserSessionSchedulerQuantumMs: env.MCP_BROWSER_SESSION_SCHEDULER_QUANTUM_MS,
      browserSessionSchedulerAgingMs: env.MCP_BROWSER_SESSION_SCHEDULER_AGING_MS,
      browserSessionExpectedConcurrency: env.MCP_BROWSER_SESSION_EXPECTED_CONCURRENCY,
      browserSessionReservedPendingPerSession: env.MCP_BROWSER_SESSION_RESERVED_PENDING_PER_SESSION,
      browserSessionCostEwmaAlpha: env.MCP_BROWSER_SESSION_COST_EWMA_ALPHA,
      browserFleetWorkerId,
      browserFleetWorkers,
      browserFleetVirtualNodes: env.MCP_BROWSER_FLEET_VIRTUAL_NODES,
      browserFleetLeaseTtlMs: env.MCP_BROWSER_FLEET_LEASE_TTL_MS,
      browserFleetMaxLocalLeases: env.MCP_BROWSER_FLEET_MAX_LOCAL_LEASES,
      toolActivationBudgetTokens: env.MCP_TOOL_ACTIVATION_BUDGET_TOKENS,
      toolActivationMaxTools: env.MCP_TOOL_MAX_ACTIVE_TOOLS,
    },
    cache: {
      enabled: env.ENABLE_CACHE,
      dir: absoluteCacheDir,
      ttl: env.CACHE_TTL,
    },
    paths,
    performance: {
      maxConcurrentAnalysis: env.MAX_CONCURRENT_ANALYSIS,
      maxCodeSizeMB: env.MAX_CODE_SIZE_MB,
    },
    offloader: {
      detailThreshold: env.OFFLOADER_DETAIL_THRESHOLD,
      fileThreshold: env.OFFLOADER_FILE_THRESHOLD,
      outputDir: env.OFFLOADER_OUTPUT_DIR,
      excludeTools: parseCsvList(env.OFFLOADER_EXCLUDE_TOOLS),
    },
    toolExecution: {
      allowTools: parseCsvList(env.MCP_TOOL_ALLOW_TOOLS),
      rules: parseToolExecutionRules(env.MCP_TOOL_RULES_JSON) ?? [],
    },
    reverseEngineering: buildReverseEngineeringConfig(env),
    search,
    observability,
    extensions: {
      registryBaseUrl: env.EXTENSION_REGISTRY_BASE_URL,
      pluginRoots: parseCsvList(env.MCP_PLUGIN_ROOTS),
      workflowRoots: parseCsvList(env.MCP_WORKFLOW_ROOTS),
      allowedDigests: parseCsvList(env.MCP_PLUGIN_ALLOWED_DIGESTS).map((digest) =>
        digest.toLowerCase().replace(/^0x/, ''),
      ),
      signatureRequired: pluginSignatureRequired,
      strictLoad: pluginStrictLoad,
    },
    captcha: {
      provider: env.CAPTCHA_PROVIDER.toLowerCase(),
      apiKey: env.CAPTCHA_API_KEY,
      solverBaseUrl: env.CAPTCHA_SOLVER_BASE_URL ?? env.CAPTCHA_2CAPTCHA_BASE_URL,
      antiCaptchaBaseUrl: env.CAPTCHA_ANTICAPTCHA_BASE_URL,
      capSolverBaseUrl: env.CAPTCHA_CAPSOLVER_BASE_URL,
    },
  };
}

function validateServerConfig(config: Config, errors: string[]): void {
  if (config.server.port < 1 || config.server.port > 65_535) {
    errors.push('server.port must be between 1 and 65535');
  }
  const safeLocalHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (
    !safeLocalHosts.has(config.server.host) &&
    !config.server.authToken &&
    !config.server.allowInsecure
  ) {
    errors.push(
      'server.authToken is required for non-localhost bindings unless allowInsecure is enabled',
    );
  }
  if (config.server.http.requestTimeoutMs < 1) {
    errors.push('server.http.requestTimeoutMs must be at least 1');
  }
  if (config.server.http.headersTimeoutMs < 1) {
    errors.push('server.http.headersTimeoutMs must be at least 1');
  }
  if (config.server.http.keepAliveTimeoutMs < 1) {
    errors.push('server.http.keepAliveTimeoutMs must be at least 1');
  }
  if (config.server.http.forceCloseTimeoutMs < 1) {
    errors.push('server.http.forceCloseTimeoutMs must be at least 1');
  }
  if (config.server.http.maxBodyBytes < 1) {
    errors.push('server.http.maxBodyBytes must be at least 1');
  }
  if (config.server.http.rateLimitWindowMs < 1) {
    errors.push('server.http.rateLimitWindowMs must be at least 1');
  }
  if (config.server.http.rateLimitMax < 1) {
    errors.push('server.http.rateLimitMax must be at least 1');
  }
  if (config.server.http.maxInFlight < 1) {
    errors.push('server.http.maxInFlight must be at least 1');
  }
  if (config.server.http.maxSseInFlight < 1) {
    errors.push('server.http.maxSseInFlight must be at least 1');
  }
}

function validateMcpBrowserSessionConfig(config: Config, errors: string[]): void {
  if (config.mcp.browserSessionQueueMaxPending < 1) {
    errors.push('mcp.browserSessionQueueMaxPending must be at least 1');
  } else if (config.mcp.browserSessionQueueMaxPending > 100_000) {
    errors.push('mcp.browserSessionQueueMaxPending must be at most 100000');
  }

  if (config.mcp.browserSessionQueueMaxPendingPerSession < 1) {
    errors.push('mcp.browserSessionQueueMaxPendingPerSession must be at least 1');
  } else if (config.mcp.browserSessionQueueMaxPendingPerSession > 100_000) {
    errors.push('mcp.browserSessionQueueMaxPendingPerSession must be at most 100000');
  } else if (
    config.mcp.browserSessionQueueMaxPendingPerSession > config.mcp.browserSessionQueueMaxPending
  ) {
    errors.push(
      'mcp.browserSessionQueueMaxPendingPerSession must not exceed ' +
        'mcp.browserSessionQueueMaxPending',
    );
  }

  if (config.mcp.browserSessionQueueWaitTimeoutMs < 1) {
    errors.push('mcp.browserSessionQueueWaitTimeoutMs must be at least 1');
  } else if (config.mcp.browserSessionQueueWaitTimeoutMs > 3_600_000) {
    errors.push('mcp.browserSessionQueueWaitTimeoutMs must be at most 3600000');
  }

  if (config.mcp.browserSessionSchedulerQuantumMs < 1) {
    errors.push('mcp.browserSessionSchedulerQuantumMs must be at least 1');
  } else if (config.mcp.browserSessionSchedulerQuantumMs > 60_000) {
    errors.push('mcp.browserSessionSchedulerQuantumMs must be at most 60000');
  }

  if (config.mcp.browserSessionSchedulerAgingMs < 1) {
    errors.push('mcp.browserSessionSchedulerAgingMs must be at least 1');
  } else if (config.mcp.browserSessionSchedulerAgingMs > 3_600_000) {
    errors.push('mcp.browserSessionSchedulerAgingMs must be at most 3600000');
  } else if (
    config.mcp.browserSessionSchedulerAgingMs >= config.mcp.browserSessionQueueWaitTimeoutMs
  ) {
    errors.push(
      'mcp.browserSessionSchedulerAgingMs must be less than ' +
        'mcp.browserSessionQueueWaitTimeoutMs',
    );
  }

  if (config.mcp.browserSessionExpectedConcurrency < 1) {
    errors.push('mcp.browserSessionExpectedConcurrency must be at least 1');
  } else if (config.mcp.browserSessionExpectedConcurrency > 10_000) {
    errors.push('mcp.browserSessionExpectedConcurrency must be at most 10000');
  }

  if (config.mcp.browserSessionReservedPendingPerSession < 0) {
    errors.push('mcp.browserSessionReservedPendingPerSession must not be negative');
  } else if (config.mcp.browserSessionReservedPendingPerSession > 10_000) {
    errors.push('mcp.browserSessionReservedPendingPerSession must be at most 10000');
  } else if (
    config.mcp.browserSessionExpectedConcurrency *
      config.mcp.browserSessionReservedPendingPerSession >
    config.mcp.browserSessionQueueMaxPending
  ) {
    errors.push(
      'reserved browser session capacity must not exceed mcp.browserSessionQueueMaxPending',
    );
  }

  if (config.mcp.browserSessionCostEwmaAlpha <= 0 || config.mcp.browserSessionCostEwmaAlpha > 1) {
    errors.push('mcp.browserSessionCostEwmaAlpha must be greater than 0 and at most 1');
  }
}

function validateMcpBrowserFleetConfig(config: Config, errors: string[]): void {
  if (!config.mcp.browserFleetWorkerId.trim()) {
    errors.push('mcp.browserFleetWorkerId must not be empty');
  }
  if (
    !config.mcp.browserFleetWorkers.some((worker) => worker.id === config.mcp.browserFleetWorkerId)
  ) {
    errors.push('mcp.browserFleetWorkers must contain mcp.browserFleetWorkerId');
  }
  if (!config.mcp.browserFleetWorkers.some((worker) => worker.accepting !== false)) {
    errors.push('mcp.browserFleetWorkers must contain at least one accepting worker');
  }
  if (config.mcp.browserFleetVirtualNodes < 1) {
    errors.push('mcp.browserFleetVirtualNodes must be at least 1');
  } else if (config.mcp.browserFleetVirtualNodes > 4096) {
    errors.push('mcp.browserFleetVirtualNodes must be at most 4096');
  }
  if (config.mcp.browserFleetLeaseTtlMs <= config.mcp.browserSessionQueueWaitTimeoutMs) {
    errors.push('mcp.browserFleetLeaseTtlMs must exceed mcp.browserSessionQueueWaitTimeoutMs');
  }
  if (config.mcp.browserFleetMaxLocalLeases < 1) {
    errors.push('mcp.browserFleetMaxLocalLeases must be at least 1');
  } else if (config.mcp.browserFleetMaxLocalLeases > 1_000_000) {
    errors.push('mcp.browserFleetMaxLocalLeases must be at most 1000000');
  }
}

function validateMcpToolActivationConfig(config: Config, errors: string[]): void {
  if (config.mcp.toolActivationBudgetTokens < 1) {
    errors.push('mcp.toolActivationBudgetTokens must be at least 1');
  }
  if (config.mcp.toolActivationMaxTools < 1) {
    errors.push('mcp.toolActivationMaxTools must be at least 1');
  }
}

function validatePerformanceConfig(config: Config, errors: string[]): void {
  if (config.performance.maxConcurrentAnalysis < 1) {
    errors.push('maxConcurrentAnalysis must be at least 1');
  } else if (config.performance.maxConcurrentAnalysis > 32) {
    errors.push('maxConcurrentAnalysis must be at most 32');
  }

  if (config.performance.maxCodeSizeMB < 1) {
    errors.push('maxCodeSizeMB must be at least 1');
  } else if (config.performance.maxCodeSizeMB > 500) {
    errors.push('maxCodeSizeMB must be at most 500');
  }
}

function validatePuppeteerConfig(config: Config, errors: string[]): void {
  if (config.puppeteer.timeout < 1000) {
    errors.push('puppeteer.timeout must be at least 1000ms');
  } else if (config.puppeteer.timeout > 300_000) {
    errors.push('puppeteer.timeout must be at most 300000ms');
  }
}

function validateToolExecutionRules(config: Config, errors: string[]): void {
  for (const [index, rule] of (config.toolExecution?.rules ?? []).entries()) {
    if (typeof rule.tool !== 'string' || rule.tool.trim().length === 0) {
      errors.push(`toolExecution.rules[${index}].tool must be a non-empty string`);
    } else if (rule.tool !== '*' && !rule.tool.endsWith('/*') && rule.tool.includes('*')) {
      errors.push(
        `toolExecution.rules[${index}].tool only supports exact names, "domain/*" or "*"`,
      );
    }
    if (rule.action !== 'allow' && rule.action !== 'deny') {
      errors.push(`toolExecution.rules[${index}].action must be "allow" or "deny"`);
    }
  }
}

function validateCacheConfig(config: Config, errors: string[]): void {
  if (config.cache.ttl < 0) {
    errors.push('cache.ttl must be non-negative');
  }
}

function validateOffloaderConfig(config: Config, errors: string[]): void {
  if ((config.offloader?.detailThreshold ?? 1) < 1) {
    errors.push('offloader.detailThreshold must be at least 1');
  }
  if ((config.offloader?.fileThreshold ?? 1) < 1) {
    errors.push('offloader.fileThreshold must be at least 1');
  } else if (
    config.offloader?.detailThreshold !== undefined &&
    config.offloader.fileThreshold !== undefined &&
    config.offloader.fileThreshold < config.offloader.detailThreshold
  ) {
    errors.push('offloader.fileThreshold must not be less than offloader.detailThreshold');
  }
}

function validateReverseEngineeringConfig(config: Config, errors: string[]): void {
  const reverse = config.reverseEngineering;
  if (reverse.transformWorkbench.defaultPreviewBytes > reverse.transformWorkbench.maxPreviewBytes) {
    errors.push('reverseEngineering default preview must not exceed max preview');
  }
  if (reverse.apk.staticTriageMinEntries > reverse.apk.staticTriageDefaultEntries) {
    errors.push('reverseEngineering APK minimum entries must not exceed the default');
  }
  if (reverse.apk.staticTriageDefaultEntries > reverse.apk.staticTriageMaxEntries) {
    errors.push('reverseEngineering APK default entries must not exceed the maximum');
  }
  if (reverse.apk.dexIntakeDefaultDexFiles > reverse.apk.dexIntakeMaxDexFiles) {
    errors.push('reverseEngineering APK default DEX files must not exceed the maximum');
  }
  if (reverse.dex.scanDefaultMaxHits > reverse.dex.scanMaxHits) {
    errors.push('reverseEngineering DEX default hits must not exceed the maximum');
  }
  if (reverse.dex.artifactDefaultLimit > reverse.dex.artifactMaxLimit) {
    errors.push('reverseEngineering DEX default artifact limit must not exceed the maximum');
  }
}

function validateSearchConfig(config: Config, errors: string[]): void {
  if (
    config.search.vectorCosineWeight !== undefined &&
    (config.search.vectorCosineWeight < 0 || config.search.vectorCosineWeight > 10)
  ) {
    errors.push('search.vectorCosineWeight must be between 0 and 10');
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
}

export function validateConfig(config: Config): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  validateServerConfig(config, errors);
  validateMcpBrowserSessionConfig(config, errors);
  validateMcpBrowserFleetConfig(config, errors);
  validateMcpToolActivationConfig(config, errors);
  validatePerformanceConfig(config, errors);
  validatePuppeteerConfig(config, errors);
  validateToolExecutionRules(config, errors);
  validateCacheConfig(config, errors);
  validateOffloaderConfig(config, errors);
  validateReverseEngineeringConfig(config, errors);
  validateSearchConfig(config, errors);
  return { valid: errors.length === 0, errors };
}
