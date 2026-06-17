export type NetworkInitiator = unknown;
export type NetworkTiming = unknown;

export interface NetworkRequest {
  requestId: string;
  rawRequestId?: string;
  sessionId?: string;
  targetId?: string;
  targetType?: string;
  frameId?: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  timestamp: number;
  type?: string;
  httpVersion?: string;
  initiator?: NetworkInitiator;
}

export interface NetworkResponse {
  requestId: string;
  rawRequestId?: string;
  sessionId?: string;
  targetId?: string;
  targetType?: string;
  frameId?: string;
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  mimeType: string;
  timestamp: number;
  fromCache?: boolean;
  timing?: NetworkTiming;
  protocol?: string;
}

export interface NetworkStatus {
  enabled: boolean;
  requestCount: number;
  responseCount: number;
  listenerCount: number;
  cdpSessionActive: boolean;
}

export interface NetworkActivity {
  request?: NetworkRequest;
  response?: NetworkResponse;
}

export interface NetworkResponseBody {
  body: string;
  base64Encoded: boolean;
}

export interface NetworkStats extends Record<string, unknown> {
  totalRequests: number;
  totalResponses: number;
  byMethod: Record<string, number>;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
}

export interface NetworkMonitorLike {
  enable(): Promise<void>;
  disable(): Promise<void>;
  isEnabled(): boolean;
  getStatus(): NetworkStatus;
  getRequests(filter?: { url?: string; method?: string; limit?: number }): NetworkRequest[];
  getResponses(filter?: { url?: string; status?: number; limit?: number }): NetworkResponse[];
  getActivity(requestId: string): NetworkActivity;
  getResponseBody(requestId: string): Promise<NetworkResponseBody | null>;
  getAllJavaScriptResponses(): Promise<
    Array<{
      url: string;
      content: string;
      size: number;
      requestId: string;
    }>
  >;
  clearRecords(): void;
  clearInjectedBuffers(): Promise<{ xhrCleared: number; fetchCleared: number }>;
  resetInjectedInterceptors(): Promise<{ xhrReset: boolean; fetchReset: boolean }>;
  getStats(): NetworkStats;
  injectXHRInterceptor(options?: { persistent?: boolean }): Promise<void>;
  injectFetchInterceptor(options?: { persistent?: boolean }): Promise<void>;
  getXHRRequests(): Promise<Record<string, unknown>[]>;
  getFetchRequests(): Promise<Record<string, unknown>[]>;
  persistsAcrossContextSwitches?(): boolean;
}
