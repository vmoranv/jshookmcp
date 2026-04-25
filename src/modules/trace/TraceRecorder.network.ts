import { writeFile } from 'node:fs/promises';
import type { TraceDB } from '@modules/trace/TraceDB';
import type { NetworkTraceChunk, NetworkTraceResource } from '@modules/trace/TraceDB.types';
import {
  asFiniteNumber,
  asString,
  createNetworkTraceResource,
  DEFAULT_NETWORK_CAPTURE,
  extractRemoteAddress,
  extractRequestId,
  isObjectRecord,
  isResponseBodyPayload,
  type EventTiming,
} from '@modules/trace/TraceRecorder.internal';
import type {
  CDPSessionLike,
  TraceNetworkCaptureOptions,
} from '@modules/trace/TraceRecorder.types';
import { resolveArtifactPath } from '@utils/artifacts';

interface TraceNetworkCaptureDeps {
  getDb: () => TraceDB | null;
  getCdpSession: () => CDPSessionLike | null;
  trackOperation: (operation: Promise<void>) => void;
}

interface TraceNetworkCaptureCounts {
  networkRequestCount: number;
  networkChunkCount: number;
  networkBodyCount: number;
}

export class TraceNetworkCapture {
  private readonly resources = new Map<string, NetworkTraceResource>();
  private options: Required<TraceNetworkCaptureOptions> = { ...DEFAULT_NETWORK_CAPTURE };
  private counts: TraceNetworkCaptureCounts = {
    networkRequestCount: 0,
    networkChunkCount: 0,
    networkBodyCount: 0,
  };

  constructor(private readonly deps: TraceNetworkCaptureDeps) {}

  configure(options?: TraceNetworkCaptureOptions): Required<TraceNetworkCaptureOptions> {
    this.resources.clear();
    this.counts = {
      networkRequestCount: 0,
      networkChunkCount: 0,
      networkBodyCount: 0,
    };
    this.options = {
      ...DEFAULT_NETWORK_CAPTURE,
      ...options,
    };
    return this.getOptions();
  }

  clear(): void {
    this.resources.clear();
    this.counts = {
      networkRequestCount: 0,
      networkChunkCount: 0,
      networkBodyCount: 0,
    };
  }

  getOptions(): Required<TraceNetworkCaptureOptions> {
    return { ...this.options };
  }

  getCounts(): TraceNetworkCaptureCounts {
    return { ...this.counts };
  }

  handleEvent(eventName: string, params: unknown, timing: EventTiming): void {
    const requestId = extractRequestId(params);
    if (!requestId) return;

    switch (eventName) {
      case 'Network.requestWillBeSent':
        this.handleRequestWillBeSent(requestId, params, timing);
        return;
      case 'Network.requestServedFromCache':
        this.handleRequestServedFromCache(requestId);
        return;
      case 'Network.responseReceived':
        this.handleResponseReceived(requestId, params, timing);
        return;
      case 'Network.dataReceived':
        this.handleDataReceived(requestId, params, timing);
        return;
      case 'Network.loadingFinished':
        this.handleLoadingFinished(requestId, params, timing);
        return;
      case 'Network.loadingFailed':
        this.handleLoadingFailed(requestId, params, timing);
        return;
      default:
        return;
    }
  }

  private handleRequestWillBeSent(requestId: string, params: unknown, timing: EventTiming): void {
    const resource = this.getOrCreateResource(requestId);
    const request =
      isObjectRecord(params) && isObjectRecord(params['request']) ? params['request'] : null;

    resource.url = request ? asString(request['url']) : resource.url;
    resource.method = request ? asString(request['method']) : resource.method;
    resource.resourceType =
      isObjectRecord(params) && typeof params['type'] === 'string'
        ? (params['type'] as string)
        : resource.resourceType;
    resource.requestHeaders = request
      ? JSON.stringify(request['headers'] ?? {})
      : resource.requestHeaders;
    resource.requestPostData = request ? asString(request['postData']) : resource.requestPostData;
    resource.startedWallTime = timing.wallTime ?? resource.startedWallTime ?? timing.timestamp;
    resource.startedMonotonicTime = timing.monotonicTime ?? resource.startedMonotonicTime;

    this.syncResource(resource);
  }

  private handleRequestServedFromCache(requestId: string): void {
    const resource = this.getOrCreateResource(requestId);
    resource.fromDiskCache = true;
    this.syncResource(resource);
  }

  private handleResponseReceived(requestId: string, params: unknown, timing: EventTiming): void {
    const resource = this.getOrCreateResource(requestId);
    const response =
      isObjectRecord(params) && isObjectRecord(params['response']) ? params['response'] : null;

    resource.url = response ? (asString(response['url']) ?? resource.url) : resource.url;
    resource.status = response ? asFiniteNumber(response['status']) : resource.status;
    resource.statusText = response ? asString(response['statusText']) : resource.statusText;
    resource.responseHeaders = response
      ? JSON.stringify(response['headers'] ?? {})
      : resource.responseHeaders;
    resource.mimeType = response ? asString(response['mimeType']) : resource.mimeType;
    resource.protocol = response ? asString(response['protocol']) : resource.protocol;
    resource.remoteAddress = response ? extractRemoteAddress(response) : resource.remoteAddress;
    resource.fromDiskCache = response ? Boolean(response['fromDiskCache']) : resource.fromDiskCache;
    resource.fromServiceWorker = response
      ? Boolean(response['fromServiceWorker'])
      : resource.fromServiceWorker;
    resource.responseWallTime = timing.wallTime ?? resource.responseWallTime ?? timing.timestamp;
    resource.responseMonotonicTime = timing.monotonicTime ?? resource.responseMonotonicTime;

    this.syncResource(resource);

    if (this.options.streamResponseChunks && resource.streamingSupported === null) {
      this.deps.trackOperation(this.enableStreamingForRequest(requestId));
    }
  }

  private handleDataReceived(requestId: string, params: unknown, timing: EventTiming): void {
    const resource = this.getOrCreateResource(requestId);
    const payload = isObjectRecord(params) ? params : null;
    const dataLength = payload ? (asFiniteNumber(payload['dataLength']) ?? 0) : 0;
    const encodedDataLength = payload ? (asFiniteNumber(payload['encodedDataLength']) ?? 0) : 0;
    const rawChunk = payload ? asString(payload['data']) : null;

    resource.receivedDataLength += dataLength;
    resource.receivedEncodedDataLength += encodedDataLength;
    resource.chunkCount += 1;

    const allowChunkData = resource.receivedDataLength <= this.options.maxBodyBytes;
    const chunk: NetworkTraceChunk = {
      requestId,
      sequence: resource.chunkCount,
      timestamp: timing.timestamp,
      monotonicTime: timing.monotonicTime,
      dataLength,
      encodedDataLength,
      chunkData: allowChunkData ? rawChunk : null,
      chunkIsBase64: rawChunk !== null,
    };

    try {
      this.deps.getDb()?.insertNetworkChunk(chunk);
      this.counts.networkChunkCount++;
    } catch {
      // Swallow recording errors
    }

    this.syncResource(resource);
  }

  private handleLoadingFinished(requestId: string, params: unknown, timing: EventTiming): void {
    const resource = this.getOrCreateResource(requestId);
    resource.finishedWallTime = timing.wallTime ?? timing.timestamp;
    resource.finishedMonotonicTime = timing.monotonicTime ?? resource.finishedMonotonicTime;
    if (isObjectRecord(params)) {
      resource.encodedDataLength =
        asFiniteNumber(params['encodedDataLength']) ?? resource.encodedDataLength;
    }
    this.syncResource(resource);

    if (this.options.recordResponseBodies) {
      this.deps.trackOperation(this.captureResponseBody(requestId));
    }
  }

  private handleLoadingFailed(requestId: string, params: unknown, timing: EventTiming): void {
    const resource = this.getOrCreateResource(requestId);
    resource.finishedWallTime = timing.wallTime ?? timing.timestamp;
    resource.finishedMonotonicTime = timing.monotonicTime ?? resource.finishedMonotonicTime;
    resource.failed = true;
    resource.errorText = isObjectRecord(params) ? asString(params['errorText']) : null;
    this.syncResource(resource);
  }

  private async enableStreamingForRequest(requestId: string): Promise<void> {
    const cdpSession = this.deps.getCdpSession();
    const db = this.deps.getDb();
    if (!cdpSession || !db || !this.options.streamResponseChunks) return;

    const resource = this.resources.get(requestId);
    if (!resource || resource.streamingSupported !== null) {
      return;
    }

    try {
      const result = await cdpSession.send('Network.streamResourceContent', { requestId });
      resource.streamingEnabled = true;
      resource.streamingSupported = true;
      resource.streamingError = null;

      if (isObjectRecord(result)) {
        const bufferedData = asString(result['bufferedData']);
        if (bufferedData) {
          const dataLength = Buffer.from(bufferedData, 'base64').length;
          const bufferedChunk: NetworkTraceChunk = {
            requestId,
            sequence: resource.chunkCount + 1,
            timestamp: Date.now(),
            monotonicTime: resource.responseMonotonicTime,
            dataLength,
            encodedDataLength: dataLength,
            chunkData:
              resource.receivedDataLength + dataLength <= this.options.maxBodyBytes
                ? bufferedData
                : null,
            chunkIsBase64: true,
          };
          resource.chunkCount += 1;
          resource.receivedDataLength += dataLength;
          resource.receivedEncodedDataLength += dataLength;
          db.insertNetworkChunk(bufferedChunk);
          this.counts.networkChunkCount++;
        }
      }
    } catch (error) {
      resource.streamingEnabled = false;
      resource.streamingSupported = false;
      resource.streamingError = error instanceof Error ? error.message : String(error);
    } finally {
      this.syncResource(resource);
    }
  }

  private async captureResponseBody(requestId: string): Promise<void> {
    const cdpSession = this.deps.getCdpSession();
    if (!cdpSession || !this.deps.getDb() || !this.options.recordResponseBodies) return;

    const resource = this.resources.get(requestId);
    if (!resource) return;

    try {
      const rawResult = await cdpSession.send('Network.getResponseBody', { requestId });
      if (!isResponseBodyPayload(rawResult)) {
        return;
      }

      resource.bodyBase64Encoded = rawResult.base64Encoded;
      resource.bodySize = rawResult.base64Encoded
        ? Buffer.from(rawResult.body, 'base64').length
        : Buffer.byteLength(rawResult.body, 'utf8');
      resource.bodyTruncated = resource.bodySize > this.options.maxBodyBytes;

      if (resource.bodyTruncated) {
        resource.bodyCaptureState = 'truncated';
        resource.bodyInline = rawResult.body.slice(0, this.options.inlineBodyBytes);
        resource.bodyArtifactPath = null;
        resource.bodyError = `Body exceeded configured maxBodyBytes (${this.options.maxBodyBytes})`;
      } else if (resource.bodySize <= this.options.inlineBodyBytes) {
        resource.bodyCaptureState = 'inline';
        resource.bodyInline = rawResult.body;
        resource.bodyArtifactPath = null;
        resource.bodyError = null;
      } else {
        const ext = rawResult.base64Encoded ? 'b64' : 'txt';
        const { absolutePath } = await resolveArtifactPath({
          category: 'traces',
          toolName: 'trace_body',
          target: requestId.slice(0, 32),
          ext,
        });
        await writeFile(absolutePath, rawResult.body, 'utf8');
        resource.bodyCaptureState = 'artifact';
        resource.bodyInline = null;
        resource.bodyArtifactPath = absolutePath;
        resource.bodyError = null;
      }

      this.counts.networkBodyCount++;
    } catch (error) {
      resource.bodyCaptureState =
        resource.bodyCaptureState === 'none' ? 'error' : resource.bodyCaptureState;
      resource.bodyError = error instanceof Error ? error.message : String(error);
    } finally {
      this.syncResource(resource);
    }
  }

  private getOrCreateResource(requestId: string): NetworkTraceResource {
    const existing = this.resources.get(requestId);
    if (existing) {
      return existing;
    }

    const created = createNetworkTraceResource(requestId);
    this.resources.set(requestId, created);
    this.counts.networkRequestCount++;
    return created;
  }

  private syncResource(resource: NetworkTraceResource): void {
    try {
      this.deps.getDb()?.upsertNetworkResource(resource);
    } catch {
      // Swallow recording errors
    }
  }
}
