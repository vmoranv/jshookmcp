export interface Config {
  puppeteer: PuppeteerConfig;
  server: ServerConfig;
  mcp: MCPConfig;
  cache: CacheConfig;
  paths: PathsConfig;
  performance: PerformanceConfig;
  search: SearchConfig;
  reverseEngineering: ReverseEngineeringConfig;
  extensions: ExtensionRuntimeConfig;
  captcha: CaptchaRuntimeConfig;
  /** Large-data response offloading (LargeDataOffloader). Optional — omitted in tests. */
  offloader?: OffloaderConfig;
  /**
   * Tool-execution permission gate (ordered rules + legacy allowTools
   * whitelist). Optional — omitted when tests build partial configs; a
   * missing section behaves exactly as before the gate existed (allow all).
   */
  toolExecution?: ToolExecutionConfig;
  /**
   * Span/metric export (see `src/server/observability/`).
   *
   * Reachable from the shipped loader: `getConfig()` builds it from
   * `JSHOOK_OBSERVABILITY_EXPORTER` (default `otlp` — telemetry ships ON,
   * opt-out) / `JSHOOK_OBSERVABILITY_MAX_SPANS` / `JSHOOK_OTLP_QUERY_TEXT`.
   * Without any OTel env the exporters target the built-in project ingress
   * (see src/constants/telemetry.ts); `OTEL_EXPORTER_OTLP_ENDPOINT` /
   * `OTEL_EXPORTER_OTLP_HEADERS` redirect to an operator-owned collector.
   */
  observability?: ObservabilityConfig;
}

/**
 * Where instrumentation samples go.
 *
 * `none` (explicit opt-out) is `NoopInstrumentation`: the interface is called
 * at real sites, and every call does nothing. `memory`
 * selects `InMemoryInstrumentation`, a bounded in-process buffer that can be
 * inspected — useful for diagnosing, and for proving the wiring works. Note
 * that nothing in `src/` calls `snapshot()`, so the buffer has no production
 * reader either; a health endpoint or shutdown flush is still missing.
 *
 * `otlp` selects `OtlpInstrumentation`: spans and metrics stream to any
 * OTLP/HTTP endpoint (self-hosted collector, SigNoz, Grafana Cloud, a
 * Cloudflare Worker receiver). The endpoint and auth headers come from the
 * standard OTEL_EXPORTER_OTLP_* env vars; `queryText` bounds how much of the
 * search query string leaves the process (reverse-engineering queries can
 * embed target URLs and credentials).
 */
export interface ObservabilityConfig {
  exporter?: 'none' | 'memory' | 'otlp';
  /**
   * Span window size for the `memory` exporter. Bounded on purpose: a process
   * that keeps one span per tool call forever is a memory leak.
   */
  maxSpans?: number;
  /**
   * Capture policy for the `search.query` span's text attribute:
   * `truncated` (default, first 64 chars + overflow marker), `full`, `off`.
   */
  queryText?: 'off' | 'truncated' | 'full';
  /**
   * Capture policy for `tool.execute` span arguments: `shape` (default,
   * argument KEY NAMES only — values are never collected), `truncated`
   * (values at 32 chars, credential-ish keys masked), `full` (values, still
   * credential-masked and size-capped), `off`.
   */
  toolArgs?: 'off' | 'shape' | 'truncated' | 'full';
  /**
   * How often the OTLP metric exporter flushes, in milliseconds.
   *
   * This is the dominant driver of metric ROW VOLUME: each flush window emits
   * one row per (tool, outcome) combination seen in it, so halving the flush
   * rate halves the rows written. D1's free tier allows 100k rows written per
   * day, and the measured 60s cadence burned it (2026-11-18: 63,877 metric
   * rows + 43,328 span-index writes in 24h, ingestion dead for the rest of
   * the day). 120s is the shipped default: fine-grained enough for CI-shaped
   * traffic, half the rows.
   */
  metricExportIntervalMs?: number;
}

/** One ordered tool-execution permission rule (the LAST matching rule wins). */
export interface ToolExecutionRuleConfig {
  /**
   * Tool selector: an exact tool name, a `domain/*` wildcard (matches every
   * tool whose name starts with `domain_`, e.g. `page/*` matches
   * `page_navigate`), or `*` (matches everything).
   */
  tool: string;
  /**
   * Optional wildcard pattern (`*` = any run of characters) matched against
   * the stable JSON serialization of the tool arguments.
   */
  pattern?: string;
  action: 'allow' | 'deny';
}

/** Tool-execution permission gate configuration. */
export interface ToolExecutionConfig {
  /**
   * Legacy flat tool-name whitelist, kept for backward compatibility. When
   * non-empty, tools outside the list are denied. Compiled into equivalent
   * allow rules that precede `rules` in the ordered rule list.
   */
  allowTools: string[];
  /**
   * Ordered permission rules. Compiled after the `allowTools` expansion, so a
   * matching user rule always takes precedence over the legacy whitelist.
   */
  rules: ToolExecutionRuleConfig[];
}

export type MCPTransportMode = 'stdio' | 'http';

/** Typed startup and HTTP transport configuration. */
export interface ServerConfig {
  transport: MCPTransportMode;
  host: string;
  port: number;
  /** Sensitive value; callers must never serialize the full config to logs. */
  authToken?: string;
  allowInsecure: boolean;
  healthVerbose: boolean;
  logging: {
    enabled: boolean;
    level: 'debug' | 'info' | 'warning' | 'error';
    fileDir?: string;
  };
  http: {
    requestTimeoutMs: number;
    headersTimeoutMs: number;
    keepAliveTimeoutMs: number;
    forceCloseTimeoutMs: number;
    maxBodyBytes: number;
    rateLimitEnabled: boolean;
    rateLimitWindowMs: number;
    rateLimitMax: number;
    trustProxy: boolean;
    maxInFlight: number;
    maxSseInFlight: number;
  };
}

/** Extension discovery and pre-import trust-boundary configuration. */
export interface ExtensionRuntimeConfig {
  registryBaseUrl?: string;
  pluginRoots: string[];
  workflowRoots: string[];
  allowedDigests: string[];
  signatureRequired: boolean;
  strictLoad: boolean;
}

/** External CAPTCHA service configuration. */
export interface CaptchaRuntimeConfig {
  provider: string;
  /** Sensitive value; callers must never serialize the full config to logs. */
  apiKey?: string;
  solverBaseUrl?: string;
  antiCaptchaBaseUrl?: string;
  capSolverBaseUrl?: string;
}

/**
 * Response-offloader tuning. Mirrors the OffloaderConfig accepted by
 * LargeDataOffloader (@server/ToolResponseOffloader); excludeTools is
 * expressed as a string[] here because it originates from a CSV env var.
 */
export interface OffloaderConfig {
  /** Strings larger than this (bytes) go to DetailedDataManager. */
  detailThreshold?: number;
  /** Strings larger than this (bytes) go directly to a file. */
  fileThreshold?: number;
  /** Subdirectory under project root for offloaded files. */
  outputDir?: string;
  /** Tools excluded from offloading (comma-separated env). */
  excludeTools?: string[];
}

export interface PuppeteerConfig {
  headless: boolean;
  timeout: number;
  executablePath?: string;
  args?: string[];
  viewport?: { width: number; height: number };
  userAgent?: string;
  maxCollectedUrls?: number;
  maxFilesPerCollect?: number;
  maxTotalContentSize?: number;
  maxSingleFileSize?: number;
}

export interface MCPConfig {
  name: string;
  version: string;
  toolProfile: 'search' | 'workflow' | 'full';
  toolDomains: string[];
  browserSessionSchedulerPolicy: 'eevdf' | 'drr-aging';
  browserSessionQueueMaxPending: number;
  browserSessionQueueMaxPendingPerSession: number;
  browserSessionQueueWaitTimeoutMs: number;
  browserSessionSchedulerQuantumMs: number;
  browserSessionSchedulerAgingMs: number;
  browserSessionExpectedConcurrency: number;
  browserSessionReservedPendingPerSession: number;
  browserSessionCostEwmaAlpha: number;
  browserFleetWorkerId: string;
  browserFleetWorkers: BrowserFleetWorkerConfig[];
  browserFleetVirtualNodes: number;
  browserFleetLeaseTtlMs: number;
  browserFleetMaxLocalLeases: number;
  /** Token budget for dynamically activated tools (search profile only). */
  toolActivationBudgetTokens: number;
  /** Max count of dynamically activated tools (search profile only). */
  toolActivationMaxTools: number;
}

export interface BrowserFleetWorkerConfig {
  id: string;
  endpoint?: string;
  weight?: number;
  accepting?: boolean;
}

export interface CacheConfig {
  enabled: boolean;
  dir: string;
  ttl: number;
}

export interface PathsConfig {
  screenshotDir: string;
  captchaScreenshotDir: string;
  debuggerSessionsDir: string;
  extensionRegistryDir: string;
  tlsKeyLogDir: string;
  registryCacheDir: string;
}

export interface PerformanceConfig {
  maxConcurrentAnalysis: number;
  maxCodeSizeMB: number;
}

export interface SearchConfig {
  queryCategoryProfiles: SearchQueryCategoryProfileConfig[];
  cjkQueryAliases: SearchCjkQueryAliasConfig[];
  intentToolBoostRules: SearchIntentToolBoostRuleConfig[];
}

export interface SearchQueryCategoryProfileConfig {
  pattern: string;
  flags?: string;
  domainBoosts: Array<{
    domain: string;
    weight: number;
  }>;
}

export interface SearchCjkQueryAliasConfig {
  pattern: string;
  flags?: string;
  tokens: string[];
}

export interface SearchIntentToolBoostRuleConfig {
  pattern: string;
  flags?: string;
  boosts: Array<{
    tool: string;
    bonus: number;
  }>;
}

export interface ReverseEngineeringConfig {
  transformWorkbench: TransformWorkbenchConfig;
  reverseSession: ReverseSessionConfig;
  binaryMagic: BinaryMagicConfig;
  nativeEmulator: NativeEmulatorConfig;
  apk: ApkAnalysisConfig;
  jadx: JadxConfig;
  dex: DexAnalysisConfig;
  frida: FridaAnalysisConfig;
  androidRuntime: AndroidRuntimeConfig;
  collector: CollectorConfig;
}

/** Code-collection tuning used by the collector when options omit values. */
export interface CollectorConfig {
  /** Default navigation/collection timeout (ms) when not otherwise configured. */
  defaultTimeoutMs: number;
  /** How long to wait after navigation for late-loading dynamic scripts (ms). */
  dynamicScriptWaitMs: number;
}

export interface TransformWorkbenchConfig {
  defaultPreviewBytes: number;
  maxPreviewBytes: number;
  textSampleBytes: number;
  maxInputBytes: number;
  maxOutputBytes: number;
  maxSteps: number;
}

export interface ReverseSessionConfig {
  maxInlineTransformInputBytes: number;
  promotedTransformPreviewBytes: number;
  runMaxSteps: number;
  evidenceRefSegmentMaxChars: number;
}

export interface BinaryMagicConfig {
  hintPrefixMaxBytes: number;
  dexMagicAscii: string;
  compactDexMagicAscii: string;
}

export interface NativeEmulatorConfig {
  cstringDefaultLimitBytes: number;
  cstringReadChunkBytes: number;
  guestPageSizeBytes: number;
  syscallCStringLimitBytes: number;
  rawMemoryMaxBytes: number;
  rawMemoryPreviewBytes: number;
}

export interface JadxConfig {
  /** Timeout for full APK decompile (jadx_decompile_apk), ms. */
  decompileTimeoutMs: number;
  /** Timeout for search-targeted decompile (jadx_search_code), ms. */
  searchTimeoutMs: number;
  /** Timeout for single-class decompile (jadx_decompile), ms. */
  singleClassTimeoutMs: number;
  /** JADX thread count (--threads-count / -j). */
  threadsCount: number;
}

export interface ApkAnalysisConfig {
  staticTriageMinEntries: number;
  staticTriageDefaultEntries: number;
  staticTriageMaxEntries: number;
  staticTriageAssetHintLimit: number;
  staticTriageNativeLibLimit: number;
  dexIntakeDefaultDexFiles: number;
  dexIntakeMaxDexFiles: number;
  dexIntakeManifestTextSampleBytes: number;
  dexIntakeManifestControlByteRatio: number;
  dexIntakeComponentLimit: number;
  dexIntakeFeatureLimit: number;
  dexIntakeUniqueLimitDefault: number;
}

export interface DexAnalysisConfig {
  scanDefaultMaxHits: number;
  scanMaxHits: number;
  scanMaxExtractBytes: number;
  artifactDefaultLimit: number;
  artifactMaxLimit: number;
  artifactMinReadBytes: number;
  artifactDefaultMaxFileBytes: number;
  artifactDefaultMaxTotalBytes: number;
  artifactMaxReadBytes: number;
  stringScanMaxBytes: number;
}

export interface FridaAnalysisConfig {
  dexDumpTimeoutMs: number;
  dexDumpMaxBufferBytes: number;
  dexDumpFileLimit: number;
  /** Default CLI timeout (ms) for attach/spawn probes on non-local devices. Remote first-packet handshakes are slower than local. */
  remoteTimeoutMs: number;
  /** Default CLI timeout (ms) for frida-ls-devices / frida-ps discovery probes. */
  deviceProbeTimeoutMs: number;
}

export interface AndroidRuntimeConfig {
  mapsMaxBytes: number;
  mapsModuleLimit: number;
}
