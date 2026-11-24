import type { PlaywrightLikePage, BridgeWindow } from './PlaywrightNetworkMonitor.types';
import {
  isUnknownArray,
  isClearedBuffersResult,
  isResetInterceptorsResult,
} from './PlaywrightNetworkMonitor.types';

const MAX_INJECTED_RECORDS = 500;

async function evaluateInPage<T>(
  page: PlaywrightLikePage,
  pageFunction: string | (() => T | Promise<T>),
): Promise<T> {
  if (!page.evaluate) {
    throw new Error('Playwright page.evaluate is not available');
  }
  return page.evaluate<T>(pageFunction);
}

async function evaluateOnNewDocumentInPage<T>(
  page: PlaywrightLikePage,
  pageFunction: string | (() => T | Promise<T>),
): Promise<T> {
  if (!page.evaluateOnNewDocument) {
    throw new Error('Playwright page.evaluateOnNewDocument is not available');
  }
  return page.evaluateOnNewDocument<T>(pageFunction);
}

export async function injectXHRInterceptor(
  page: PlaywrightLikePage,
  options?: { persistent?: boolean },
): Promise<void> {
  const script = `
    (function() {
      if (window.__xhrInterceptorInjected) return;
      window.__xhrInterceptorInjected = true;
      const maxRecords = ${MAX_INJECTED_RECORDS};
      const OrigXHR = window.__pwOriginalXMLHttpRequest || window.XMLHttpRequest;
      window.__pwOriginalXMLHttpRequest = OrigXHR;
      if (!window.__xhrRequests) window.__xhrRequests = [];
      const XHRWrapper = function() {
        const xhr = new OrigXHR();
        const origOpen = xhr.open.bind(xhr);
        const origSend = xhr.send.bind(xhr);
        xhr.open = function(method, url, ...rest) {
          xhr.__hookMeta = { method, url, timestamp: Date.now() };
          return origOpen(method, url, ...rest);
        };
        xhr.send = function(body) {
          let recorded = false;
          const record = function(outcome) {
            if (recorded) return;
            recorded = true;
            let response = null;
            try {
              const type = xhr.responseType;
              const raw =
                !type || type === 'text' ? xhr.responseText : xhr.response;
              response =
                typeof raw === 'string'
                  ? raw.slice(0, 2048)
                  : raw === null || raw === undefined
                    ? null
                    : '[non-text response]';
            } catch (e) {
              // responseText throws for blob/arraybuffer/document responses.
              response = null;
            }
            window.__xhrRequests.push({
              ...xhr.__hookMeta, body: body ? String(body).slice(0, 2048) : null,
              status: xhr.status, outcome, response,
            });
            if (window.__xhrRequests.length > maxRecords) {
              window.__xhrRequests.splice(0, window.__xhrRequests.length - maxRecords);
            }
          };
          xhr.addEventListener('load', function() { record('load'); });
          xhr.addEventListener('error', function() { record('error'); });
          xhr.addEventListener('timeout', function() { record('timeout'); });
          xhr.addEventListener('abort', function() { record('abort'); });
          return origSend(body);
        };
        return xhr;
      };
      XHRWrapper.prototype = OrigXHR.prototype;
      try {
        Object.setPrototypeOf(XHRWrapper, OrigXHR);
      } catch (e) {}
      window.XMLHttpRequest = XHRWrapper;
      console.log('[PlaywrightXHR] XHR interceptor injected');
    })();
  `;
  if (options?.persistent) {
    await evaluateOnNewDocumentInPage<void>(page, script);
  } else {
    await evaluateInPage<void>(page, script);
  }
}

export async function injectFetchInterceptor(
  page: PlaywrightLikePage,
  options?: { persistent?: boolean },
): Promise<void> {
  const script = `
    (function() {
      if (window.__fetchInterceptorInjected) return;
      window.__fetchInterceptorInjected = true;
      const maxRecords = ${MAX_INJECTED_RECORDS};
      const origFetch = window.__pwOriginalFetch || window.fetch;
      window.__pwOriginalFetch = origFetch;
      if (!window.__fetchRequests) window.__fetchRequests = [];
      const normalizeHeaders = (value) => {
        if (!value) return {};
        try {
          if (typeof Headers !== 'undefined' && value instanceof Headers) {
            return Object.fromEntries(value.entries());
          }
        } catch {}
        if (Array.isArray(value)) {
          try {
            return Object.fromEntries(value);
          } catch {
            return {};
          }
        }
        return typeof value === 'object' ? value : {};
      };
      window.fetch = function(...args) {
        const [resource, opts = {}] = args;
        const requestLike = resource && typeof resource === 'object' ? resource : null;
        const url =
          typeof resource === 'string'
            ? resource
            : typeof resource?.url === 'string'
              ? resource.url
              : String(resource);
        const method = opts?.method || requestLike?.method || 'GET';
        const headers = normalizeHeaders(opts?.headers || requestLike?.headers);
        const bodySource = opts?.body;
        const body =
          bodySource === undefined || bodySource === null
            ? null
            : String(bodySource).slice(0, 2048);
        const entry = {
          url,
          method,
          headers,
          body,
          timestamp: Date.now(),
          response: null,
          status: 0,
        };
        const recordEntry = function() {
          window.__fetchRequests.push(entry);
          if (window.__fetchRequests.length > maxRecords) {
            window.__fetchRequests.splice(0, window.__fetchRequests.length - maxRecords);
          }
          // Auto-persist compact summary so data survives context compression
          try {
            const s = { url: entry.url, method: entry.method, status: entry.status, ts: entry.timestamp };
            const prev = JSON.parse(localStorage.getItem('__capturedAPIs') || '[]');
            prev.push(s);
            if (prev.length > 500) prev.splice(0, prev.length - 500);
            localStorage.setItem('__capturedAPIs', JSON.stringify(prev));
          } catch(e) {}
        };
        const capturePreview = function(res, info) {
          let contentType = '';
          try {
            const headers = res.headers;
            if (headers && typeof headers.get === 'function') {
              contentType = headers.get('content-type') || '';
            }
          } catch (e) {}
          const lower = String(contentType).toLowerCase();
          const isText =
            lower === '' ||
            lower.indexOf('text/') === 0 ||
            lower.indexOf('json') !== -1 ||
            lower.indexOf('javascript') !== -1 ||
            lower.indexOf('xml') !== -1 ||
            lower.indexOf('x-www-form-urlencoded') !== -1;
          if (!isText) {
            info.response = '[non-text response]';
            return;
          }
          try {
            const cloned = res.clone();
            if (!cloned || typeof cloned.text !== 'function') {
              info.response = '[Unable to read response]';
              return;
            }
            // Out-of-band: never delay the caller on body download.
            void cloned.text().then(
              (text) => {
                info.response = text.slice(0, 2048);
              },
              () => {
                info.response = '[Unable to read response]';
              },
            );
          } catch (e) {
            info.response = '[Unable to read response]';
          }
        };
        return origFetch.apply(this, args).then(
          (res) => {
            entry.status = res.status;
            entry.outcome = 'fulfilled';
            capturePreview(res, entry);
            recordEntry();
            return res;
          },
          (error) => {
            entry.outcome = 'rejected';
            entry.error = String(error && error.message ? error.message : error);
            recordEntry();
            throw error;
          },
        );
      };
      console.log('[PlaywrightFetch] Fetch interceptor injected');
    })();
  `;
  if (options?.persistent) {
    await evaluateOnNewDocumentInPage<void>(page, script);
  } else {
    await evaluateInPage<void>(page, script);
  }
}

export async function getXHRRequests(page: PlaywrightLikePage): Promise<unknown[]> {
  try {
    const result: unknown = await evaluateInPage(page, () => {
      const bridgeWindow = window as BridgeWindow;
      return bridgeWindow.__xhrRequests ?? [];
    });
    return isUnknownArray(result) ? result : [];
  } catch {
    return [];
  }
}

export async function getFetchRequests(page: PlaywrightLikePage): Promise<unknown[]> {
  try {
    const result: unknown = await evaluateInPage(page, () => {
      const bridgeWindow = window as BridgeWindow;
      return bridgeWindow.__fetchRequests ?? [];
    });
    return isUnknownArray(result) ? result : [];
  } catch {
    return [];
  }
}

export async function clearInjectedBuffers(
  page: PlaywrightLikePage,
): Promise<{ xhrCleared: number; fetchCleared: number }> {
  try {
    const result: unknown = await evaluateInPage(page, () => {
      const bridgeWindow = window as BridgeWindow;
      const xhrRequests = bridgeWindow.__xhrRequests;
      const fetchRequests = bridgeWindow.__fetchRequests;

      const xhrCleared = Array.isArray(xhrRequests) ? xhrRequests.length : 0;
      const fetchCleared = Array.isArray(fetchRequests) ? fetchRequests.length : 0;

      if (Array.isArray(xhrRequests)) {
        xhrRequests.length = 0;
      }
      if (Array.isArray(fetchRequests)) {
        fetchRequests.length = 0;
      }

      return { xhrCleared, fetchCleared };
    });
    return isClearedBuffersResult(result) ? result : { xhrCleared: 0, fetchCleared: 0 };
  } catch {
    return { xhrCleared: 0, fetchCleared: 0 };
  }
}

export async function resetInjectedInterceptors(
  page: PlaywrightLikePage,
): Promise<{ xhrReset: boolean; fetchReset: boolean }> {
  try {
    const result: unknown = await evaluateInPage(page, () => {
      const bridgeWindow = window as BridgeWindow;
      let xhrReset = false;
      let fetchReset = false;

      if (bridgeWindow.__pwOriginalXMLHttpRequest) {
        bridgeWindow.XMLHttpRequest = bridgeWindow.__pwOriginalXMLHttpRequest;
        xhrReset = true;
      }

      if (bridgeWindow.__pwOriginalFetch) {
        bridgeWindow.fetch = bridgeWindow.__pwOriginalFetch;
        fetchReset = true;
      }

      if (Array.isArray(bridgeWindow.__xhrRequests)) {
        bridgeWindow.__xhrRequests.length = 0;
      }
      if (Array.isArray(bridgeWindow.__fetchRequests)) {
        bridgeWindow.__fetchRequests.length = 0;
      }

      bridgeWindow.__xhrInterceptorInjected = false;
      bridgeWindow.__fetchInterceptorInjected = false;

      return { xhrReset, fetchReset };
    });
    return isResetInterceptorsResult(result) ? result : { xhrReset: false, fetchReset: false };
  } catch {
    return { xhrReset: false, fetchReset: false };
  }
}
