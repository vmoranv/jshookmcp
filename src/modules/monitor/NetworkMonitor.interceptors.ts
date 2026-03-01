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

        window.XMLHttpRequest = function() {
          const xhr = new originalXHR();
          const requestInfo = {
            method: '',
            url: '',
            requestHeaders: {},
            responseHeaders: {},
            status: 0,
            response: null,
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

          const originalSend = xhr.send;
          xhr.send = function(body) {
            console.log('[XHRInterceptor] XHR sent:', requestInfo.url, 'Body:', body);

            xhr.addEventListener('load', function() {
              requestInfo.status = xhr.status;
              requestInfo.response = xhr.response;
              requestInfo.responseHeaders = xhr.getAllResponseHeaders();

              xhrRequests.push(requestInfo);
              if (xhrRequests.length > ${maxRecords}) {
                xhrRequests.splice(0, xhrRequests.length - ${maxRecords});
              }
              console.log('[XHRInterceptor] XHR completed:', requestInfo.url, 'Status:', xhr.status);
            });

            return originalSend.call(xhr, body);
          };

          return xhr;
        };

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

        window.fetch = function(url, options = {}) {
          const requestInfo = {
            url: typeof url === 'string' ? url : url.url,
            method: options.method || 'GET',
            headers: options.headers || {},
            body: options.body,
            timestamp: Date.now(),
            response: null,
            status: 0,
          };

          console.log('[FetchInterceptor] Fetch called:', requestInfo.method, requestInfo.url);

          return originalFetch.call(window, url, options).then(async (response) => {
            requestInfo.status = response.status;

            const clonedResponse = response.clone();
            try {
              requestInfo.response = await clonedResponse.text();
            } catch (e) {
              requestInfo.response = '[Unable to read response]';
            }

            fetchRequests.push(requestInfo);
            if (fetchRequests.length > ${maxRecords}) {
              fetchRequests.splice(0, fetchRequests.length - ${maxRecords});
            }
            // Auto-persist compact summary to localStorage so data survives context compression
            try {
              const summary = { url: requestInfo.url, method: requestInfo.method, status: requestInfo.status, ts: requestInfo.timestamp };
              const prev = JSON.parse(localStorage.getItem('__capturedAPIs') || '[]');
              prev.push(summary);
              if (prev.length > 500) prev.splice(0, prev.length - 500);
              localStorage.setItem('__capturedAPIs', JSON.stringify(prev));
            } catch(e) {}
            console.log('[FetchInterceptor] Fetch completed:', requestInfo.url, 'Status:', response.status);

            return response;
          }).catch((error) => {
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
