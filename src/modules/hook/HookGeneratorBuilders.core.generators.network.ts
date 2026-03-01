import type { HookOptions } from '../../types/index.js';

export function generateXHRHook(
  action: string,
  customCode?: string,
  _condition?: HookOptions['condition'],
  _performance = false
): string {
  return `
(function() {
'use strict';

const XHR = XMLHttpRequest.prototype;
const originalOpen = XHR.open;
const originalSend = XHR.send;
const originalSetRequestHeader = XHR.setRequestHeader;

XHR.open = function(method, url, async, user, password) {
  this._hookData = {
    method: method,
    url: url,
    async: async !== false,
    timestamp: Date.now(),
    headers: {},
    stackTrace: new Error().stack
  };

  console.log('[XHR Hook] open:', {
    method: method,
    url: url,
    async: async !== false
  });

  ${action === 'block' ? 'return;' : ''}

  return originalOpen.apply(this, arguments);
};

XHR.setRequestHeader = function(header, value) {
  if (this._hookData) {
    this._hookData.headers[header] = value;
    console.log('[XHR Hook] setRequestHeader:', { header, value });
  }

  return originalSetRequestHeader.apply(this, arguments);
};

XHR.send = function(data) {
  const xhr = this;

  if (xhr._hookData) {
    xhr._hookData.requestData = data;
    xhr._hookData.sendTime = Date.now();

    console.log('[XHR Hook] send:', {
      url: xhr._hookData.url,
      method: xhr._hookData.method,
      headers: xhr._hookData.headers,
      data: data
    });
  }

  const originalOnReadyStateChange = xhr.onreadystatechange;

  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4) {
      const responseTime = Date.now() - (xhr._hookData?.sendTime || 0);

      console.log('[XHR Hook] response:', {
        url: xhr._hookData?.url,
        status: xhr.status,
        statusText: xhr.statusText,
        responseTime: responseTime + 'ms',
        responseHeaders: xhr.getAllResponseHeaders(),
        responseType: xhr.responseType,
        responseURL: xhr.responseURL
      });

      try {
        if (xhr.responseType === '' || xhr.responseType === 'text') {
          console.log('[XHR Hook] responseText:', xhr.responseText?.substring(0, 500));
        } else if (xhr.responseType === 'json') {
          console.log('[XHR Hook] responseJSON:', xhr.response);
        } else {
          console.log('[XHR Hook] response:', typeof xhr.response);
        }
      } catch (e) {
        console.warn('[XHR Hook] Failed to log response:', e);
      }
    }

    if (originalOnReadyStateChange) {
      return originalOnReadyStateChange.apply(this, arguments);
    }
  };

  const originalAddEventListener = xhr.addEventListener;
  xhr.addEventListener = function(event, listener, ...args) {
    if (event === 'load' || event === 'error' || event === 'abort') {
      const wrappedListener = function(e) {
        console.log(\`[XHR Hook] event '\${event}':\`, {
          url: xhr._hookData?.url,
          status: xhr.status
        });
        return listener.apply(this, arguments);
      };
      return originalAddEventListener.call(this, event, wrappedListener, ...args);
    }
    return originalAddEventListener.apply(this, arguments);
  };

  ${customCode || ''}

  return originalSend.apply(this, arguments);
};

console.log('[Hook] XHR hooked successfully');
})();
`.trim();
}

export function generateFetchHook(
  action: string,
  customCode?: string,
  _condition?: HookOptions['condition'],
  _performance = false
): string {
  return `
(function() {
'use strict';

const originalFetch = window.fetch;

window.fetch = new Proxy(originalFetch, {
  apply: function(target, thisArg, args) {
    const [resource, config] = args;

    let url, method, headers, body;

    if (resource instanceof Request) {
      url = resource.url;
      method = resource.method;
      headers = Object.fromEntries(resource.headers.entries());
      body = resource.body;
    } else {
      url = resource;
      method = config?.method || 'GET';
      headers = config?.headers || {};
      body = config?.body;
    }

    const hookContext = {
      url: url,
      method: method,
      headers: headers,
      body: body,
      timestamp: Date.now(),
      stackTrace: new Error().stack.split('\\n').slice(2, 5).join('\\n')
    };

    console.log('[Fetch Hook] request:', hookContext);

    ${action === 'block' ? 'return Promise.reject(new Error("Fetch blocked by hook"));' : ''}
    ${customCode || ''}

    const startTime = performance.now();

    return Reflect.apply(target, thisArg, args)
      .then(async response => {
        const endTime = performance.now();
        const duration = (endTime - startTime).toFixed(2);

        const clonedResponse = response.clone();

        const responseInfo = {
          url: url,
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          redirected: response.redirected,
          type: response.type,
          headers: Object.fromEntries(response.headers.entries()),
          duration: duration + 'ms'
        };

        console.log('[Fetch Hook] response:', responseInfo);

        try {
          const contentType = response.headers.get('content-type') || '';

          if (contentType.includes('application/json')) {
            const json = await clonedResponse.json();
            console.log('[Fetch Hook] responseJSON:', json);
          } else if (contentType.includes('text/')) {
            const text = await clonedResponse.text();
            console.log('[Fetch Hook] responseText:', text.substring(0, 500));
          } else {
            console.log('[Fetch Hook] response type:', contentType);
          }
        } catch (e) {
          console.warn('[Fetch Hook] Failed to parse response:', e.message);
        }

        return response;
      })
      .catch(error => {
        const endTime = performance.now();
        const duration = (endTime - startTime).toFixed(2);

        console.error('[Fetch Hook] error:', {
          url: url,
          error: error.message,
          duration: duration + 'ms'
        });

        throw error;
      });
  }
});

console.log('[Fetch Hook] Successfully hooked window.fetch');
})();
`.trim();
}

export function generateWebSocketHook(
  action: string,
  customCode?: string,
  _condition?: HookOptions['condition'],
  _performance = false
): string {
  return `
(function() {
'use strict';

const OriginalWebSocket = window.WebSocket;
let wsCounter = 0;

window.WebSocket = function(url, protocols) {
  const wsId = ++wsCounter;
  const connectTime = Date.now();

  console.log(\`[WebSocket Hook #\${wsId}] connecting:\`, {
    url: url,
    protocols: protocols,
    timestamp: new Date().toISOString()
  });

  ${action === 'block' ? 'throw new Error("WebSocket blocked by hook");' : ''}

  const ws = new OriginalWebSocket(url, protocols);

  const originalSend = ws.send;
  ws.send = function(data) {
    const dataInfo = {
      wsId: wsId,
      url: url,
      timestamp: new Date().toISOString(),
      dataType: typeof data,
      size: data?.length || data?.byteLength || data?.size || 0
    };

    if (typeof data === 'string') {
      dataInfo.content = data.length > 500 ? data.substring(0, 500) + '...' : data;
    } else if (data instanceof ArrayBuffer) {
      dataInfo.content = \`ArrayBuffer(\${data.byteLength} bytes)\`;
    } else if (data instanceof Blob) {
      dataInfo.content = \`Blob(\${data.size} bytes, \${data.type})\`;
    }

    console.log(\`[WebSocket Hook #\${wsId}] send:\`, dataInfo);

    ${customCode || ''}

    return originalSend.apply(this, arguments);
  };

  ws.addEventListener('open', function(event) {
    const duration = Date.now() - connectTime;
    console.log(\`[WebSocket Hook #\${wsId}] open:\`, {
      url: url,
      readyState: ws.readyState,
      protocol: ws.protocol,
      extensions: ws.extensions,
      duration: duration + 'ms'
    });
  });

  ws.addEventListener('message', function(event) {
    const messageInfo = {
      wsId: wsId,
      url: url,
      timestamp: new Date().toISOString(),
      dataType: typeof event.data
    };

    if (typeof event.data === 'string') {
      messageInfo.content = event.data.length > 500 ? event.data.substring(0, 500) + '...' : event.data;
    } else if (event.data instanceof ArrayBuffer) {
      messageInfo.content = \`ArrayBuffer(\${event.data.byteLength} bytes)\`;
    } else if (event.data instanceof Blob) {
      messageInfo.content = \`Blob(\${event.data.size} bytes, \${event.data.type})\`;
    }

    console.log(\`[WebSocket Hook #\${wsId}] message:\`, messageInfo);
  });

  ws.addEventListener('error', function(event) {
    console.error(\`[WebSocket Hook #\${wsId}] error:\`, {
      url: url,
      readyState: ws.readyState,
      timestamp: new Date().toISOString()
    });
  });

  ws.addEventListener('close', function(event) {
    const duration = Date.now() - connectTime;
    console.log(\`[WebSocket Hook #\${wsId}] close:\`, {
      url: url,
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
      duration: duration + 'ms',
      timestamp: new Date().toISOString()
    });
  });

  return ws;
};

window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
window.WebSocket.OPEN = OriginalWebSocket.OPEN;
window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;

console.log('[WebSocket Hook] Successfully hooked window.WebSocket');
})();
`.trim();
}

