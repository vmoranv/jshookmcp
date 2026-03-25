/**
 * Common type definitions for MCP Tool test responses to eliminate 'any' usage.
 */

export interface CommonSuccessResponse {
  success: boolean;
  error?: string;
  tool?: string;
}

export interface ListPagesResponse extends CommonSuccessResponse {
  pages: Array<{
    id: string;
    url: string;
    title: string;
    index: number;
  }>;
}

export interface BrowserStatusResponse extends CommonSuccessResponse {
  connected?: boolean;
  driver?: 'chrome' | 'camoufox' | 'playwright' | string;
  pageCount?: number;
  pages?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface BrowserLaunchResponse extends CommonSuccessResponse {
  driver: string;
  mode: string;
  status: {
    connected: boolean;
  };
  endpoint?: string;
  wsEndpoint?: string;
}

export interface BrowserCloseResponse extends CommonSuccessResponse {
  message: string;
}

export interface BrowserListTabsResponse extends CommonSuccessResponse {
  count: number;
  pages: Array<{
    pageId: string;
    url: string;
    title: string;
    index: number;
    aliases: string[];
  }>;
  currentPageId: string | null;
  hint?: string;
}

export interface BrowserSelectTabResponse extends CommonSuccessResponse {
  selectedIndex: number;
  url: string;
  title: string;
  activeContextRefreshed: boolean;
  networkMonitoringEnabled?: boolean;
  consoleMonitoringEnabled?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  availablePages?: any[];
}

export interface BrowserAttachResponse extends CommonSuccessResponse {
  selectedIndex: number;
  totalPages: number;
  takeoverReady: boolean;
  currentUrl?: string;
}

export interface PageEvaluateResponse extends CommonSuccessResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  result: any;
  driver?: string;
}

export interface PageScreenshotResponse extends CommonSuccessResponse {
  path: string;
  displayPath: string;
  size: number;
  selector?: string;
  driver?: string;
  mode?: 'single' | 'batch';
  total?: number;
  succeeded?: number;
  results?: Array<{
    selector: string;
    success: boolean;
    path?: string;
    displayPath?: string;
    error?: string;
  }>;
}

export interface PageInjectScriptResponse extends CommonSuccessResponse {
  message: string;
}

export interface PageWaitForSelectorResponse extends CommonSuccessResponse {
  message: string;
  driver?: string;
  element?: {
    tagName: string;
    id: string;
    className: string;
    textContent: string;
    attributes: Record<string, string>;
  };
}

export interface PageInteractionResponse extends CommonSuccessResponse {
  message: string;
  driver?: string;
  navigated?: boolean;
}

export interface PageClickResponse extends PageInteractionResponse {
  selector?: string;
}

export interface PageTypeResponse extends PageInteractionResponse {
  selector?: string;
}

export interface PageSelectResponse extends PageInteractionResponse {
  selector?: string;
}

export interface PagePressKeyResponse extends PageInteractionResponse {
  key: string;
}

export interface TabWorkflowResponse extends CommonSuccessResponse {
  pageId?: string;
  bound?: {
    alias: string;
    pageId: string;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  aliases?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  staleAliases?: any[];
  found?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  value?: any;
}

export interface GenericDataResponse<T> extends CommonSuccessResponse {
  data: T;
}

export interface AnalysisResult extends CommonSuccessResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  findings: any[]; // Still some any here but localized
  summary: string;
}

export interface CaptchaDetectionResult extends CommonSuccessResponse {
  detected: boolean;
  type?: string;
  confidence?: number;
}

export interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  timestamp?: number;
  type?: string;
}

export interface NetworkRequestsResponse extends CommonSuccessResponse {
  message?: string;
  requests: NetworkRequest[];
  total: number;
  tip?: string;
  detail?: string;
  possibleReasons?: string[];
  recommended_actions?: string[];
  monitoring?: {
    autoEnabled: boolean;
  };
  filtered?: boolean;
  page?: {
    offset: number;
    limit: number;
    returned: number;
    totalAfterFilter: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
  filterMiss?: boolean;
  hint?: string;
  urlSamples?: string[];
  // Performance optimization fields
  staticResourcesExcluded?: number;
  staticFilterNote?: string;
  optimizationHint?: string;
}

export interface NetworkResponseBodyResponse extends CommonSuccessResponse {
  message?: string;
  body?: string;
  base64Encoded?: boolean;
  requestId?: string;
  attempts?: number;
  summary?: {
    size: number;
    sizeKB: string;
    base64Encoded: boolean;
    preview: string;
    truncated: boolean;
    reason: string;
  };
}

export interface NetworkStatsResponse extends CommonSuccessResponse {
  message?: string;
  hint?: string;
  stats: {
    totalRequests: number;
    totalResponses: number;
    byMethod: Record<string, number>;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    timeStats: {
      earliest: number;
      latest: number;
      duration: number;
    } | null;
  };
}

export interface NetworkStatusResponse extends CommonSuccessResponse {
  enabled: boolean;
  requestCount?: number;
  responseCount?: number;
  listenerCount?: number;
  cdpSessionActive?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  usage?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  nextSteps?: any;
  example?: string;
}

export interface NetworkExtractAuthResponse extends CommonSuccessResponse {
  message?: string;
  scannedRequests: number;
  found: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  findings: any[];
}

export interface NetworkExportHarResponse extends CommonSuccessResponse {
  message?: string;
  entryCount: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  har?: any;
}

export interface NetworkReplayResponse extends CommonSuccessResponse {
  dryRun?: boolean;
  requestId?: string;
  url?: string;
  hint?: string;
}

export interface PerformanceGetMetricsResponse extends CommonSuccessResponse {
  metrics: Record<string, number>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  timeline?: any[];
}

export interface PerformanceCoverageResponse extends CommonSuccessResponse {
  message?: string;
  totalScripts?: number;
  avgCoverage?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  coverage?: any[];
}

export interface PerformanceHeapSnapshotResponse extends CommonSuccessResponse {
  message?: string;
  snapshotSize?: number;
}

export interface PerformanceTraceResponse extends CommonSuccessResponse {
  message?: string;
  artifactPath?: string;
  eventCount?: number;
  sizeBytes?: number;
  sizeKB?: string;
  hint?: string;
}

export interface ProfilerCpuResponse extends CommonSuccessResponse {
  message?: string;
  artifactPath?: string;
  totalNodes?: number;
  totalSamples?: number;
  durationMs?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  hotFunctions?: any[];
}

export interface ProfilerHeapSamplingResponse extends CommonSuccessResponse {
  message?: string;
  artifactPath?: string;
  sampleCount?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  topAllocations?: any[];
}

export interface BinaryDetectFormatResponse extends CommonSuccessResponse {
  source: string;
  byteLength: number;
  encodingSignals: string[];
  entropy: number;
  assessment: string;
  previewHex: string;
  magicFormats?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  topBytes?: any[];
  requestBodyUsed?: boolean;
  requestId?: string | null;
}

export interface BinaryDecodeResponse extends CommonSuccessResponse {
  encoding: string;
  outputFormat: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  result: any;
  byteLength?: number;
  hexDump?: string;
}

export interface BinaryEncodeResponse extends CommonSuccessResponse {
  inputFormat: string;
  outputEncoding: string;
  output: string;
  byteLength: number;
}

export interface BinaryEntropyAnalysisResponse extends CommonSuccessResponse {
  source: string;
  overallEntropy: number;
  assessment: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  blockEntropies: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  byteFrequency: any[];
  byteLength: number;
  blockSize?: number;
}

export interface ProtobufDecodeRawResponse extends CommonSuccessResponse {
  byteLength: number;
  parsedBytes: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  fields: any[];
  maxDepth?: number;
}

export interface WorkflowScriptRegisterResponse extends CommonSuccessResponse {
  action?: 'registered' | 'updated';
  name?: string;
  description?: string;
  available?: string[];
}

export interface WorkflowScriptRunResponse extends CommonSuccessResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  value?: any;
  script?: string;
  available?: string[];
}

export interface WorkflowListExtensionsResponse extends CommonSuccessResponse {
  count: number;
  workflows: Array<{
    id: string;
    displayName: string;
    description: string;
    tags: string[];
    timeoutMs: number;
    defaultMaxConcurrency: number;
    source: string;
  }>;
}

export interface WorkflowRunExtensionResponse extends CommonSuccessResponse {
  workflowId?: string;
  available?: string[];
}
