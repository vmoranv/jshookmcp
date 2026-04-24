export interface Config {
  puppeteer: PuppeteerConfig;
  mcp: MCPConfig;
  cache: CacheConfig;
  paths: PathsConfig;
  performance: PerformanceConfig;
  search: SearchConfig;
  validation: ValidationConfig;
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
  vectorEnabled?: boolean;
  vectorModelId?: string;
  vectorCosineWeight?: number;
  vectorDynamicWeight?: boolean;
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

export interface ValidationConfig {
  // URLs
  captchaSolverBaseUrl?: string;
  extensionRegistryBaseUrl?: string;
  burpMcpSseUrl?: string;

  // Ports
  mcpPort?: number;
  defaultDebugPort?: number;

  // API Keys/Tokens
  captchaApiKey?: string;
  mcpAuthToken?: string;
  mcpPluginSignatureSecret?: string;

  // Logging and runtime
  logLevel: string;
  runtimeErrorWindowMs: number;
  runtimeErrorThreshold: number;

  // HTTP and transport
  mcpTransport: string;
  mcpHost: string;
  mcpAllowInsecure: boolean;
  mcpMaxBodyBytes: number;
  mcpRateLimitWindowMs: number;
  mcpRateLimitMax: number;
  mcpHttpRequestTimeoutMs: number;
  mcpHttpHeadersTimeoutMs: number;
  mcpHttpKeepaliveTimeoutMs: number;
  mcpHttpForceCloseTimeoutMs: number;

  // Tool and plugin configuration
  mcpToolProfile: string;
  mcpToolDomains?: string;
  mcpDefaultPluginBoostTier: string;
  mcpPluginRoots?: string;
  mcpWorkflowRoots?: string;
  mcpPluginAllowedDigests?: string;
  mcpPluginSignatureRequired?: boolean;
  mcpPluginStrictLoad?: boolean;

  // Cache and performance
  cacheGlobalMaxSizeBytes: number;
  tokenBudgetMaxTokens: number;
  detailedDataDefaultTtlMs: number;
  detailedDataMaxTtlMs: number;
  detailedDataSmartThresholdBytes: number;
  jshookIoConcurrency: number;
  jshookCpuConcurrency: number;
  jshookCdpConcurrency: number;

  // Worker pools
  workerPoolMinWorkers: number;
  workerPoolMaxWorkers: number;
  workerPoolIdleTimeoutMs: number;
  workerPoolJobTimeoutMs: number;

  // Parallel execution
  parallelDefaultConcurrency: number;
  parallelDefaultTimeoutMs: number;
  parallelDefaultMaxRetries: number;
  parallelRetryBackoffBaseMs: number;

  // External tools and sandbox
  externalToolTimeoutMs: number;
  externalToolProbeTimeoutMs: number;
  externalToolProbeCacheTtlMs: number;
  externalToolForceKillGraceMs: number;
  externalToolMaxStdoutBytes: number;
  externalToolMaxStderrBytes: number;
  sandboxExecTimeoutMs: number;
  sandboxMemoryLimitMb: number;
  sandboxStackSizeMb: number;
  sandboxTerminateGraceMs: number;

  // Symbolic execution
  symbolicExecMaxPaths: number;
  symbolicExecMaxDepth: number;
  symbolicExecTimeoutMs: number;
  packerSandboxTimeoutMs: number;

  // LLM token limits
  advDeobfLlmMaxTokens: number;
  vmDeobfLlmMaxTokens: number;
  deobfLlmMaxTokens: number;
  cryptoDetectLlmMaxTokens: number;

  // Workflow batch processing
  workflowBatchMaxRetries: number;
  workflowBatchMaxTimeoutMs: number;
  workflowBundleCacheTtlMs: number;
  workflowBundleCacheMaxBytes: number;

  // Memory operations
  memoryReadTimeoutMs: number;
  memoryMaxReadBytes: number;
  memoryWriteTimeoutMs: number;
  memoryMaxWriteBytes: number;
  memoryDumpTimeoutMs: number;
  memoryScanTimeoutMs: number;
  memoryScanMaxBufferBytes: number;
  memoryScanMaxResults: number;
  memoryScanMaxRegions: number;
  memoryScanRegionMaxBytes: number;
  memoryInjectTimeoutMs: number;
  memoryMonitorIntervalMs: number;
  memoryVmMapTimeoutMs: number;
  memoryProtectionQueryTimeoutMs: number;
  memoryProtectionPwshTimeoutMs: number;

  // Native operations
  nativeAdminCheckTimeoutMs: number;
  nativeScanMaxResults: number;
  processLaunchWaitMs: number;
  winDebugPortPollAttempts: number;
  winDebugPortPollIntervalMs: number;

  // CAPTCHA
  captchaProvider: string;
  captchaDefaultTimeoutMs: number;
}
