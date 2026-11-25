/** Response body preview size (UTF-16 code units) kept in-page by the fetch interceptor (b2-1).
 *  The full body is fetched on demand via the host-side Network.getResponseBody channel. */
const RESPONSE_PREVIEW_LIMIT = 2_048;

/** Throttle interval (ms) for the batched `__capturedAPIs` localStorage write (b2-2). */
const CAPTURED_API_PERSIST_INTERVAL_MS = 1_000;

/** Maximum number of summaries persisted to the `__capturedAPIs` localStorage entry. */
const CAPTURED_API_MAX_ENTRIES = 500;

export function buildXHRInterceptorCode(maxRecords: number): string {
  return `
      (function() {
        if (window.__xhrInterceptorInstalled) {
          console.log('[XHRInterceptor] Already installed');
          return;
        }
        window.__xhrInterceptorInstalled = true;

        const originalXHR = window.__originalXMLHttpRequestForHook || window.XMLHttpRequest;
        window.__originalXMLHttpRequestForHook = originalXHR;
        if (!window.__xhrRequests) {
          window.__xhrRequests = [];
        }
        const xhrRequests = window.__xhrRequests;

        const XHRWrapper = function() {
          const xhr = new originalXHR();
          const requestInfo = {
            method: '',
            url: '',
            requestHeaders: {},
            responseHeaders: '',
            status: 0,
            response: null,
            responseLength: null,
            responseTruncated: false,
            responseType: '',
            timestamp: Date.now(),
          };

          const originalOpen = xhr.open;
          xhr.open = function(method, url, ...args) {
            requestInfo.method = method;
            requestInfo.url = url;
            console.log('[XHRInterceptor] XHR opened:', method, url);
            return originalOpen.call(xhr, method, url, ...args);
          };

          const originalSetRequestHeader = xhr.setRequestHeader;
          xhr.setRequestHeader = function(header, value) {
            requestInfo.requestHeaders[header] = value;
            return originalSetRequestHeader.call(xhr, header, value);
          };

          const record = function(outcome) {
            if (requestInfo.outcome) return;
            requestInfo.status = xhr.status;
            requestInfo.responseHeaders = xhr.getAllResponseHeaders();
            requestInfo.responseType = xhr.responseType || '';
            try {
              // responseText throws for blob/arraybuffer/document responses.
              const rawResponse =
                !requestInfo.responseType || requestInfo.responseType === 'text'
                  ? xhr.responseText
                  : xhr.response;
              if (typeof rawResponse === 'string') {
                requestInfo.responseLength = rawResponse.length;
                requestInfo.responseTruncated =
                  rawResponse.length > ${RESPONSE_PREVIEW_LIMIT};
                requestInfo.response = requestInfo.responseTruncated
                  ? rawResponse.slice(0, ${RESPONSE_PREVIEW_LIMIT})
                  : rawResponse;
              } else if (rawResponse === null || rawResponse === undefined) {
                requestInfo.response = null;
              } else {
                // Non-text bodies cannot be serialized by
                // Runtime.evaluate({ returnByValue: true }); keep a tag and
                // the byte size instead of shipping the binary payload.
                requestInfo.response = '[non-text response]';
                requestInfo.responseLength =
                  typeof rawResponse.byteLength === 'number'
                    ? rawResponse.byteLength
                    : typeof rawResponse.size === 'number'
                      ? rawResponse.size
                      : null;
              }
            } catch (e) {
              requestInfo.response = null;
            }
            requestInfo.outcome = outcome;

            xhrRequests.push(requestInfo);
            if (xhrRequests.length > ${maxRecords}) {
              xhrRequests.splice(0, xhrRequests.length - ${maxRecords});
            }
            console.log(
              '[XHRInterceptor] XHR completed:',
              requestInfo.url,
              'Status:',
              xhr.status,
              'Outcome:',
              outcome,
            );
          };

          const originalSend = xhr.send;
          xhr.send = function(body) {
            let bodySize = 0;
            try {
              if (typeof body === 'string') bodySize = body.length;
              else if (body && typeof body.byteLength === 'number') bodySize = body.byteLength;
              else if (body && typeof body.size === 'number') bodySize = body.size;
            } catch {}
            console.log('[XHRInterceptor] XHR sent:', requestInfo.url, 'BodySize:', bodySize);

            xhr.addEventListener('load', function() { record('load'); });
            xhr.addEventListener('error', function() { record('error'); });
            xhr.addEventListener('timeout', function() { record('timeout'); });
            xhr.addEventListener('abort', function() { record('abort'); });

            return originalSend.call(xhr, body);
          };

          return xhr;
        };
        // Preserve instanceof and the static readyState constants
        // (XMLHttpRequest.DONE/OPENED/...) while still returning orig instances.
        XHRWrapper.prototype = originalXHR.prototype;
        try {
          Object.setPrototypeOf(XHRWrapper, originalXHR);
        } catch (e) {}
        window.XMLHttpRequest = XHRWrapper;

        window.__getXHRRequests = function() {
          return window.__xhrRequests || [];
        };

        console.log('[XHRInterceptor] XHR interceptor installed');
      })();
    `;
}

export function buildFetchInterceptorCode(maxRecords: number): string {
  return `
      (function() {
        if (window.__fetchInterceptorInstalled) {
          console.log('[FetchInterceptor] Already installed');
          return;
        }
        window.__fetchInterceptorInstalled = true;

        const originalFetch = window.__originalFetchForHook || window.fetch;
        window.__originalFetchForHook = originalFetch;
        if (!window.__fetchRequests) {
          window.__fetchRequests = [];
        }
        const fetchRequests = window.__fetchRequests;

        // BEHAVIOR CHANGE (b2-2): throttle __capturedAPIs persistence. Summaries are
        // buffered in-page and flushed in a single batch per interval instead of
        // synchronously rewriting localStorage (JSON.parse + stringify + setItem)
        // on every completed request.
        const capturedApiBuffer = [];
        let capturedApiFlushTimer = null;
        const flushCapturedApis = function() {
          capturedApiFlushTimer = null;
          if (capturedApiBuffer.length === 0) return;
          try {
            const pending = capturedApiBuffer.splice(0, capturedApiBuffer.length);
            const prev = JSON.parse(localStorage.getItem('__capturedAPIs') || '[]');
            const merged = prev.concat(pending);
            const trimmed = merged.length > ${CAPTURED_API_MAX_ENTRIES}
              ? merged.slice(merged.length - ${CAPTURED_API_MAX_ENTRIES})
              : merged;
            localStorage.setItem('__capturedAPIs', JSON.stringify(trimmed));
          } catch (e) {
            // best-effort persistence only; ignore quota or serialization failures
          }
        };

        window.fetch = function(url, options = {}) {
          const requestInfo = {
            url: typeof url === 'string' ? url : url.url,
            method: options.method || 'GET',
            headers: options.headers || {},
            body: options.body,
            timestamp: Date.now(),
            // BEHAVIOR CHANGE (b2-1): only a truncated preview of the response body
            // is kept in-page. The full body remains available on demand through the
            // host-side Network.getResponseBody channel.
            responsePreview: null,
            status: 0,
          };

          console.log('[FetchInterceptor] Fetch called:', requestInfo.method, requestInfo.url);

          const recordRequest = function() {
            fetchRequests.push(requestInfo);
            if (fetchRequests.length > ${maxRecords}) {
              fetchRequests.splice(0, fetchRequests.length - ${maxRecords});
            }
            // Auto-persist compact summary to localStorage so data survives context compression
            try {
              capturedApiBuffer.push({ url: requestInfo.url, method: requestInfo.method, status: requestInfo.status, ts: requestInfo.timestamp });
              if (capturedApiFlushTimer === null) {
                capturedApiFlushTimer = setTimeout(flushCapturedApis, ${CAPTURED_API_PERSIST_INTERVAL_MS});
              }
            } catch (e) {
              // best-effort persistence only; ignore quota or serialization failures
            }
          };

          // Read the preview out-of-band: callers must never wait for the body.
          // Binary/document payloads are not decoded as UTF-8 text.
          const capturePreview = function(response, info) {
            let contentType = '';
            try {
              if (response.headers && typeof response.headers.get === 'function') {
                contentType = response.headers.get('content-type') || '';
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
              info.responsePreview = '[non-text response]';
              return;
            }
            try {
              const cloned = response.clone();
              if (typeof cloned.text !== 'function') {
                info.responsePreview = '[Unable to read response]';
                return;
              }
              void cloned.text().then(
                function(fullText) {
                  const fullLength = fullText.length;
                  info.responseLength = fullLength;
                  info.responseTruncated = fullLength > ${RESPONSE_PREVIEW_LIMIT};
                  info.responsePreview = info.responseTruncated
                    ? fullText.slice(0, ${RESPONSE_PREVIEW_LIMIT})
                    : fullText;
                },
                function() {
                  info.responsePreview = '[Unable to read response]';
                },
              );
            } catch (e) {
              info.responsePreview = '[Unable to read response]';
            }
          };

          return originalFetch.call(window, url, options).then((response) => {
            requestInfo.status = response.status;
            requestInfo.outcome = 'fulfilled';
            capturePreview(response, requestInfo);
            recordRequest();
            console.log('[FetchInterceptor] Fetch completed:', requestInfo.url, 'Status:', response.status);
            return response;
          }).catch((error) => {
            requestInfo.outcome = 'rejected';
            requestInfo.error = String(error && error.message ? error.message : error);
            recordRequest();
            console.error('[FetchInterceptor] Fetch failed:', requestInfo.url, error);
            throw error;
          });
        };

        window.__getFetchRequests = function() {
          return window.__fetchRequests || [];
        };

        console.log('[FetchInterceptor] Fetch interceptor installed');
      })();
    `;
}

export const CLEAR_INJECTED_BUFFERS_EXPRESSION = `
          (() => {
            const xhrStore = Array.isArray(window.__xhrRequests)
              ? window.__xhrRequests
              : (typeof window.__getXHRRequests === 'function' ? window.__getXHRRequests() : null);
            const fetchStore = Array.isArray(window.__fetchRequests)
              ? window.__fetchRequests
              : (typeof window.__getFetchRequests === 'function' ? window.__getFetchRequests() : null);

            const xhrCleared = Array.isArray(xhrStore) ? xhrStore.length : 0;
            const fetchCleared = Array.isArray(fetchStore) ? fetchStore.length : 0;

            if (Array.isArray(xhrStore)) xhrStore.length = 0;
            if (Array.isArray(fetchStore)) fetchStore.length = 0;

            return { xhrCleared, fetchCleared };
          })()
        `;

export const RESET_INJECTED_INTERCEPTORS_EXPRESSION = `
          (() => {
            let xhrReset = false;
            let fetchReset = false;

            if (window.__originalXMLHttpRequestForHook) {
              window.XMLHttpRequest = window.__originalXMLHttpRequestForHook;
              xhrReset = true;
            }

            if (window.__originalFetchForHook) {
              window.fetch = window.__originalFetchForHook;
              fetchReset = true;
            }

            if (Array.isArray(window.__xhrRequests)) window.__xhrRequests.length = 0;
            if (Array.isArray(window.__fetchRequests)) window.__fetchRequests.length = 0;

            window.__xhrInterceptorInstalled = false;
            window.__fetchInterceptorInstalled = false;
            delete window.__getXHRRequests;
            delete window.__getFetchRequests;

            return { xhrReset, fetchReset };
          })()
        `;
